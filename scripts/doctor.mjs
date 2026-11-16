#!/usr/bin/env node
/**
 * Breadfast QA — environment doctor.
 *
 *   npm run doctor
 *
 * Checks every prerequisite a QA engineer needs, on Windows AND macOS/Linux, and
 * prints a fix-it hint for each gap instead of failing silently. Read-only: it
 * never writes files, never calls a Breadfast backend, and never needs secrets.
 *
 * Exit code 0 when nothing REQUIRED is missing (warnings are fine), 1 otherwise.
 *
 * Modes:
 *   npm run doctor                      human report (default)
 *   node scripts/doctor.mjs --json      machine report for Claude: { ready, blocking[], warnings[], ok[] },
 *                                       each problem carrying a `fix` (the key/env to set or command to run)
 *   node scripts/doctor.mjs --session-start
 *                                       the SessionStart hook (.claude/settings.json): skips the slow
 *                                       tool probes, prints a short brief into Claude's context telling it
 *                                       what to ask the user for before any workflow, and ALWAYS exits 0
 *                                       so a missing credential never stops Claude Code from opening.
 *
 * Credential values are never printed, in any mode — only whether each one is set.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const isWindows = process.platform === 'win32';
const requireCjs = createRequire(import.meta.url);

const MODE_JSON = process.argv.includes('--json');
const MODE_SESSION = process.argv.includes('--session-start');

const results = [];
/** `fix` is machine-readable: what Claude should ask for / set / run to clear this result. */
const add = (level, name, detail, hint, fix) => results.push({ level, name, detail, hint, fix });
const ok = (name, detail) => add('ok', name, detail);
const warn = (name, detail, hint, fix) => add('warn', name, detail, hint, fix);
const fail = (name, detail, hint, fix) => add('fail', name, detail, hint, fix);

/** Run a command and return trimmed stdout, or null if it isn't on PATH / fails. */
function run(cmd, args) {
  try {
    return execFileSync(cmd, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 20000,
      // Needed on Windows so PATH-resolved shims (.cmd/.bat like npm, mvn) are found.
      shell: isWindows,
    }).trim();
  } catch {
    return null;
  }
}

const firstLine = (s) => (s ? s.split(/\r?\n/)[0].trim() : s);

// ── 1. Runtimes ──────────────────────────────────────────────────────────────
{
  const major = Number(process.versions.node.split('.')[0]);
  if (major >= 20) ok('Node.js', `v${process.versions.node}`);
  else fail('Node.js', `v${process.versions.node} — too old`,
    'Install Node 20+ (22 LTS recommended): https://nodejs.org — or `nvm install 22`');
}

{
  const v = firstLine(run('git', ['--version']));
  if (v) ok('Git', v);
  else fail('Git', 'not found on PATH', isWindows
    ? 'Install Git for Windows (includes Git Bash): https://git-scm.com/download/win'
    : 'macOS: `xcode-select --install` or `brew install git`');
}

// At session start Claude Code is obviously running, and the JDK/Maven probes cost seconds on every
// launch — so the session-start brief skips these three tool probes. `npm run doctor` still runs them.
if (!MODE_SESSION) {
  // The engine shells out to the Claude CLI; without it the workflows cannot run.
  const v = firstLine(run('claude', ['--version']));
  if (v) ok('Claude CLI', v);
  else fail('Claude CLI', 'not found on PATH',
    'Install Claude Code and sign in (per-user subscription): https://claude.com/claude-code');
}

// ── 2. Optional runtimes (needed only for the mobile/Java automation path) ────
if (!MODE_SESSION) {
  // `java -version` writes to stderr on older JDKs; -version + --version both tried.
  const v = firstLine(run('java', ['--version'])) || firstLine(run('java', ['-version']));
  if (v) ok('Java JDK (mobile automation)', v);
  else warn('Java JDK (mobile automation)', 'not found on PATH',
    'Only needed to RUN the Java/Appium framework. Install JDK 17+ (`brew install openjdk@17` / adoptium.net)');
}

