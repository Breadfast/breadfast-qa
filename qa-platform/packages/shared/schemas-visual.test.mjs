/**
 * VT0-S2 — additive visual-schema extensions are back-compatible.
 *   npm run build -w @qa/shared && node --test packages/shared/schemas-visual.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  VisualFinding, VisualComparison, VISUAL_VERDICTS, VISUAL_LAYERS, VISUAL_FINDING_SOURCES,
  computeVisualHealth, detectVisualPatterns,
} from './dist/index.js';

test('VT0-S2: new enums exported with expected members', () => {
  assert.ok(VISUAL_VERDICTS.includes('coverage-gap'));
  assert.deepEqual([...VISUAL_FINDING_SOURCES], ['deterministic', 'ai', 'ocr']);
  assert.equal(VISUAL_LAYERS.length, 8);
  for (const l of ['identity', 'component-tree', 'text', 'ai']) assert.ok(VISUAL_LAYERS.includes(l));
});

test('VT0-S2: a legacy finding (no new fields) still validates and gets defaults', () => {
  // Shape as produced before VT0-S2 — no layer/source/coverageGap.
  const legacy = { category: 'content', dimension: 'sentence-case', severity: 'minor', screen: 'Home',
    expected: 'Title Case', actual: 'sentence case', differenceDescription: 'x', recommendation: 'y',
    confidence: 'high', sources: [] };
  const parsed = VisualFinding.parse(legacy);
  assert.equal(parsed.source, 'ai');        // defaulted — legacy findings labeled AI
  assert.equal(parsed.coverageGap, false);  // defaulted
  assert.equal(parsed.layer, undefined);    // optional, no default
});

test('VT0-S2: new finding fields accepted when supplied', () => {
  const f = VisualFinding.parse({ category: 'content', source: 'deterministic', layer: 'text', coverageGap: true, sources: [] });
  assert.equal(f.source, 'deterministic');
  assert.equal(f.layer, 'text');
  assert.equal(f.coverageGap, true);
  assert.throws(() => VisualFinding.parse({ source: 'nope', sources: [] }), 'invalid source rejected');
});

test('VT0-S2: a legacy VisualComparison (no engine) still validates; engine optional', () => {
  const legacy = { compared: true, expectedFrames: 2, comparedScreens: 2, passRate: 100,
    categoriesCovered: ['content'], screens: [], patterns: [], componentsAffected: [], notes: '' };
  const parsed = VisualComparison.parse(legacy);
  assert.equal(parsed.engine, undefined);
  assert.equal(VisualComparison.parse({ ...legacy, engine: 'pyramid' }).engine, 'pyramid');
  assert.throws(() => VisualComparison.parse({ ...legacy, engine: 'bogus' }), 'invalid engine rejected');
});

test('VT0-S2: coverage-gap verdict validates on a screen', () => {
  const vc = VisualComparison.parse({ compared: true, expectedFrames: 1, comparedScreens: 0, passRate: 0,
    categoriesCovered: [], patterns: [], componentsAffected: [], notes: '',
    screens: [{ screen: 'Unmapped', verdict: 'coverage-gap', findings: [] }] });
  assert.equal(vc.screens[0].verdict, 'coverage-gap');
});

test('VT0-S2: computeVisualHealth + detectVisualPatterns consume the widened shape unchanged', () => {
  const vc = {
    compared: true, expectedFrames: 2, comparedScreens: 2, passRate: 50,
    categoriesCovered: ['content'], patterns: [], componentsAffected: [], notes: '',
    screens: [
      { screen: 'A', verdict: 'major', categoriesChecked: ['content'],
        findings: [{ category: 'content', dimension: 'sentence-case', severity: 'major', screen: 'A',
          component: 'Primary Button', source: 'deterministic', layer: 'text', coverageGap: false,
          expected: 'x', actual: 'y', differenceDescription: 'z', recommendation: 'w', confidence: 'high', sources: [] }] },
      { screen: 'B', verdict: 'coverage-gap', categoriesChecked: [], findings: [] },
    ],
  };
  const health = computeVisualHealth(vc);
  assert.ok(typeof health.visualHealth === 'number');           // runs without throwing
  assert.equal(health.findingsBySeverity.major, 1);             // reads existing fields unchanged
  const patterns = detectVisualPatterns(vc);
  assert.ok(Array.isArray(patterns));                           // consumes widened findings fine
});
