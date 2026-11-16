// The doctor is the readiness check Claude runs before any /qa-* workflow (and at session start).
// These tests run it against a throwaway copy of the repo skeleton, so the developer's own
// credentials.local.js is never read, and they assert on what a colleague's first run looks like.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
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

test('fresh clone, nothing configured: not ready, and every gap says exactly what to set', () => {
  const { status, json } = doctor(fakeRepo(null));
  assert.equal(status, 1);
  assert.equal(json.ready, false);
  const team = byName(json.blocking, 'QA team');
  assert.equal(team.fix.type, 'team');
  assert.deepEqual(team.fix.available, ['card-core', 'payment']);
  const token = byName(json.blocking, 'Jira API token');
  assert.deepEqual([token.fix.type, token.fix.key, token.fix.env, token.fix.secret], ['credential', 'jiraApiToken', 'JIRA_API_TOKEN', true]);
  assert.ok(byName(json.blocking, 'BrowserStack Test Management API token'));
  assert.equal(byName(json.warnings, 'Credentials file').fix.type, 'command');
});

test('template copied but not filled in: placeholders count as missing, and TODO is not a team', () => {
  const template = path.join(repo, 'automation', 'config', 'credentials.local.example.js');
  const root = fakeRepo(null);
  cpSync(template, path.join(root, 'automation', 'config', 'credentials.local.js'));
  const { json } = doctor(root);
  assert.match(byName(json.blocking, 'Jira API token').detail, /still the template placeholder/);
  assert.match(byName(json.blocking, 'Jira email').detail, /still the template placeholder/);
  assert.ok(byName(json.blocking, 'QA team'), 'team: TODO must not count as a selected team');
});

test('filled in: the credentials and team pass, and no value is ever printed', () => {
  const root = fakeRepo(`module.exports = {
    team: 'card-core', jiraEmail: 'qa.person@breadfast.com', jiraApiToken: '${FAKE_TOKEN}',
    bsTmUsername: 'qa.person@breadfast.com', bsTmApiToken: '${FAKE_TOKEN}2',
  };`);
  const { json, stdout } = doctor(root);
  for (const name of ['QA team', 'Jira email', 'Jira API token', 'BrowserStack Test Management username', 'BrowserStack Test Management API token']) {
    assert.ok(!byName(json.blocking, name), `${name} should not be blocking`);
    assert.ok(json.ok.includes(name), `${name} should be ok`);
  }
  assert.ok(byName(json.warnings, 'BrowserStack App Automate access key'), 'App Automate is a warning, not blocking');
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

test('a team whose profile still has TODO values is a warning that lists the fields', () => {
  const root = fakeRepo(`module.exports = { team: 'payment' };`);
  const { json } = doctor(root);
  const team = byName(json.warnings, 'QA team');
  assert.equal(team.fix.type, 'team-values');
  assert.ok(team.fix.fields.includes('jira.projectKey'));
});

test('session-start brief: always exits 0, tells Claude what to ask for, never prints values', () => {
  const missing = doctor(fakeRepo(null), '--session-start');
  assert.equal(missing.status, 0);
  assert.match(missing.stdout, /blocking/);
  assert.match(missing.stdout, /jiraApiToken/);
  assert.match(missing.stdout, /Readiness step/);

  const filled = doctor(fakeRepo(`module.exports = { team: 'card-core', jiraEmail: 'a@b.co', jiraApiToken: '${FAKE_TOKEN}',
    bsTmUsername: 'a@b.co', bsTmApiToken: '${FAKE_TOKEN}', browserstackUsername: 'a', browserstackAccessKey: '${FAKE_TOKEN}' };`),
  '--session-start');
  assert.equal(filled.status, 0);
  assert.ok(!filled.stdout.includes(FAKE_TOKEN));
});