if (!MODE_SESSION) {
  const v = firstLine(run('mvn', ['-v']));
  if (v) ok('Maven (mobile automation)', v);
  else warn('Maven (mobile automation)', 'not found on PATH',
    'Only needed to RUN the Java framework. `brew install maven`, or use IntelliJ\'s bundled Maven');
}

// ── 3. Repo integrity ────────────────────────────────────────────────────────
{
  const required = ['CLAUDE.md', path.join('docs', 'ai'), 'qa-workflow', 'automation'];
  const missing = required.filter((r) => !existsSync(path.join(repoRoot, r)));
  if (!missing.length) ok('Repo layout', `companion root detected at ${repoRoot}`);
  else fail('Repo layout', `missing: ${missing.join(', ')}`,
    'Run this from the repo root of a full clone (a partial/zip download will not work)');
}

{
  const skills = path.join(repoRoot, '.claude', 'skills');
  const expected = ['qa-shift-left', 'qa-validate', 'qa-full', 'grill-me'];
  const missing = expected.filter((s) => !existsSync(path.join(skills, s, 'SKILL.md')));
  if (!missing.length) ok('Workflow skills', `${expected.length} discovered in .claude/skills/`);
  else fail('Workflow skills', `missing: ${missing.join(', ')}`,
    'The /qa-* entrypoints are only discovered when the REPO ROOT is the folder open in Claude Code');
}

{
  const nm = path.join(repoRoot, 'node_modules');
  if (existsSync(nm)) ok('Root node modules', 'installed');
  else warn('Root node modules', 'not installed',
    'Run `npm install` in the repo root (needed for Playwright/DB automation, not for the workflows)',
    { type: 'command', run: 'npm install' });
}

// ── 4. Java framework registration (cross-platform resolution) ───────────────
{
  const mod = path.join(repoRoot, 'automation', 'config', 'framework.js');
  try {
    const { createRequire } = await import('node:module');
    const framework = createRequire(import.meta.url)(mod);
    const found = framework.resolve();
    if (found) {
      ok('Java QA framework', found);
      // The framework's environment files are gitignored there too: a fresh clone has none, and
      // OTP lookup, card-service config and BrowserStack runs all read them.
      const needed = ['config_testing.properties', 'cardServiceConfigs_testing.properties', 'browserStackConfigs.properties'];
      const missing = needed.filter((f) => !framework.environmentsFile(f));
      if (!missing.length) ok('Framework config files', `${needed.length} found in resources/environments`);
      else warn('Framework config files', `missing: ${missing.join(', ')}`,
        `These are gitignored in the framework repo. Get them from the QA team and copy them into ${framework.environmentsDir()}`);
    } else warn('Java QA framework', 'not located on this machine',
      'Only needed to GENERATE/RUN automation. Clone it, then set QA_FRAMEWORK_PATH to the folder ' +
      'containing pom.xml. Tried:\n      ' + framework.candidates().join('\n      '),
      { type: 'path', env: 'QA_FRAMEWORK_PATH', what: 'the folder containing the Java framework pom.xml',
        clone: 'https://github.com/Breadfast/QA_Automation_Framework' });
  } catch (e) {
    fail('Java QA framework', `could not load framework.js (${e.message})`,
      'Ensure automation/config/framework.js exists and the clone is complete');
  }
}

