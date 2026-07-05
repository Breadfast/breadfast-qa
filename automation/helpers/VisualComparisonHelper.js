'use strict';

/**
 * VisualComparisonHelper — B10-56337 first-class visual certification against Figma.
 *
 * For each UI screen/state it: (1) exports the matching Figma frame via FigmaExporter (REST API,
 * file tvvGnEaxVjJvMWOTl4zjZC node 1-211, scale=2), (2) captures the actual Playwright screenshot,
 * and (3) writes a self-contained side-by-side HTML page (Expected | Actual) plus a manifest that
 * feeds the story's HTML report per-screen coverage matrix and visual verdict.
 *
 * The Figma export degrades gracefully: with no FIGMA_API_TOKEN (or on a Figma rate-limit) the
 * Expected pane is omitted and the actual screenshot + verdict record are still produced, so the
 * suite never hard-fails on design-tooling availability.
 *
 * Verdict values: 'PASS' | 'Minor Difference' | 'Major Difference' | 'REVIEW' (default — awaiting
 * the reviewer's per-screen visual judgement in the report).
 */

const fs   = require('fs');
const path = require('path');

// Co-located in the shared helpers folder — a relative require is cross-platform
// (no hardcoded D:\ path, which would break on macOS).
const FigmaExporter = require('./FigmaExporter');

const DEFAULT_FILE_KEY = 'tvvGnEaxVjJvMWOTl4zjZC';
const DEFAULT_NODE     = '1:211';

class VisualComparisonHelper {
  /** @param {{outDir:string, fileKey?:string, node?:string, token?:string}} opts */
  constructor({ outDir, fileKey = DEFAULT_FILE_KEY, node = DEFAULT_NODE, token } = {}) {
    if (!outDir) throw new Error('VisualComparisonHelper: outDir is required');
    this.outDir  = outDir;
    this.fileKey = fileKey;
    this.node    = node.replace('-', ':');
    this.token   = token || process.env.FIGMA_API_TOKEN;
    this.records = [];
    fs.mkdirSync(this.outDir, { recursive: true });
  }

  /** Export the expected Figma frame once and cache it. Returns the path or null if unavailable. */
  async exportExpected(label = 'edit_customer_details') {
    if (this._expectedPath !== undefined) return this._expectedPath;
    try {
      const fx = new FigmaExporter({ token: this.token });
      const manifest = await fx.exportNodes({
        fileKey: this.fileKey,
        outDir:  this.outDir,
        scale:   2,
        nodes:   [{ id: this.node, name: `figma_expected_${label}` }],
      });
      this._expectedPath = (manifest[0] && manifest[0].file) || null;
    } catch (e) {
      console.warn(`[visual] Figma export unavailable: ${e.message}`);
      this._expectedPath = null;
    }
    return this._expectedPath;
  }

  /** Capture the actual Playwright screenshot for a screen/state. Returns its path. */
  async captureActual(page, name, { fullPage = false } = {}) {
    const file = path.join(this.outDir, `actual_${VisualComparisonHelper._slug(name)}.png`);
    await page.screenshot({ path: file, fullPage });
    return file;
  }

  /**
   * Compose a screen record: export Expected (shared frame), capture Actual, write the side-by-side
   * HTML, and store it in the manifest. Returns the record.
   * @param {import('@playwright/test').Page} page
   * @param {string} name    screen/state name (e.g. "Popup 1 — store not selected")
   * @param {{verdict?:string, notes?:string, fullPage?:boolean}} opts
   */
  async compareScreen(page, name, opts = {}) {
    const expectedPath = await this.exportExpected();
    const actualPath   = await this.captureActual(page, name, { fullPage: opts.fullPage });
    const sideBySide   = this._writeSideBySide(name, { expectedPath, actualPath, verdict: opts.verdict, notes: opts.notes });
    const record = {
      screen:   name,
      expected: expectedPath ? path.basename(expectedPath) : null,
      actual:   path.basename(actualPath),
      sideBySide: path.basename(sideBySide),
      verdict:  opts.verdict || 'REVIEW',
      notes:    opts.notes || '',
    };
    this.records.push(record);
    return record;
  }

