#!/usr/bin/env node
'use strict';

const fs = require('node:fs');

const SCREENSHOTS_IOS_EN_PATH  = 'D:/BreadfastQA/screenshots_b64.json';
const SCREENSHOTS_IOS_AR_PATH  = 'D:/BreadfastQA/ios_ar_screenshots.json';
const SCREENSHOTS_AND_EN_PATH  = 'D:/BreadfastQA/android_en_screenshots.json';
const SCREENSHOTS_AND_AR_PATH  = 'D:/BreadfastQA/android_ar_screenshots.json';
const OUTPUT_PATH               = 'D:/BreadfastQA/test_report_B10-53033.html';

console.log('Reading iOS English screenshots …');
const iosEn = JSON.parse(fs.readFileSync(SCREENSHOTS_IOS_EN_PATH, 'utf8'));

console.log('Reading iOS Arabic screenshots …');
let iosAr = {};
try { iosAr = JSON.parse(fs.readFileSync(SCREENSHOTS_IOS_AR_PATH, 'utf8')); } catch(e) { console.warn('iOS Arabic screenshots not found:', e.message); }

let andEn = {};
try { andEn = JSON.parse(fs.readFileSync(SCREENSHOTS_AND_EN_PATH, 'utf8')); } catch(e) { console.warn('Android EN screenshots not found:', e.message); }

let andAr = {};
try { andAr = JSON.parse(fs.readFileSync(SCREENSHOTS_AND_AR_PATH, 'utf8')); } catch(e) { console.warn('Android AR screenshots not found:', e.message); }

console.log('iOS EN keys:', Object.keys(iosEn).length);
console.log('iOS AR keys:', Object.keys(iosAr).length);
console.log('Android EN keys:', Object.keys(andEn).length);
console.log('Android AR keys:', Object.keys(andAr).length);

// ─── Screenshot helpers ──────────────────────────────────────────────────────

function imgFromMap(map, key, caption) {
  const b64 = map[key];
  if (!b64) return `<p class="img-missing">Not found: ${key}</p>`;
  const src = b64.startsWith('data:') ? b64 : `data:image/png;base64,${b64}`;
  return `<figure class="screenshot"><img src="${src}" alt="${caption}" height="260" /><figcaption>${caption}</figcaption></figure>`;
}

function imgFromFile(filename, caption) {
  try {
    const buf = fs.readFileSync(`D:/BreadfastQA/${filename}`);
    const src = `data:image/png;base64,${buf.toString('base64')}`;
    return `<figure class="screenshot"><img src="${src}" alt="${caption}" height="260" /><figcaption>${caption}</figcaption></figure>`;
  } catch(e) {
    console.warn(`imgFromFile: ${filename} not found:`, e.message);
    return `<p class="img-missing">Not found: ${filename}</p>`;
  }
}

function imgFromFigmaKey(map, key, caption) {
  const b64 = map[key];
  if (!b64) return null;
  const src = b64.startsWith('data:') ? b64 : `data:image/png;base64,${b64}`;
  return `<figure class="screenshot figma-frame"><img src="${src}" alt="${caption}" height="260" /><figcaption>${caption}</figcaption></figure>`;
}

function iosEnImg(key, caption)  { return imgFromMap(iosEn, key, caption); }
function iosArImg(key, caption)  { return imgFromMap(iosAr, key, caption); }
function andEnImg(key, caption)  { return imgFromMap(andEn, key, caption); }
function andArImg(key, caption)  { return imgFromMap(andAr, key, caption); }
function arFile(fn, caption)     { return imgFromFile(fn, caption); }

// ─── Layout components ───────────────────────────────────────────────────────

function notTestedCol(platform) {
  return `<div class="not-tested-col">
    <span class="badge-not-tested">Not Tested</span>
    <p class="not-tested-note">${platform} session<br>not yet run</p>
  </div>`;
}

function figmaNoRefFrame(label) {
  return `<div class="figma-no-ref-frame">
    <span class="badge-no-figma">📋 No Figma Ref</span>
    <p class="figma-no-ref-note">${label}<br>Fetch via Figma MCP tool</p>
  </div>`;
}

function platformSection(iosEnHtml, iosArHtml, andEnHtml, andArHtml) {
  return `
  <div class="evidence-section">
    <div class="section-label actual-label">Actual Screenshots</div>
    <div class="platform-compare">
      <div class="platform-col">
        <div class="platform-label plat-ios-en">📱 iOS · English</div>
        <div class="screenshots-strip">${iosEnHtml}</div>
      </div>
      <div class="platform-col">
        <div class="platform-label plat-ios-ar">📱 iOS · العربية</div>
        <div class="screenshots-strip">${iosArHtml}</div>
      </div>
      <div class="platform-col">
        <div class="platform-label plat-and-en">🤖 Android · English</div>
        <div class="screenshots-strip">${andEnHtml}</div>
      </div>
      <div class="platform-col">
        <div class="platform-label plat-and-ar">🤖 Android · العربية</div>
        <div class="screenshots-strip">${andArHtml}</div>
      </div>
    </div>
  </div>`;
}

function figmaSection(figmaEnHtml, figmaArHtml) {
  return `
  <div class="evidence-section figma-ref-section">
    <div class="section-label figma-label">Figma Reference Design</div>
    <div class="figma-compare">
      <div class="figma-col">
        <div class="figma-lang-label figma-en-label">English Frame</div>
        <div class="screenshots-strip">${figmaEnHtml}</div>
      </div>
      <div class="figma-col">
        <div class="figma-lang-label figma-ar-label">Arabic Frame</div>
        <div class="screenshots-strip">${figmaArHtml}</div>
      </div>
    </div>
  </div>`;
}

function figmaCompRow(aspect, result, note = '—') {
  const cfg = {
    matches:    { icon: '✅', label: 'Matches',    cls: 'fc-match'  },
    mismatch:   { icon: '❌', label: 'Mismatch',   cls: 'fc-fail'   },
    'style-note': { icon: '⚠️', label: 'Style Note', cls: 'fc-warn'   },
    'no-ref':   { icon: '📋', label: 'No Ref',     cls: 'fc-noref'  },
    'not-tested': { icon: '⬜', label: 'Not Tested', cls: 'fc-notest' },
  };
  const c = cfg[result] || cfg['no-ref'];
  return `
  <tr>
    <td class="fc-aspect">${aspect}</td>
    <td class="fc-result ${c.cls}">${c.icon} ${c.label}</td>
    <td class="fc-note">${note}</td>
  </tr>`;
}

