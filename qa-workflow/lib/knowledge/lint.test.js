'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { lintTeamContext, lintDomain, SECTIONS } = require('./lint');
const { knowledgeStatus } = require('./status');

const REPO = path.join(__dirname, '..', '..', '..');
const REGISTRY = require(path.join(REPO, 'qa-workflow/registry/knowledge.json'));

function teamDir(context, repos) {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'kl-')), 'orders');
  fs.mkdirSync(dir);
  if (context != null) fs.writeFileSync(path.join(dir, 'context.md'), context);
  if (repos !== undefined) fs.writeFileSync(path.join(dir, 'repos.json'), typeof repos === 'string' ? repos : JSON.stringify(repos));
  return dir;
}

/** A minimal valid context: every section, one tagged fact each, an open question for the unknown. */
function validContext(extra = {}) {
  const body = SECTIONS.filter((s) => s !== 'Open questions / unknowns').map((s) => `## ${s}\n${extra[s] || '- A fact. [tester: Orders QA lead; 2026-11-24]'}\n`).join('\n');
  return `# Orders — team context\n\nverifiedAt: 2026-11-24 · verifiedBy: Orders QA lead\n\n${body}\n## Open questions / unknowns\n${extra.open || '- Which repos may QA read?'}\n`;
}
const lint = (ctx, repos = [], own = ['payment']) => lintTeamContext(teamDir(ctx, repos), { ownDomains: own, registry: REGISTRY });
const codes = (r) => r.errors.map((e) => e.code);

test('the real card-core context passes (Card is the reference)', () => {
  const r = lintTeamContext(path.join(REPO, 'teams/card-core'), { ownDomains: ['card', 'payment', 'marketing'], registry: REGISTRY });
  assert.deepEqual(r.errors, []);
  assert.ok(r.stats.confirmed > 0 && r.stats.unknown > 0);
});

test('a valid context passes and counts each confidence class', () => {
  const r = lint(validContext({
    Product: '- Sells groceries. [confirmed: doc:https://wiki.example/orders; 2026-11-24]',
    Architecture: '- Orders service owns checkout. [confirmed: repo:orders-service@1a2b3c4d:src/app.ts:12; 2026-11-24]\n- Uses a queue. [inferred: imports amqplib; 2026-11-24]',
    'Tech stack': '- Frontend stack. [unknown]',
  }));
  assert.deepEqual(r.errors, []);
  assert.equal(r.stats.confirmed, 2);
  assert.equal(r.stats.inferred, 1);
  assert.equal(r.stats.unknown, 1);
});

test('an untagged or unsourced fact fails — a guess must not read like a fact', () => {
  assert.ok(codes(lint(validContext({ Product: '- Sells groceries.' }))).includes('untagged'));
  assert.ok(codes(lint(validContext({ Product: '- X. [confirmed: somewhere; 2026-11-24]' }))).includes('bad-tag'));
  assert.ok(codes(lint(validContext({ Product: '- X. [tester: ; 2026-11-24]' }))).includes('bad-tag'));
  assert.ok(codes(lint(validContext({ Product: '- X. [inferred: grep]' }))).includes('bad-tag'), 'a date is required');
});

test('[unknown] facts need an open question; missing sections and the verified line are errors', () => {
  assert.ok(codes(lint(validContext({ Product: '- X. [unknown]', open: '(none yet)' }))).includes('unknown-without-question'));
  assert.ok(codes(lint('# x\n## Product\n- a [unknown]\n')).includes('missing-section'));
  assert.ok(codes(lint(validContext().replace(/verifiedAt.*\n/, ''))).includes('no-verified-line'));
});

test('a secret or another team\'s product knowledge in a team context fails', () => {
  const secret = `- Token: ${'ATATT' + 'x'.repeat(30)} [tester: a; 2026-11-24]`;
  assert.ok(codes(lint(validContext({ Product: secret }))).includes('secret'));
  const card = '- Seed users through cards_hades and enter the BCID. [tester: a; 2026-11-24]'; // Card-internal identifiers
  assert.ok(codes(lint(validContext({ Product: card }), [], ['payment'])).includes('foreign-domain'));
  assert.ok(!codes(lint(validContext({ Product: card }), [], ['card'])).includes('foreign-domain'), 'its own domain is fine');
});

