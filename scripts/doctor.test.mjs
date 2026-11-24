// The doctor is the readiness check Claude runs before any /qa-* workflow (and at session start).
// These tests run it against a throwaway copy of the repo skeleton, so the developer's own
// credentials.local.js is never read, and they assert on what a colleague's first run looks like.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CRED_ENV = ['JIRA_EMAIL', 'JIRA_API_TOKEN', 'BS_TM_USERNAME', 'BS_TM_API_TOKEN', 'BROWSERSTACK_USERNAME',
  'BROWSERSTACK_ACCESS_KEY', 'BROWSERSTACK_EMAIL', 'BROWSERSTACK_PASSWORD', 'QA_TEAM', 'QA_TEAMS_DIR'];
const FAKE_TOKEN = 'ATATTfake0123456789secretvalue';

/** A minimal repo copy: the doctor, the config loaders, the team profiles and the credentials template. */
function fakeRepo(credentialsBody) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'doctor-'));
  for (const d of ['scripts', 'automation/config', 'qa-workflow', 'docs/ai']) mkdirSync(path.join(root, d), { recursive: true });
  cpSync(path.join(repo, 'scripts', 'doctor.mjs'), path.join(root, 'scripts', 'doctor.mjs'));
  for (const f of ['team.js', 'framework.js', 'credentials.local.example.js']) {
    cpSync(path.join(repo, 'automation', 'config', f), path.join(root, 'automation', 'config', f));
  }
  cpSync(path.join(repo, 'teams'), path.join(root, 'teams'), { recursive: true });
  // team.js validates a profile's `domains` against the knowledge registry.
  cpSync(path.join(repo, 'qa-workflow', 'registry'), path.join(root, 'qa-workflow', 'registry'), { recursive: true });
  // The /qa-* entrypoints: a real clone has them, so a fresh copy must not fail on "Workflow skills".
  cpSync(path.join(repo, '.claude', 'skills'), path.join(root, '.claude', 'skills'), { recursive: true });
  writeFileSync(path.join(root, 'CLAUDE.md'), '');
  if (credentialsBody != null) writeFileSync(path.join(root, 'automation', 'config', 'credentials.local.js'), credentialsBody);
  return root;
}

/** The developer's real machine must not leak in: framework.js also searches ~/projects, so HOME moves too. */
function isolatedEnv(root, frameworkPath) {
  const env = { ...process.env, QA_FRAMEWORK_PATH: frameworkPath, HOME: root, USERPROFILE: root };
  for (const k of CRED_ENV) delete env[k];
  return env;
}

function doctor(root, mode = '--json') {
  const env = isolatedEnv(root, path.join(root, 'no-framework'));
  const r = spawnSync(process.execPath, [path.join(root, 'scripts', 'doctor.mjs'), mode], { encoding: 'utf8', env, cwd: root });
  return { status: r.status, stdout: r.stdout, json: mode === '--json' ? JSON.parse(r.stdout) : null };
}

const byName = (list, name) => list.find((p) => p.name === name);

test('fresh clone, nothing configured: NOTHING blocks — every gap is a question with the step that needs it', () => {
  // Operator rule 2026-11-24: a step the tester has not done yet is asked for, never a block.
  const { status, json } = doctor(fakeRepo(null));
  assert.equal(status, 0);
  assert.equal(json.ready, true);
  assert.equal(json.complete, false);
  assert.deepEqual(json.blocking, []);
  const team = byName(json.ask, 'QA team');
  assert.deepEqual([team.fix.type, team.fix.when], ['team', 'start']);
  assert.deepEqual(team.fix.available, ['card-core', 'payment']);
  const token = byName(json.ask, 'Jira API token');
  assert.deepEqual([token.fix.type, token.fix.key, token.fix.env, token.fix.secret, token.fix.when],
    ['credential', 'jiraApiToken', 'JIRA_API_TOKEN', true, 'bug-filing']);
  assert.equal(byName(json.ask, 'BrowserStack Test Management API token').fix.when, 'import');
  assert.equal(byName(json.ask, 'Java QA framework').fix.when, 'automation');
  assert.equal(byName(json.ask, 'Credentials file').fix.type, 'command');
  assert.equal(json.firstRun, true);
  assert.equal(byName(json.ask, 'First-run setup').fix.run, '/qa-setup');
  // Asked in the order the run reaches them: start-of-run items first.
  const order = ['start', 'import', 'bug-filing', 'mobile', 'automation'];
  const whens = json.ask.map((a) => order.indexOf(a.fix.when));
  assert.deepEqual(whens, [...whens].sort((a, b) => a - b));
});

