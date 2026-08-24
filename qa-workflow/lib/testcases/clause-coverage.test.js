'use strict';
/**
 * Clause-level AC coverage + the multi-clause signal.
 * Regression harness for B10-57764: AC5 held two requirements under one id, four cases carried
 * `ac:AC-5`, and the lint reported the AC as covered while half of it was never asserted.
 */
const test = require('node:test');
const assert = require('node:assert');
const { extractAcs, extractAcTexts, parentAc } = require('./parse');
const { lintTestCases } = require('./lint');

const AC_DOC = [
  '| **AC1** | The Featured column renders between Status and Actions. |',
  '| **AC5** | Checking a perk’s featured box is only allowed when the list is filtered by a category,'
    + ' otherwise, the feature column is visible but the featured box is dimmed. |',
].join('\n');

const mkCase = (title, acs) => ({
  line: 2, title, folderPath: 'f', state: 'Active', owner: 'o', priority: 'High',
  type: 'Acceptance', automationStatus: 'Not Automated', description: 'd', preconditions: 'p',
  issues: 'B10-1', template: 'Steps', tags: [], systemFields: [], screens: ['s1'], acs,
  steps: [{ line: 2, step: 'do', expected: 'happens' }],
});
const parsed = (cases) => ({ header: [], headerOk: true, cases, orphanRows: [], rowCount: cases.length + 1 });

test('extractAcTexts keeps the AC wording, extractAcs keeps ids', () => {
  assert.deepStrictEqual(extractAcs(AC_DOC), ['AC-1', 'AC-5']);
  const texts = extractAcTexts(AC_DOC);
  assert.strictEqual(texts.length, 2);
  assert.match(texts.find((t) => t.id === 'AC-5').text, /otherwise/);
});

test('parentAc maps a clause id back to its AC', () => {
  assert.strictEqual(parentAc('AC-5.2'), 'AC-5');
  assert.strictEqual(parentAc('AC-5'), 'AC-5');
});

test('B10-57764 shape: a multi-clause AC tagged as one id is WARNED, not silently passed', () => {
  const r = lintTestCases(parsed([mkCase('gate is inert when unfiltered', ['AC-5'])]), {
    acs: extractAcs(AC_DOC).filter((a) => a === 'AC-5'),
    acTexts: extractAcTexts(AC_DOC),
  });
  const warn = r.findings.find((f) => f.code === 'ac-possible-multi-clause');
  assert.ok(warn, 'expected the clause signal on AC-5');
  assert.strictEqual(warn.severity, 'warn', 'must be a signal, never an error');
  assert.strictEqual(warn.indicator, 'otherwise');
  assert.strictEqual(r.errors, 0, 'the signal must not fail the gate on its own');
  assert.deepStrictEqual(r.summary.acs.possibleMultiClause, ['AC-5']);
});

test('decomposed clauses are enforced: an uncovered clause is an ERROR', () => {
  const acs = ['AC-5.1', 'AC-5.2'];
  const r = lintTestCases(parsed([mkCase('only the gate clause', ['AC-5.1'])]), { acs, acTexts: [] });
  const err = r.findings.find((f) => f.code === 'uncovered-ac' && f.ac === 'AC-5.2');
  assert.ok(err, 'AC-5.2 must be reported uncovered');
  assert.strictEqual(err.severity, 'error');
  assert.strictEqual(r.errors, 1);
});

test('once decomposed, the clause signal goes quiet (the decision was taken)', () => {
  const r = lintTestCases(parsed([mkCase('a', ['AC-5.1']), mkCase('b', ['AC-5.2'])]), {
    acs: ['AC-5', 'AC-5.1', 'AC-5.2'],
    acTexts: extractAcTexts(AC_DOC),
  });
  assert.ok(!r.findings.some((f) => f.code === 'ac-possible-multi-clause'),
    'a decomposed AC must not keep nagging');
  assert.deepStrictEqual(r.summary.acs.clauses, ['AC-5.1', 'AC-5.2']);
});

test('an AC with no clause indicator is not flagged', () => {
  const r = lintTestCases(parsed([mkCase('column renders', ['AC-1'])]), {
    acs: ['AC-1'], acTexts: extractAcTexts(AC_DOC),
  });
  assert.ok(!r.findings.some((f) => f.code === 'ac-possible-multi-clause'));
});
