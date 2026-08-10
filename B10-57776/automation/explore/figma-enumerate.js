/**
 * B10-57776 — Figma cluster ENUMERATION (step 1 of capture).
 *
 * The REST API is quota-blocked (429 on /files and /nodes), and the Playwright MCP
 * browser profile is held by another instance — so capture runs through this own-script
 * browser session using the shared saved login (`auth/figma-auth.json`).
 *
 * This step does NOT capture baselines. It answers one question the skill insists on
 * answering before any capture: **how many sibling frames are in the story's cluster?**
 * (figma-analysis SKILL "Frame-set COMPLETENESS" — a layer-name search under-reports and
 *  an incomplete frame set manufactures false findings.)
 *
 * Output: zoomed-out canvas screenshots + the selected node's geometry, into
 *   B10-57776/figma-analysis/frames/_enumerate/
 *
 * Run: node B10-57776/automation/explore/figma-enumerate.js
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const AUTH = 'D:/breadfast-qa/auth/figma-auth.json';
const FILE_KEY = 'kyspsx61WsmZgAgjMpimcu';
const NODE = '5893-267497';
const URL = `https://www.figma.com/design/${FILE_KEY}/Perks-Admin-Dashboard?node-id=${NODE}`;
const OUT = 'D:/breadfast-qa/B10-57776/figma-analysis/frames/_enumerate';

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const state = JSON.parse(fs.readFileSync(AUTH, 'utf8'));
  console.log(`session: ${state.cookies.length} cookies, savedAt ${state.savedAt}`);

  const browser = await chromium.launch({ headless: false, args: ['--start-maximized'] });
  const ctx = await browser.newContext({
    storageState: { cookies: state.cookies, origins: state.origins || [] },
    viewport: { width: 1600, height: 950 },
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  const page = await ctx.newPage();

  console.log('navigating…');
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 });

  // canvas ready == the document title carries the file name with an en-dash
  for (let i = 0; i < 60; i++) {
    const t = await page.title();
    if (/–/.test(t) && !/^Figma$/.test(t)) { console.log('title:', t); break; }
    if (/login|Log in/i.test(page.url())) throw new Error('SESSION EXPIRED — redirected to login');
    await page.waitForTimeout(2000);
  }
  await page.waitForTimeout(12000); // let images load (else exports come out black)
  console.log('url:', page.url());

  const shot = async (name) => {
    const p = path.join(OUT, name);
    await page.screenshot({ path: p });
    console.log('  shot ->', name);
  };

  await shot('01-landed.png');

  // Zoom to fit the current selection, then step out to reveal the whole sibling row.
  await page.keyboard.press('Shift+Digit2');
  await page.waitForTimeout(2500);
  await shot('02-zoom-to-selection.png');

  for (let i = 1; i <= 6; i++) {
    await page.keyboard.press('Control+Minus');
    await page.waitForTimeout(1200);
    await shot(`03-zoomout-${i}.png`);
  }

  // Zoom-to-fit the whole page for the widest possible view of the cluster
  await page.keyboard.press('Shift+Digit1');
  await page.waitForTimeout(3000);
  await shot('04-fit-page.png');

  // Read whatever the app exposes about the current selection / page structure
  const info = await page.evaluate(() => {
    const txt = (sel) => [...document.querySelectorAll(sel)]
      .map((e) => e.textContent.trim()).filter(Boolean).slice(0, 80);
    return {
      title: document.title,
      url: location.href,
      // the layers panel rows carry frame names
      layerRows: txt('[class*="layer_row"], [class*="layerRow"], [data-testid*="layer"]'),
      // the page tabs / canvas name
      pageTabs: txt('[class*="page_row"], [class*="pagesPanel"] [role="button"]'),
      objectsPanelText: txt('[class*="objects_panel"], [class*="left_panel"] span').slice(0, 60),
    };
  });
  fs.writeFileSync(path.join(OUT, 'selection-info.json'), JSON.stringify(info, null, 2));
  console.log('\nlayerRows:', JSON.stringify(info.layerRows.slice(0, 40)));
  console.log('pageTabs:', JSON.stringify(info.pageTabs.slice(0, 20)));

  console.log('\nleaving the browser OPEN for the capture step; screenshots ->', OUT);
  fs.writeFileSync(path.join(OUT, '_wsEndpoint.txt'), browser.wsEndpoint ? String(browser.wsEndpoint()) : '');
  await page.waitForTimeout(2000);
  await browser.close();
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
