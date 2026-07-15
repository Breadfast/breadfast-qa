/**
 * Prompt Registry guard tests (Phase 1 #2) — zero-dependency, run with:
 *   npm run build -w @qa/shared && node --test packages/shared/prompts.test.mjs
 * Golden-string assertions catch accidental prompt drift; metadata assertions
 * enforce that every prompt stays versioned/owned/changelogged.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promptRegistry, getPrompt, PROMPT_REGISTRY_VERSION, LIFECYCLE_NODES, PROMPT_SUBCAPABILITIES } from './dist/index.js';

test('every prompt carries required, well-formed metadata', () => {
  for (const [key, p] of Object.entries(promptRegistry)) {
    assert.equal(p.key, key, `key mismatch for ${key}`);
    assert.match(p.version, /^\d+\.\d+\.\d+$/, `${key} version must be semver`);
    assert.ok(p.name && p.purpose && p.owner, `${key} missing name/purpose/owner`);
    assert.ok(Array.isArray(p.changelog) && p.changelog.length >= 1, `${key} needs a changelog`);
    assert.ok(p.schemaName && p.schemaHint, `${key} missing schemaName/schemaHint`);
    assert.equal(typeof p.build, 'function', `${key} build must be a function`);
    // schemaHint must itself be valid JSON (it is the shape example shown to the model).
    assert.doesNotThrow(() => JSON.parse(p.schemaHint), `${key} schemaHint must be valid JSON`);
  }
});

test('PROMPT_REGISTRY_VERSION is a stable, formatted token', () => {
  assert.match(PROMPT_REGISTRY_VERSION, /^1-[0-9a-f]{8}$/);
});

test('golden: requirements_analysis keeps its baseline analysis instruction + citation directive', () => {
  const out = getPrompt('requirements_analysis').build({ jiraKey: 'B10-56336', title: 'Redeem perk' });
  assert.ok(
    out.startsWith(
      'Perform STEP 1 Requirements Analysis for Jira story B10-56336 ("Redeem perk"). ' +
        'Use the REAL Jira source provided in Context (description, acceptance criteria, comments) — comments may ' +
        'override/clarify the AC. Analyze per CLAUDE.md.',
    ),
    'baseline analysis instruction preserved',
  );
  assert.ok(out.includes('Populate "sources"'), 'citation directive appended (Phase 2)');
  assert.equal(getPrompt('requirements_analysis').version, '1.1.0');
});

test('golden: generate_hls injects the resolved cap in both places', () => {
  const out = getPrompt('generate_hls').build({ jiraKey: 'B10-1', maxHls: 15 });
  assert.ok(out.includes('NO MORE THAN 15 scenarios'));
  assert.ok(out.includes('N ≤ 15'));
  assert.ok(out.startsWith('Generate STEP 5 High Level Scenarios for B10-1.'));
});

test('golden: generate_testcases references the canonical granular standard', () => {
  const out = getPrompt('generate_testcases').build({ jiraKey: 'B10-2' });
  assert.ok(out.startsWith('Generate STEP 6 detailed test cases for B10-2 in the canonical granular standard'));
  assert.ok(out.includes('one user action per step, every step has its OWN Expected Result'));
});

test('all 16 prompts registered (14 reasoning + execution + visual_comparison)', () => {
  assert.equal(Object.keys(promptRegistry).length, 16);
  assert.ok(promptRegistry.execution, 'execution prompt migrated into the registry');
  assert.ok(promptRegistry.visual_comparison, 'visual comparison prompt registered');
});

test('migrated agentic prompt variants build byte-identically', () => {
  // Figma frame-read variant.
  const figFrames = getPrompt('figma_analysis').build({
    jiraKey: 'B10-1', mode: 'frames', exportMethod: 'batch', frameFiles: ['C:\\a\\f1.png'],
  });
  assert.ok(figFrames.includes('READ each one and analyze the actual pixels'));
  assert.ok(figFrames.includes('- C:\\\\a\\\\f1.png'), 'frame path double-escaped as before');
  // Figma spec-only variant.
  const figSpec = getPrompt('figma_analysis').build({ jiraKey: 'B10-1', mode: 'spec', why: 'no url' });
  assert.ok(figSpec.includes('NOTE: design frames could not be exported (no url)'));
  // Exploratory probe variant.
  const probe = getPrompt('exploratory_testing').build({
    jiraKey: 'B10-1', mode: 'probe', title: 'T', creds: 'Open x.', charterList: '- a: b',
    riskAreas: 'r', fragileFlows: 'f', shotsDir: 'C:\\s',
  });
  assert.ok(probe.startsWith('Use the Playwright browser tools to actually explore the live app for B10-1'));
  assert.ok(probe.includes('name it exploratory_<n>_<slug>.png'));
  // Automation write variant.
  const write = getPrompt('automation_generation').build({
    jiraKey: 'B10-1', platform: 'web', sharedPagesDir: '/pages', javaFramework: '/jf',
    mode: 'write', title: 'T', planJson: '{}', dir: 'C:\\w', automationDir: 'C:\\w\\automation',
    pwFramework: '/pw', isWeb: true,
  });
  assert.ok(write.startsWith('You are implementing automation specs for Jira story B10-1'));
  assert.ok(write.includes('Reply "DONE: <comma-separated list of files written>"'));
  // Execution variant carries the 6-check defect-grounding gate.
  const exec = getPrompt('execution').build({
    jiraKey: 'B10-1', title: 'T', environment: 'testing', locale: 'en-US',
    shotsDir: 'C:\\s', casesFile: 'C:\\c.md', isWeb: true, creds: 'Open x.', useUser: '',
  });
  assert.ok(exec.includes('DEFECT GROUNDING (mandatory precision gate'));
  assert.ok(exec.includes('ONE DEFECT = ONE PROBLEM'));
  assert.ok(exec.includes('BLOCKER HANDLING'));
});

test('every registry key is a lifecycle node or a declared sub-capability (invariant lock)', () => {
  const allowed = new Set([...LIFECYCLE_NODES, ...PROMPT_SUBCAPABILITIES]);
  for (const key of Object.keys(promptRegistry)) {
    assert.ok(allowed.has(key), `registry key "${key}" is neither a lifecycle node nor a sub-capability`);
  }
});
