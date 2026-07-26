'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeFinding,
  validateFinding,
  computeHealth,
  detectPatterns,
  SEVERITY_PENALTY,
} = require('./finding');

test('normalizeFinding applies defaults', () => {
  const f = normalizeFinding({ capability: 'visual', severity: 'major' });
  assert.equal(f.confidence, 'medium');
  assert.equal(f.source, 'ai');
  assert.equal(f.coverageGap, false);
  assert.deepEqual(f.sources, []);
  assert.deepEqual(f.extension, {});
});

test('validateFinding enforces enums + required capability', () => {
  assert.equal(validateFinding({ capability: 'visual', severity: 'major' }).valid, true);
  assert.equal(validateFinding({ severity: 'major' }).valid, false); // missing capability
  assert.equal(validateFinding({ capability: 'visual', severity: 'huge' }).valid, false); // bad severity
  assert.equal(validateFinding({ capability: 'visual', severity: 'minor', source: 'psychic' }).valid, false);
});

test('computeHealth reproduces the visual.ts penalty math', () => {
  // critical 25 + major 10 + minor 3 = 38 → 62 (medium)
  const h = computeHealth([
    { capability: 'visual', severity: 'critical' },
    { capability: 'visual', severity: 'major' },
    { capability: 'visual', severity: 'minor' },
  ]);
  assert.equal(SEVERITY_PENALTY.critical + SEVERITY_PENALTY.major + SEVERITY_PENALTY.minor, 38);
  assert.equal(h.score, 62);
  assert.equal(h.level, 'medium');
  assert.equal(h.total, 3);
  assert.equal(h.bySeverity.critical, 1);
});

test('computeHealth: two majors → 80 (high); score floors at 0', () => {
  assert.equal(computeHealth([{ capability: 'v', severity: 'major' }, { capability: 'v', severity: 'major' }]).level, 'high');
  const many = Array.from({ length: 6 }, () => ({ capability: 'v', severity: 'critical' })); // 150 penalty
  assert.equal(computeHealth(many).score, 0);
});

test('coverage-gap findings never penalize health or form patterns', () => {
  const h = computeHealth([
    { capability: 'visual', severity: 'critical', coverageGap: true },
    { capability: 'visual', severity: 'minor' },
  ]);
  assert.equal(h.total, 1);
  assert.equal(h.score, 97); // only the minor (3) counts
});

test('detectPatterns groups recurring root causes (occurrences ≥ 2)', () => {
  const findings = [
    { capability: 'visual', category: 'content', dimension: 'sentence-case', subject: 'Helper label', location: 'a', severity: 'minor' },
    { capability: 'visual', category: 'content', dimension: 'sentence-case', subject: 'Helper label', location: 'b', severity: 'minor' },
    { capability: 'visual', category: 'color', dimension: 'text-color', subject: 'Title', location: 'a', severity: 'major' }, // singleton
  ];
  const patterns = detectPatterns(findings);
  assert.equal(patterns.length, 1);
  assert.equal(patterns[0].occurrences, 2);
  assert.deepEqual(patterns[0].locations, ['a', 'b']);
});

test('detectPatterns honors a capability-supplied keyFn', () => {
  // Visual keys on component+token; here two findings share subject but differ by token.
  const findings = [
    { capability: 'visual', category: 'color', dimension: 'text-color', subject: 'Button', location: 'a', severity: 'major', extension: { token: 'brand-500' } },
    { capability: 'visual', category: 'color', dimension: 'text-color', subject: 'Button', location: 'b', severity: 'major', extension: { token: 'brand-700' } },
  ];
  const keyFn = (f) => [f.subject, f.extension && f.extension.token].join('|');
  assert.equal(detectPatterns(findings).length, 1); // default: same subject → 1 pattern
  assert.equal(detectPatterns(findings, { keyFn }).length, 0); // token-aware: different tokens → no pattern
});