test('only what makes the scripts impossible to run is a hard failure', () => {
  const root = fakeRepo(null);
  rmSync(path.join(root, '.claude'), { recursive: true });
  const { status, json } = doctor(root);
  assert.equal(status, 1);
  assert.deepEqual(json.blocking.map((b) => b.name), ['Workflow skills']);
});

test('template copied but not filled in: placeholders count as missing, and TODO is not a team', () => {
  const template = path.join(repo, 'automation', 'config', 'credentials.local.example.js');
  const root = fakeRepo(null);
  cpSync(template, path.join(root, 'automation', 'config', 'credentials.local.js'));
  const { json } = doctor(root);
  assert.match(byName(json.ask, 'Jira API token').detail, /still the template placeholder/);
  assert.match(byName(json.ask, 'Jira email').detail, /still the template placeholder/);
  assert.ok(byName(json.ask, 'QA team'), 'team: TODO must not count as a selected team');
});

test('filled in: the credentials and team pass, and no value is ever printed', () => {
  const root = fakeRepo(`module.exports = {
    team: 'card-core', jiraEmail: 'qa.person@breadfast.com', jiraApiToken: '${FAKE_TOKEN}',
    bsTmUsername: 'qa.person@breadfast.com', bsTmApiToken: '${FAKE_TOKEN}2',
  };`);
  const { json, stdout } = doctor(root);
  for (const name of ['QA team', 'Jira email', 'Jira API token', 'BrowserStack Test Management username', 'BrowserStack Test Management API token']) {
    assert.ok(!byName(json.ask, name), `${name} should not be asked for`);
    assert.ok(json.ok.includes(name), `${name} should be ok`);
  }
  assert.equal(byName(json.ask, 'BrowserStack App Automate access key').fix.when, 'mobile');
  assert.ok(!stdout.includes(FAKE_TOKEN), 'a credential value leaked into the report');
});

test('App Automate keys in the Java framework\'s browserStackConfigs.properties count as set', () => {
  const root = fakeRepo(`module.exports = { team: 'card-core' };`);
  const fw = path.join(root, 'framework');
  mkdirSync(path.join(fw, 'resources', 'environments'), { recursive: true });
  writeFileSync(path.join(fw, 'pom.xml'), '<project/>');
  writeFileSync(path.join(fw, 'resources', 'environments', 'browserStackConfigs.properties'),
    `userName=qa_AbC123\naccessKey=${FAKE_TOKEN}\n`);
  const env = isolatedEnv(root, fw);
  const r = spawnSync(process.execPath, [path.join(root, 'scripts', 'doctor.mjs'), '--json'], { encoding: 'utf8', env, cwd: root });
  const json = JSON.parse(r.stdout);
  assert.ok(json.ok.includes('BrowserStack App Automate username'));
  assert.ok(json.ok.includes('BrowserStack App Automate access key'));
  assert.ok(!r.stdout.includes(FAKE_TOKEN));
});

test('a team whose profile still has TODO values is asked for before the import, listing the fields', () => {
  const root = fakeRepo(`module.exports = { team: 'payment' };`);
  const { json } = doctor(root);
  const team = byName(json.ask, 'QA team');
  assert.deepEqual([team.fix.type, team.fix.when], ['team-values', 'import']);
  assert.ok(team.fix.fields.includes('browserstack.project'));
});

test('session-start brief: always exits 0, tells Claude what to ask for, never prints values', () => {
  const missing = doctor(fakeRepo(null), '--session-start');
  assert.equal(missing.status, 0);
  assert.match(missing.stdout, /item\(s\) to add/);
  assert.match(missing.stdout, /NEVER a reason to stop a run/);
  assert.match(missing.stdout, /jiraApiToken/);
  assert.match(missing.stdout, /needed before a bug is filed/);
  assert.match(missing.stdout, /Readiness step/);
  assert.match(missing.stdout, /FIRST RUN on this machine/);

  const filled = doctor(fakeRepo(`module.exports = { team: 'card-core', jiraEmail: 'a@b.co', jiraApiToken: '${FAKE_TOKEN}',
    bsTmUsername: 'a@b.co', bsTmApiToken: '${FAKE_TOKEN}', browserstackUsername: 'a', browserstackAccessKey: '${FAKE_TOKEN}' };`),
  '--session-start');
  assert.equal(filled.status, 0);
  assert.ok(!filled.stdout.includes(FAKE_TOKEN));
});