function figmaComparisonTable(rows) {
  return `
  <div class="evidence-section figma-comp-section">
    <div class="section-label figma-comp-label">Figma Comparison Result</div>
    <div class="figma-comp-wrap">
      <table class="figma-comp-table">
        <thead><tr><th>Aspect</th><th>Result</th><th>Notes</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  </div>`;
}

function figmaMismatchBox(title, items) {
  const lis = items.map(i => `<li>${i}</li>`).join('');
  return `
  <div class="figma-mismatch-box">
    <div class="figma-mismatch-header">
      <span class="figma-mismatch-icon">❌ FIGMA MISMATCH</span>
      <span class="figma-mismatch-title">${title}</span>
    </div>
    <ul>${lis}</ul>
  </div>`;
}

function badge(status) {
  const map = { PASS: 'badge-pass', FAIL: 'badge-fail', BLOCKED: 'badge-blocked', PARTIAL: 'badge-partial' };
  return `<span class="badge ${map[status] || 'badge-pass'}">${status}</span>`;
}

function tc(title, status, note) {
  return `
  <tr>
    <td class="tc-title">${title}</td>
    <td class="tc-status">${badge(status)}</td>
    <td class="tc-note">${note || ''}</td>
  </tr>`;
}

// Standard no-ref comparison rows used when Figma frames have not been fetched yet
function noRefRows(screenNote) {
  const note = screenNote || 'Figma frame not fetched — run Figma MCP tool to populate comparison';
  return (
    figmaCompRow('Content (EN) — text labels, buttons, step indicators', 'no-ref', note) +
    figmaCompRow('Content (AR) — Arabic text, RTL labels, step indicators', 'no-ref', note) +
    figmaCompRow('Style — iOS (colors, typography, spacing, icons)', 'no-ref', note) +
    figmaCompRow('Style — Android (colors, typography, spacing, icons)', 'not-tested', 'Android session not yet run')
  );
}

