#!/usr/bin/env node
/**
 * One-command setup for a fresh clone:
 *
 *   npm run setup                     interactive: asks only for your team (Enter skips)
 *   npm run setup -- --team payment   same, team given up front
 *   npm run setup -- --no-browsers    skip the ~150 MB Chromium download
 *
 * It installs what can be installed without asking (npm packages, Chromium, the pre-commit secret check),
 * creates your gitignored credentials file from the template and records your team. Then it runs the
 * doctor. It never asks for a token or a password: those go into the credentials file, and Claude asks
 * for each one right before the step that needs it (`/qa-setup` asks for all of them at once).
 *
 * Nothing here stops on a missing piece: every step that cannot finish says so and the rest carry on.
 * Safe to re-run; each step skips what is already done.
 *
 *   node scripts/setup.mjs --done [--deferred "a,b"]
 *       Called by the /qa-setup workflow as its last step: records that first-run setup happened on this
 *       machine (a small file in the per-user workspace, outside the repo), with what the tester skipped.
 *       From then on the doctor stops asking Claude to run setup; skipped items are asked for just in time.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const isWindows = process.platform === 'win32';
const requireCjs = createRequire(import.meta.url);
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const interactive = process.stdin.isTTY && process.stdout.isTTY && !flag('--non-interactive');

const CRED = path.join(repoRoot, 'automation', 'config', 'credentials.local.js');
const WORKSPACE = process.env.QA_WORKSPACE_DIR?.trim() || path.join(os.homedir(), 'BreadfastQA', 'Workspace');
const MARKER = path.join(WORKSPACE, 'qa-setup.json');

if (flag('--done')) {
  const deferred = (option('--deferred') || '').split(',').map((s) => s.trim()).filter(Boolean);
  try {
    mkdirSync(WORKSPACE, { recursive: true });
    writeFileSync(MARKER, JSON.stringify({ completedAt: new Date().toISOString(), repo: repoRoot, deferred }, null, 2) + '\n');
  } catch (e) {
    // Never a blocker: the only cost is that the next session offers setup once more.
    console.log(`Could not record setup in ${MARKER} (${e.code || e.message}). Setup itself is fine; set QA_WORKSPACE_DIR `
      + 'to a writable folder outside the repo, or ignore this — the next session will just offer /qa-setup again.');
    process.exit(0);
  }
  console.log(`First-run setup recorded (${MARKER}).${deferred.length ? ` Deferred: ${deferred.join(', ')} — asked again before the step that needs each.` : ''}`);
  process.exit(0);
}
const TEMPLATE = path.join(repoRoot, 'automation', 'config', 'credentials.local.example.js');
const notes = [];

const step = (title) => console.log(`\n▸ ${title}`);
const done = (msg) => console.log(`  ✓ ${msg}`);
const later = (msg) => { console.log(`  · ${msg}`); notes.push(msg); };

function sh(cmd, cmdArgs) {
  const r = spawnSync(cmd, cmdArgs, { cwd: repoRoot, stdio: 'inherit', shell: isWindows });
  return r.status === 0;
}

// ── 0. Node ──────────────────────────────────────────────────────────────────
const major = Number(process.versions.node.split('.')[0]);
if (major < 20) {
  console.error(`Node ${process.versions.node} is too old. Install Node 20+ (22 LTS): https://nodejs.org — then run npm run setup again.`);
  process.exit(1);
}
console.log('Breadfast QA — setup');

// ── 1. npm packages ──────────────────────────────────────────────────────────
step('npm packages');
if (existsSync(path.join(repoRoot, 'node_modules', '@playwright', 'test'))) done('already installed');
else if (sh('npm', ['install'])) done('installed');
else later('npm install failed — check your network, then run `npm run setup` again');

// ── 2. Chromium (web execution + Figma design export) ────────────────────────
step('Chromium for Playwright');
const pwCache = process.env.PLAYWRIGHT_BROWSERS_PATH || (isWindows ? path.join(os.homedir(), 'AppData', 'Local', 'ms-playwright')
  : process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright') : path.join(os.homedir(), '.cache', 'ms-playwright'));
if (flag('--no-browsers')) later('skipped Chromium (--no-browsers) — run `npm run playwright:install` before web execution or Figma export');
else if (existsSync(pwCache)) done('already installed');
else if (sh('npx', ['playwright', 'install', 'chromium'])) done('installed');
else later('Chromium download failed — run `npm run playwright:install` later');

// ── 3. Pre-commit secret check ───────────────────────────────────────────────
step('Pre-commit secret check');
const hooks = spawnSync('git', ['config', '--get', 'core.hooksPath'], { cwd: repoRoot, encoding: 'utf8' }).stdout.trim();
if (hooks === '.githooks') done('already on');
else if (sh('git', ['config', 'core.hooksPath', '.githooks'])) done('on — a commit that stages a credential is stopped');
else later('could not set core.hooksPath — run `npm run hooks:install`');

// ── 4. Credentials file ──────────────────────────────────────────────────────
step('Credentials file (gitignored)');
if (existsSync(CRED)) done('automation/config/credentials.local.js exists — left as it is');
else { copyFileSync(TEMPLATE, CRED); done('created automation/config/credentials.local.js from the template'); }

// ── 5. Team ──────────────────────────────────────────────────────────────────
step('Your QA team');
const team = requireCjs(path.join(repoRoot, 'automation', 'config', 'team.js'));
const available = team.availableTeams();
const current = (() => { try { return team.selectedTeamId(); } catch { return null; } })();
let chosen = option('--team');
if (!chosen && current) done(`${current} (already set)`);
else {
  if (!chosen && interactive) {
    console.log(`  Teams with a profile: ${available.join(', ') || '(none yet)'}`);
    console.log('  Type yours, or a new id for a squad that has none yet (e.g. growth). Enter skips — Claude asks later.');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    chosen = (await rl.question('  Team id: ')).trim().toLowerCase();
    rl.close();
  }
  if (!chosen) later('no team yet — Claude asks which team at the start of your first run');
  else if (!/^[a-z0-9][a-z0-9-]*$/.test(chosen)) later(`"${chosen}" is not a valid team id (lowercase letters, digits, hyphens) — Claude asks later`);
  else {
    const text = readFileSync(CRED, 'utf8');
    const next = /^\s*team:\s*['"][^'"]*['"]\s*,?/m.test(text)
      ? text.replace(/^(\s*)team:\s*['"][^'"]*['"]\s*,?/m, `$1team: '${chosen}',`)
      : text.replace(/module\.exports\s*=\s*\{/, `module.exports = {\n  team: '${chosen}',`);
    writeFileSync(CRED, next);
    done(`team: '${chosen}' written to credentials.local.js`);
    if (!available.includes(chosen)) {
      const r = spawnSync(process.execPath, [path.join(repoRoot, 'qa-workflow', 'bin', 'qa-cli.js'), 'team-init', chosen],
        { cwd: repoRoot, encoding: 'utf8' });
      if (r.status === 0) {
        done(`created teams/${chosen}.json (Jira B10 + bug type pre-filled). Claude asks for the squad-specific values later; commit the file so your squad shares it`);
      } else later(`could not create teams/${chosen}.json: ${(r.stderr || r.stdout).trim().split('\n')[0]}`);
    }
  }
}

// ── 6. The doctor ────────────────────────────────────────────────────────────
step('Checking everything');
const doc = spawnSync(process.execPath, [path.join(repoRoot, 'scripts', 'doctor.mjs')], { cwd: repoRoot, stdio: 'inherit' });

console.log('\nNext: open this folder in Claude Code and type  /qa-setup  — Claude asks for anything marked ADD');
console.log('(credentials, Jira/Figma sign-in, team values). Or go straight to  /qa-shift-left B10-XXXXX : the same');
console.log('questions come first, you can skip any of them, and only the step that needs a skipped item waits.\n');
process.exit(doc.status === 1 ? 1 : 0);
