'use strict';

// Team scoping in qa-cli (P0 generalization, 2026-11-24): init records the team, record defaults and
// guards domains, cross-domain is the named escape hatch, complete-check reports violations, and a
// legacy state (no team) behaves exactly as before.

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CLI = path.join(__dirname, 'qa-cli.js');
const REPO = path.join(__dirname, '..', '..');

/** Fixture teams use the real domain ids (the record guard validates against the real registry). */
const TEAMS = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-cli-teams-'));
const team = (id, domains, surfaces) => fs.writeFileSync(path.join(TEAMS, `${id}.json`),
  JSON.stringify({ id, name: id, domains, surfaces, jira: {}, browserstack: {} }));
team('pay-only', ['payment'], ['mobile']);
team('card-ref', ['card', 'payment', 'marketing'], ['web', 'mobile', 'backend']);
team('no-domain', [], ['backend']);
team('broken', ['fintech'], ['web']);

const env = (teamId) => ({ ...process.env, QA_TEAMS_DIR: TEAMS, QA_TEAM: teamId || '' });
const run = (args, teamId, input) => execFileSync(process.execPath, [CLI, ...args],
  { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], input: input || '', env: env(teamId) });
const fails = (args, teamId) => {
  try { run(args, teamId); } catch (e) { return String(e.stderr) + String(e.stdout); }
  assert.fail('expected a non-zero exit: ' + args.join(' '));
};
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'qa-cli-team-'));
const state = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'qa-state.json'), 'utf8'));
const issue = JSON.stringify({ updated: '2026-11-24T09:00:00Z', summary: 'S', description: 'D', ac: 'A', comments: [] });

function story(teamId, extra = []) {
  const dir = tmp();
  run(['init', dir, 'B10-1', ...extra], teamId);
  run(['fingerprint-jira', dir], teamId, issue);
  fs.mkdirSync(path.join(dir, 'requirements-analysis'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'requirements-analysis/requirements.md'), 'body');
  return dir;
}
const record = (dir, teamId, key, extra = []) => JSON.parse(run(['record', dir, key,
  '--path', 'requirements-analysis/requirements.md', '--generator', 'story-analysis@1.0', ...extra], teamId));

test('init records the selected team, and --team / --surfaces win', () => {
  const a = story('pay-only');
  assert.equal(state(a).team, 'pay-only');
  const b = story('pay-only', ['--team', 'card-ref', '--surfaces', 'web,backend']);
  assert.equal(state(b).team, 'card-ref');
  assert.deepEqual(state(b).storySurfaces, ['web', 'backend']);
});

test('init refuses an invalid team profile or surface', () => {
  assert.match(fails(['init', tmp(), 'B10-1'], 'broken'), /unknown domain\(s\): fintech/);
  assert.match(fails(['init', tmp(), 'B10-1', '--surfaces', 'tv'], 'pay-only'), /--surfaces takes any of/);
});

test('record defaults a domain-consuming artifact to the team\'s domains', () => {
  const dir = story('pay-only');
  assert.deepEqual(record(dir, 'pay-only', 'requirements').domains, ['payment']);
  // Non-consumers (e.g. execution-side artifacts) get no default.
  assert.equal(record(dir, 'pay-only', 'figma-analysis').domains, undefined);
});

test('record refuses another team\'s domain and names the operator command', () => {
  const dir = story('pay-only');
  const out = fails(['record', dir, 'requirements', '--path', 'requirements-analysis/requirements.md',
    '--generator', 'story-analysis@1.0', '--domains', 'card,payment'], 'pay-only');
  assert.match(out, /not in team pay-only's domains \(payment\)/);
  assert.match(out, /qa-cli\.js cross-domain <storyDir> card --by/);
});

test('an operator-approved cross-domain read lets the story consume that domain', () => {
  const dir = story('pay-only');
  run(['cross-domain', dir, 'card', '--by', 'QA Lead', '--reason', 'story changes the card panel'], 'pay-only');
  assert.equal(state(dir).crossDomains.card.approvedBy, 'QA Lead');
  assert.deepEqual(record(dir, 'pay-only', 'requirements', ['--domains', 'card,payment']).domains, ['card', 'payment']);
  const cc = JSON.parse(run(['complete-check', dir, '--expect', 'requirements'], 'pay-only'));
  assert.equal(cc.ok, true);
  assert.equal(cc.team, 'pay-only');
  const plan = JSON.parse(run(['knowledge', dir, '--json'], 'pay-only'));
  assert.deepEqual(plan.crossDomains, ['card']);
});

test('cross-domain needs a name, a reason, a known domain and a team-scoped story', () => {
  const dir = story('pay-only');
  assert.match(fails(['cross-domain', dir, 'card'], 'pay-only'), /--by "<operator>" --reason/);
  assert.match(fails(['cross-domain', dir, 'fintech', '--by', 'x', '--reason', 'y'], 'pay-only'), /unknown domain "fintech"/);
  const legacy = tmp();
  fs.writeFileSync(path.join(legacy, 'qa-state.json'), JSON.stringify({ schemaVersion: 1, ticket: 'B10-1', sources: { jira: null }, artifacts: {} }));
  assert.match(fails(['cross-domain', legacy, 'card', '--by', 'x', '--reason', 'y'], 'pay-only'), /no team recorded/);
});

test('complete-check reports an artifact that consumed a domain outside the team', () => {
  const dir = story('pay-only');
  record(dir, 'pay-only', 'requirements');
  const s = state(dir);
  s.artifacts.requirements.domains = ['payment', 'card']; // simulate a leak written around the guard
  fs.writeFileSync(path.join(dir, 'qa-state.json'), JSON.stringify(s));
  let out;
  try { run(['complete-check', dir, '--expect', 'requirements'], 'pay-only'); } catch (e) { out = JSON.parse(e.stdout); }
  assert.ok(out, 'complete-check should exit non-zero');
  assert.ok(out.problems.some((p) => p.key === 'requirements' && /domain-out-of-team: consumed card/.test(p.issue)));
});

test('a team with domains [] records no domains by default and may not consume any', () => {
  const dir = story('no-domain');
  assert.equal(record(dir, 'no-domain', 'requirements').domains, undefined);
  assert.match(fails(['record', dir, 'requirements', '--path', 'requirements-analysis/requirements.md',
    '--generator', 'story-analysis@1.0', '--domains', 'card'], 'no-domain'), /not in team no-domain's domains \(none\)/);
});

test('a LEGACY state (no team) behaves exactly as before: no guard, no team/scope in output', () => {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, 'requirements-analysis'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'requirements-analysis/requirements.md'), 'body');
  fs.writeFileSync(path.join(dir, 'qa-state.json'), JSON.stringify({ schemaVersion: 1, ticket: 'B10-1',
    sources: { jira: { updated: '2026-07-01T00:00:00Z', hash: 'a'.repeat(64) } }, artifacts: {} }));
  // Any known domain is accepted (pre-team behaviour), whatever team is selected in the environment.
  assert.deepEqual(record(dir, 'pay-only', 'requirements', ['--domains', 'card,marketing']).domains, ['card', 'marketing']);
  const cc = JSON.parse(run(['complete-check', dir, '--expect', 'requirements'], 'pay-only'));
  assert.equal(cc.ok, true);
  assert.equal('team' in cc, false);
  const st = JSON.parse(run(['status', dir, '--json'], 'pay-only'));
  assert.equal('scope' in st, false);
});

