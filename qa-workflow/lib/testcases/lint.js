'use strict';

/**
 * The mechanical half of the test-case review gate.
 *
 * `testcase-review` (qa-workflow/skills/testcase-review/SKILL.md) runs nine checks. Four and a half of
 * them are computable from the CSV alone — duplicates, per-step expected results, format conformance,
 * AC coverage, categorization vocabulary. Those are implemented here so they are an EXIT CODE rather
 * than an agent grading its own output; the rest (unrelated cases, correct expected results, correct
 * granularity, justified regression coverage, automatable feasibility) stay human/agent judgement.
 *
 * Contract: docs/ai/browserstack-process.md §10.1–10.4 (format) + §10.2a (traceability tags).
 * Severity: `error` fails the gate, `warn` is reported and does not.
 */
const { COLUMNS } = require('./parse');

const PRIORITIES = ['Critical', 'High', 'Medium', 'Low'];
const TYPES = ['Acceptance', 'Regression', 'Functional', 'Usability', 'Smoke & Sanity'];
const AUTOMATION_STATUSES = ['Not Automated', 'Automated', 'Automation Not Required'];
const STATES = ['Active', 'Draft', 'Deprecated'];
/** Author-owned fields every case must carry (§10.2 "Source = author"). */
const REQUIRED_FIELDS = [
  ['title', 'Title'], ['folderPath', 'Folder Path'], ['state', 'State'], ['owner', 'Owner'],
  ['priority', 'Priority'], ['type', 'Type of Test Case'], ['automationStatus', 'Automation Status'],
  ['description', 'Description'], ['preconditions', 'Preconditions'], ['issues', 'Issues'],
];

const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').replace(/[.,;:!?'"]/g, '').trim();

/**
 * @param {object} parsed        output of parse.parseTestCases()
 * @param {object} [opts]        { acs?:string[], requireScreens?:boolean, newImport?:boolean }
 * @returns {{findings:Array, errors:number, warnings:number, summary:object}}
 */
function lintTestCases(parsed, opts = {}) {
  const findings = [];
  const add = (severity, code, message, extra = {}) => findings.push({ severity, code, message, ...extra });
  const cases = parsed.cases || [];
  const acs = (opts.acs || []).map((a) => String(a).toUpperCase());

  // ── format ────────────────────────────────────────────────────────────
  if (!parsed.headerOk) {
    add('error', 'header-mismatch',
      `header must be the exact ${COLUMNS.length}-column canonical row (§10.1); got ${(parsed.header || []).length} columns`);
  }
  for (const o of parsed.orphanRows || []) {
    add('error', 'orphan-step-row', `step row before any case — a continuation row must follow a titled case`, { line: o.line });
  }
  if (!cases.length) add('error', 'no-cases', 'no test cases found');

  // ── per case ──────────────────────────────────────────────────────────
  for (const c of cases) {
    const at = { line: c.line, title: c.title };

    for (const [key, label] of REQUIRED_FIELDS) {
      if (!c[key]) add('error', 'missing-required-field', `${label} is empty`, at);
    }
    if (c.template !== 'Steps') add('error', 'bad-template', `Template must be "Steps" (got "${c.template || ''}")`, at);
    if (c.priority && !PRIORITIES.includes(c.priority)) add('error', 'bad-priority', `Priority "${c.priority}" is outside ${PRIORITIES.join('/')}`, at);
    if (c.type && !TYPES.includes(c.type)) add('error', 'bad-type', `Type of Test Case "${c.type}" is outside ${TYPES.join('/')}`, at);
    if (c.state && !STATES.includes(c.state)) add('warn', 'bad-state', `State "${c.state}" is unusual (expected ${STATES.join('/')})`, at);
    if (c.automationStatus && !AUTOMATION_STATUSES.includes(c.automationStatus)) {
      add('error', 'bad-automation-status', `Automation Status "${c.automationStatus}" is outside ${AUTOMATION_STATUSES.join('/')}`, at);
    }

    // steps — the check that actually catches broken cases
    const steps = c.steps.filter((s) => s.step || s.expected);
    if (!steps.length) add('error', 'no-steps', 'case has no steps', at);
    for (const s of steps) {
      if (!s.step) add('error', 'empty-step', 'a row has an Expected Result but no Step', { line: s.line, title: c.title });
      if (!s.expected) add('error', 'missing-expected-result', `step has no Expected Result: "${(s.step || '').slice(0, 60)}"`, { line: s.line, title: c.title });
    }

    // traceability
    if (!c.acs.length) add('error', 'missing-ac-ref', 'no `ac:` tag — the case cites no Acceptance Criterion', at);
    if (acs.length) {
      for (const ref of c.acs) if (!acs.includes(ref)) add('error', 'unknown-ac-ref', `cites ${ref}, which is not in the story's AC list`, at);
    }
    if (opts.requireScreens && !c.screens.length) add('warn', 'missing-screen-ref', 'no `screen:` tag — visual validation cannot pair this case to a screen', at);

    if (opts.newImport && c.systemFields.length) {
      add('warn', 'system-column-populated', `system-owned column(s) filled on a new import: ${c.systemFields.join(', ')}`, at);
    }
  }

  // ── across cases ──────────────────────────────────────────────────────
  const byTitle = new Map();
  const bySteps = new Map();
  for (const c of cases) {
    const t = norm(c.title);
    const s = c.steps.map((x) => norm(x.step) + '|' + norm(x.expected)).join('||');
    if (!byTitle.has(t)) byTitle.set(t, []);
    byTitle.get(t).push(c);
    if (!s) continue;
    if (!bySteps.has(s)) bySteps.set(s, []);
    bySteps.get(s).push(c);
  }
  for (const [, group] of byTitle) {
    if (group.length > 1) {
      add('error', 'duplicate-title', `${group.length} cases share the title "${group[0].title}"`, { line: group[0].line, lines: group.map((g) => g.line) });
    }
  }
  for (const [, group] of bySteps) {
    if (group.length > 1 && norm(group[0].title) !== norm(group[1].title)) {
      add('error', 'duplicate-steps', `${group.length} cases have an identical step sequence under different titles`, { line: group[0].line, lines: group.map((g) => g.line), titles: group.map((g) => g.title) });
    }
  }

  // AC coverage — the check the review gate calls "no missing AC coverage"
  const covered = new Set(cases.flatMap((c) => c.acs));
  const uncovered = acs.filter((a) => !covered.has(a));
  for (const a of uncovered) add('error', 'uncovered-ac', `${a} has no test case`, { ac: a });

  const errors = findings.filter((f) => f.severity === 'error').length;
  const warnings = findings.filter((f) => f.severity === 'warn').length;
  return {
    findings,
    errors,
    warnings,
    summary: {
      cases: cases.length,
      steps: cases.reduce((n, c) => n + c.steps.filter((s) => s.step || s.expected).length, 0),
      automatable: cases.filter((c) => c.automationStatus !== 'Automation Not Required').length,
      byType: TYPES.reduce((m, t) => (m[t] = cases.filter((c) => c.type === t).length, m), {}),
      acs: { declared: acs.length, covered: [...covered].sort(), uncovered },
      screens: [...new Set(cases.flatMap((c) => c.screens))].sort(),
    },
  };
}

module.exports = { lintTestCases, PRIORITIES, TYPES, AUTOMATION_STATUSES, STATES };
