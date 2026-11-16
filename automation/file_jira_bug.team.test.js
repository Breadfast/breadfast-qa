'use strict';
/**
 * file_jira_bug.js takes the Jira project, bug issue type, squad and components from the selected
 * team profile — never from hard-coded card-squad values. Exercised end to end through `--dry`,
 * which validates and prints the payload without any network call.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SCRIPT = path.join(__dirname, 'file_jira_bug.js');

const PROFILE = {
  id: 'orders', name: 'Orders',
  jira: {
    projectKey: 'ORD', bugIssueTypeId: '10001',
    bug: { web: { squad: ['Orders Web'], components: ['Dashboard'] }, mobile: { squad: ['TODO'], components: ['TODO'] } },
  },
  browserstack: { project: 'PR-9', numericProject: '111', suiteFolder: 222 },
  surfaces: ['web'], domains: ['orders'],
};

function setup(specOverrides = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bug-team-'));
  const teams = path.join(dir, 'teams');
  fs.mkdirSync(teams);
  fs.writeFileSync(path.join(teams, 'orders.json'), JSON.stringify(PROFILE));
  const actual = path.join(dir, 'actual-thing.png');
  const video = path.join(dir, 'F-01-thing.mp4');
  fs.writeFileSync(actual, 'x');
  fs.writeFileSync(video, 'x');
  const spec = {
    parent: 'ORD-42', combo: 'web',
    title: 'The export button stays disabled after choosing a status',
    stepList: ['open "Reports"', 'choose a status', 'check the "Export" button'],
    actual: 'The button stays disabled.', expected: 'The button should be enabled.',
    severity: 'Major', platform: 'FE', attachments: [actual, video],
    ...specOverrides,
  };
  const specPath = path.join(dir, 'bug.json');
  fs.writeFileSync(specPath, JSON.stringify([spec]));
  return { teams, specPath };
}

function dry(specPath, env) {
  return spawnSync(process.execPath, [SCRIPT, '--spec', specPath, '--dry'], {
    encoding: 'utf8',
    env: { ...process.env, JIRA_EMAIL: 'qa@example.com', JIRA_API_TOKEN: 'not-a-real-token', ...env },
  });
}

function payloadFrom(stdout) {
  const start = stdout.indexOf('{', stdout.indexOf('--dry: payload'));
  const end = stdout.lastIndexOf('}');
  return JSON.parse(stdout.slice(start, end + 1));
}

test('web bug: project, issue type, squad and components come from the team profile', () => {
  const { teams, specPath } = setup();
  const r = dry(specPath, { QA_TEAMS_DIR: teams, QA_TEAM: 'orders' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const { fields } = payloadFrom(r.stdout);
  assert.deepEqual(fields.project, { key: 'ORD' });
  assert.deepEqual(fields.issuetype, { id: '10001' });
  assert.deepEqual(fields.customfield_10183, [{ value: 'Orders Web' }]);
  assert.deepEqual(fields.components, [{ name: 'Dashboard' }]);
  assert.deepEqual(fields.labels, ['ai-created', 'qa-found']);
  assert.doesNotMatch(r.stdout, /B10|Card Core|Bcard/);
});

test('no team selected → rejected before any write, with how to choose', () => {
  const { teams, specPath } = setup();
  // QA_TEAM='' falls through to credentials.local.js. On a machine with no team there it is "No QA team
  // selected"; on one whose local file names a real team, that team does not exist in this temp teams
  // dir, so it is "Unknown QA team". Either way: refused, and never filed under someone else's values.
  const r = dry(specPath, { QA_TEAMS_DIR: teams, QA_TEAM: '' });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /No QA team selected|Unknown QA team/);
  assert.match(r.stdout, /Nothing was written/);
});

test('a mobile bug while the mobile values are still TODO → the field is named, nothing written', () => {
  const { teams, specPath } = setup({ combo: 'android-en', platform: 'Android', builds: { android: { version: '1.0', build: '1' } } });
  const r = dry(specPath, { QA_TEAMS_DIR: teams, QA_TEAM: 'orders' });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /jira\.bug\.mobile\.squad" is not filled in/);
  assert.match(r.stdout, /Nothing was written/);
});

test('a parent story from another team\'s project is rejected', () => {
  const { teams, specPath } = setup({ parent: 'B10-56652' });
  const r = dry(specPath, { QA_TEAMS_DIR: teams, QA_TEAM: 'orders' });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /parent B10-56652 is not in your team's Jira project ORD/);
});