test('status shows the team scope for a team-scoped story', () => {
  const dir = story('pay-only', ['--surfaces', 'mobile']);
  const st = JSON.parse(run(['status', dir, '--json'], 'pay-only'));
  assert.deepEqual(st.scope, { team: 'pay-only', domains: ['payment'], crossDomains: [], storySurfaces: ['mobile'] });
  assert.match(run(['status', dir], 'pay-only'), /team pay-only {2}· {2}domains payment/);
});

test('the real card-core profile still allows every domain Card stories record today', () => {
  const dir = story('card-ref');
  assert.deepEqual(record(dir, 'card-ref', 'testcases', ['--domains', 'card,payment,marketing']).domains,
    ['card', 'payment', 'marketing']);
  const real = JSON.parse(fs.readFileSync(path.join(REPO, 'teams/card-core.json'), 'utf8'));
  assert.deepEqual(real.domains, ['card', 'payment', 'marketing']);
});

test('repos joins the team\'s repos.json with this tester\'s grants — an ungranted clone is never read', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-cli-repo-'));
  const git = (...a) => execFileSync('git', ['-C', repo, ...a], { stdio: 'pipe', encoding: 'utf8' }).trim();
  git('init', '-q'); git('config', 'user.email', 't@e.x'); git('config', 'user.name', 't');
  fs.writeFileSync(path.join(repo, 'a.txt'), 'x'); git('add', '.'); git('commit', '-qm', 'one');
  fs.mkdirSync(path.join(TEAMS, 'pay-only'), { recursive: true });
  fs.writeFileSync(path.join(TEAMS, 'pay-only', 'repos.json'), JSON.stringify([
    { id: 'pay-service', url: 'git@example:pay.git', role: 'backend' },
    { id: 'pay-web', url: 'git@example:web.git', role: 'web' },
  ]));
  const grants = JSON.stringify({ 'pay-service': { path: repo, granted: true }, 'pay-web': { path: repo, granted: false } });
  const out = JSON.parse(execFileSync(process.execPath, [CLI, 'repos', '--json'],
    { encoding: 'utf8', env: { ...env('pay-only'), QA_REPO_GRANTS: grants } }));
  const svc = out.repos.find((r) => r.id === 'pay-service');
  const web = out.repos.find((r) => r.id === 'pay-web');
  assert.equal(svc.granted, true);
  assert.match(svc.headSha, /^[0-9a-f]{40}$/);
  assert.equal(web.granted, false);
  assert.equal(web.headSha, null);
});

test('knowledge-lint exits 1 on an untagged fact and 0 on the real card-core context', () => {
  const ok = execFileSync(process.execPath, [CLI, 'knowledge-lint', path.join(REPO, 'teams/card-core'), '--team', 'card-core'],
    { encoding: 'utf8', env: { ...process.env, QA_TEAMS_DIR: path.join(REPO, 'teams') } });
  assert.match(ok, /knowledge-lint .*card-core: OK/);
  fs.mkdirSync(path.join(TEAMS, 'pay-only'), { recursive: true });
  fs.writeFileSync(path.join(TEAMS, 'pay-only', 'context.md'), '# x\nverifiedAt: 2026-11-24 · verifiedBy: a\n## Product\n- untagged fact\n');
  assert.match(fails(['knowledge-lint', path.join(TEAMS, 'pay-only')], 'pay-only'), /untagged/);
});
