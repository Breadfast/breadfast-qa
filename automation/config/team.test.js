'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const team = require('./team.js');

const REPO_TEAMS = path.join(__dirname, '..', '..', 'teams');

function tmpTeams(profiles) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'teams-'));
  for (const [id, body] of Object.entries(profiles)) fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(body));
  return dir;
}

const FILLED = {
  id: 'orders', name: 'Orders',
  jira: {
    projectKey: 'ORD', bugIssueTypeId: '10001',
    bug: { web: { squad: ['Orders Web'], components: ['Dashboard'] }, mobile: { squad: ['Orders App'], components: ['App'] } },
  },
  browserstack: { project: 'PR-9', numericProject: '111', suiteFolder: 222 },
  surfaces: ['web', 'mobile'], domains: ['orders'],
};

/** Run fn with QA_TEAM unset, restoring it afterwards. */
function withoutEnvTeam(fn) {
  const saved = process.env.QA_TEAM;
  delete process.env.QA_TEAM;
  try { return fn(); } finally { if (saved === undefined) delete process.env.QA_TEAM; else process.env.QA_TEAM = saved; }
}

test('no team selected → a TeamProfileError that lists the teams and how to choose — never a default team', () => {
  const dir = tmpTeams({ orders: FILLED });
  withoutEnvTeam(() => {
    assert.throws(() => team.loadTeam({ dir, local: {} }), (e) => e instanceof team.TeamProfileError
      && /No QA team selected/.test(e.message) && /orders/.test(e.message) && /QA_TEAM/.test(e.message));
    assert.equal(team.tryLoadTeam({ dir, local: {} }), null);
  });
});

test('the TODO placeholder in credentials.local.js counts as "not selected"', () => {
  withoutEnvTeam(() => assert.equal(team.selectedTeamId({ team: 'TODO' }), null));
});

test('QA_TEAM wins over credentials.local.js', () => {
  const saved = process.env.QA_TEAM;
  process.env.QA_TEAM = 'orders';
  try { assert.equal(team.selectedTeamId({ team: 'payment' }), 'orders'); } finally {
    if (saved === undefined) delete process.env.QA_TEAM; else process.env.QA_TEAM = saved;
  }
});

test('unknown team and invalid id are explicit errors', () => {
  const dir = tmpTeams({ orders: FILLED });
  assert.throws(() => team.loadTeam({ dir, id: 'nope' }), /Unknown QA team "nope"/);
  assert.throws(() => team.loadTeam({ dir, id: '../x' }), /not valid/);
});

test('bugDefaults takes web values for web/be and mobile values for app combos; spec values win', () => {
  const p = team.loadTeam({ dir: tmpTeams({ orders: FILLED }), id: 'orders' });
  const web = team.bugDefaults(p, { combo: 'web' });
  assert.deepEqual([web.projectKey, web.issueTypeId, web.squad, web.components], ['ORD', '10001', ['Orders Web'], ['Dashboard']]);
  assert.deepEqual(team.bugDefaults(p, { combo: 'be' }).squad, ['Orders Web']);
  assert.deepEqual(team.bugDefaults(p, { combo: 'ios-ar' }).components, ['App']);
  assert.deepEqual(team.bugDefaults(p, { combo: 'web', squad: ['Override'] }).squad, ['Override']);
  assert.deepEqual(web.labels, ['ai-created', 'qa-found']);
  assert.equal(web.environment, 'Egypt');
});

test('a TODO value needed by the caller is named in the error; unrelated TODOs do not block', () => {
  const half = JSON.parse(JSON.stringify(FILLED));
  half.jira.bug.mobile = { squad: ['TODO'], components: ['TODO'] };
  half.browserstack.suiteFolder = 'TODO';
  const p = team.loadTeam({ dir: tmpTeams({ orders: half }), id: 'orders' });
  assert.deepEqual(team.bugDefaults(p, { combo: 'web' }).squad, ['Orders Web']);
  assert.throws(() => team.bugDefaults(p, { combo: 'android-en' }), /"jira\.bug\.mobile\.squad" is not filled in/);
  assert.deepEqual(team.unfilledPaths(p), ['jira.bug.mobile.squad', 'jira.bug.mobile.components', 'browserstack.suiteFolder']);
});