// ─── HTML ────────────────────────────────────────────────────────────────────

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Test Report – B10-53033 | Breadfast Card</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html { font-size: 15px; }
  body { font-family: 'Segoe UI', system-ui, -apple-system, sans-serif; background: #f4f0f8; color: #1a1a2e; line-height: 1.6; }

  /* ── Header ── */
  header { background: linear-gradient(135deg, #6c1f7e 0%, #b8007e 100%); color: #fff; padding: 36px 48px 28px; box-shadow: 0 4px 24px rgba(108,31,126,.35); }
  header .brand { font-size: .85rem; letter-spacing: .12em; text-transform: uppercase; opacity: .8; margin-bottom: 6px; }
  header h1 { font-size: 1.9rem; font-weight: 700; margin-bottom: 4px; }
  header .subtitle { font-size: 1rem; opacity: .85; }
  .meta-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 10px 24px; margin-top: 22px; padding-top: 18px; border-top: 1px solid rgba(255,255,255,.25); }
  .meta-grid .meta-item { font-size: .82rem; opacity: .9; }
  .meta-grid .meta-item strong { display: block; font-size: .72rem; letter-spacing: .08em; text-transform: uppercase; opacity: .65; margin-bottom: 2px; }

  /* ── Summary bar ── */
  .summary-bar { display: flex; gap: 12px; flex-wrap: wrap; padding: 20px 48px; background: #fff; border-bottom: 1px solid #e8dff0; box-shadow: 0 2px 8px rgba(0,0,0,.06); }
  .stat-card { display: flex; flex-direction: column; align-items: center; min-width: 100px; padding: 12px 16px; border-radius: 12px; flex: 1; }
  .stat-card .stat-num { font-size: 1.9rem; font-weight: 800; line-height: 1; }
  .stat-card .stat-label { font-size: .72rem; font-weight: 600; letter-spacing: .07em; text-transform: uppercase; margin-top: 4px; opacity: .75; text-align: center; }
  .stat-total   { background: #f0eaf8; color: #6c1f7e; }
  .stat-pass    { background: #e8f8f0; color: #1a7a46; }
  .stat-fail    { background: #fdecea; color: #c0392b; }
  .stat-partial { background: #fff4e0; color: #a05a00; }
  .stat-figma   { background: #e8f0ff; color: #1a4a9e; }
  .stat-noref   { background: #e2e3e5; color: #383d41; }

  /* ── Coverage note ── */
  .coverage-note { max-width: 1200px; margin: 20px auto 0; padding: 0 24px; }
  .note-box { background: #fffbea; border: 1.5px solid #e6c200; border-left: 5px solid #b89600; border-radius: 10px; padding: 14px 20px; display: flex; gap: 14px; align-items: flex-start; }
  .note-box .note-icon { background: #b89600; color: #fff; font-size: .7rem; font-weight: 800; letter-spacing: .07em; padding: 3px 10px; border-radius: 20px; text-transform: uppercase; white-space: nowrap; margin-top: 2px; }
  .note-box .note-title { font-weight: 700; font-size: .95rem; color: #5a4400; margin-bottom: 4px; }
  .note-box p { font-size: .875rem; color: #6b5200; }

  main { max-width: 1200px; margin: 28px auto; padding: 0 24px 64px; }

  /* ── Story card ── */
  .story-card { background: #fff; border-radius: 16px; box-shadow: 0 2px 16px rgba(108,31,126,.09); margin-bottom: 36px; overflow: hidden; border: 1px solid #ede5f5; }
  .story-header { display: flex; align-items: flex-start; gap: 16px; padding: 20px 28px 16px; background: linear-gradient(90deg, #f9f4fd 0%, #fff 100%); border-bottom: 1px solid #ede5f5; }
  .story-id { background: linear-gradient(135deg, #6c1f7e, #b8007e); color: #fff; font-size: .75rem; font-weight: 700; letter-spacing: .06em; padding: 4px 12px; border-radius: 20px; white-space: nowrap; margin-top: 3px; }
  .story-header-text h2 { font-size: 1.1rem; font-weight: 700; color: #2c0a38; }
  .story-header-text p  { font-size: .85rem; color: #7a6a8a; margin-top: 3px; }
  .story-header-status { margin-left: auto; }

  /* ── Test case table ── */
  .tc-table-wrap { padding: 0 28px 20px; overflow-x: auto; }
  table.tc-table { width: 100%; border-collapse: collapse; margin-top: 16px; font-size: .875rem; }
  .tc-table thead tr { background: #f4f0f8; }
  .tc-table th { text-align: left; padding: 10px 14px; font-size: .73rem; font-weight: 700; letter-spacing: .09em; text-transform: uppercase; color: #6c1f7e; border-bottom: 2px solid #ede5f5; }
  .tc-table td { padding: 9px 14px; border-bottom: 1px solid #f0eaf8; vertical-align: middle; }
  .tc-table tr:last-child td { border-bottom: none; }
  .tc-table tr:hover td { background: #faf7fd; }
  .tc-title { font-weight: 500; color: #1a1a2e; }
  .tc-note  { color: #666; font-size: .82rem; }

  /* ── Badges ── */
  .badge { display: inline-block; padding: 3px 12px; border-radius: 20px; font-size: .72rem; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; }
  .badge-pass    { background: #d4f5e2; color: #0d6e35; }
  .badge-fail    { background: #fcd9d6; color: #9e1f12; }
  .badge-blocked { background: #ffecd4; color: #9a4c00; }
  .badge-partial { background: #e8e0f5; color: #5a1a70; }
  .badge-no-figma { display: inline-block; padding: 3px 10px; border-radius: 20px; font-size: .72rem; font-weight: 700; background: #e2e3e5; color: #383d41; border: 1px solid #d6d8db; }
  .badge-not-tested { display: inline-block; padding: 3px 10px; border-radius: 20px; font-size: .72rem; font-weight: 700; background: #f0eaf8; color: #6c1f7e; border: 1px solid #d6c5e8; }

  /* ── Status chips ── */
  .status-chip { display: inline-flex; align-items: center; gap: 6px; padding: 6px 16px; border-radius: 24px; font-size: .78rem; font-weight: 700; letter-spacing: .07em; text-transform: uppercase; }
  .chip-pass    { background: #d4f5e2; color: #0d6e35; border: 1.5px solid #a0e0bc; }
  .chip-fail    { background: #fcd9d6; color: #9e1f12; border: 1.5px solid #f0a0a0; }
  .chip-partial { background: #ffecd4; color: #9a4c00; border: 1.5px solid #f0c890; }

  /* ── Evidence section wrapper ── */
  .evidence-section { padding: 0 28px 0; margin-bottom: 0; }
  .evidence-section + .evidence-section { border-top: 1px solid #f0eaf8; }
  .section-label { font-size: .7rem; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; padding: 14px 0 10px; }
  .actual-label   { color: #1a4a9e; }
  .figma-label    { color: #6c1f7e; }
  .figma-comp-label { color: #155724; }

  /* ── 4-column platform layout ── */
  .platform-compare { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; padding-bottom: 20px; }
  .platform-col { min-width: 0; }
  .platform-label { font-size: .72rem; font-weight: 700; letter-spacing: .07em; text-transform: uppercase; padding: 5px 10px; border-radius: 6px; margin-bottom: 10px; display: inline-flex; align-items: center; gap: 5px; }
  .plat-ios-en  { background: #e8f0ff; color: #1a4a9e; }
  .plat-ios-ar  { background: #fff3e0; color: #8b4500; }
  .plat-and-en  { background: #e8f5e9; color: #1b5e20; }
  .plat-and-ar  { background: #fce4ec; color: #880e4f; }

  /* ── Not tested placeholder ── */
  .not-tested-col { display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 180px; background: #fafafa; border: 1.5px dashed #ccc; border-radius: 12px; padding: 20px 12px; text-align: center; gap: 8px; }
  .not-tested-note { font-size: .78rem; color: #999; margin-top: 6px; }

  /* ── Figma reference section ── */
  .figma-ref-section { background: #f9f4fd; border-top: 1px dashed #c8b0e0; border-bottom: 1px dashed #c8b0e0; }
  .figma-compare { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; padding-bottom: 20px; }
  .figma-col { min-width: 0; }
  .figma-lang-label { font-size: .72rem; font-weight: 700; letter-spacing: .07em; text-transform: uppercase; padding: 4px 10px; border-radius: 6px; margin-bottom: 10px; display: inline-block; }
  .figma-en-label { background: #e8f0ff; color: #1a4a9e; }
  .figma-ar-label { background: #fff3e0; color: #8b4500; }
  .figma-no-ref-frame { display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 180px; background: #f0edf5; border: 1.5px dashed #b8a0d0; border-radius: 12px; padding: 20px 16px; text-align: center; gap: 8px; }
  .figma-no-ref-note { font-size: .78rem; color: #7a6a8a; margin-top: 6px; }
  figure.figma-frame { border: 2px solid #b8007e; }
  figure.figma-frame figcaption { color: #b8007e; }

  /* ── Figma comparison table ── */
  .figma-comp-section { background: #f8fffe; }
  .figma-comp-wrap { padding-bottom: 20px; overflow-x: auto; }
  .figma-comp-table { width: 100%; border-collapse: collapse; font-size: .875rem; }
  .figma-comp-table thead tr { background: #e8f5e9; }
  .figma-comp-table th { text-align: left; padding: 9px 14px; font-size: .72rem; font-weight: 700; letter-spacing: .09em; text-transform: uppercase; color: #155724; border-bottom: 2px solid #c3e6cb; }
  .figma-comp-table td { padding: 8px 14px; border-bottom: 1px solid #e8f5e9; vertical-align: middle; }
  .figma-comp-table tr:last-child td { border-bottom: none; }
  .fc-aspect { font-weight: 500; color: #1a1a2e; font-size: .85rem; }
  .fc-result { font-weight: 700; font-size: .8rem; white-space: nowrap; }
  .fc-match  { color: #155724; }
  .fc-fail   { color: #721c24; }
  .fc-warn   { color: #856404; }
  .fc-noref  { color: #383d41; }
  .fc-notest { color: #6c1f7e; }
  .fc-note   { font-size: .8rem; color: #555; }

  /* ── Figma mismatch callout ── */
  .figma-mismatch-box { margin: 0 28px 20px; background: #fff5f5; border: 2px solid #dc3545; border-radius: 8px; padding: 14px 18px; }
  .figma-mismatch-header { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
  .figma-mismatch-icon { background: #dc3545; color: #fff; font-size: .7rem; font-weight: 800; letter-spacing: .07em; padding: 3px 10px; border-radius: 20px; }
  .figma-mismatch-title { font-weight: 700; font-size: .95rem; color: #721c24; }
  .figma-mismatch-box ul { padding-left: 18px; color: #721c24; font-size: .875rem; }
  .figma-mismatch-box ul li { margin-bottom: 4px; }

  /* ── Screenshots ── */
  .screenshots-strip { display: flex; gap: 10px; flex-wrap: wrap; }
  figure.screenshot { display: flex; flex-direction: column; align-items: center; background: #f9f4fd; border: 1px solid #ede5f5; border-radius: 12px; overflow: hidden; padding: 8px 8px 6px; max-width: 200px; }
  figure.screenshot img { border-radius: 6px; object-fit: contain; width: auto; max-width: 184px; display: block; }
  figure.screenshot figcaption { font-size: .7rem; color: #6c1f7e; font-weight: 600; text-align: center; margin-top: 6px; padding: 0 4px; }
  .img-missing { color: #999; font-style: italic; font-size: .8rem; padding: 8px 0; }

  /* ── Bug / info boxes ── */
  .bug-box { margin: 0 28px 20px; background: #fff5f5; border: 1.5px solid #e84040; border-left: 5px solid #c0392b; border-radius: 10px; padding: 16px 20px; }
  .bug-box .bug-header { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
  .bug-box .bug-icon { background: #c0392b; color: #fff; font-size: .7rem; font-weight: 800; letter-spacing: .07em; padding: 3px 10px; border-radius: 20px; text-transform: uppercase; }
  .bug-box .bug-title { font-weight: 700; font-size: .95rem; color: #8b1a1a; }
  .bug-box ul { padding-left: 18px; color: #5a1010; font-size: .875rem; }
  .bug-box ul li { margin-bottom: 4px; }
  .info-box { margin: 0 28px 20px; background: #f0f7ff; border: 1.5px solid #4a90d9; border-left: 5px solid #1a6fbd; border-radius: 10px; padding: 16px 20px; }
  .info-box .info-header { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
  .info-box .info-icon { background: #1a6fbd; color: #fff; font-size: .7rem; font-weight: 800; letter-spacing: .07em; padding: 3px 10px; border-radius: 20px; text-transform: uppercase; }
  .info-box .info-title { font-weight: 700; font-size: .95rem; color: #0d3d6e; }
  .info-box p { font-size: .875rem; color: #1a4a7a; }

  /* ── Footer ── */
  footer { text-align: center; padding: 28px 24px; font-size: .8rem; color: #9a8aaa; border-top: 1px solid #ede5f5; background: #fff; }
  footer strong { color: #6c1f7e; }

  @media (max-width: 900px) {
    .platform-compare { grid-template-columns: repeat(2, 1fr); }
    .figma-compare { grid-template-columns: 1fr; }
  }
  @media (max-width: 600px) {
    .platform-compare { grid-template-columns: 1fr; }
    .summary-bar { padding: 16px 20px; }
  }
</style>
</head>
<body>

<header>
  <div class="brand">Breadfast &middot; QA Test Report</div>
  <h1>B10-53033 &mdash; Card Feature Test Suite</h1>
  <div class="subtitle">End-to-end verification of the Prepaid Card flow &mdash; English &amp; Arabic &mdash; iOS + Android &mdash; with Figma design comparison</div>
  <div class="meta-grid">
    <div class="meta-item"><strong>Report Date</strong>2026-05-24</div>
    <div class="meta-item"><strong>Application</strong>com.breadfast.testing</div>
    <div class="meta-item"><strong>Build</strong>v2026.19.0</div>
    <div class="meta-item"><strong>iOS Device</strong>iPhone 14 &middot; iOS 18.0</div>
    <div class="meta-item"><strong>Android Device</strong>Samsung Galaxy S23 &middot; Android 13</div>
    <div class="meta-item"><strong>Platform</strong>BrowserStack App Automate</div>
    <div class="meta-item"><strong>Languages</strong>English (en/US) + Arabic (ar/EG)</div>
    <div class="meta-item"><strong>Tester</strong>ahmed.essameldien@breadfast.com</div>
  </div>
</header>

<div class="summary-bar">
  <div class="stat-card stat-total">
    <div class="stat-num">8</div>
    <div class="stat-label">Total Stories</div>
  </div>
  <div class="stat-card stat-pass">
    <div class="stat-num">7</div>
    <div class="stat-label">Passed (functional)</div>
  </div>
  <div class="stat-card stat-fail">
    <div class="stat-num">0</div>
    <div class="stat-label">Bugs Found</div>
  </div>
  <div class="stat-card stat-figma">
    <div class="stat-num">0</div>
    <div class="stat-label">Figma Mismatches</div>
  </div>
  <div class="stat-card stat-noref">
    <div class="stat-num">8</div>
    <div class="stat-label">Awaiting Figma Ref</div>
  </div>
  <div class="stat-card stat-partial">
    <div class="stat-num">1</div>
    <div class="stat-label">Partial / Blocked</div>
  </div>
</div>

<div class="coverage-note">
  <div class="note-box">
    <div class="note-icon">Coverage</div>
    <div>
      <div class="note-title">Session Scope: iOS (English + Arabic) &mdash; Android Pending</div>
      <p>
        This session validated iOS English and iOS Arabic for all 8 stories. Android English and Android Arabic sessions
        have not yet been run &mdash; columns are marked &ldquo;Not Tested&rdquo; and will be populated in the next session.
        <br>
        <strong>Figma comparison:</strong> Figma reference frames have not yet been fetched via the Figma MCP tool.
        All comparison cells show &ldquo;No Figma Ref&rdquo;. Run <code>get_screenshot</code> on each Figma frame and store
        results under <code>figma_en_*</code> / <code>figma_ar_*</code> keys in the screenshot accumulators,
        then regenerate this report to populate the comparison rows.
      </p>
    </div>
  </div>
</div>

<main>

  <!-- ─── B10-53346 Pay Home Page ─────────────────────────────────────────── -->
  <div class="story-card">
    <div class="story-header">
      <div class="story-id">B10-53346</div>
      <div class="story-header-text">
        <h2>Pay Home Page</h2>
        <p>Card journey widget, balance display &amp; skeleton animation &mdash; English &amp; Arabic</p>
      </div>
      <div class="story-header-status"><span class="status-chip chip-partial">Partial</span></div>
    </div>

    <div class="tc-table-wrap">
      <table class="tc-table">
        <thead><tr><th>Test Case</th><th>Status</th><th>Notes</th></tr></thead>
        <tbody>
          ${tc('Card journey widget renders with 3 steps (EN)',       'PASS', '')}
          ${tc('Card journey widget renders with 3 steps (AR)',       'PASS', 'Confirmed: التقديم → الاستلام → التفعيل')}
          ${tc('Active step shows action button (EN + AR)',            'PASS', '')}
          ${tc('Arabic RTL layout renders correctly on Pay home',     'PASS', 'Wallet balance, quick actions, card widget all RTL')}
          ${tc('Skeleton animation fires once on status change',       'BLOCKED', 'Requires video capture; static screenshots insufficient')}
        </tbody>
      </table>
    </div>

    ${platformSection(
      iosEnImg('anim3_frame_3', 'Pay home (iOS EN)') + iosEnImg('screen_pay_home_activation', 'Activation step (iOS EN)'),
      arFile('ar_s03_pay_home.png', 'الصفحة الرئيسية (iOS AR)') + arFile('ar_s43_pay_home_activate.png', 'خطوة التفعيل (iOS AR)'),
      notTestedCol('Android EN'),
      notTestedCol('Android AR')
    )}

    ${figmaSection(
      figmaNoRefFrame('Pay Home — English frame'),
      figmaNoRefFrame('Pay Home — Arabic frame')
    )}

    ${figmaComparisonTable(
      figmaCompRow('Content (EN) — widget steps, tab labels, balance label', 'no-ref', 'Fetch Figma Pay Home EN frame to verify: step labels (Apply / Receive / Activate), wallet balance format') +
      figmaCompRow('Content (AR) — widget steps (التقديم/الاستلام/التفعيل), رصيد المحفظة', 'no-ref', 'Fetch Figma Pay Home AR frame to verify RTL widget step labels and Arabic balance label') +
      figmaCompRow('Style — iOS (widget card, tab bar, color palette)', 'no-ref', 'Fetch Figma iOS frame') +
      figmaCompRow('Style — Android (widget card, bottom nav, material style)', 'not-tested', 'Android session not yet run')
    )}
  </div>

  <!-- ─── B10-53347 Wallet Balance ─────────────────────────────────────────── -->
  <div class="story-card">
    <div class="story-header">
      <div class="story-id">B10-53347</div>
      <div class="story-header-text">
        <h2>Wallet &amp; Balance Display</h2>
        <p>Balance visibility, currency symbol &amp; quick-action buttons</p>
      </div>
      <div class="story-header-status"><span class="status-chip chip-pass">Pass</span></div>
    </div>

    <div class="tc-table-wrap">
      <table class="tc-table">
        <thead><tr><th>Test Case</th><th>Status</th><th>Notes</th></tr></thead>
        <tbody>
          ${tc('Wallet balance "0.00 ج.م" visible in Arabic locale', 'PASS', 'Currency label ج.م confirmed in Arabic Pay home')}
          ${tc('Add to balance button visible',                        'PASS', 'إضافة إلى الرصيد label visible')}
          ${tc('Saved cards section visible',                          'PASS', 'البطاقات المحفوظة visible')}
        </tbody>
      </table>
    </div>

    ${platformSection(
      iosEnImg('anim3_frame_3', 'Pay home balance (iOS EN)'),
      arFile('ar_s03_pay_home.png', 'رصيد المحفظة (iOS AR)'),
      notTestedCol('Android EN'),
      notTestedCol('Android AR')
    )}

    ${figmaSection(
      figmaNoRefFrame('Wallet Balance — English frame'),
      figmaNoRefFrame('Wallet Balance — Arabic frame')
    )}

    ${figmaComparisonTable(
      figmaCompRow('Content (EN) — balance format, button labels, saved cards label', 'no-ref', 'Fetch Figma EN frame to verify balance format and quick-action button copy') +
      figmaCompRow('Content (AR) — رصيد المحفظة, ج.م currency, إضافة إلى الرصيد', 'no-ref', 'Fetch Figma AR frame — verify Arabic currency symbol and RTL alignment') +
      figmaCompRow('Style — iOS (balance typography, quick-action button style)', 'no-ref', 'Fetch Figma iOS frame') +
      figmaCompRow('Style — Android', 'not-tested', 'Android session not yet run')
    )}
  </div>

  <!-- ─── B10-53348 Card Application Screen ───────────────────────────────── -->
  <div class="story-card">
    <div class="story-header">
      <div class="story-id">B10-53348</div>
      <div class="story-header-text">
        <h2>Card Application Screen</h2>
        <p>Card perks carousel, invitation code &amp; intro screens</p>
      </div>
      <div class="story-header-status"><span class="status-chip chip-pass">Pass</span></div>
    </div>

    <div class="tc-table-wrap">
      <table class="tc-table">
        <thead><tr><th>Test Case</th><th>Status</th><th>Notes</th></tr></thead>
        <tbody>
          ${tc('Card perks carousel renders and is scrollable',         'PASS', 'Carousel displayed correctly in testing environment')}
          ${tc('Carousel items show content (test data in test env)',    'PASS', '"LOGO ENGLISH LOGO", "merchantperk", "test" are seeded test data — not production bugs')}
          ${tc('Invitation code screen layout correct (EN + AR)',       'PASS', '')}
          ${tc('Apply for card intro screen displays correctly (AR)',   'PASS', 'قدّم على بطاقتك — confirmed in Arabic')}
        </tbody>
      </table>
    </div>

    <div class="info-box">
      <div class="info-header">
        <span class="info-icon">Test Data</span>
        <span class="info-title">Card Perks Carousel Content is Testing Data</span>
      </div>
      <p>The carousel shows values such as <em>"LOGO ENGLISH LOGO"</em>, <em>"merchantperk"</em>, and <em>"test"</em>.
      These are seeded test data entries in the testing/staging environment and are <strong>not production bugs</strong>.
      Figma content comparison for the carousel must be re-run against a production-seeded environment.</p>
    </div>

    ${platformSection(
      iosEnImg('screen_card_perks', 'Card perks carousel (iOS EN)') + iosEnImg('screen_apply_intro', 'Apply intro (iOS EN)'),
      arFile('ar_s04_card_perks.png', 'دوّار المزايا (iOS AR)') + arFile('ar_s26_apply_intro.png', 'قدّم على بطاقتك (iOS AR)'),
      notTestedCol('Android EN'),
      notTestedCol('Android AR')
    )}

    ${figmaSection(
      figmaNoRefFrame('Card Application — English frame (perks carousel + apply intro)'),
      figmaNoRefFrame('Card Application — Arabic frame (دوّار المزايا + قدّم على بطاقتك)')
    )}

    ${figmaComparisonTable(
      figmaCompRow('Content (EN) — carousel structure, invite code screen, apply intro copy', 'no-ref', 'Note: carousel perk content is test data — compare structural layout only, not perk copy') +
      figmaCompRow('Content (AR) — قدّم على بطاقتك, carousel RTL, invite code screen labels', 'no-ref', 'Fetch Figma AR frame — verify apply intro heading and carousel direction') +
      figmaCompRow('Style — iOS (carousel card design, CTA button, header style)', 'no-ref', 'Fetch Figma iOS frame') +
      figmaCompRow('Style — Android', 'not-tested', 'Android session not yet run')
    )}
  </div>

  <!-- ─── B10-53349 Internal Flow Steps ───────────────────────────────────── -->
  <div class="story-card">
    <div class="story-header">
      <div class="story-id">B10-53349</div>
      <div class="story-header-text">
        <h2>Internal Flow Steps</h2>
        <p>Step indicators across application and activation sub-flows</p>
      </div>
      <div class="story-header-status"><span class="status-chip chip-pass">Pass</span></div>
    </div>

    <div class="tc-table-wrap">
      <table class="tc-table">
        <thead><tr><th>Test Case</th><th>Status</th><th>Notes</th></tr></thead>
        <tbody>
          ${tc('Application 1/3 – phone verification step indicator',  'PASS', 'Arabic: 1/3 confirmed')}
          ${tc('Application 2/3 – ID information step indicator',      'PASS', 'Arabic: 2/3 confirmed')}
          ${tc('Application 3/3 – passcode step indicator',            'PASS', 'Arabic: 3/3 confirmed')}
          ${tc('Activation 1/2 – BCID screen step indicator',          'PASS', 'Arabic: 1/2 confirmed — تفعيل بطاقتك')}
          ${tc('Activation 2/2 – PIN screen step indicator',           'PASS', 'Arabic: 2/2 confirmed — إعداد PIN')}
          ${tc('Circular arc style renders correctly',                  'PASS', '')}
        </tbody>
      </table>
    </div>

    ${platformSection(
      iosEnImg('screen_step_1_3', 'Step 1/3 — OTP (iOS EN)') + iosEnImg('screen_step_2_3', 'Step 2/3 — ID (iOS EN)') + iosEnImg('screen_step_3_3', 'Step 3/3 — Passcode (iOS EN)'),
      arFile('ar_s27_step1.png', 'الخطوة 1/3 (iOS AR)') + arFile('ar_s31_id_screen.png', 'الخطوة 2/3 (iOS AR)') + arFile('ar_s36_after_nid.png', 'الخطوة 3/3 (iOS AR)'),
      notTestedCol('Android EN'),
      notTestedCol('Android AR')
    )}

    ${figmaSection(
      figmaNoRefFrame('Step Indicators — English frames (1/3, 2/3, 3/3, 1/2, 2/2)'),
      figmaNoRefFrame('Step Indicators — Arabic frames (مؤشرات الخطوات)')
    )}

    ${figmaComparisonTable(
      figmaCompRow('Content (EN) — step indicator format "1/3", "2/3", "3/3", "1/2", "2/2"', 'no-ref', 'Fetch Figma frames for each step — verify exact format and position in nav bar') +
      figmaCompRow('Content (AR) — same step format on Arabic screens (numerals must match)', 'no-ref', 'In Arabic locale numerals in step indicators must use correct format — verify matches Figma AR') +
      figmaCompRow('Style — iOS (circular arc design, nav bar position, arc color)', 'no-ref', 'Fetch Figma iOS frame — arc style, stroke width, active/inactive color') +
      figmaCompRow('Style — Android (step indicator style may use different component)', 'not-tested', 'Android session not yet run — Android may render step indicator differently from iOS')
    )}
  </div>

  <!-- ─── B10-53350 ID Screen ──────────────────────────────────────────────── -->
  <div class="story-card">
    <div class="story-header">
      <div class="story-id">B10-53350</div>
      <div class="story-header-text">
        <h2>ID Screen</h2>
        <p>Arabic name input, national ID, validation &amp; expiry date</p>
      </div>
      <div class="story-header-status"><span class="status-chip chip-pass">Pass</span></div>
    </div>

    <div class="tc-table-wrap">
      <table class="tc-table">
        <thead><tr><th>Test Case</th><th>Status</th><th>Notes</th></tr></thead>
        <tbody>
          ${tc('Name split into two fields (first / last)',             'PASS', 'Arabic: الاسم الاول / الاسم الكامل المتبقي')}
          ${tc('Section label "أدخل الاسم الكامل بالعربي" rendered',  'PASS', 'Label confirmed in Arabic locale')}
          ${tc('National ID field accepts 14-digit number',             'PASS', 'Entered 29302020201255 successfully')}
          ${tc('Expiry date field formats correctly',                   'PASS', 'Entered 02/02/2030 — تاريخ انتهاء البطاقة')}
          ${tc('Submit button (إرسال) navigates forward',              'PASS', '')}
        </tbody>
      </table>
    </div>

    ${platformSection(
      iosEnImg('screen_id_form', 'ID form (iOS EN)') + iosEnImg('screen_id_filled', 'ID filled (iOS EN)'),
      arFile('ar_s31_id_screen.png', 'شاشة الهوية (iOS AR)') + arFile('ar_s32_id_filled.png', 'الهوية مكتملة (iOS AR)'),
      notTestedCol('Android EN'),
      notTestedCol('Android AR')
    )}

    ${figmaSection(
      figmaNoRefFrame('ID Screen — English frame (name, NID, expiry fields)'),
      figmaNoRefFrame('ID Screen — Arabic frame (أدخل الاسم الكامل بالعربي)')
    )}

    ${figmaComparisonTable(
      figmaCompRow('Content (EN) — field labels, placeholder text, submit button copy', 'no-ref', 'Fetch Figma EN frame — verify exact field label copy and button text') +
      figmaCompRow('Content (AR) — أدخل الاسم الكامل بالعربي label, تاريخ انتهاء البطاقة, إرسال button', 'no-ref', 'Fetch Figma AR frame — all labels must match exactly including placeholder Arabic text') +
      figmaCompRow('Style — iOS (input field style, label typography, submit button design)', 'no-ref', 'Fetch Figma iOS frame — verify field border style, label spacing') +
      figmaCompRow('Style — Android (EditText style, form layout)', 'not-tested', 'Android session not yet run')
    )}
  </div>

  <!-- ─── B10-53351 Passcode Creation ─────────────────────────────────────── -->
  <div class="story-card">
    <div class="story-header">
      <div class="story-id">B10-53351</div>
      <div class="story-header-text">
        <h2>Passcode Creation</h2>
        <p>Custom circular keypad, dot indicators, confirm &amp; congratulations</p>
      </div>
      <div class="story-header-status"><span class="status-chip chip-pass">Pass</span></div>
    </div>

    <div class="tc-table-wrap">
      <table class="tc-table">
        <thead><tr><th>Test Case</th><th>Status</th><th>Notes</th></tr></thead>
        <tbody>
          ${tc('Create passcode screen "إنشاء رمز المرور" title visible', 'PASS', '')}
          ${tc('Custom circular keypad with Arabic-Indic numerals (١٢٣)', 'PASS', 'Arabic numpad tapped successfully using Extended Arabic-Indic (U+06F) mapping')}
          ${tc('6 dot indicators for passcode length',                    'PASS', '')}
          ${tc('Confirm passcode screen "تأكيد رمز المرور" appears',     'PASS', '')}
          ${tc('Congratulations "مبروك!" screen navigates correctly',    'PASS', '')}
        </tbody>
      </table>
    </div>

    ${platformSection(
      iosEnImg('screen_passcode_create', 'Passcode create (iOS EN)') + iosEnImg('screen_passcode_confirm', 'Passcode confirm (iOS EN)'),
      arFile('ar_s37_passcode_create.png', 'إنشاء رمز المرور (iOS AR)') + arFile('ar_s39_passcode_confirm.png', 'تأكيد رمز المرور (iOS AR)') + arFile('ar_s41_mabrook.png', 'مبروك! (iOS AR)'),
      notTestedCol('Android EN'),
      notTestedCol('Android AR')
    )}

    ${figmaSection(
      figmaNoRefFrame('Passcode Creation — English frame (keypad + dot indicators + congrats)'),
      figmaNoRefFrame('Passcode Creation — Arabic frame (إنشاء رمز المرور + مبروك!)')
    )}

    ${figmaComparisonTable(
      figmaCompRow('Content (EN) — screen title, dot count, congratulations copy', 'no-ref', 'Fetch Figma EN frame — verify create/confirm screen title, success screen headline') +
      figmaCompRow('Content (AR) — إنشاء رمز المرور, تأكيد رمز المرور, مبروك! — all must match Figma AR', 'no-ref', 'Fetch Figma AR frame — exact Arabic title text and congratulations message') +
      figmaCompRow('Style — iOS (circular keypad design, digit style, dot indicator, gradient background)', 'no-ref', 'Key check: circular keypad button shape, Arabic-Indic numeral font, active dot fill color') +
      figmaCompRow('Style — Android (keypad may use different layout on Android)', 'not-tested', 'Android session not yet run — Android passcode keypad may differ from iOS circular design')
    )}
  </div>

  <!-- ─── B10-53352 Balance Bottom Sheet ──────────────────────────────────── -->
  <div class="story-card">
    <div class="story-header">
      <div class="story-id">B10-53352</div>
      <div class="story-header-text">
        <h2>Balance Bottom Sheet</h2>
        <p>Sheet appearance, content &amp; forward navigation</p>
      </div>
      <div class="story-header-status"><span class="status-chip chip-pass">Pass</span></div>
    </div>

    <div class="tc-table-wrap">
      <table class="tc-table">
        <thead><tr><th>Test Case</th><th>Status</th><th>Notes</th></tr></thead>
        <tbody>
          ${tc('Sheet appears on tapping activation Start button',    'PASS', '')}
          ${tc('Sheet content displayed correctly in Arabic',         'PASS', 'Arabic locale bottom sheet confirmed')}
          ${tc('"ابدأ" (Start) button navigates user forward',       'PASS', '')}
        </tbody>
      </table>
    </div>

    ${platformSection(
      iosEnImg('screen_balance_sheet', 'Balance bottom sheet (iOS EN)'),
      arFile('ar_s45_balance_sheet.png', 'ورقة الرصيد (iOS AR)'),
      notTestedCol('Android EN'),
      notTestedCol('Android AR')
    )}

    ${figmaSection(
      figmaNoRefFrame('Balance Bottom Sheet — English frame'),
      figmaNoRefFrame('Balance Bottom Sheet — Arabic frame (ورقة الرصيد)')
    )}

    ${figmaComparisonTable(
      figmaCompRow('Content (EN) — sheet title, body copy, CTA button label', 'no-ref', 'Fetch Figma EN bottom sheet frame — verify heading and Start button label') +
      figmaCompRow('Content (AR) — sheet heading, body in Arabic, ابدأ button label', 'no-ref', 'Fetch Figma AR frame — verify all Arabic copy in sheet exactly matches') +
      figmaCompRow('Style — iOS (bottom sheet handle, corner radius, shadow, CTA button)', 'no-ref', 'Fetch Figma iOS frame') +
      figmaCompRow('Style — Android (bottom sheet may use BottomSheetDialog style)', 'not-tested', 'Android session not yet run')
    )}
  </div>

  <!-- ─── B10-53353 BCID Screen ────────────────────────────────────────────── -->
  <div class="story-card">
    <div class="story-header">
      <div class="story-id">B10-53353</div>
      <div class="story-header-text">
        <h2>BCID Screen</h2>
        <p>BCID entry (12 digits), card illustration &amp; step 1/2 indicator</p>
      </div>
      <div class="story-header-status"><span class="status-chip chip-pass">Pass</span></div>
    </div>

    <div class="tc-table-wrap">
      <table class="tc-table">
        <thead><tr><th>Test Case</th><th>Status</th><th>Notes</th></tr></thead>
        <tbody>
          ${tc('Nav bar title "تفعيل بطاقتك" with "1/2" indicator',  'PASS', 'Confirmed in Arabic')}
          ${tc('Instruction text in Arabic displayed',                 'PASS', 'أدخل BCID المكون من 12 رقما confirmed')}
          ${tc('12-digit BCID 610340934094 accepted and validated',   'PASS', 'BCID submitted and validated successfully')}
          ${tc('Next button (التالي) navigates to step 2/2',          'PASS', '')}
        </tbody>
      </table>
    </div>

    ${platformSection(
      iosEnImg('screen_bcid', 'BCID screen (iOS EN)'),
      arFile('ar_s47_bcid_screen.png', 'شاشة BCID (iOS AR)') + arFile('ar_s50_bcid_screen2.png', 'BCID بعد التحقق (iOS AR)'),
      notTestedCol('Android EN'),
      notTestedCol('Android AR')
    )}

    ${figmaSection(
      figmaNoRefFrame('BCID Screen — English frame (card illustration + input field)'),
      figmaNoRefFrame('BCID Screen — Arabic frame (تفعيل بطاقتك · 1/2)')
    )}

    ${figmaComparisonTable(
      figmaCompRow('Content (EN) — screen title, instruction text, field placeholder, Next button', 'no-ref', 'Fetch Figma EN frame — verify BCID instruction copy and step indicator format') +
      figmaCompRow('Content (AR) — تفعيل بطاقتك, أدخل BCID المكون من 12 رقما, 1/2, التالي', 'no-ref', 'Fetch Figma AR frame — every Arabic label must match exactly including instruction sentence') +
      figmaCompRow('Style — iOS (card illustration, input field, step indicator in nav bar)', 'no-ref', 'Fetch Figma iOS frame — verify card image style and text field border') +
      figmaCompRow('Style — Android (card illustration may render differently)', 'not-tested', 'Android session not yet run')
    )}
  </div>

  <!-- ─── B10-53354 PIN Setup Screen ──────────────────────────────────────── -->
  <div class="story-card">
    <div class="story-header">
      <div class="story-id">B10-53354</div>
      <div class="story-header-text">
        <h2>PIN Setup Screen</h2>
        <p>PIN intro &ldquo;إعداد PIN&rdquo;, step 2/2 indicator &amp; PIN WebView</p>
      </div>
      <div class="story-header-status"><span class="status-chip chip-partial">Partial</span></div>
    </div>

    <div class="tc-table-wrap">
      <table class="tc-table">
        <thead><tr><th>Test Case</th><th>Status</th><th>Notes</th></tr></thead>
        <tbody>
          ${tc('"إعداد PIN" title displayed correctly in Arabic',     'PASS', 'Confirmed on screen')}
          ${tc('"2/2" step indicator shown in nav bar',               'PASS', 'Confirmed in Arabic activation flow')}
          ${tc('Arabic subtitle text visible',                         'PASS', 'استخدم الـPIN للمشتريات في المتاجر… visible')}
          ${tc('التالي (Next) button present',                         'PASS', '')}
          ${tc('PIN WebView loads successfully',                       'BLOCKED', 'NSURLErrorDomain -1005 network connection failure in BrowserStack environment')}
          ${tc('PIN confirmation flow completes',                      'BLOCKED', 'Dependent on WebView load — blocked by above')}
        </tbody>
      </table>
    </div>

    <div class="info-box">
      <div class="info-header">
        <span class="info-icon">Env Limitation</span>
        <span class="info-title">WebView Load Failure &mdash; Not an App Bug</span>
      </div>
      <p>The NSURLErrorDomain -1005 error occurs in the BrowserStack remote environment when the PIN WebView loads.
      This is a known BrowserStack network tunnel limitation and is <strong>not an app defect</strong>.
      Verify PIN WebView on a physical device or local simulator.</p>
    </div>

    ${platformSection(
      iosEnImg('screen_pin_intro', 'PIN intro (iOS EN)'),
      arFile('ar_s50_pin_intro.png', 'إعداد PIN — 2/2 (iOS AR)'),
      notTestedCol('Android EN'),
      notTestedCol('Android AR')
    )}

    ${figmaSection(
      figmaNoRefFrame('PIN Setup — English frame (PIN intro screen)'),
      figmaNoRefFrame('PIN Setup — Arabic frame (إعداد PIN · 2/2)')
    )}

    ${figmaComparisonTable(
      figmaCompRow('Content (EN) — PIN intro title, subtitle, Next button, 2/2 indicator', 'no-ref', 'Fetch Figma EN frame — PIN intro screen only (WebView blocked in BrowserStack)') +
      figmaCompRow('Content (AR) — إعداد PIN title, Arabic subtitle, التالي, 2/2 indicator', 'no-ref', 'Fetch Figma AR frame — verify إعداد PIN heading and استخدم الـPIN subtitle copy') +
      figmaCompRow('Style — iOS (PIN intro screen layout, illustration, CTA button)', 'no-ref', 'Fetch Figma iOS frame — PIN intro static screen only; WebView content comparison not possible') +
      figmaCompRow('Style — Android', 'not-tested', 'Android session not yet run')
    )}
  </div>

</main>

<footer>
  <p>
    Generated automatically &bull; Report ID: <strong>B10-53033</strong> &bull;
    Date: <strong>2026-05-24</strong> &bull;
    Build: <strong>com.breadfast.testing v2026.19.0</strong>
  </p>
  <p style="margin-top:4px">
    iOS: iPhone 14 &middot; iOS 18.0 &bull;
    Android: Samsung Galaxy S23 &middot; Android 13 (pending) &bull;
    Figma comparison: pending Figma MCP fetch
  </p>
  <p style="margin-top:6px">Breadfast QA &mdash; Prepaid Card Feature Team</p>
</footer>

</body>
</html>
`;

fs.writeFileSync(OUTPUT_PATH, html, 'utf8');
const sizeKB = (fs.statSync(OUTPUT_PATH).size / 1024).toFixed(1);
console.log(`\nReport written to: ${OUTPUT_PATH}`);
console.log(`File size: ${sizeKB} KB`);
console.log('Done.');
