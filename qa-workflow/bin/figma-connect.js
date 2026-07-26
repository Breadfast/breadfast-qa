'use strict';
/**
 * Figma Playwright Session Authenticator (plugin-aligned, qa-platform-free).
 *
 * Relocated out of the deferred qa-platform (was qa-platform/auth/connect-figma.js).
 * Self-contained: imports NO qa-platform code — only @playwright/test, resolved from
 * the runnable Playwright framework (D:\Playwright\b55168_pom).
 *
 * Two modes:
 *   --status            Report saved-session freshness and exit. Prints one JSON line.
 *                       Exit 0 = FRESH (usable); exit 3 = MISSING/EXPIRED/INVALID (reconnect needed);
 *                       exit 2 = internal error. The Figma session-gate calls this first.
 *   (default)           Launch a HEADED Chromium so the user can log in to Figma via Google,
 *                       auto-detect success, capture the full storageState, write figma-auth.json, exit.
 *
 * Usage (cwd must be the Playwright framework so its node_modules resolve @playwright/test):
 *   cd D:\Playwright\b55168_pom && node D:\breadfast-qa\qa-workflow\bin\figma-connect.js
 *   cd D:\Playwright\b55168_pom && node D:\breadfast-qa\qa-workflow\bin\figma-connect.js --status
 *   (or set NODE_PATH=<b55168_pom>\node_modules)
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
 *   NODE_PATH                    — <b55168_pom>/node_modules (set by the caller if cwd differs)
 *
 * CommonJS (require) so it works over NODE_PATH, like the shared automation/ scripts.
 */

const path = require('path');
const fs   = require('fs');

// Default session location: repo-root auth/ (gitignored via ".gitignore: auth/figma-auth.json").
// __dirname = <repo>/qa-workflow/bin  →  ../../auth/figma-auth.json = <repo>/auth/figma-auth.json
const DEFAULT_AUTH_PATH = path.resolve(__dirname, '..', '..', 'auth', 'figma-auth.json');
const AUTH_PATH     = process.env.FIGMA_AUTH_PATH || DEFAULT_AUTH_PATH;
const MAX_AGE_DAYS  = Number(process.env.FIGMA_SESSION_MAX_AGE_DAYS) || 25;
const TIMEOUT_MS    = Number(process.env.FIGMA_CONNECT_TIMEOUT_MS) || 10 * 60 * 1000;
const POLL_MS       = 2000;

/**
 * Inspect the saved session file without launching a browser.
 * @returns {{state:'FRESH'|'MISSING'|'EXPIRED'|'INVALID', path:string, cookies?:number, savedAt?:string, ageDays?:number, maxAgeDays:number, reason?:string}}
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
  return { ...base, state: 'FRESH', cookies, savedAt: data.savedAt, ageDays: Number(ageDays.toFixed(1)) };
}

function runStatus() {
  const s = sessionStatus();
  process.stdout.write(JSON.stringify(s) + '\n');
  process.exit(s.state === 'FRESH' ? 0 : 3);
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
  // Resolve playwright from NODE_PATH / cwd (b55168_pom/node_modules).
  let chromium;
  try {
    ({ chromium } = require('@playwright/test'));
  } catch (e) {
    console.error(`[figma-connect] Could not load @playwright/test: ${e.message}`);
    console.error(`[figma-connect] Run from the Playwright framework (cwd = D:\\Playwright\\b55168_pom) or set NODE_PATH to its node_modules.`);
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
    console.error(`[figma-connect] Run "npx playwright install chromium" in D:\\Playwright\\b55168_pom, or use the in-session Playwright-MCP reconnect fallback.`);
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

    let state;
    try {
      state = await context.storageState();
    } catch (e) {
      console.error(`[figma-connect] Failed to capture storageState: ${e.message}`);
      await browser.close().catch(() => {});
      process.exit(1);
    }

    if (!state.cookies?.length) {
      console.log('[figma-connect] No cookies captured yet — waiting for session to settle...');
      continue;
    }

    const authData = {
      cookies:  state.cookies,
      origins:  state.origins ?? [],
      savedAt:  new Date().toISOString(),
      figmaUrl: url,
    };

    try {
      fs.mkdirSync(path.dirname(AUTH_PATH), { recursive: true });
      fs.writeFileSync(AUTH_PATH, JSON.stringify(authData, null, 2), 'utf8');
      console.log(`[figma-connect] Session saved (${state.cookies.length} cookie(s)) → ${AUTH_PATH}`);
    } catch (e) {
      console.error(`[figma-connect] Could not write auth file: ${e.message}`);
      await browser.close().catch(() => {});
      process.exit(1);
    }

    await browser.close().catch(() => {});
    console.log('[figma-connect] Done. You can close this window.');
    process.exit(0);
  }

  console.error(`[figma-connect] Timeout: login not completed within ${TIMEOUT_MS / 60_000} minutes.`);
  await browser.close().catch(() => {});
  process.exit(1);
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--status') || argv.includes('-s')) return runStatus();
  return runConnect().catch(e => {
    console.error(`[figma-connect] Fatal error: ${e.message}`);
    process.exit(1);
  });
}

main();
