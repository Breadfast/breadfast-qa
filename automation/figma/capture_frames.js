/**
 * Shared Figma frame capture — the ONE sanctioned export channel.
 *
 * Figma's own native "Copy as PNG" (Ctrl+Shift+C), driven through the authenticated Playwright
 * browser session seeded from `auth/figma-auth.json`. Never a browser screenshot, never the REST
 * image endpoints, never the MCP `get_screenshot` — see CLAUDE.md §2 STEP 2 and
 * docs/ai/testing-process.md §4.1.
 *
 * Promoted to `automation/figma/` on 2026-08-24 (B10-58603). Before this, every story re-implemented
 * the same script inside its own gitignored folder — B10-57766, B10-57774 and B10-57776 each carried
 * a divergent copy, and none of them implemented the sha256-distinctness gate that the
 * stale-clipboard failure on B10-57764 requires. This version is the hardened one:
 *
 *   1. Clear the clipboard AND assert it holds no `image/png` before pressing the shortcut.
 *   2. Poll until a FRESH `image/png` appears.
 *   3. sha256 every saved PNG and require all values DISTINCT — a duplicate means the shortcut
 *      re-served the previous frame under this frame's name, which is silent and corrupts the
 *      whole expected-side baseline. Duplicates are retried, then reported as failures.
 *   4. Record dimensions (from the PNG IHDR) so the ~2x scale can be checked.
 *
 * Usage:
 *   node automation/figma/capture_frames.js --spec <spec.json>
 *
 * Spec shape:
 *   {
 *     "fileKey": "QCmQy63guCtjBrAV45rIMX",
 *     "fileSlug": "Card-Settings-Enhancement",     // any slug; Figma redirects on mismatch
 *     "out":     "D:/breadfast-qa/B10-58603/figma-analysis/frames/export",
 *     "ctx":     "D:/breadfast-qa/B10-58603/figma-analysis/frames/context",
 *     "settleMs": 14000,                            // lazy-image wait; raise for image-heavy frames
 *     "frames": [ { "node": "6663:1480", "name": "f01_more_en_loaded", "state": "...", "acs": ["AC-1"] } ]
 *   }
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { chromium } = require('playwright');

const AUTH_PATH = process.env.FIGMA_AUTH_PATH || path.join(__dirname, '..', '..', 'auth', 'figma-auth.json');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}

/** Empty the clipboard and confirm no image survives on it. Returns true when provably image-free. */
async function clearClipboard(page) {
  await page.evaluate(async () => {
    try { await navigator.clipboard.writeText('__cleared__'); } catch (e) { /* permission race */ }
  });
  return page.evaluate(async () => {
    try {
      const items = await navigator.clipboard.read();
      return !items.some((it) => it.types.includes('image/png'));
    } catch (e) { return true; }        // unreadable clipboard cannot serve a stale PNG either
  });
}

