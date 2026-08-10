/**
 * B10-57776 — CORRECTED frame enumeration.
 *
 * Why v1 was wrong: `figma-frames.js` read the selection NAME from the DOM and the node id
 * from `location.href` in the same call. Figma updates the URL's `node-id` asynchronously
 * after a selection change, so a fresh name got paired with the PREVIOUS node's id. The
 * damage was visible on capture: node 5895-34769, labelled "View merchant - Connected to a
 * perk", actually rendered the **Mobile sections** empty state. A wrong name↔node map is the
 * kind of thing that manufactures false findings, so the map is rebuilt here.
 *
 * The fix: after every selection change, poll until the URL's node-id **settles**, and only
 * then read the name — and record both only when the pair has been stable across two reads.
 *
 * Run: node B10-57776/automation/explore/figma-frames2.js
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const AUTH = 'D:/breadfast-qa/auth/figma-auth.json';
const FILE_KEY = 'kyspsx61WsmZgAgjMpimcu';
const SECTION_NODE = '5893-267497';
const SECTION = 'Managing merchants';
const URL_ = `https://www.figma.com/design/${FILE_KEY}/Perks-Admin-Dashboard?node-id=${SECTION_NODE}`;
const OUT = 'D:/breadfast-qa/B10-57776/figma-analysis/frames/_enumerate';

const raw = (page) => page.evaluate(() => {
  const nameEl = document.querySelector('[class*="headerSelectionName"]');
  const panel = document.querySelector('[class*="properties_panel--panelContainer"]');
  const text = panel ? panel.innerText : '';
  const grab = (label) => {
    const m = text.match(new RegExp('(?:^|\\n)\\s*' + label + '\\s*\\n\\s*(-?[\\d,.]+)', 'm'));
    return m ? Number(m[1].replace(/,/g, '')) : null;
  };
  return {
    name: nameEl ? nameEl.textContent.trim() : null,
    node: new URL(location.href).searchParams.get('node-id'),
    w: grab('Width'), h: grab('Height'), x: grab('X'), y: grab('Y'),
  };
});

/** Read the selection only once (name, node) has been identical twice in a row. */
async function settled(page, tries = 14) {
  let last = null;
  for (let i = 0; i < tries; i++) {
    await page.waitForTimeout(260);
    const cur = await raw(page);
    if (last && cur.name && cur.node && cur.name === last.name && cur.node === last.node) return cur;
    last = cur;
  }
  return last;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const state = JSON.parse(fs.readFileSync(AUTH, 'utf8'));
  const browser = await chromium.launch({ headless: false });
  const ctx = await browser.newContext({
    storageState: { cookies: state.cookies, origins: state.origins || [] },
    viewport: { width: 1600, height: 950 },
  });
  const page = await ctx.newPage();
  await page.goto(URL_, { waitUntil: 'domcontentloaded', timeout: 120000 });
  for (let i = 0; i < 60; i++) { if (/–/.test(await page.title())) break; await page.waitForTimeout(2000); }
  await page.waitForTimeout(15000);

  await page.keyboard.press('Shift+Digit2');
  await page.waitForTimeout(3500);
  const base = await settled(page);
  console.log('section:', JSON.stringify(base));
  await page.screenshot({ path: path.join(OUT, '40-corrected-base.png') });

  const found = new Map();
  const trace = [];

  for (let y = 350; y <= 545; y += 24) {
    for (let x = 390; x <= 1195; x += 24) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(120);
      await page.mouse.click(x, y);
      let cur = await settled(page, 8);
      if (!cur || !cur.name || cur.name === SECTION) continue;

      // walk up to the section; the node visited just before it is the outer frame
      let prev = cur;
      for (let hop = 0; hop < 6; hop++) {
        await page.keyboard.press('Shift+Enter');
        const up = await settled(page, 8);
        if (!up || !up.name) break;
        if (up.name === SECTION) break;
        if (up.node === prev.node) break;
        prev = up;
      }
      trace.push({ x, y, name: prev.name, node: prev.node });
      const key = prev.node;
      if (key && !found.has(key)) {
        found.set(key, { ...prev, firstClick: { x, y } });
        console.log(`  + ${String(key).padEnd(14)} ${String(prev.w)}x${prev.h} @(${prev.x},${prev.y})  ${prev.name}`);
      }
    }
  }

  const frames = [...found.values()].sort((a, b) => (a.y - b.y) || (a.x - b.x));
  fs.writeFileSync(path.join(OUT, 'frames-found-v2.json'),
    JSON.stringify({ section: base, frames, trace }, null, 2));

  console.log(`\n=== ${frames.length} frames (name<->node pairs settled) ===`);
  frames.forEach((f, i) => console.log(`${String(i + 1).padStart(2)}. ${String(f.node).padEnd(14)} ${String(f.w)}x${f.h} @(${f.x},${f.y})  ${f.name}`));
  await browser.close();
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