  /** Write a self-contained side-by-side HTML page (relative <img> refs, no external assets). */
  _writeSideBySide(name, { expectedPath, actualPath, verdict = 'REVIEW', notes = '' }) {
    const exp = expectedPath
      ? `<figure><figcaption>Expected (Figma ${this.node})</figcaption><img src="${path.basename(expectedPath)}"></figure>`
      : `<figure><figcaption>Expected (Figma)</figcaption><div class="missing">Figma export unavailable (set FIGMA_API_TOKEN)</div></figure>`;
    const html =
`<!doctype html><meta charset="utf-8"><title>${name}</title>
<style>
 body{font-family:system-ui,Arial,sans-serif;margin:16px;background:#fafafa}
 h1{font-size:18px} .verdict{padding:4px 10px;border-radius:6px;font-weight:600}
 .REVIEW{background:#fff3cd} .PASS{background:#d1e7dd} .Minor{background:#fff3cd} .Major{background:#f8d7da}
 .row{display:flex;gap:16px;flex-wrap:wrap} figure{margin:0;flex:1 1 45%}
 img{max-width:100%;border:1px solid #ccc} .missing{padding:40px;border:1px dashed #bbb;color:#888;text-align:center}
 figcaption{font-weight:600;margin-bottom:6px}
</style>
<h1>${name} <span class="verdict ${(verdict.split(' ')[0])}">${verdict}</span></h1>
${notes ? `<p>${notes}</p>` : ''}
<div class="row">${exp}
<figure><figcaption>Actual (Playwright)</figcaption><img src="${path.basename(actualPath)}"></figure></div>`;
    const file = path.join(this.outDir, `sidebyside_${VisualComparisonHelper._slug(name)}.html`);
    fs.writeFileSync(file, html, 'utf8');
    return file;
  }

  /** Write the visual manifest (JSON) + a coverage-matrix index.html for the story report. */
  writeReport() {
    const jsonPath = path.join(this.outDir, 'visual-manifest.json');
    fs.writeFileSync(jsonPath, JSON.stringify(this.records, null, 2), 'utf8');

    const rows = this.records.map(r =>
      `<tr><td>${r.screen}</td>
        <td>${r.expected ? `<a href="${r.expected}">expected</a>` : '—'}</td>
        <td><a href="${r.actual}">actual</a></td>
        <td><a href="${r.sideBySide}">side-by-side</a></td>
        <td class="verdict ${(r.verdict.split(' ')[0])}">${r.verdict}</td></tr>`).join('\n');
    const index =
`<!doctype html><meta charset="utf-8"><title>B10-56337 Visual Coverage</title>
<style>
 body{font-family:system-ui,Arial,sans-serif;margin:16px}
 table{border-collapse:collapse;width:100%} th,td{border:1px solid #ccc;padding:8px;text-align:left}
 .verdict{font-weight:600}
 .REVIEW{background:#fff3cd} .PASS{background:#d1e7dd} .Minor{background:#fff3cd} .Major{background:#f8d7da}
</style>
<h1>B10-56337 — Figma Visual Coverage Matrix</h1>
<table><thead><tr><th>Screen / State</th><th>Expected</th><th>Actual</th><th>Side-by-side</th><th>Verdict</th></tr></thead>
<tbody>${rows}</tbody></table>`;
    const indexPath = path.join(this.outDir, 'index.html');
    fs.writeFileSync(indexPath, index, 'utf8');
    return { jsonPath, indexPath, count: this.records.length };
  }

  static _slug(name) {
    return String(name).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  }
}

VisualComparisonHelper.DEFAULT_FILE_KEY = DEFAULT_FILE_KEY;
VisualComparisonHelper.DEFAULT_NODE = DEFAULT_NODE;
module.exports = VisualComparisonHelper;