// ── Team scope: domains/surfaces decide which product knowledge a session loads (2026-11-24) ───
const FILLED_CREDS = (teamId) => `module.exports = {
  team: '${teamId}', jiraEmail: 'qa.person@breadfast.com', jiraApiToken: '${FAKE_TOKEN}',
  bsTmUsername: 'qa.person@breadfast.com', bsTmApiToken: '${FAKE_TOKEN}2',
};`;
const ORDERS = (over = {}) => JSON.stringify({ id: 'orders', name: 'Orders',
  jira: { projectKey: 'B10', bugIssueTypeId: '10084', bug: { web: { squad: ['Orders'], components: ['Orders Web'] } } },
  browserstack: { project: 'PR-9', numericProject: '1', suiteFolder: 2 },
  surfaces: ['backend'], domains: [], ...over });

test('session brief names the team and its knowledge plan command', () => {
  const root = fakeRepo(FILLED_CREDS('card-core'));
  const { stdout } = doctor(root, '--session-start');
  assert.match(stdout, /QA team: card-core — product knowledge for this session = `node qa-workflow\/bin\/qa-cli\.js knowledge --team card-core`/);
  assert.match(stdout, /domains: card, payment, marketing/);
});

test('an unknown domain or surface in the team profile is asked for at the start (it would load the wrong knowledge)', () => {
  const root = fakeRepo(FILLED_CREDS('orders'));
  writeFileSync(path.join(root, 'teams', 'orders.json'), ORDERS({ domains: ['fintech'] }));
  const t = byName(doctor(root).json.ask, 'QA team');
  assert.ok(t, 'expected a QA team question');
  assert.equal(t.fix.when, 'start');
  assert.match(t.detail, /unknown domain\(s\): fintech/);
  assert.equal(t.fix.type, 'team-values');
});

test('a valid non-card team passes, and is not asked for the Card squad\'s framework file', () => {
  const root = fakeRepo(FILLED_CREDS('orders'));
  writeFileSync(path.join(root, 'teams', 'orders.json'), ORDERS());
  const fw = path.join(root, 'fw');
  mkdirSync(path.join(fw, 'resources', 'environments'), { recursive: true });
  writeFileSync(path.join(fw, 'pom.xml'), '<project/>');
  for (const f of ['config_testing.properties', 'browserStackConfigs.properties']) writeFileSync(path.join(fw, 'resources', 'environments', f), 'x=1\n');
  const env = isolatedEnv(root, fw);
  const r = spawnSync(process.execPath, [path.join(root, 'scripts', 'doctor.mjs'), '--json'], { encoding: 'utf8', env, cwd: root });
  const json = JSON.parse(r.stdout);
  assert.ok(json.ok.includes('QA team'));
  assert.ok(json.ok.includes('Framework config files'), JSON.stringify(json.ask));
});

test('a profile without a browserstack block does not crash the team check', () => {
  const root = fakeRepo(FILLED_CREDS('orders'));
  const p = JSON.parse(ORDERS()); delete p.browserstack;
  writeFileSync(path.join(root, 'teams', 'orders.json'), JSON.stringify(p));
  const { json } = doctor(root);
  const t = byName(json.ask, 'QA team');
  assert.ok(!t || !/TypeError|Cannot read properties/.test(t.detail), t && t.detail);
});

test('a team with no team context is offered onboarding at the start, without blocking; card-core\'s context passes', () => {
  const root = fakeRepo(FILLED_CREDS('orders'));
  writeFileSync(path.join(root, 'teams', 'orders.json'), ORDERS());
  const { status, json } = doctor(root);
  assert.equal(status, 0);
  const missing = byName(json.ask, 'Team context');
  assert.ok(missing, 'missing context must be asked for');
  assert.deepEqual([missing.fix.type, missing.fix.when], ['team-context', 'start']);
  assert.match(missing.fix.run, /team-onboarding/);
  const card = doctor(fakeRepo(FILLED_CREDS('card-core'))).json;
  assert.ok(card.ok.includes('Team context'), JSON.stringify(card.ask.map((r) => r.name)));
});

test('setup is a one-time workflow: after setup.mjs --done the doctor stops asking for it', () => {
  const root = fakeRepo(FILLED_CREDS('card-core'));
  cpSync(path.join(repo, 'scripts', 'setup.mjs'), path.join(root, 'scripts', 'setup.mjs'));
  const env = isolatedEnv(root, path.join(root, 'no-framework'));
  const r = spawnSync(process.execPath, [path.join(root, 'scripts', 'setup.mjs'), '--done', '--deferred', 'Java QA framework'],
    { encoding: 'utf8', env, cwd: root });
  assert.equal(r.status, 0, r.stderr);
  const { json, stdout } = { ...doctor(root), stdout: doctor(root, '--session-start').stdout };
  assert.equal(json.firstRun, false);
  assert.match(byName(json.ok.map((n) => ({ name: n })), 'First-run setup').name, /First-run setup/);
  assert.doesNotMatch(stdout, /FIRST RUN/);
});
