/**
 * VT6-S1 — deterministic cutover-readiness evaluator.
 *   npm run build -w @qa/shared && node --test packages/shared/visual-cutover.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateCutover, DEFAULT_CUTOVER_THRESHOLDS } from './dist/index.js';

const div = (o) => ({
  legacyScreens: 0, pyramidScreens: 0, legacyFindings: 0, pyramidFindings: 0,
  legacyBySeverity: {}, pyramidBySeverity: {}, screensCompared: 0, verdictAgreements: 0, verdictAgreementRate: 0, ...o,
});

test('no evidence ⇒ NO-GO (insufficient evidence)', () => {
  const d = evaluateCutover([]);
  assert.equal(d.verdict, 'no-go');
  assert.match(d.reasons.join(' '), /Insufficient evidence/);
  assert.equal(d.metrics.screensCompared, 0);
});

test('strong parity ⇒ GO', () => {
  const d = evaluateCutover([
    div({ screensCompared: 15, verdictAgreements: 15, legacyFindings: 10, pyramidFindings: 10 }),
    div({ screensCompared: 15, verdictAgreements: 14, legacyFindings: 8, pyramidFindings: 8 }),
  ]);
  assert.equal(d.verdict, 'go', d.reasons.join('; '));
  assert.equal(d.metrics.screensCompared, 30);
});

test('low verdict agreement ⇒ NO-GO', () => {
  const d = evaluateCutover([div({ screensCompared: 30, verdictAgreements: 15, legacyFindings: 10, pyramidFindings: 10 })]);
  assert.equal(d.verdict, 'no-go');
  assert.match(d.reasons.join(' '), /agreement/);
});

test('under-detection (pyramid ≪ legacy) ⇒ NO-GO', () => {
  const d = evaluateCutover([div({ screensCompared: 30, verdictAgreements: 30, legacyFindings: 100, pyramidFindings: 3 })]);
  assert.equal(d.verdict, 'no-go');
  assert.match(d.reasons.join(' '), /under-detection/);
});

test('legacy found nothing ⇒ finding-ratio axis passes (ratio 1)', () => {
  const d = evaluateCutover([div({ screensCompared: 30, verdictAgreements: 30, legacyFindings: 0, pyramidFindings: 0 })]);
  assert.equal(d.metrics.findingRatio, 1);
  assert.equal(d.verdict, 'go');
});

test('thresholds are configurable', () => {
  const d = evaluateCutover([div({ screensCompared: 5, verdictAgreements: 5, legacyFindings: 1, pyramidFindings: 1 })],
    { ...DEFAULT_CUTOVER_THRESHOLDS, minScreensCompared: 5 });
  assert.equal(d.verdict, 'go');
});
