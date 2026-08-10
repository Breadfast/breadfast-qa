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
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const isWindows = process.platform === 'win32';

const results = [];
const add = (level, name, detail, hint) => results.push({ level, name, detail, hint });
const ok = (name, detail) => add('ok', name, detail);
const warn = (name, detail, hint) => add('warn', name, detail, hint);
const fail = (name, detail, hint) => add('fail', name, detail, hint);

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

{
  // The engine shells out to the Claude CLI; without it the workflows cannot run.
  const v = firstLine(run('claude', ['--version']));
  if (v) ok('Claude CLI', v);
  else fail('Claude CLI', 'not found on PATH',
    'Install Claude Code and sign in (per-user subscription): https://claude.com/claude-code');
}

// ── 2. Optional runtimes (needed only for the mobile/Java automation path) ────
{
  // `java -version` writes to stderr on older JDKs; -version + --version both tried.
  const v = firstLine(run('java', ['--version'])) || firstLine(run('java', ['-version']));
  if (v) ok('Java JDK (mobile automation)', v);
  else warn('Java JDK (mobile automation)', 'not found on PATH',
    'Only needed to RUN the Java/Appium framework. Install JDK 17+ (`brew install openjdk@17` / adoptium.net)');
}

{
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
    'Run `npm install` in the repo root (needed for Playwright/DB automation, not for the workflows)');
}

// ── 4. Java framework registration (cross-platform resolution) ───────────────
{
  const mod = path.join(repoRoot, 'automation', 'config', 'framework.js');
  try {
    const { createRequire } = await import('node:module');
    const framework = createRequire(import.meta.url)(mod);
    const found = framework.resolve();
    if (found) ok('Java QA framework', found);
    else warn('Java QA framework', 'not located on this machine',
      'Only needed to GENERATE/RUN automation. Clone it, then set QA_FRAMEWORK_PATH to the folder ' +
      'containing pom.xml. Tried:\n      ' + framework.candidates().join('\n      '));
  } catch (e) {
    fail('Java QA framework', `could not load framework.js (${e.message})`,
      'Ensure automation/config/framework.js exists and the clone is complete');
  }
}

// ── 5. Credentials (presence only — never printed, never validated remotely) ──
{
  const localFile = path.join(repoRoot, 'automation', 'config', 'credentials.local.js');
  const has = (k) => !!(process.env[k] && process.env[k].trim());
  const jiraViaEnv = has('JIRA_EMAIL') && has('JIRA_API_TOKEN');
  const bsViaEnv = has('BROWSERSTACK_EMAIL') && has('BROWSERSTACK_PASSWORD');

  if (existsSync(localFile)) ok('Credentials file', 'automation/config/credentials.local.js present (gitignored)');
  else if (jiraViaEnv || bsViaEnv) ok('Credentials', 'supplied via environment variables');
  else warn('Credentials', 'no credentials.local.js and no credential env vars',
    'Copy the template and fill in YOUR OWN values:\n' +
    (isWindows
      ? '      copy automation\\config\\credentials.local.example.js automation\\config\\credentials.local.js'
      : '      cp automation/config/credentials.local.example.js automation/config/credentials.local.js'));

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
    warn('Playwright', 'package not installed', 'Run `npm install` first');
  } else {
    const cacheDir = process.env.PLAYWRIGHT_BROWSERS_PATH || (
      isWindows ? path.join(os.homedir(), 'AppData', 'Local', 'ms-playwright')
        : process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright')
          : path.join(os.homedir(), '.cache', 'ms-playwright'));
    if (existsSync(cacheDir)) ok('Playwright browsers', cacheDir);
    else warn('Playwright browsers', 'no browser cache found',
      'Run `npm run playwright:install` (downloads Chromium)');
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
