/**
 * B10-57776 — capture the 17 "Managing merchants" frames at 2x via Copy-as-PNG.
 *
 * Channel: authenticated browser session + `Ctrl+Shift+C` (Copy as PNG) — the PRIMARY channel
 * per the figma-analysis skill. The REST exporter is quota-blocked (429 on /files and /nodes)
 * and the MCP browser profile is held by another instance.
 *
 * Two traps this guards against:
 *  1. [[figma-copy-as-png-stale-clipboard]] — Ctrl+Shift+C can leave the PREVIOUS frame on the
 *     clipboard, which then gets saved under the NEXT frame's name. So the clipboard is cleared
 *     to a sentinel before every copy, the read is polled until a PNG appears, and every image
 *     must have a sha256 distinct from all earlier ones.
 *  2. Image-heavy frames export BLACK if captured before lazy images settle — hence the wait
 *     after each navigation.
 *
 * Also records each frame's X/Y/W/H so the layout can be reconciled for completeness (a missing
 * frame shows up as an unexplained hole in the section's tiling).
 *
 * Run: node B10-57776/automation/explore/figma-capture.js
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { chromium } = require('playwright');

const AUTH = 'D:/breadfast-qa/auth/figma-auth.json';
const FILE_KEY = 'kyspsx61WsmZgAgjMpimcu';
const OUT = 'D:/breadfast-qa/B10-57776/figma-analysis/frames';
const ENUM = path.join(OUT, '_enumerate', 'frames-found.json');
const SECTION = 'Managing merchants';

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const readSelection = (page) => page.evaluate(() => {
  const nameEl = document.querySelector('[class*="headerSelectionName"]');
  const panel = document.querySelector('[class*="properties_panel--panelContainer"]');
  const text = panel ? panel.innerText : '';
  const grab = (label) => {
    const m = text.match(new RegExp('(?:^|\\n)\\s*' + label + '\\s*\\n\\s*(-?[\\d,.]+)', 'm'));
    return m ? Number(m[1].replace(/,/g, '')) : null;
  };
  return {
    name: nameEl ? nameEl.textContent.trim() : null,
    w: grab('Width'), h: grab('Height'), x: grab('X'), y: grab('Y'),
    panelText: text.slice(0, 600),
  };
});

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const frames = JSON.parse(fs.readFileSync(ENUM, 'utf8')).frames
    .filter((f) => f.name && f.name !== SECTION);
  console.log(`capturing ${frames.length} frames\n`);

  const state = JSON.parse(fs.readFileSync(AUTH, 'utf8'));
  const browser = await chromium.launch({ headless: false });
  const ctx = await browser.newContext({
    storageState: { cookies: state.cookies, origins: state.origins || [] },
    viewport: { width: 1600, height: 950 },
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'https://www.figma.com' });
  const page = await ctx.newPage();

  const seen = new Map();   // sha256 -> filename
  const manifest = [];
  const nameCount = {};

  for (const [i, f] of frames.entries()) {
    const label = `${i + 1}/${frames.length} ${f.node} ${f.name}`;
    nameCount[f.name] = (nameCount[f.name] || 0) + 1;
    const suffix = nameCount[f.name] > 1 ? `-${nameCount[f.name]}` : '';
    const file = `${String(i + 1).padStart(2, '0')}-${slug(f.name)}${suffix}.png`;

    try {
      await page.goto(
        `https://www.figma.com/design/${FILE_KEY}/Perks-Admin-Dashboard?node-id=${f.node}`,
        { waitUntil: 'domcontentloaded', timeout: 120000 },
      );
      for (let t = 0; t < 60; t++) {
        if (/–/.test(await page.title())) break;
        if (/login/i.test(page.url())) throw new Error('SESSION EXPIRED');
        await page.waitForTimeout(2000);
      }
      await page.waitForTimeout(11000);           // let lazy images fill, else exports go black
      await page.keyboard.press('Shift+Digit2');  // frame fills the canvas
      await page.waitForTimeout(2500);

      const sel = await readSelection(page);

      // 1. clear the clipboard to a sentinel so a stale PNG cannot be mistaken for this frame
      await page.evaluate(() => navigator.clipboard.writeText('__CLEARED__'));
      await page.waitForTimeout(400);

      // 2. copy as PNG — the shortcut must land on the canvas, so click empty canvas first? no:
      //    the deep-link already selects the frame; clicking would change the selection.
      await page.keyboard.press('Control+Shift+c');

      // 3. poll for a real PNG on the clipboard
      let b64 = null;
      for (let t = 0; t < 25; t++) {
        await page.waitForTimeout(600);
        b64 = await page.evaluate(async () => {
          try {
            const items = await navigator.clipboard.read();
            for (const it of items) {
              if (it.types.includes('image/png')) {
                const blob = await it.getType('image/png');
                const buf = new Uint8Array(await blob.arrayBuffer());
                let s = '';
                for (let k = 0; k < buf.length; k++) s += String.fromCharCode(buf[k]);
                return btoa(s);
              }
            }
          } catch (e) { return null; }
          return null;
        });
        if (b64) break;
      }
      if (!b64) { console.log(`  !! ${label} — no PNG on clipboard`); manifest.push({ ...f, ...sel, file: null, error: 'no-clipboard-png' }); continue; }

      const buf = Buffer.from(b64, 'base64');
      const sha = crypto.createHash('sha256').update(buf).digest('hex');
      if (seen.has(sha)) {
        console.log(`  !! ${label} — DUPLICATE of ${seen.get(sha)} (stale clipboard) — skipped`);
        manifest.push({ ...f, ...sel, file: null, error: `duplicate-of:${seen.get(sha)}`, sha256: sha });
        continue;
      }
      seen.set(sha, file);
      fs.writeFileSync(path.join(OUT, file), buf);
      const dim = buf.slice(1, 4).toString() === 'PNG'
        ? `${buf.readUInt32BE(16)}x${buf.readUInt32BE(20)}` : '?';
      console.log(`  ok ${label}\n       -> ${file}  ${dim}  ${(buf.length / 1024).toFixed(0)} KB  design ${sel.w}x${sel.h} @ (${sel.x},${sel.y})`);
      manifest.push({ ...f, designName: sel.name, w: sel.w, h: sel.h, x: sel.x, y: sel.y, file, px: dim, bytes: buf.length, sha256: sha });
    } catch (e) {
      console.log(`  !! ${label} — ${e.message}`);
      manifest.push({ ...f, file: null, error: e.message });
    }
  }

  fs.writeFileSync(path.join(OUT, 'export', 'MANIFEST.json').replace('\\export', ''), '');
  fs.mkdirSync(path.join(OUT, 'export'), { recursive: true });
  fs.writeFileSync(path.join(OUT, 'export', 'MANIFEST.json'), JSON.stringify({
    fileKey: FILE_KEY, section: SECTION, sectionNode: '5893-267497',
    capturedVia: 'browser-session Ctrl+Shift+C (copy as PNG, 2x native)',
    capturedAt: new Date().toISOString(),
    frames: manifest,
  }, null, 2));

  const ok = manifest.filter((m) => m.file);
  console.log(`\n=== ${ok.length}/${frames.length} captured, ${new Set(ok.map((m) => m.sha256)).size} distinct images ===`);
  await browser.close();
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
