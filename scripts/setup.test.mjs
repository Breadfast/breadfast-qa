// `npm run setup` on a fresh copy: installs nothing over the network here (node_modules and the browser cache
// are faked), never stops on a missing piece, writes the team, creates a new squad's profile, and is safe to re-run.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function freshClone() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'setup-'));
  for (const rel of ['scripts/setup.mjs', 'scripts/doctor.mjs', 'automation/config/team.js', 'automation/config/framework.js',
    'automation/config/credentials.local.example.js', 'teams', 'qa-workflow', '.claude/skills', 'docs/ai/QA_PROCESS.md', 'CLAUDE.md']) {
    cpSync(path.join(repo, rel), path.join(root, rel), { recursive: true });
  }
  mkdirSync(path.join(root, 'node_modules', '@playwright', 'test'), { recursive: true });
  mkdirSync(path.join(root, 'pw-cache'));
  return root;
}

function setup(root, ...args) {
  const env = { ...process.env, HOME: root, USERPROFILE: root, PLAYWRIGHT_BROWSERS_PATH: path.join(root, 'pw-cache'),
    QA_FRAMEWORK_PATH: path.join(root, 'none'), GIT_CEILING_DIRECTORIES: path.dirname(root) };
  for (const k of ['QA_TEAM', 'QA_TEAMS_DIR', 'QA_KNOWLEDGE_REGISTRY', 'JIRA_API_TOKEN', 'BS_TM_API_TOKEN']) delete env[k];
  return spawnSync(process.execPath, [path.join(root, 'scripts', 'setup.mjs'), '--non-interactive', ...args], { encoding: 'utf8', env, cwd: root });
}

test('a new squad: setup writes the team, creates its profile, and ends ready with questions — not failures', () => {
  const root = freshClone();
  const r = setup(root, '--team', 'growth');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const cred = readFileSync(path.join(root, 'automation', 'config', 'credentials.local.js'), 'utf8');
  assert.match(cred, /team: 'growth',/);
  const profile = JSON.parse(readFileSync(path.join(root, 'teams', 'growth.json'), 'utf8'));
  assert.equal(profile.jira.projectKey, 'B10');
  assert.match(r.stdout, /to add/);
  assert.match(r.stdout, /\/qa-setup/);
  assert.match(r.stdout, / 0 must fix/);
});

test('an existing team gets no new profile, and a re-run changes nothing', () => {
  const root = freshClone();
  const teamsBefore = readdirSync(path.join(root, 'teams')).sort();
  assert.equal(setup(root, '--team', 'card-core').status, 0);
  assert.deepEqual(readdirSync(path.join(root, 'teams')).sort(), teamsBefore);
  const before = readFileSync(path.join(root, 'automation', 'config', 'credentials.local.js'), 'utf8');
  const again = setup(root);
  assert.equal(again.status, 0);
  assert.match(again.stdout, /card-core \(already set\)/);
  assert.equal(readFileSync(path.join(root, 'automation', 'config', 'credentials.local.js'), 'utf8'), before);
});

test('no team given and nobody to ask: setup carries on and says Claude asks later', () => {
  const root = freshClone();
  const r = setup(root);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /no team yet — Claude asks which team/);
});

test('an invalid team id is refused without stopping setup', () => {
  const root = freshClone();
  const r = setup(root, '--team', 'Bad Squad');
  assert.equal(r.status, 0);
  assert.match(r.stdout, /not a valid team id/);
});