// ── 5. Credentials (presence only — never printed, never validated remotely) ──
// Each value is resolved exactly like automation/config/credentials.js does it — env var first, then
// credentials.local.js — so "set" here means "the scripts will find it". A value still holding the
// template's placeholder text counts as NOT set: a copied-but-unfilled template is the most common
// first-run state, and it used to pass this check because only the file's existence was tested.
const CREDENTIALS_REL = 'automation/config/credentials.local.js';
const CREDENTIALS = [
  { name: 'Jira email', env: 'JIRA_EMAIL', key: 'jiraEmail', level: 'fail', secret: false,
    needFor: 'filing bugs (Jira REST)', where: 'your @breadfast.com address' },
  { name: 'Jira API token', env: 'JIRA_API_TOKEN', key: 'jiraApiToken', level: 'fail', secret: true,
    needFor: 'filing bugs and attaching evidence (Jira REST)',
    where: 'https://id.atlassian.com/manage-profile/security/api-tokens → Create API token' },
  { name: 'BrowserStack Test Management username', env: 'BS_TM_USERNAME', key: 'bsTmUsername', level: 'fail', secret: false,
    alt: { env: 'BROWSERSTACK_USERNAME', key: 'browserstackUsername' },
    needFor: 'importing/syncing test cases and runs (STEP 7, every story)', where: 'your BrowserStack login email' },
  { name: 'BrowserStack Test Management API token', env: 'BS_TM_API_TOKEN', key: 'bsTmApiToken', level: 'fail', secret: true,
    needFor: 'importing/syncing test cases and runs (STEP 7, every story)',
    where: 'BrowserStack → Profile → API tokens → the Test Management token (NOT the App Automate key)' },
  { name: 'BrowserStack App Automate username', env: 'BROWSERSTACK_USERNAME', key: 'browserstackUsername', level: 'warn', secret: false,
    needFor: 'mobile sessions and automated runs', where: 'BrowserStack → Account → Settings → Authentication & Security' },
  { name: 'BrowserStack App Automate access key', env: 'BROWSERSTACK_ACCESS_KEY', key: 'browserstackAccessKey', level: 'warn', secret: true,
    needFor: 'mobile sessions and automated runs', where: 'BrowserStack → Account → Settings → Authentication & Security' },
];
const PLACEHOLDER = /your-|\.\.\.|^you@|^todo$|^<.*>$/i;
{
  const localFile = path.join(repoRoot, 'automation', 'config', 'credentials.local.js');
  let local = {};
  let localBroken = null;
  if (existsSync(localFile)) {
    try { local = requireCjs(localFile); } catch (e) { localBroken = e.message.split('\n')[0]; }
  }
  const resolve = (env, key) => {
    const fromEnv = process.env[env] && process.env[env].trim();
    return fromEnv || local[key];
  };
  const isSet = (v) => v != null && String(v).trim() !== '' && !PLACEHOLDER.test(String(v).trim());
  const copyCmd = isWindows
    ? 'copy automation\\config\\credentials.local.example.js automation\\config\\credentials.local.js'
    : 'cp automation/config/credentials.local.example.js automation/config/credentials.local.js';

  if (localBroken) {
    fail('Credentials file', `${CREDENTIALS_REL} does not load: ${localBroken}`,
      'Fix the syntax error in the file (it is plain JavaScript: module.exports = { … })',
      { type: 'file', path: CREDENTIALS_REL });
  } else if (existsSync(localFile)) {
    ok('Credentials file', `${CREDENTIALS_REL} present (gitignored)`);
  } else {
    warn('Credentials file', `no ${CREDENTIALS_REL} — values can still come from env vars`,
      `Create it from the template:  ${copyCmd}`, { type: 'command', run: copyCmd });
  }

  for (const c of CREDENTIALS) {
    const v = resolve(c.env, c.key) || (c.alt && resolve(c.alt.env, c.alt.key));
    if (isSet(v)) { ok(c.name, 'set'); continue; }
    const placeholder = v != null && String(v).trim() !== '';
    const detail = `${placeholder ? 'still the template placeholder' : 'not set'} — needed for ${c.needFor}`;
    const hint = `Set ${c.key} in ${CREDENTIALS_REL} (or env ${c.env}). Get it from: ${c.where}`;
    const fix = { type: 'credential', key: c.key, env: c.env, file: CREDENTIALS_REL, secret: c.secret, where: c.where };
    if (c.level === 'fail') fail(c.name, detail, hint, fix);
    else warn(c.name, detail, hint, fix);
  }

  if (existsSync(localFile)) {
    // Guard against the exact mistake this repo shipped once: a real token committed.
    const tracked = run('git', ['ls-files', '--error-unmatch', 'automation/config/credentials.local.js']);
    if (tracked) {
      fail('Credentials safety', 'credentials.local.js is TRACKED BY GIT',
        'Untrack it immediately: `git rm --cached automation/config/credentials.local.js` and rotate any exposed token');
    } else {
      ok('Credentials safety', 'credentials.local.js is untracked, as it must be');
    }
  }
}