/** Read an image/png off the clipboard as base64, or null. */
function readClipboardPng(page) {
  return page.evaluate(async () => {
    try {
      const items = await navigator.clipboard.read();
      for (const it of items) {
        if (!it.types.includes('image/png')) continue;
        const buf = await (await it.getType('image/png')).arrayBuffer();
        const u8 = new Uint8Array(buf);
        let s = '';
        const CH = 0x8000;
        for (let i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
        return btoa(s);
      }
    } catch (e) { return 'ERR:' + e.message; }
    return null;
  });
}

/** One frame: navigate, clear, copy, poll, save. Returns a manifest row. */
async function captureFrame(page, spec, f, seen) {
  const url = `https://www.figma.com/design/${spec.fileKey}/${spec.fileSlug || 'file'}?node-id=${f.node.replace(':', '-')}`;
  console.log(`\n=== ${f.name}  (${f.node}) ===`);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });

  // Canvas-loaded gate: the editor puts the file name + en-dash into the title once it is live.
  let title = '';
  for (let i = 0; i < 60; i++) {
    title = await page.title();
    if (/–/.test(title)) break;
    await sleep(2000);
  }
  if (/login|Log in/i.test(page.url())) {
    throw new Error('SESSION EXPIRED — redirected to login. Re-run qa-workflow/bin/figma-connect.js.');
  }
  console.log('  title:', title);

  await sleep(spec.settleMs || 14000);          // image-heavy frames export black until lazy images land
  await page.bringToFront();

  // Up to 4 attempts; each one starts from a provably image-free clipboard.
  for (let attempt = 1; attempt <= 4; attempt++) {
    const clean = await clearClipboard(page);
    if (!clean) { console.log(`  attempt ${attempt}: clipboard still holds a PNG, retrying`); await sleep(2000); continue; }

    await page.keyboard.press('Control+Shift+C');

    let b64 = null;
    for (let poll = 0; poll < 10 && !b64; poll++) {
      await sleep(1500);
      const got = await readClipboardPng(page);
      if (typeof got === 'string' && got.startsWith('ERR:')) { console.log('  clipboard err:', got); continue; }
      b64 = got;
    }
    if (!b64) { console.log(`  attempt ${attempt}: no PNG appeared`); continue; }

    const buf = Buffer.from(b64, 'base64');
    const hash = sha256(buf);
    // THE GATE: an identical hash means the shortcut re-served a previous frame under this name.
    if (seen.has(hash)) {
      console.log(`  attempt ${attempt}: DUPLICATE of ${seen.get(hash)} (sha ${hash.slice(0, 12)}) — stale clipboard, retrying`);
      await sleep(3000);
      continue;
    }

    const file = path.join(spec.out, `${f.name}_2x.png`);
    fs.writeFileSync(file, buf);
    const width = buf.readUInt32BE(16), height = buf.readUInt32BE(20);   // PNG IHDR
    seen.set(hash, f.name);
    console.log(`  saved ${path.basename(file)}  ${buf.length} bytes  ${width}x${height}  sha ${hash.slice(0, 12)}`);
    return { ...f, ok: true, file, bytes: buf.length, width, height, sha256: hash, exportForm: 'copy-as-png', attempts: attempt };
  }

  console.log('  !! FAILED to capture a distinct PNG');
  await page.screenshot({ path: path.join(spec.ctx, `FAILED_${f.name}.png`) });
  return { ...f, ok: false, reason: 'no distinct PNG after 4 attempts' };
}

(async () => {
  const specPath = arg('spec');
  if (!specPath) { console.error('usage: capture_frames.js --spec <spec.json>'); process.exit(2); }
  const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
  fs.mkdirSync(spec.out, { recursive: true });
  fs.mkdirSync(spec.ctx, { recursive: true });

  if (!fs.existsSync(AUTH_PATH)) {
    console.error(`Missing Figma session: ${AUTH_PATH}\n  -> run: node qa-workflow/bin/figma-connect.js`);
    process.exit(3);
  }
  const raw = JSON.parse(fs.readFileSync(AUTH_PATH, 'utf8'));

  const browser = await chromium.launch({ headless: false, args: ['--start-maximized'] });
  const context = await browser.newContext({
    storageState: { cookies: raw.cookies, origins: raw.origins || [] },
    viewport: { width: 1600, height: 1000 },
    deviceScaleFactor: 1,
  });
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'https://www.figma.com' });
  const page = await context.newPage();

  const seen = new Map();                 // sha256 -> frame name, the distinctness ledger
  const rows = [];
  try {
    for (const f of spec.frames) rows.push(await captureFrame(page, spec, f, seen));
  } finally {
    await browser.close();
  }

  fs.writeFileSync(path.join(spec.ctx, 'capture-log.json'), JSON.stringify(rows, null, 2));
  console.log('\n--- summary ---');
  for (const r of rows) console.log(`${r.ok ? 'OK  ' : 'FAIL'} ${r.name.padEnd(28)} ${r.ok ? `${r.width}x${r.height}  ${r.sha256.slice(0, 12)}` : r.reason}`);
  const failed = rows.filter((r) => !r.ok);
  console.log(`\n${rows.length - failed.length}/${rows.length} captured, all sha256 distinct: ${seen.size === rows.length - failed.length}`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