test('repos.json: id/url/role required, no local paths', () => {
  assert.deepEqual(codes(lint(validContext(), [{ id: 'orders-service', url: 'git@x:orders.git', role: 'backend' }])), []);
  assert.ok(codes(lint(validContext(), [{ id: 'Bad Id', url: '', role: 'tv' }])).includes('repos-json'));
  assert.ok(codes(lint(validContext(), [{ id: 'a', url: 'u', role: 'web', path: '/Users/me/a' }])).includes('repos-json'));
  assert.ok(codes(lint(validContext(), '{not json')).includes('repos-json'));
});

test('domain folders need a provenance header and no secrets; the real domains pass', () => {
  for (const d of ['card', 'payment', 'marketing']) assert.deepEqual(lintDomain(path.join(REPO, 'qa-workflow/domains', d)).errors, []);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dom-'));
  fs.writeFileSync(path.join(dir, 'rules.md'), '# Rules\nno header\n');
  assert.ok(lintDomain(dir).errors.some((e) => e.code === 'no-provenance'));
});

test('knowledge-status: age, and confirmed facts whose cited code changed (granted repos only)', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'ks-repo-'));
  const git = (...a) => execFileSync('git', ['-C', repo, ...a], { stdio: 'pipe', encoding: 'utf8' }).trim();
  git('init', '-q'); git('config', 'user.email', 't@e.x'); git('config', 'user.name', 't');
  fs.writeFileSync(path.join(repo, 'a.ts'), 'v1\n'); fs.writeFileSync(path.join(repo, 'b.ts'), 'v1\n');
  git('add', '.'); git('commit', '-qm', 'one');
  const sha = git('rev-parse', 'HEAD');
  fs.writeFileSync(path.join(repo, 'a.ts'), 'v2\n'); git('commit', '-qam', 'two');
  const ctx = validContext({
    Architecture: `- A. [confirmed: repo:svc@${sha}:a.ts:1; 2026-11-24]\n- B. [confirmed: repo:svc@${sha}:b.ts; 2026-11-24]\n- C. [confirmed: repo:other@${sha}:c.ts; 2026-11-24]`,
  });
  const dir = teamDir(ctx, []);
  const now = Date.parse('2026-12-01T00:00:00Z');
  const st = knowledgeStatus(dir, { repos: { svc: { path: repo, granted: true } }, now });
  assert.deepEqual(st.citations.map((c) => `${c.path}:${c.state}`), ['a.ts:changed', 'b.ts:unchanged', 'c.ts:unchecked']);
  assert.equal(st.stale, true);
  const ungranted = knowledgeStatus(dir, { repos: { svc: { path: repo, granted: false } }, now });
  assert.ok(ungranted.citations.every((c) => c.state === 'unchecked'), 'an ungranted repo is never read');
  const old = knowledgeStatus(teamDir(validContext(), []), { now: Date.parse('2027-06-01T00:00:00Z') });
  assert.match(old.reasons.join(' '), /days ago \(threshold 90\)/);
});

test('ANY squad can write its own context: generic vocabulary, its own B10 tickets and named dependencies are fine', () => {
  const ordinary = validContext({
    Product: '- First-order cashback offers and referral perks. [confirmed: jira:B10-61234; 2026-11-24]',
    Architecture: '- Promo service; the card panel is not involved. [tester: growth lead; 2026-11-24]',
    'Integrations & dependencies': '- Checkout is paid with Breadfast Pay or the BCard; card data lives in cards_hades. [tester: shopping lead; 2026-11-24]',
  });
  assert.deepEqual(lint(ordinary, [], []).errors, [], 'a squad with no domain yet');
  assert.deepEqual(lint(ordinary, [], ['growth']).errors, [], 'a squad with its own domain');
});