// ── 5b. QA team profile (teams/<team>.json — no team's values are ever a default) ─
{
  const require = createRequire(import.meta.url);
  try {
    const team = require(path.join(repoRoot, 'automation', 'config', 'team.js'));
    const id = team.selectedTeamId();
    const known = team.availableTeams();
    if (!id) {
      fail('QA team', 'no team selected',
        `Pick yours: add  team: '<id>'  to automation/config/credentials.local.js (or set QA_TEAM).\n` +
        `      Teams with a profile: ${known.join(', ') || '(none)'} — new team: see teams/README.md`,
        { type: 'team', key: 'team', env: 'QA_TEAM', file: CREDENTIALS_REL, available: known,
          newTeam: 'copy teams/_template.json to teams/<id>.json and fill it in' });
    } else {
      const profile = team.loadTeam({ id });
      const todo = team.unfilledPaths(profile);
      if (todo.length) {
        warn('QA team', `${id} — ${todo.length} value(s) still TODO: ${todo.join(', ')}`,
          `Fill them in teams/${id}.json (ask your squad lead) and commit the file. Scripts that need a TODO value stop and name it.`,
          { type: 'team-values', team: id, file: `teams/${id}.json`, fields: todo, explained: 'teams/_template.json' });
      } else {
        ok('QA team', `${id} (${profile.name}) — Jira ${profile.jira.projectKey}, BrowserStack ${profile.browserstack.project}`);
      }
    }
  } catch (e) {
    fail('QA team', e.message.split('\n')[0], 'See teams/README.md',
      { type: 'team', key: 'team', env: 'QA_TEAM', file: CREDENTIALS_REL });
  }
}

// ── 6. Runtime workspace (must live OUTSIDE the repo) ────────────────────────
{
  const ws = process.env.QA_WORKSPACE_DIR?.trim() || path.join(os.homedir(), 'BreadfastQA', 'Workspace');
  const inside = path.resolve(ws).toLowerCase().startsWith(path.resolve(repoRoot).toLowerCase() + path.sep);
  if (inside) {
    fail('Runtime workspace', `${ws} is INSIDE the repo`,
      'Point QA_WORKSPACE_DIR outside the clone so runtime data is never committed');
  } else if (existsSync(ws)) {
    ok('Runtime workspace', ws);
  } else {
    warn('Runtime workspace', `${ws} (will be created on first run)`,
      'Override with QA_WORKSPACE_DIR if you want it elsewhere');
  }
}

// ── 7. Playwright browsers (needed for web execution + Figma browser export) ─
{
  const pw = path.join(repoRoot, 'node_modules', '@playwright', 'test');
  if (!existsSync(pw)) {
    warn('Playwright', 'package not installed', 'Run `npm install` first', { type: 'command', run: 'npm install' });
  } else {
    const cacheDir = process.env.PLAYWRIGHT_BROWSERS_PATH || (
      isWindows ? path.join(os.homedir(), 'AppData', 'Local', 'ms-playwright')
        : process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright')
          : path.join(os.homedir(), '.cache', 'ms-playwright'));
    if (existsSync(cacheDir)) ok('Playwright browsers', cacheDir);
    else warn('Playwright browsers', 'no browser cache found',
      'Run `npm run playwright:install` (downloads Chromium)', { type: 'command', run: 'npm run playwright:install' });
  }
}

