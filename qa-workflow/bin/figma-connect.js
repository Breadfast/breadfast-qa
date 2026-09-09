'use strict';
/**
 * Figma Playwright Session Authenticator (plugin-aligned, qa-platform-free).
 *
 * Relocated out of the deferred qa-platform (was qa-platform/auth/connect-figma.js).
 * Self-contained: imports NO qa-platform code — only @playwright/test, which resolves from
 * the repo's own node_modules (it is a dependency in the repo-root package.json). Nothing
 * outside this repository is required.
 *
 * Modes:
 *   --status            Verify the saved session and exit. Prints one JSON line.
 *                       Structural fast-fail (exists / parses / has cookies / within the age window),
 *                       then ONE REAL authenticated request to Figma — because a date is not proof of
 *                       a session (see "the freshness gate" note below).
 *                         exit 0 = FRESH (verified) or UNVERIFIED (probe could not complete)
 *                         exit 3 = MISSING / INVALID / EXPIRED / STALE  → reconnect needed
 *                         exit 4 = UNVERIFIED and --strict was passed
 *                         exit 2 = internal error
 *                       Flags: --offline / --no-probe (date-only, the pre-2026-09-08 behaviour),
 *                              --strict (UNVERIFIED becomes exit 4), --timeout <ms> (default 8000).
 *   --import-state <p>  Persist a storageState JSON (a file, or `-` for stdin) as the session, through
 *                       the same guarded atomic writer the login path uses. This is how an in-MCP
 *                       login gets round-tripped back to disk — see SKILL.md's session gate.
 *   (default)           Launch a HEADED Chromium so the user can log in to Figma via Google,
 *                       auto-detect success, capture the full storageState, write figma-auth.json, exit.
 *
 * Usage (run from the repo root — no special cwd or NODE_PATH needed):
 *   node qa-workflow/bin/figma-connect.js
 *   node qa-workflow/bin/figma-connect.js --status
 *   node qa-workflow/bin/figma-connect.js --status --offline
 *   node qa-workflow/bin/figma-connect.js --import-state state.json
 *
 * Why --status probes (2026-09-08): the old gate decided FRESH from `cookies.length >= 1` plus
 * `savedAt` age and never contacted Figma, so a jar Figma had already invalidated server-side
 * (password change, new device, SSO policy) reported FRESH with 25 days "left" while every capture
 * run hit the login wall. Session load/restore/probe/save now live once in
 * automation/figma/session.js — including the `__Host-` split-restore that makes the jar work at all.
 *
 * If @playwright/test cannot be loaded (no headed display / missing dep), the script exits 2 with
 * guidance — that is the signal to fall back to the in-session Playwright-MCP reconnect path
 * (see qa-workflow/skills/figma-analysis/SKILL.md → session gate).
 *
 * Environment variables:
 *   FIGMA_AUTH_PATH              — where to read/write figma-auth.json
 *                                  (default: <repo root>/auth/figma-auth.json)
 *   FIGMA_SESSION_MAX_AGE_DAYS   — freshness window for --status (default: 25)
 *   FIGMA_CONNECT_TIMEOUT_MS     — max ms to wait for user login (default: 600000 = 10 min)
 *
 * CommonJS (require), like the shared automation/ scripts.
 */

const fs   = require('fs');

// The ONE implementation of jar load / split-restore / probe / atomic save. Node builtins only, so
// requiring it here costs nothing and cannot drag in a Playwright flavour.
const session = require('../../automation/figma/session.js');

// Default session location: repo-root auth/ (gitignored via ".gitignore: auth/figma-auth.json"),
// i.e. <repo>/auth/figma-auth.json; FIGMA_AUTH_PATH overrides. Resolved by the shared module so the
// two entry points can never disagree about where the session lives.
const AUTH_PATH     = session.authPath();
const MAX_AGE_DAYS  = Number(process.env.FIGMA_SESSION_MAX_AGE_DAYS) || 25;
const TIMEOUT_MS    = Number(process.env.FIGMA_CONNECT_TIMEOUT_MS) || 10 * 60 * 1000;
const POLL_MS       = 2000;

/**
 * Structural checks only — cheap, offline, no browser. These are the FAST-FAIL half of the gate:
 * they prove the file is there and plausible, never that Figma still honours it.
 * @returns {{state:'FRESH'|'MISSING'|'EXPIRED'|'INVALID', path:string, cookies?:number, savedAt?:string, ageDays?:number, maxAgeDays:number, reason?:string, jar?:object}}
 */
