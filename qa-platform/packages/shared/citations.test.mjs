/**
 * Citation resolver tests (Phase 2 M1).
 *   npm run build -w @qa/shared && node --test packages/shared/citations.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveCitation, resolveCitations } from './dist/index.js';

const ctx = {
  jiraBaseUrl: 'https://breadfast.atlassian.net/',
  storyKey: 'B10-56336',
  figmaFileKey: 'ABC123',
  acById: { 'AC-1': 'User can redeem a perk' },
};

test('story citation links to Jira browse', () => {
  const r = resolveCitation({ kind: 'story', ref: 'B10-56336' }, ctx);
  assert.equal(r.href, 'https://breadfast.atlassian.net/browse/B10-56336');
  assert.equal(r.label, 'B10-56336');
});

test('ac citation carries the AC text as title', () => {
  const r = resolveCitation({ kind: 'ac', ref: 'AC-1' }, ctx);
  assert.equal(r.label, 'AC-1');
  assert.equal(r.title, 'User can redeem a perk');
});

test('comment citation deep-links with focusedCommentId', () => {
  const r = resolveCitation({ kind: 'comment', ref: '10457' }, ctx);
  assert.ok(r.href.includes('focusedCommentId=10457'));
  assert.equal(r.label, 'Comment 10457');
});

test('figma citation links to the design file', () => {
  const r = resolveCitation({ kind: 'figma', ref: 'Checkout' }, ctx);
  assert.equal(r.href, 'https://www.figma.com/design/ABC123');
  assert.equal(r.label, 'Figma: Checkout');
});

test('rule + testcase + requirement produce labels', () => {
  assert.equal(resolveCitation({ kind: 'rule', ref: 'business-rules#cashback' }).label, 'Rule: business-rules#cashback');
  assert.equal(resolveCitation({ kind: 'testcase', ref: 'TC-49835' }).label, 'TC TC-49835');
  assert.equal(resolveCitation({ kind: 'requirement', ref: 'R7' }).label, 'Req R7');
});

test('explicit label overrides the derived one; no jira base ⇒ no link', () => {
  const r = resolveCitation({ kind: 'story', ref: 'B10-1', label: 'Parent story' }, {});
  assert.equal(r.label, 'Parent story');
  assert.equal(r.href, undefined);
});

test('resolveCitations skips empties', () => {
  const rs = resolveCitations([{ kind: 'ac', ref: 'AC-1' }, { kind: 'ac', ref: '' }], ctx);
  assert.equal(rs.length, 1);
});
