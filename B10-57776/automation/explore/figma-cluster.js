/**
 * B10-57776 — enumerate the frames INSIDE the "Managing merchants" section.
 *
 * Node 5893-267497 turned out to be a SECTION (15910 x 4352) sitting in "Phase 2"
 * alongside sibling sections (Adding perks, Perks table, Managing homepage…, Perk actions,
 * Managing categories, Managing mobile sections). The story's states are the frames
 * INSIDE our section, so this expands the layers tree and reads their real names + node ids.
 *
 * Run: node B10-57776/automation/explore/figma-cluster.js
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
  const browser = await chromium.launch({ headless: false });
  const ctx = await browser.newContext({
    storageState: { cookies: state.cookies, origins: state.origins || [] },
    viewport: { width: 1600, height: 950 },
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 });

  for (let i = 0; i < 60; i++) {
    const t = await page.title();
    if (/–/.test(t)) break;
    if (/login/i.test(page.url())) throw new Error('SESSION EXPIRED');
    await page.waitForTimeout(2000);
  }
  await page.waitForTimeout(15000);
  console.log('loaded:', await page.title());

  // Zoom to the selected section so the frames inside are visible and countable
  await page.keyboard.press('Shift+Digit2');
  await page.waitForTimeout(4000);
  await page.screenshot({ path: path.join(OUT, '10-section-fit.png') });
  console.log('  -> 10-section-fit.png');

  // ---- expand the layers tree under our section --------------------------
  // Rows are virtualized; expand by clicking the chevron of each ancestor in turn.
  const expand = async (label) => {
    const row = page.locator(`[class*="layer_row"], [class*="row_container"]`)
      .filter({ hasText: label }).first();
    if (!(await row.count())) { console.log(`  (no layer row for "${label}")`); return false; }
    const box = await row.boundingBox();
    if (!box) return false;
    // the chevron sits at the left edge of the row
    await page.mouse.click(box.x + 10, box.y + box.height / 2);
    await page.waitForTimeout(1500);
    return true;
  };

  await expand('Phase 2');
  await page.screenshot({ path: path.join(OUT, '11-layers-phase2.png') });
  await expand('Managing merchants');
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(OUT, '12-layers-merchants.png') });
  console.log('  -> 11/12 layer screenshots');

  // read every visible layer row label, in DOM order, with indentation depth
  const rows = await page.evaluate(() => {
    const sel = '[class*="layer_row"], [class*="row_container"], [data-testid*="layer-row"]';
    return [...document.querySelectorAll(sel)].map((el) => {
      const r = el.getBoundingClientRect();
      return {
        text: el.textContent.trim().slice(0, 80),
        x: Math.round(r.x),
        y: Math.round(r.y),
        indent: Math.round(r.x),
      };
    }).filter((r) => r.text);
  });
  fs.writeFileSync(path.join(OUT, 'layer-rows.json'), JSON.stringify(rows, null, 2));
  console.log('\nLAYER ROWS:');
  rows.forEach((r) => console.log(`   y=${String(r.y).padStart(4)}  ${r.text}`));

  await browser.close();
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