function sessionStatus() {
  const base = { path: AUTH_PATH, maxAgeDays: MAX_AGE_DAYS };
  if (!fs.existsSync(AUTH_PATH)) {
    return { ...base, state: 'MISSING', reason: 'no figma-auth.json at this path' };
  }
  let data;
  try {
    data = JSON.parse(fs.readFileSync(AUTH_PATH, 'utf8'));
  } catch (e) {
    return { ...base, state: 'INVALID', reason: 'unparseable JSON: ' + e.message };
  }
  const cookies = Array.isArray(data.cookies) ? data.cookies.length : 0;
  if (cookies < 1) {
    return { ...base, state: 'INVALID', cookies, savedAt: data.savedAt, reason: 'no cookies in session' };
  }
  const savedMs = Date.parse(data.savedAt);
  if (Number.isNaN(savedMs)) {
    return { ...base, state: 'INVALID', cookies, savedAt: data.savedAt, reason: 'missing/unparseable savedAt' };
  }
  const ageDays = (Date.now() - savedMs) / 86_400_000;
  if (ageDays > MAX_AGE_DAYS) {
    return { ...base, state: 'EXPIRED', cookies, savedAt: data.savedAt, ageDays: Number(ageDays.toFixed(1)) };
  }
  return { ...base, state: 'FRESH', cookies, savedAt: data.savedAt, ageDays: Number(ageDays.toFixed(1)), jar: data };
}

/**
 * States, and what each one means for the caller:
 *   FRESH        structurally fine AND Figma confirmed the session   → exit 0, capture away
 *   UNVERIFIED   structurally fine, the probe could not complete     → exit 0 (4 with --strict);
 *                offline / timeout / 429 / endpoint moved. NOT an expired session — do NOT re-login;
 *                capture_frames.js's own file-canvas gate is the backstop.
 *   STALE        structurally fine, Figma REJECTED it                → exit 3, reconnect
 *   MISSING / INVALID / EXPIRED                                      → exit 3, reconnect
 * Exit 2 stays "internal error". Callers that only branch 0 vs non-zero keep working unchanged.
 */
async function runStatus(argv) {
  const offline = argv.includes('--offline') || argv.includes('--no-probe');
  const strict  = argv.includes('--strict');
  const ti      = argv.indexOf('--timeout');
  const timeoutMs = ti > -1 && argv[ti + 1] ? Number(argv[ti + 1]) : 8000;

  const s = sessionStatus();
  const jar = s.jar;
  delete s.jar;                                        // never print the cookies

  if (s.state !== 'FRESH') {                           // structural fast-fail: nothing to probe
    process.stdout.write(JSON.stringify({ ...s, verified: false, probe: 'skipped' }) + '\n');
    process.exit(3);
  }
  if (offline) {
    process.stdout.write(JSON.stringify({ ...s, verified: false, probe: 'skipped (--offline)' }) + '\n');
    process.exit(0);
  }

  let probe;
  try {
    probe = await session.probeSession(jar, { timeoutMs });
  } catch (e) {
    probe = { authenticated: null, via: 'probe', reason: `probe threw: ${e.message}`, ms: 0 };
  }

  if (probe.authenticated === true) {
    process.stdout.write(JSON.stringify({ ...s, state: 'FRESH', verified: true, probe }) + '\n');
    process.exit(0);
  }
  if (probe.authenticated === false) {
    process.stdout.write(JSON.stringify({
      ...s,
      state: 'STALE',
      verified: false,
      probe,
      reason: `session file is intact (${s.ageDays}d old) but Figma no longer accepts it — ${probe.reason}`,
      remedy: 'node qa-workflow/bin/figma-connect.js',
    }) + '\n');
    process.exit(3);
  }
  process.stdout.write(JSON.stringify({
    ...s,
    state: 'UNVERIFIED',
    verified: false,
    probe,
    reason: `could not verify the session against Figma — ${probe.reason}. This is NOT an expired session; do not re-login on this alone.`,
  }) + '\n');
  process.exit(strict ? 4 : 0);
}

/**
 * Persist a storageState JSON produced elsewhere (an in-MCP login, most importantly) as the session,
 * through the same guarded atomic writer the login path uses — one writer, one set of guards.
 */
async function runImportState(argv) {
  const i = argv.indexOf('--import-state');
  const src = argv[i + 1];
  if (!src) {
    console.error('[figma-connect] usage: --import-state <state.json|->');
    process.exit(2);
  }
  let text;
  try {
    text = src === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(src, 'utf8');
  } catch (e) {
    console.error(`[figma-connect] Could not read state: ${e.message}`);
    process.exit(2);
  }
  let state;
  try {
    state = JSON.parse(text);
  } catch (e) {
    console.error(`[figma-connect] Unparseable storageState JSON: ${e.message}`);
    process.exit(2);
  }
  // Accept either a raw Playwright storageState or a jar in our own {cookies, origins, …} shape.
  const res = session.writeJar(state, AUTH_PATH, { figmaUrl: state.figmaUrl || 'imported' });
  if (!res.saved) {
    console.error(`[figma-connect] Session NOT saved — ${res.reason}. The previous session file is untouched.`);
    process.exit(3);
  }
  console.log(`[figma-connect] Session saved (${res.cookies} cookie(s), savedAt ${res.savedAt}) → ${res.path}`);
  const probe = await session.probeSession(state, { timeoutMs: 8000 });
  console.log(`[figma-connect] Probe: ${probe.authenticated === true ? 'AUTHENTICATED' : probe.authenticated === false ? 'REJECTED' : 'UNVERIFIED'} via ${probe.via} — ${probe.reason}`);
  process.exit(probe.authenticated === false ? 3 : 0);
}

