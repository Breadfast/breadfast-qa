'use strict';
/**
 * Stitch images side by side with a label above each panel, for before/after bug evidence.
 *
 * Two separate crops of the same control are ambiguous on a ticket: a triager sees two calendars and
 * has to trust the filenames to know which is which. One labelled image cannot be misread. Built for
 * B10-59719, where the original attachments were rejected for exactly this - they showed states
 * without saying what the states were.
 *
 *   node compose_side_by_side.js --out <png> --pad 20 \
 *        --panel <png> --label "entered" [--panel <png> --label "after refresh" ...] [--title "..."]
 */
const fs = require('fs');
const { chromium } = require('playwright');

const argv = process.argv.slice(2);
const panels = [];
let out = null;
let title = null;
let pad = 20;
for (let i = 0; i < argv.length; i += 2) {
  const [k, v] = [argv[i], argv[i + 1]];
  if (k === '--out') out = v;
  else if (k === '--title') title = v;
  else if (k === '--pad') pad = Number(v);
  else if (k === '--panel') panels.push({ file: v });
  else if (k === '--label' && panels.length) panels[panels.length - 1].label = v;
}
if (!out || !panels.length || panels.some((p) => !fs.existsSync(p.file))) {
  console.error('usage: compose_side_by_side.js --out <png> --panel <png> --label "<text>" [...] [--title "<text>"]');
  process.exit(2);
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 2 });
  const imgs = panels.map((p) => ({
    label: p.label || '',
    dataUrl: 'data:image/png;base64,' + fs.readFileSync(p.file).toString('base64'),
  }));
  await page.setContent(`<!doctype html><html><body style="margin:0;background:#fff">
    <div id="wrap" style="display:inline-block;padding:${pad}px;font:600 22px/1.3 system-ui,Segoe UI,sans-serif;color:#111">
      ${title ? `<div style="padding:0 0 ${pad}px 2px;font-size:24px">${title}</div>` : ''}
      <div style="display:flex;gap:${pad * 2}px;align-items:flex-start">
        ${imgs.map((im) => `<div>
            <div style="padding:0 0 10px 2px">${im.label}</div>
            <img src="${im.dataUrl}" style="display:block;border:2px solid #ddd">
          </div>`).join('')}
      </div>
    </div></body></html>`);
  await page.waitForFunction(() => [...document.images].every((i) => i.complete && i.naturalWidth > 0));
  await page.waitForTimeout(200);
  const el = await page.$('#wrap');
  await el.screenshot({ path: out, scale: 'device' });
  const b = await el.boundingBox();
  console.log(`wrote ${out}  ${Math.round(b.width)}x${Math.round(b.height)} css`);
  await browser.close();
})();
