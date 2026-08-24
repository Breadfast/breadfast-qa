/**
 * Pixel sampler — reads exact RGBA values out of PNGs without a native image dependency.
 *
 * There is no PNG decoder installed in either tree (no pngjs / sharp / jimp), so this decodes
 * through the Chromium that Playwright already ships: load the file as a data URL into a canvas
 * and read `getImageData`. Deterministic, and it needs no new dependency.
 *
 * Built for B10-58603, where operator decision D-5 requires the screen background to be proven a
 * *vertical gradient* (white at the top, light grey at the bottom) rather than merely "not solid
 * white" — a single flat-colour sample would pass a solid grey background. Also serves the visual
 * phase, which compares the same regions between a Figma frame and a device screenshot.
 *
 * Usage:
 *   node automation/figma/sample_pixels.js --file <png> [--points x,y;x,y;...] [--column x] [--rows 8]
 *
 *   --points   explicit sample points, semicolon-separated
 *   --column   sample a vertical column at this x, at `--rows` evenly spaced heights (gradient probe)
 *   --rows     how many samples the column probe takes (default 12)
 *   --box      x,y,w,h — summarise a region: the darkest pixel, the most saturated one, and the
 *              mean. Use this for TEXT and ICON colour, where no single coordinate is reliable:
 *              glyph strokes are thin and anti-aliased, so a point sample usually lands on the
 *              background. Reports `redDominance` (how far r exceeds max(g,b)) so a red label can be
 *              distinguished from a dark one without hardcoding a brand hex.
 *
 * Prints JSON: { file, width, height, samples: [...], box: {...} }
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}

(async () => {
  const file = arg('file');
  if (!file || !fs.existsSync(file)) { console.error('usage: sample_pixels.js --file <png> [--points x,y;...] [--column x] [--rows n]'); process.exit(2); }

  const dataUrl = 'data:image/png;base64,' + fs.readFileSync(file).toString('base64');
  const explicit = (arg('points') || '').split(';').filter(Boolean).map((p) => p.split(',').map(Number));
  const column = arg('column') ? Number(arg('column')) : null;
  const rows = Number(arg('rows') || 12);
  const box = arg('box') ? arg('box').split(',').map(Number) : null;

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const out = await page.evaluate(async ({ dataUrl, explicit, column, rows, box }) => {
    const img = new Image();
    img.src = dataUrl;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);

    const pts = explicit.slice();
    if (column !== null) {
      // Evenly spaced down the full height, inset by half a step so we never sample the very edge row.
      const step = c.height / rows;
      for (let i = 0; i < rows; i++) pts.push([column, Math.round(step * (i + 0.5))]);
    }
    const hex = (n) => n.toString(16).padStart(2, '0');
    const samples = pts.map(([x, y]) => {
      const d = ctx.getImageData(x, y, 1, 1).data;
      return { x, y, r: d[0], g: d[1], b: d[2], a: d[3], hex: '#' + hex(d[0]) + hex(d[1]) + hex(d[2]) };
    });
    let boxStats = null;
    if (box) {
      const [bx, by, bw, bh] = box;
      const d = ctx.getImageData(bx, by, bw, bh).data;
      let darkest = null, reddest = null;
      let sr = 0, sg = 0, sb = 0, count = 0;
      for (let i = 0; i < d.length; i += 4) {
        const r = d[i], g = d[i + 1], b = d[i + 2];
        const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        const redDominance = r - Math.max(g, b);
        sr += r; sg += g; sb += b; count += 1;
        if (!darkest || lum < darkest.lum) darkest = { r, g, b, lum: Math.round(lum), redDominance };
        if (!reddest || redDominance > reddest.redDominance) reddest = { r, g, b, redDominance, lum: Math.round(lum) };
      }
      const mean = { r: Math.round(sr / count), g: Math.round(sg / count), b: Math.round(sb / count) };
      boxStats = {
        box: { x: bx, y: by, w: bw, h: bh }, pixels: count,
        darkest: { ...darkest, hex: '#' + hex(darkest.r) + hex(darkest.g) + hex(darkest.b) },
        reddest: { ...reddest, hex: '#' + hex(reddest.r) + hex(reddest.g) + hex(reddest.b) },
        mean: { ...mean, hex: '#' + hex(mean.r) + hex(mean.g) + hex(mean.b) },
      };
    }
    return { width: c.width, height: c.height, samples, boxStats };
  }, { dataUrl, explicit, column, rows, box });
  await browser.close();

  console.log(JSON.stringify({ file: path.basename(file), ...out }, null, 1));
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