/** True when the browser URL has left the Figma login/OAuth flow and reached a real workspace page. */
function isAuthenticatedUrl(url) {
  if (!url || !url.includes('figma.com')) return false;
  const u = url.toLowerCase();
  if (
    u.includes('/login') ||
    u.includes('/auth/') ||
    u.includes('accounts.google.com') ||
    u.includes('google.com/o/oauth')
  ) return false;
  return (
    u.includes('/files') ||
    u.includes('/team/') ||
    u.includes('/design/') ||
    u.includes('/proto/') ||
    u.includes('/community') ||
    u.includes('/drafts') ||
    u === 'https://www.figma.com/' ||
    u === 'https://www.figma.com'
  );
}

async function runConnect() {
  // Resolves from the repo's own node_modules (@playwright/test is a repo-root dependency).
  let chromium;
  try {
    ({ chromium } = require('@playwright/test'));
  } catch (e) {
    console.error(`[figma-connect] Could not load @playwright/test: ${e.message}`);
    console.error(`[figma-connect] Run "npm install" at the repo root, then retry.`);
    console.error(`[figma-connect] If no headed browser is available here, fall back to the in-session Playwright-MCP reconnect (SKILL.md session gate).`);
    process.exit(2);
  }

  console.log('[figma-connect] Launching a browser for Figma authentication...');
  console.log(`[figma-connect] Session will be saved to: ${AUTH_PATH}`);

  let browser;
  try {
    try {
      browser = await chromium.launch({ headless: false });
    } catch {
      browser = await chromium.launch({ headless: false, channel: 'chrome' });
    }
  } catch (e) {
    console.error(`[figma-connect] Failed to launch a headed browser: ${e.message}`);
    console.error(`[figma-connect] Run "npx playwright install chromium" at the repo root, or use the in-session Playwright-MCP reconnect fallback.`);
    process.exit(2);
  }

  const context = await browser.newContext();
  const page    = await context.newPage();

  try {
    await page.goto('https://www.figma.com/login', { waitUntil: 'domcontentloaded', timeout: 30_000 });
  } catch {
    // Non-fatal — keep polling.
  }

  console.log('[figma-connect] Browser open. Please sign in to Figma with Google.');
  console.log(`[figma-connect] You have ${TIMEOUT_MS / 60_000} minutes to complete login.`);

  const deadline = Date.now() + TIMEOUT_MS;

  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, POLL_MS));

    try {
      if (page.isClosed() || !browser.isConnected()) {
        console.error('[figma-connect] Browser was closed before login completed.');
        process.exit(1);
      }
    } catch {
      console.error('[figma-connect] Browser disconnected unexpectedly.');
      process.exit(1);
    }

    let url;
    try {
      url = page.url();
    } catch {
      console.error('[figma-connect] Could not read page URL — browser may have closed.');
      process.exit(1);
    }

    if (!isAuthenticatedUrl(url)) continue;

    console.log(`[figma-connect] Authentication detected (${url}). Capturing session...`);

    // ONE writer for the session file: the shared guarded atomic save. It refuses a jar with no
    // `__Host-figma.authn` cookie, so a half-settled login cannot clobber a good session — that
    // refusal is the "keep polling" signal.
    const res = await session.saveJar(context, AUTH_PATH, { figmaUrl: url });
    if (!res.saved) {
      console.log(`[figma-connect] Session not ready yet (${res.reason}) — waiting for it to settle...`);
      continue;
    }
    console.log(`[figma-connect] Session saved (${res.cookies} cookie(s), savedAt ${res.savedAt}) → ${res.path}`);

    await browser.close().catch(() => {});
    console.log('[figma-connect] Done. You can close this window.');
    console.log('[figma-connect] From now on every successful capture run re-saves this session, so the');
    console.log('[figma-connect] 25-day window resets on USE — you should not need to log in again.');
    process.exit(0);
  }

  console.error(`[figma-connect] Timeout: login not completed within ${TIMEOUT_MS / 60_000} minutes.`);
  await browser.close().catch(() => {});
  process.exit(1);
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--status') || argv.includes('-s')) {
    return runStatus(argv).catch(e => {
      console.error(`[figma-connect] Status check failed: ${e.message}`);
      process.exit(2);
    });
  }
  if (argv.includes('--import-state')) {
    return runImportState(argv).catch(e => {
      console.error(`[figma-connect] Import failed: ${e.message}`);
      process.exit(2);
    });
  }
  return runConnect().catch(e => {
    console.error(`[figma-connect] Fatal error: ${e.message}`);
    process.exit(1);
  });
}

main();