// ── 8. Line-ending hygiene (the classic mixed-OS repo trap) ──────────────────
{
  const attrs = path.join(repoRoot, '.gitattributes');
  if (existsSync(attrs) && /text=auto/.test(readFileSync(attrs, 'utf8'))) {
    ok('Line endings', '.gitattributes normalizes to LF (CRLF forced for .cmd/.bat)');
  } else {
    warn('Line endings', '.gitattributes missing or not normalizing',
      'Without it, Windows checkouts commit CRLF and break shell scripts on macOS');
  }
  const autocrlf = run('git', ['config', '--get', 'core.autocrlf']);
  if (isWindows && autocrlf === 'input') {
    warn('git core.autocrlf', 'set to "input" on Windows',
      'Prefer `git config --global core.autocrlf true` on Windows, or leave it unset and let .gitattributes decide');
  }
}

// ── Report ───────────────────────────────────────────────────────────────────
const problems = (level) => results.filter((r) => r.level === level)
  .map(({ name, detail, hint, fix }) => ({ name, detail, hint, fix }));

if (MODE_JSON) {
  const blocking = problems('fail');
  process.stdout.write(JSON.stringify({
    ready: blocking.length === 0,
    blocking,
    warnings: problems('warn'),
    ok: results.filter((r) => r.level === 'ok').map((r) => r.name),
  }, null, 2) + '\n');
  process.exit(blocking.length ? 1 : 0);
}

if (MODE_SESSION) {
  // Printed into Claude's context by the SessionStart hook. Written as an instruction to Claude, kept
  // short, and it never prints a credential value. Exit 0 always: the session must open regardless.
  const blocking = problems('fail');
  const warnings = problems('warn');
  const line = (r) => `- ${r.name}: ${r.detail}${r.fix && r.fix.key ? ` → set \`${r.fix.key}\` in ${r.fix.file || CREDENTIALS_REL}` : ''}`;
  if (!blocking.length && !warnings.length) {
    console.log('QA environment check (scripts/doctor.mjs): ready — nothing missing.');
  } else {
    console.log(`QA environment check (scripts/doctor.mjs): ${blocking.length} blocking, ${warnings.length} warning(s).`);
    if (blocking.length) console.log('Blocking — a /qa-* workflow cannot complete without these:\n' + blocking.map(line).join('\n'));
    if (warnings.length) console.log('Warnings — only some paths need these:\n' + warnings.map(line).join('\n'));
    console.log('Before starting any /qa-* workflow, run the Readiness step in '
      + 'qa-workflow/skills/detect-prerequisites/SKILL.md: tell the user what is missing and ask for it in ONE batch. '
      + 'Do not wait for a script to fail mid-run.');
  }
  process.exit(0);
}

const ICON = { ok: '  OK  ', warn: ' WARN ', fail: ' FAIL ' };
const width = results.reduce((m, r) => Math.max(m, r.name.length), 0);

console.log('\nBreadfast QA — environment doctor');
console.log(`${process.platform} ${os.release()} · ${os.arch()} · repo ${repoRoot}\n`);

for (const r of results) {
  console.log(`[${ICON[r.level]}] ${r.name.padEnd(width)}  ${r.detail}`);
  if (r.hint) console.log(`${' '.repeat(width + 11)}→ ${r.hint}`);
}

const fails = results.filter((r) => r.level === 'fail');
const warns = results.filter((r) => r.level === 'warn');
console.log(`\n${results.length - fails.length - warns.length} ok · ${warns.length} warning(s) · ${fails.length} blocking\n`);

if (fails.length) {
  console.log('Blocking issues must be fixed before running a QA workflow.');
  console.log('Setup guide: SETUP.md · Troubleshooting: SETUP.md#troubleshooting\n');
  process.exit(1);
}
console.log(warns.length
  ? 'No blocking issues. Warnings only affect the optional paths noted above.\n'
  : 'Environment is fully ready.\n');
