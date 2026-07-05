'use strict';
/**
 * Figma Playwright Session Authenticator
 *
 * Launches a headed Chromium browser so the user can log in to Figma via Google.
 * Detects when authentication succeeds (URL leaves the login flow and reaches a
 * Figma workspace), captures the full Playwright storageState (cookies + localStorage),
 * writes it to figma-auth.json, and exits cleanly.
 *
 * Spawned by FigmaAuthService in the QA Platform API:
 *   node connect-figma.js
 *   (cwd = D:\Playwright\b55168_pom so its node_modules resolve @playwright/test)
 *
 * Environment variables:
 *   FIGMA_AUTH_PATH          — where to write figma-auth.json (default: <this dir>/figma-auth.json)
 *   FIGMA_CONNECT_TIMEOUT_MS — max ms to wait for user login (default: 600 000 = 10 min)
 *   NODE_PATH                — set by the spawner to <b55168_pom>/node_modules
 *
 * This file is CommonJS (require) so it works over NODE_PATH like provision_for_execution.js.
 */

const path = require('path');
const fs   = require('fs');

const AUTH_PATH  = process.env.FIGMA_AUTH_PATH  || path.join(__dirname, 'figma-auth.json');
const TIMEOUT_MS = Number(process.env.FIGMA_CONNECT_TIMEOUT_MS) || 10 * 60 * 1000;
const POLL_MS    = 2000;

/** True when the browser URL has left the Figma login/OAuth flow. */
function isAuthenticatedUrl(url) {
  if (!url || !url.includes('figma.com')) return false;
  const u = url.toLowerCase();
  if (
    u.includes('/login') ||
    u.includes('/auth/') ||
    u.includes('accounts.google.com') ||
    u.includes('google.com/o/oauth')
  ) return false;
  // Any real Figma workspace page indicates a successful login.
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

async function main() {
  // Resolve playwright from NODE_PATH (b55168_pom/node_modules).
  let chromium;
  try {
    ({ chromium } = require('@playwright/test'));
  } catch (e) {
    console.error(`[figma-connect] Could not load @playwright/test: ${e.message}`);
    console.error(`[figma-connect] Ensure the configured Playwright framework (${process.cwd()}) has @playwright/test installed (npm install).`);
    process.exit(2);
  }

  console.log('[figma-connect] Launching browser for Figma authentication...');
  console.log(`[figma-connect] Auth state will be saved to: ${AUTH_PATH}`);

  let browser;
  try {
    // Try Playwright's bundled Chromium first; fall back to system Chrome.
    try {
      browser = await chromium.launch({ headless: false });
    } catch {
      browser = await chromium.launch({ headless: false, channel: 'chrome' });
    }
  } catch (e) {
    console.error(`[figma-connect] Failed to launch browser: ${e.message}`);
    console.error(`[figma-connect] Run "npx playwright install chromium" inside the configured Playwright framework (${process.cwd()}) and retry.`);
    process.exit(2);
  }

  const context = await browser.newContext();
  const page    = await context.newPage();

  try {
    await page.goto('https://www.figma.com/login', { waitUntil: 'domcontentloaded', timeout: 30_000 });
  } catch {
    // Non-fatal — login page might have loaded partially; keep polling.
  }

  console.log('[figma-connect] Browser open. Please sign in to Figma with Google.');
  console.log(`[figma-connect] You have ${TIMEOUT_MS / 60_000} minutes to complete login.`);

  const deadline = Date.now() + TIMEOUT_MS;

  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, POLL_MS));

    // Detect browser closed by the user.
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
      console.log(`[figma-connect] Session saved (${state.cookies.length} cookie(s)).`);
    } catch (e) {
      console.error(`[figma-connect] Could not write auth file: ${e.message}`);
      await browser.close().catch(() => {});
      process.exit(1);
    }

    await browser.close().catch(() => {});
    console.log('[figma-connect] Done. You can close this window.');
    process.exit(0);
  }

  console.error(`[figma-connect] Timeout: user did not complete login within ${TIMEOUT_MS / 60_000} minutes.`);
  await browser.close().catch(() => {});
  process.exit(1);
}

main().catch(e => {
  console.error(`[figma-connect] Fatal error: ${e.message}`);
  process.exit(1);
});
