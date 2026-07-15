/**
 * Knowledge Lint tests (Phase 2 M8) — deterministic governance check, 0 AI.
 *   npm run build -w @qa/shared && node --test packages/shared/knowledge-lint.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lintKnowledgeProposals } from './dist/index.js';

const corpus = [
  { path: 'docs/ai/business/business-rules.md', title: 'Business Rules', text: 'Cashback perks redemption rules and coupon stacking limits for the loyalty program.' },
  { path: 'docs/ai/automation/playwright-framework.md', title: 'Playwright Framework', text: 'Page objects, helpers, fixtures for the web automation framework.' },
];

test('deterministic — same input ⇒ same output', () => {
  const input = { proposals: [{ docPath: 'docs/ai/business/loyalty.md', summary: 'New loyalty tier rule for gold members', rationale: 'reusable rule' }], corpus };
  assert.equal(JSON.stringify(lintKnowledgeProposals(input)), JSON.stringify(lintKnowledgeProposals(input)));
});

test('placement — a path outside docs/ai is rejected', () => {
  const r = lintKnowledgeProposals({ proposals: [{ docPath: 'notes/random.md', summary: 'Something reusable about perks redemption', rationale: 'x' }], corpus });
  const p = r.proposals[0];
  assert.equal(p.verdict, 'reject');
  assert.ok(p.issues.some((i) => i.kind === 'placement' && i.severity === 'error'));
  assert.equal(r.summary.placementIssues, 1);
});

test('placement — non-markdown path is rejected', () => {
  const r = lintKnowledgeProposals({ proposals: [{ docPath: 'docs/ai/business/rules.txt', summary: 'Reusable perks redemption knowledge here', rationale: 'x' }], corpus });
  assert.equal(r.proposals[0].verdict, 'reject');
});

test('duplicate — high lexical overlap with an existing doc is flagged for review', () => {
  const r = lintKnowledgeProposals({
    proposals: [{ docPath: 'docs/ai/business/cashback.md', summary: 'Cashback perks redemption rules and coupon stacking limits loyalty program', rationale: 'rules' }],
    corpus,
  });
  const p = r.proposals[0];
  assert.equal(p.verdict, 'review');
  assert.ok(p.issues.some((i) => i.kind === 'duplicate'));
  assert.equal(p.similarTo.path, 'docs/ai/business/business-rules.md');
  assert.ok(r.summary.duplicates >= 1);
});

test('conflict — contradiction language on a shared topic is surfaced', () => {
  const r = lintKnowledgeProposals({
    proposals: [{ docPath: 'docs/ai/business/business-rules.md', summary: 'Coupon stacking is no longer allowed; replace the old cashback redemption rules', rationale: 'policy change' }],
    corpus,
  });
  const p = r.proposals[0];
  assert.ok(p.issues.some((i) => i.kind === 'conflict'), 'conflict flagged');
  assert.ok(r.summary.conflicts >= 1);
});

test('quality — vague summary + missing rationale flagged; clean proposal is ok', () => {
  const r = lintKnowledgeProposals({
    proposals: [
      { docPath: 'docs/ai/misc.md', summary: 'update docs' },
      { docPath: 'docs/ai/modules/checkout.md', summary: 'Checkout bottom-sheet reuses the shared PaymentSheet component object', rationale: 'reusable automation pattern' },
    ],
    corpus,
  });
  const vague = r.proposals[0];
  assert.ok(vague.issues.some((i) => i.kind === 'quality'));
  assert.ok(vague.issues.some((i) => i.severity === 'info' && /rationale/i.test(i.message)));
  const clean = r.proposals[1];
  assert.equal(clean.verdict, 'ok');
  assert.equal(clean.issues.length, 0);
});

test('in-batch duplicate proposals are flagged', () => {
  const r = lintKnowledgeProposals({
    proposals: [
      { docPath: 'docs/ai/a.md', summary: 'Reusable OTP handling for card activation flow', rationale: 'x' },
      { docPath: 'docs/ai/b.md', summary: 'Reusable OTP handling for card activation flow', rationale: 'y' },
    ],
    corpus: [],
  });
  assert.ok(r.proposals[1].issues.some((i) => /batch/i.test(i.message)));
});

test('empty corpus still runs placement + quality checks', () => {
  const r = lintKnowledgeProposals({ proposals: [{ docPath: 'docs/ai/x.md', summary: 'A specific reusable testing convention for BrowserStack', rationale: 'x' }] });
  assert.equal(r.proposals[0].verdict, 'ok');
  assert.equal(r.summary.total, 1);
});
