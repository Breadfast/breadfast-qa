'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { COLUMNS, parseCsv, parseTestCases, normalizeAc, extractAcs } = require('./parse');
const { lintTestCases } = require('./lint');

const HEADER = COLUMNS.join(',');
/** Build a canonical first row (24 columns) for a case. */
const caseRow = (o = {}) => {
  const f = {
    tcId: '', title: 'Verify something happens', folderId: '48895703', folderPath: '2026.Q3.S3>Story',
    state: 'Active', owner: 'Fintech', priority: 'High', type: 'Functional',
    automationStatus: 'Not Automated', description: 'Desc', preconditions: 'Pre', template: 'Steps',
    step: 'Log in to the Admin Portal', expected: 'Dashboard is displayed',
    issues: 'B10-57771', tags: 'ai-created,ac:AC-1,screen:perks-list', ...o,
  };
  return [f.tcId, `"${f.title}"`, f.folderId, `"${f.folderPath}"`, f.state, f.owner, f.priority, f.type,
    f.automationStatus, `"${f.description}"`, `"${f.preconditions}"`, f.template, `"${f.step}"`,
    `"${f.expected}"`, f.issues, `"${f.tags}"`, '', '', '', '', '', '', 'BCard Squad', ''].join(',');
};
const stepRow = (step, expected) => `,,,,,,,,,,,,"${step}","${expected}",,,,,,,,,,`;
const csvOf = (...rows) => [HEADER, ...rows].join('\n') + '\n';

// ── CSV reading ───────────────────────────────────────────────────────
test('parseCsv handles quotes, doubled quotes and embedded newlines', () => {
  const rows = parseCsv('a,"b,with,commas","he said ""hi""","line1\nline2"\nx,y,z,w\n');
  assert.deepEqual(rows[0], ['a', 'b,with,commas', 'he said "hi"', 'line1\nline2']);
  assert.deepEqual(rows[1], ['x', 'y', 'z', 'w']);
});

test('a case spans one row per step; continuation rows carry only Steps + Expected Result', () => {
  const parsed = parseTestCases(csvOf(caseRow(), stepRow('Open Perks', 'The perks list is displayed'), stepRow('Click Duplicate', 'The duplicate form opens')));
  assert.equal(parsed.headerOk, true);
  assert.equal(parsed.cases.length, 1);
  assert.equal(parsed.cases[0].steps.length, 3);
  assert.equal(parsed.cases[0].steps[2].expected, 'The duplicate form opens');
  assert.deepEqual(parsed.cases[0].acs, ['AC-1']);
  assert.deepEqual(parsed.cases[0].screens, ['perks-list']);
});

test('a continuation row before any case is reported, not silently dropped', () => {
  const parsed = parseTestCases(csvOf(stepRow('orphan', 'nothing')));
  assert.equal(parsed.cases.length, 0);
  assert.equal(parsed.orphanRows.length, 1);
  assert.equal(lintTestCases(parsed).findings.some((f) => f.code === 'orphan-step-row'), true);
});

test('AC references normalize across the forms people actually write', () => {
  assert.equal(normalizeAc('AC-1'), 'AC-1');
  assert.equal(normalizeAc('ac 1'), 'AC-1');
  assert.equal(normalizeAc('AC1'), 'AC-1');
  assert.equal(normalizeAc('AC-2.1'), 'AC-2.1');
  assert.deepEqual(extractAcs('AC1 does X. Then AC-3 and ac 2 apply. AC1 again.'), ['AC-1', 'AC-2', 'AC-3']);
});

// ── the mechanical review checks ──────────────────────────────────────
const lint = (csvText, opts) => lintTestCases(parseTestCases(csvText), opts);

test('a clean suite passes with zero errors', () => {
  const r = lint(csvOf(caseRow(), stepRow('Open Perks', 'The list is displayed'),
    caseRow({ title: 'Verify a second thing', tags: 'ai-created,ac:AC-2,screen:perks-list' })),
  { acs: ['AC-1', 'AC-2'], requireScreens: true });
  assert.equal(r.errors, 0, JSON.stringify(r.findings));
  assert.equal(r.summary.cases, 2);
  assert.deepEqual(r.summary.acs.uncovered, []);
});

test('check 5 — every step must carry its own Expected Result', () => {
  const r = lint(csvOf(caseRow(), stepRow('Inspect the Featured toggle', '')));
  assert.equal(r.findings.filter((f) => f.code === 'missing-expected-result').length, 1);
  assert.ok(r.errors > 0);
});

test('check 1 — duplicates, by title and by identical step sequence', () => {
  const dup = lint(csvOf(caseRow(), caseRow()));
  assert.ok(dup.findings.some((f) => f.code === 'duplicate-title'));

  const sameSteps = lint(csvOf(caseRow({ title: 'Verify A' }), caseRow({ title: 'Verify B' })));
  assert.ok(sameSteps.findings.some((f) => f.code === 'duplicate-steps'),
    'two differently-titled cases with an identical step sequence are still a duplicate');
});

test('check 3 — AC coverage is computed, not asserted', () => {
  const r = lint(csvOf(caseRow({ tags: 'ai-created,ac:AC-1' })), { acs: ['AC-1', 'AC-2', 'AC-3'] });
  const uncovered = r.findings.filter((f) => f.code === 'uncovered-ac').map((f) => f.ac);
  assert.deepEqual(uncovered, ['AC-2', 'AC-3']);
  assert.deepEqual(r.summary.acs.covered, ['AC-1']);
});

test('check 3 — a case citing an AC the story does not have is an error, not a pass', () => {
  const r = lint(csvOf(caseRow({ tags: 'ai-created,ac:AC-9' })), { acs: ['AC-1'] });
  assert.ok(r.findings.some((f) => f.code === 'unknown-ac-ref'));
});

test('check 6 — categorization vocabulary is enforced', () => {
  const r = lint(csvOf(caseRow({ type: 'Smoke', priority: 'Urgent', automationStatus: 'Maybe' })));
  for (const code of ['bad-type', 'bad-priority', 'bad-automation-status']) {
    assert.ok(r.findings.some((f) => f.code === code), code);
  }
});

test('check 9 — format conformance: header, template, required author fields', () => {
  const badHeader = lintTestCases(parseTestCases('Title,Steps\nx,y\n'));
  assert.ok(badHeader.findings.some((f) => f.code === 'header-mismatch'));

  const r = lint(csvOf(caseRow({ template: '', preconditions: '', issues: '' })));
  assert.ok(r.findings.some((f) => f.code === 'bad-template'));
  assert.equal(r.findings.filter((f) => f.code === 'missing-required-field').length, 2); // Preconditions + Issues
});

test('system-owned columns are only flagged on a NEW import', () => {
  const withId = csvOf(caseRow({ tcId: 'TC-49841' }));
  assert.equal(lint(withId).findings.some((f) => f.code === 'system-column-populated'), false);
  assert.equal(lint(withId, { newImport: true }).findings.some((f) => f.code === 'system-column-populated'), true);
});

test('screen tags are a warning, never a blocker — coverage gap ≠ defect', () => {
  const r = lint(csvOf(caseRow({ tags: 'ai-created,ac:AC-1' })), { acs: ['AC-1'], requireScreens: true });
  assert.equal(r.errors, 0);
  assert.equal(r.warnings, 1);
  assert.equal(r.findings[0].code, 'missing-screen-ref');
});
