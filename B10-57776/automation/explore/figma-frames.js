/**
 * B10-57776 — identify EVERY top-level frame inside the "Managing merchants" section.
 *
 * The layers panel is virtualized and its chevrons don't respond to synthetic clicks, and
 * Tab-cycling siblings doesn't advance the selection (figma-analysis SKILL). What does work:
 * click a point on the canvas, then walk UP the tree with Shift+Enter until the selection
 * becomes the section itself — the node visited immediately before that is the section's
 * direct child, i.e. the outer frame we want as a baseline.
 *
 * Scans a grid over the section at fit-zoom, walks up from each hit, and dedupes by node id.
 * Records name + node id + width/height so the capture step can deep-link each frame.
 *
 * Run: node B10-57776/automation/explore/figma-frames.js
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const AUTH = 'D:/breadfast-qa/auth/figma-auth.json';
const FILE_KEY = 'kyspsx61WsmZgAgjMpimcu';
const NODE = '5893-267497';
const SECTION_NAME = 'Managing merchants';
const URL = `https://www.figma.com/design/${FILE_KEY}/Perks-Admin-Dashboard?node-id=${NODE}`;
const OUT = 'D:/breadfast-qa/B10-57776/figma-analysis/frames/_enumerate';

// The selected node's name lives in the properties-panel header button
// (`inspect_selection_header--headerSelectionName`), NOT in the panel's first text line —
// reading the panel text instead returns the zoom level ("1"). Width/Height are printed with
// thousands separators ("15,910px"), so the number regex must accept commas.
const readSelection = (page) => page.evaluate(() => {
  const nameEl = document.querySelector('[class*="headerSelectionName"]');
  const panel = document.querySelector('[class*="properties_panel--panelContainer"]');
  const text = panel ? panel.innerText : '';
  const grab = (label) => {
    const m = text.match(new RegExp(label + '\\s*\\n?\\s*([\\d,.]+)\\s*px'));
    return m ? Number(m[1].replace(/,/g, '')) : null;
  };
  return {
    name: nameEl ? nameEl.textContent.trim() : null,
    node: new URL(location.href).searchParams.get('node-id'),
    w: grab('Width'),
    h: grab('Height'),
  };
});

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
    if (/–/.test(await page.title())) break;
    if (/login/i.test(page.url())) throw new Error('SESSION EXPIRED');
    await page.waitForTimeout(2000);
  }
  await page.waitForTimeout(15000);

  await page.keyboard.press('Shift+Digit2'); // fit the section
  await page.waitForTimeout(4000);
  const base = await readSelection(page);
  console.log('section selection:', JSON.stringify(base));

  // the section's on-screen box, so the grid only scans inside it
  await page.screenshot({ path: path.join(OUT, '20-grid-base.png') });

  const found = new Map();      // node -> {name,node,w,h,clicks:[]}
  const visitedClicks = [];

  // Grid across the section's visible area (from 10-section-fit.png: x 340..1320, y 310..585)
  for (let y = 360; y <= 540; y += 30) {
    for (let x = 395; x <= 1190; x += 30) {
      await page.keyboard.press('Escape');
      await page.mouse.click(x, y);
      await page.waitForTimeout(320);
      let cur = await readSelection(page);
      if (!cur.name || cur.name === SECTION_NAME) continue;

      // walk up until the section is selected; keep the last node before it
      let prev = cur;
      for (let hop = 0; hop < 6; hop++) {
        await page.keyboard.press('Shift+Enter');
        await page.waitForTimeout(320);
        const up = await readSelection(page);
        if (!up.name) break;
        if (up.name === SECTION_NAME) break;
        if (up.node === prev.node && up.name === prev.name) break;
        prev = up;
      }
      visitedClicks.push({ x, y, resolved: prev.name, node: prev.node });
      if (prev.node && !found.has(prev.node)) {
        found.set(prev.node, { ...prev, firstClick: { x, y } });
        console.log(`  + ${String(prev.node).padEnd(14)} ${String(prev.w)}x${prev.h}  ${prev.name}`);
      }
    }
  }

  const frames = [...found.values()];
  fs.writeFileSync(path.join(OUT, 'frames-found.json'),
    JSON.stringify({ section: base, frames, clicks: visitedClicks }, null, 2));

  console.log(`\n=== ${frames.length} distinct top-level frames in "${SECTION_NAME}" ===`);
  frames.forEach((f, i) => console.log(`${String(i + 1).padStart(2)}. ${String(f.node).padEnd(14)} ${String(f.w)}x${f.h}  ${f.name}`));
  console.log('\n->', path.join(OUT, 'frames-found.json'));

  await browser.close();
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
