/**
 * Bounding-box measurer — finds the tight box of the non-background content inside a region of a PNG.
 *
 * Built for B10-58603 AC-10, which requires the eight leading row icons at 24x24 and the trailing
 * chevrons at 20x20. The obvious source for that — Appium element rects — does NOT answer it: a
 * lookup by row LABEL returns the whole 888px-wide row container, not the icon, and rows scrolled out
 * of view come back with height 3 or NEGATIVE height (-153, -309) because `allowInvisibleElements` is
 * on. So the sizes are measured off the screenshot instead.
 *
 * Scans a region, treats any pixel differing from the region's modal (background) colour by more than
 * --tol as content, and reports the tight bounding box in PIXELS plus its size in DP at --density.
 *
 *   node automation/figma/measure_bbox.js --file <png> --region x,y,w,h [--tol 24] [--density 2.625]
 */
'use strict';

const fs = require('fs');
const { chromium } = require('playwright');

const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d; };

(async () => {
  const file = arg('file');
  const region = (arg('region') || '').split(',').map(Number);
  const tol = Number(arg('tol') || 24);
  const density = Number(arg('density') || 2.625);
  if (!file || !fs.existsSync(file) || region.length !== 4) {
    console.error('usage: measure_bbox.js --file <png> --region x,y,w,h [--tol n] [--density n]');
    process.exit(2);
  }
  const dataUrl = 'data:image/png;base64,' + fs.readFileSync(file).toString('base64');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const out = await page.evaluate(async ({ dataUrl, region, tol }) => {
    const img = new Image(); img.src = dataUrl; await img.decode();
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const [rx, ry, rw, rh] = region;
    const d = ctx.getImageData(rx, ry, rw, rh).data;
    const at = (x, y) => { const i = (y * rw + x) * 4; return [d[i], d[i + 1], d[i + 2]]; };
    // Background = the most common colour in the region (the row's card fill).
    const freq = new Map();
    for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) {
      const k = at(x, y).join(','); freq.set(k, (freq.get(k) || 0) + 1);
    }
    const bg = [...freq.entries()].sort((a, b) => b[1] - a[1])[0][0].split(',').map(Number);
    let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1, n = 0;
    for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) {
      const p = at(x, y);
      const diff = Math.max(Math.abs(p[0] - bg[0]), Math.abs(p[1] - bg[1]), Math.abs(p[2] - bg[2]));
      if (diff > tol) { n++; if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
    }
    if (n === 0) return { bg, contentPixels: 0, bbox: null };
    return { bg, contentPixels: n, bbox: { x: rx + x0, y: ry + y0, w: x1 - x0 + 1, h: y1 - y0 + 1 } };
  }, { dataUrl, region, tol });
  await browser.close();
  if (out.bbox) {
    out.dp = { w: +(out.bbox.w / density).toFixed(1), h: +(out.bbox.h / density).toFixed(1), density };
  }
  console.log(JSON.stringify({ file, region, tol, ...out }, null, 1));
})();
