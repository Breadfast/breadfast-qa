/**
 * B10-57776 — completeness check on the enumerated frame set.
 *
 * The grid scan found 17 frames, but a grid can skip a narrow or oddly-placed frame, and the
 * section is 4,352px tall — enough for more rows than the two that were visible. So instead of
 * trusting the scan, ask Figma directly: enter the section and select-all inside it, then read
 * the selection-count the properties header reports. If that count == 17, the set is complete.
 *
 * (figma-analysis SKILL: "State the expected state-count and reconcile" — an incomplete frame
 *  set does not merely miss coverage, it manufactures false findings.)
 *
 * Run: node B10-57776/automation/explore/figma-verify-count.js
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const AUTH = 'D:/breadfast-qa/auth/figma-auth.json';
const URL = 'https://www.figma.com/design/kyspsx61WsmZgAgjMpimcu/Perks-Admin-Dashboard?node-id=5893-267497';
const OUT = 'D:/breadfast-qa/B10-57776/figma-analysis/frames/_enumerate';

const header = (page) => page.evaluate(() => {
  const el = document.querySelector('[class*="headerSelectionName"]');
  return el ? el.textContent.trim() : null;
});

(async () => {
  const state = JSON.parse(fs.readFileSync(AUTH, 'utf8'));
  const browser = await chromium.launch({ headless: false });
  const ctx = await browser.newContext({
    storageState: { cookies: state.cookies, origins: state.origins || [] },
    viewport: { width: 1600, height: 950 },
  });
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
  for (let i = 0; i < 60; i++) { if (/–/.test(await page.title())) break; await page.waitForTimeout(2000); }
  await page.waitForTimeout(15000);

  await page.keyboard.press('Shift+Digit2');
  await page.waitForTimeout(3000);
  console.log('selected:', await header(page));

  // enter the section, then select every sibling inside it
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1500);
  const firstChild = await header(page);
  console.log('after Enter (first child):', firstChild);

  await page.keyboard.press('Control+a');
  await page.waitForTimeout(2500);
  const selectAll = await header(page);
  console.log('after Ctrl+A (select all inside):', selectAll);
  await page.screenshot({ path: path.join(OUT, '30-select-all-inside.png') });

  // also read the layers panel, which is now scrolled to the selected subtree
  const rows = await page.evaluate(() => [...document.querySelectorAll('[class*="layer_row"]')]
    .map((e) => e.textContent.trim()).filter(Boolean));
  fs.writeFileSync(path.join(OUT, 'select-all-layers.json'), JSON.stringify({ selectAll, rows }, null, 2));
  console.log('layer rows visible:', rows.length);
  rows.forEach((r) => console.log('   ', r));

  await browser.close();
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
