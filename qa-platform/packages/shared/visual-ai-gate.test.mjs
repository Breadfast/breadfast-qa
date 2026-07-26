/**
 * VT5 — AI-invocation gate, audit sampling, shadow divergence.
 *   npm run build -w @qa/shared && node --test packages/shared/visual-ai-gate.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldInvokeAi, isAuditSampled, computeVisualDivergence } from './dist/index.js';

test('shouldInvokeAi: coverage-gap never invokes', () => {
  assert.equal(shouldInvokeAi({ identityResolved: false, fullyStructured: false, hasExpected: false, deterministicFindings: 0 }).invoke, false);
});

test('shouldInvokeAi: residual (no structure / no expected) invokes', () => {
  assert.equal(shouldInvokeAi({ identityResolved: true, fullyStructured: false, hasExpected: true, deterministicFindings: 0 }).invoke, true);
  assert.equal(shouldInvokeAi({ identityResolved: true, fullyStructured: true, hasExpected: false, deterministicFindings: 0 }).invoke, true);
});

test('shouldInvokeAi: fully evaluated ⇒ skip (clean or with deterministic findings)', () => {
  assert.equal(shouldInvokeAi({ identityResolved: true, fullyStructured: true, hasExpected: true, deterministicFindings: 0 }).invoke, false);
  assert.equal(shouldInvokeAi({ identityResolved: true, fullyStructured: true, hasExpected: true, deterministicFindings: 3 }).invoke, false);
});

test('shouldInvokeAi: audit sample of a fully-evaluated screen invokes', () => {
  const d = shouldInvokeAi({ identityResolved: true, fullyStructured: true, hasExpected: true, deterministicFindings: 0, auditSampled: true });
  assert.equal(d.invoke, true);
  assert.match(d.reason, /audit/);
});

test('isAuditSampled: rate 0 disables; rate 1 all; rate 0.5 every 2nd; rate 0.1 every 10th', () => {
  assert.equal(isAuditSampled(0, 0), false);
  assert.equal(isAuditSampled(5, 0), false);
  assert.equal(isAuditSampled(3, 1), true);
  assert.deepEqual([0, 1, 2, 3].map((i) => isAuditSampled(i, 0.5)), [true, false, true, false]);
  assert.equal(isAuditSampled(10, 0.1), true);
  assert.equal(isAuditSampled(5, 0.1), false);
});

test('computeVisualDivergence: matches by screen name, tallies findings + verdict agreement', () => {
  const legacy = { screens: [
    { screen: 'Home', verdict: 'pass', findings: [] },
    { screen: 'Cart', verdict: 'major', findings: [{ severity: 'major' }, { severity: 'minor' }] },
    { screen: 'OnlyLegacy', verdict: 'pass', findings: [] },
  ] };
  const pyramid = { screens: [
    { screen: 'Home', verdict: 'pass', findings: [] },        // agree
    { screen: 'Cart', verdict: 'minor', findings: [{ severity: 'minor' }] }, // disagree
    { screen: 'OnlyPyramid', verdict: 'pass', findings: [] },
  ] };
  const d = computeVisualDivergence(legacy, pyramid);
  assert.equal(d.legacyScreens, 3);
  assert.equal(d.pyramidScreens, 3);
  assert.equal(d.legacyFindings, 2);
  assert.equal(d.pyramidFindings, 1);
  assert.equal(d.screensCompared, 2); // Home + Cart (intersection by name)
  assert.equal(d.verdictAgreements, 1); // Home
  assert.equal(d.verdictAgreementRate, 0.5);
  assert.equal(d.legacyBySeverity.major, 1);
  assert.equal(d.pyramidBySeverity.minor, 1);
});

test('computeVisualDivergence: empty inputs are safe', () => {
  const d = computeVisualDivergence(null, undefined);
  assert.equal(d.screensCompared, 0);
  assert.equal(d.verdictAgreementRate, 0);
});