test('a surface the team deleted from its profile is reported, not guessed', () => {
  const webOnly = JSON.parse(JSON.stringify(FILLED));
  delete webOnly.jira.bug.mobile;
  const p = team.loadTeam({ dir: tmpTeams({ orders: webOnly }), id: 'orders' });
  assert.throws(() => team.bugDefaults(p, { combo: 'ios-en' }), /jira\.bug\.mobile\.squad/);
});

test('resolveBrowserstackProject: explicit value wins, else the team profile, else an error', () => {
  const dir = tmpTeams({ orders: FILLED, blank: { ...FILLED, id: 'blank', browserstack: { project: 'TODO' } } });
  assert.equal(team.resolveBrowserstackProject('PR-1', { dir, id: 'orders' }), 'PR-1');
  assert.equal(team.resolveBrowserstackProject(undefined, { dir, id: 'orders' }), 'PR-9');
  assert.throws(() => team.resolveBrowserstackProject(undefined, { dir, id: 'blank' }), /browserstack\.project/);
});

test('storyKeyPattern: the team project when known, any Jira key otherwise', () => {
  assert.ok(team.storyKeyPattern({ jira: { projectKey: 'ORD' } }).test('ORD-12'));
  assert.ok(!team.storyKeyPattern({ jira: { projectKey: 'ORD' } }).test('B10-12'));
  assert.ok(team.storyKeyPattern(null).test('PAY-7'));
  assert.ok(team.storyKeyPattern({ jira: { projectKey: 'TODO' } }).test('B10-1'));
});

test('shipped profiles: card-core is complete; payment and the template are valid JSON with TODOs only', () => {
  const card = team.loadTeam({ dir: REPO_TEAMS, id: 'card-core' });
  assert.deepEqual(team.unfilledPaths(card), []);
  assert.equal(card.jira.projectKey, 'B10');
  assert.equal(card.browserstack.project, 'PR-5');
  const payment = team.loadTeam({ dir: REPO_TEAMS, id: 'payment' });
  assert.ok(team.unfilledPaths(payment).includes('browserstack.project'));
  assert.equal(payment.jira.projectKey, 'B10'); // D-15: every team files stories in B10
  assert.deepEqual(payment.domains, ['payment']);
  assert.ok(!team.availableTeams(REPO_TEAMS).includes('_template'));
  JSON.parse(fs.readFileSync(path.join(REPO_TEAMS, '_template.json'), 'utf8'));
});

// ── domains / surfaces: the switch for knowledge loading (P0 generalization, 2026-11-24) ────────
test('teamDomains validates against the knowledge registry; [] is allowed', () => {
  const known = ['card', 'marketing', 'payment'];
  assert.deepEqual(team.teamDomains({ id: 'x', domains: ['payment', 'payment'] }, known), ['payment']);
  assert.deepEqual(team.teamDomains({ id: 'x', domains: [] }, known), []);
  assert.throws(() => team.teamDomains({ id: 'x', domains: ['orders'] }, known), /unknown domain\(s\): orders/);
  assert.throws(() => team.teamDomains({ id: 'x', domains: ['TODO'] }, known), /not filled in yet/);
  assert.throws(() => team.teamDomains({ id: 'x' }, known), /must be a list/);
});

test('teamSurfaces accepts only web | mobile | backend, at least one', () => {
  assert.deepEqual(team.teamSurfaces({ id: 'x', surfaces: ['backend'] }), ['backend']);
  assert.throws(() => team.teamSurfaces({ id: 'x', surfaces: [] }), /at least one/);
  assert.throws(() => team.teamSurfaces({ id: 'x', surfaces: ['TODO'] }), /not filled in yet/);
  assert.throws(() => team.teamSurfaces({ id: 'x', surfaces: ['desktop'] }), /unknown value\(s\): desktop/);
});

test('the real registry knows card, marketing, payment; card-core loads all three (D-6)', () => {
  assert.deepEqual(team.knownDomains(), ['card', 'marketing', 'payment']);
  const card = team.loadTeam({ dir: REPO_TEAMS, id: 'card-core' });
  assert.deepEqual(team.teamDomains(card), ['card', 'payment', 'marketing']);
  assert.deepEqual(team.teamSurfaces(card), ['web', 'mobile', 'backend']);
  assert.equal(team.teamContextDir(card, REPO_TEAMS), path.join(REPO_TEAMS, 'card-core'));
});
