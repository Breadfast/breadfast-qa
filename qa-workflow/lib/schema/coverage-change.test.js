'use strict';
/**
 * coverageChanges validation — the record that makes a coverage reduction reviewable.
 * B10-57764: clarification A-3 removed AC5's visual assertion and no later phase re-opened it.
 */
const test = require('node:test');
const assert = require('node:assert');
const { validateQaState } = require('./validate');

const base = () => ({
  schemaVersion: 1,
  ticket: 'B10-57764',
  sources: { jira: { updated: '2026-08-24T00:00:00.000Z', hash: 'a'.repeat(64) } },
  artifacts: {},
});
const cc = (over = {}) => ({
  source: 'clarification',
  sourceRef: 'clarification/clarifications.md#A-3',
  affects: ['AC-5'],
  kind: ['removes-visual-validation', 'visual-to-behavioural'],
  was: 'visual + behavioural',
  now: 'behavioural only',
  reason: 'design unchecked-disabled box is byte-identical to unchecked-enabled',
  evidence: 'ImageChops diff bbox None on frame-05 vs frame-02',
  scopeChecked: 'unchecked only — checked box NOT compared',
  status: 'proposed',
  ...over,
});

test('a well-formed proposed coverage change validates', () => {
  const s = base(); s.coverageChanges = { 'a-3': cc() };
  assert.strictEqual(validateQaState(s).valid, true);
});

test('an unknown kind is rejected', () => {
  const s = base(); s.coverageChanges = { 'a-3': cc({ kind: ['made-it-simpler'] }) };
  const r = validateQaState(s);
  assert.strictEqual(r.valid, false);
  assert.ok(r.errors.some((e) => e.path === 'coverageChanges.a-3.kind'));
});

test('affects and reason are required', () => {
  for (const [field, over] of [['affects', { affects: [] }], ['reason', { reason: '' }]]) {
    const s = base(); s.coverageChanges = { x: cc(over) };
    const r = validateQaState(s);
    assert.strictEqual(r.valid, false, field + ' must be required');
    assert.ok(r.errors.some((e) => e.path === `coverageChanges.x.${field}`));
  }
});

test('approved/rejected must carry the operator name — never self-granted', () => {
  const s = base(); s.coverageChanges = { x: cc({ status: 'approved' }) };
  const r = validateQaState(s);
  assert.strictEqual(r.valid, false);
  assert.ok(r.errors.some((e) => e.path === 'coverageChanges.x.approvedBy'));

  const ok = base(); ok.coverageChanges = { x: cc({ status: 'approved', approvedBy: 'Ahmed', at: '2026-08-24T10:00:00.000Z' }) };
  assert.strictEqual(validateQaState(ok).valid, true);
});

test('a bad status value is rejected', () => {
  const s = base(); s.coverageChanges = { x: cc({ status: 'accepted' }) };
  assert.ok(validateQaState(s).errors.some((e) => e.path === 'coverageChanges.x.status'));
});

test('absent coverageChanges stays valid — the field is optional', () => {
  assert.strictEqual(validateQaState(base()).valid, true);
});
