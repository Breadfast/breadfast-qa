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
 *
 * ── Annotated Design-Bug evidence (Phase 5 operator path) ────────────────────────────────────
 * `compareScreenWithFindings()` / `writeFindingEvidence()` produce, PER CONFIRMED FINDING, a
 * self-contained side-by-side page: the Figma crop (Expected) beside the app crop (Actual) with a
 * RED annotation (rectangle / circle / arrow) drawn on the exact issue, plus the finding record.
 * These files attach directly to the story's Design Bugs. Only confirmed defects are annotated —
 * never dynamic-data / state differences (see docs/ai/visual-testing/CLAUDE_CODE_OPERATOR.md §6).
 * No image library is required: the overlay is SVG over the <img>; a PNG for Jira can be rasterized
 * from the HTML via `rasterize(page, htmlPath, outPng)` using the existing Playwright page.
 *
 * A finding is: { id, component, category, severity, expected, actual, rootCause, recommendation,
 *                 actualBBox:{x,y,w,h}, expectedBBox?:{x,y,w,h}, shape?:'rect'|'circle'|'arrow' }
 * Bounding boxes are in the image's natural (PNG) pixel coordinates.
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

  // ── Annotated evidence (Design-Bug attachments) ───────────────────────────────────────────

  /**
   * Capture the actual screen, export the expected Figma frame, and write ONE annotated
   * side-by-side evidence file PER confirmed finding. Records the screen + findings in the manifest.
   * @param {import('@playwright/test').Page} page
   * @param {string} name  screen/state name
   * @param {{findings:Array, fullPage?:boolean, verdict?:string, crop?:boolean, expectedLabel?:string}} opts
   * @returns {Promise<{record:object, evidenceFiles:string[]}>}
   */
  async compareScreenWithFindings(page, name, opts = {}) {
    const findings = Array.isArray(opts.findings) ? opts.findings : [];
    const expectedPath = await this.exportExpected(opts.expectedLabel || VisualComparisonHelper._slug(name));
    const actualPath   = await this.captureActual(page, name, { fullPage: opts.fullPage });

    const evidenceFiles = findings.map((f) =>
      this.writeFindingEvidence(name, f, { expectedPath, actualPath, crop: opts.crop !== false }));

    const record = {
      screen:   name,
      expected: expectedPath ? path.basename(expectedPath) : null,
      actual:   path.basename(actualPath),
      verdict:  opts.verdict || (findings.length ? 'REVIEW' : 'PASS'),
      findings: findings.map((f, i) => ({
        id: f.id || `F${i + 1}`, component: f.component, category: f.category,
        severity: f.severity, expected: f.expected, actual: f.actual,
        rootCause: f.rootCause, recommendation: f.recommendation,
        evidence: path.basename(evidenceFiles[i]),
      })),
    };
    this.records.push(record);
    return { record, evidenceFiles };
  }

  /**
   * Write one annotated side-by-side evidence page for a single finding. Returns the HTML path.
   * @param {string} name screen name
   * @param {object} f    a finding (see file header)
   * @param {{expectedPath:?string, actualPath:string, crop?:boolean}} io
   */
  writeFindingEvidence(name, f, { expectedPath, actualPath, crop = true }) {
    const id  = f.id || 'F';
    const sev = String(f.severity || 'info').toLowerCase();
    const actSize = VisualComparisonHelper._pngSize(actualPath) || { w: 1000, h: 1000 };
    const expSize = expectedPath ? (VisualComparisonHelper._pngSize(expectedPath) || { w: 1000, h: 1000 }) : null;

    const actualPane = this._imagePane(path.basename(actualPath), actSize, f.actualBBox, {
      shape: f.shape || 'rect', crop, id, annotate: true,
    });
    const expectedPane = expectedPath
      ? this._imagePane(path.basename(expectedPath), expSize, f.expectedBBox, {
          shape: f.shape || 'rect', crop, id, annotate: !!f.expectedBBox,
        })
      : `<div class="missing">Figma export unavailable (set FIGMA_API_TOKEN)</div>`;

    const row = (k, v) => v ? `<tr><th>${k}</th><td>${VisualComparisonHelper._esc(v)}</td></tr>` : '';
    const html =
`<!doctype html><meta charset="utf-8"><title>${VisualComparisonHelper._esc(name)} — ${VisualComparisonHelper._esc(id)}</title>
<style>
 body{font-family:system-ui,Arial,sans-serif;margin:16px;background:#fafafa;color:#111}
 h1{font-size:17px;margin:0 0 4px} .sub{color:#666;font-size:13px;margin:0 0 12px}
 .sev{padding:2px 9px;border-radius:6px;font-weight:700;font-size:12px;text-transform:uppercase}
 .critical{background:#f8d7da;color:#842029} .major{background:#f8d7da;color:#842029}
 .minor{background:#fff3cd;color:#664d03} .info{background:#cfe2ff;color:#084298}
 .row{display:flex;gap:20px;flex-wrap:wrap;align-items:flex-start;margin:8px 0 16px}
 figure{margin:0;flex:1 1 45%;min-width:280px}
 figcaption{font-weight:700;margin-bottom:6px}
 .arrow{align-self:center;font-size:26px;color:#888}
 .missing{padding:40px;border:1px dashed #bbb;color:#888;text-align:center;border-radius:6px}
 table{border-collapse:collapse;width:100%;max-width:900px;font-size:14px}
 th,td{border:1px solid #d5d5d5;padding:7px 10px;text-align:left;vertical-align:top}
 th{background:#f2f2f2;width:150px;white-space:nowrap}
</style>
<h1>${VisualComparisonHelper._esc(f.component || name)} <span class="sev ${sev}">${sev}</span></h1>
<p class="sub">${VisualComparisonHelper._esc(name)} · ${VisualComparisonHelper._esc(id)} · ${VisualComparisonHelper._esc(f.category || '')}</p>
<div class="row">
 <figure><figcaption>Expected (Figma${this.node ? ' ' + this.node : ''})</figcaption>${expectedPane}</figure>
 <div class="arrow">⇄</div>
 <figure><figcaption>Actual (Annotated)</figcaption>${actualPane}</figure>
</div>
<table>
 ${row('Expected', f.expected)}
 ${row('Actual', f.actual)}
 ${row('Root Cause', f.rootCause)}
 ${row('Recommendation', f.recommendation)}
</table>`;
    const file = path.join(this.outDir, `evidence_${VisualComparisonHelper._slug(name)}_${VisualComparisonHelper._slug(id)}.html`);
    fs.writeFileSync(file, html, 'utf8');
    return file;
  }

  /** Build one image pane: full or cropped-to-bbox, with an optional red SVG annotation overlay. */
  _imagePane(src, size, bbox, { shape = 'rect', crop = true, id = '', annotate = true }) {
    // No bbox → show the whole image (optionally with no annotation).
    if (!bbox || !annotate) {
      return `<div style="position:relative"><img src="${src}" style="max-width:100%;border:1px solid #ccc"></div>`;
    }
    const pad = Math.round(Math.max(bbox.w, bbox.h) * 0.35) + 12;
    const bx = Math.max(0, bbox.x - pad);
    const by = Math.max(0, bbox.y - pad);
    const bw = Math.min(size.w - bx, bbox.w + 2 * pad);
    const bh = Math.min(size.h - by, bbox.h + 2 * pad);
    const svg = VisualComparisonHelper._annoSvg(bbox, shape, id);

    if (!crop) {
      // Full image, overlay spans the whole natural viewBox.
      return `<div style="position:relative;display:inline-block;max-width:100%">
<img src="${src}" style="display:block;max-width:100%;border:1px solid #ccc">
<svg style="position:absolute;inset:0;width:100%;height:100%" viewBox="0 0 ${size.w} ${size.h}" preserveAspectRatio="none">${svg}</svg></div>`;
    }
    // Cropped zoom box: img is shifted under an overflow-hidden window; SVG viewBox = crop rect.
    const DISPLAY_W = 460;
    const scale = DISPLAY_W / bw;
    const dispH = Math.round(bh * scale);
    return `<div style="position:relative;width:${DISPLAY_W}px;max-width:100%;height:${dispH}px;overflow:hidden;border:1px solid #ccc;border-radius:4px">
<img src="${src}" style="position:absolute;left:${-Math.round(bx * scale)}px;top:${-Math.round(by * scale)}px;width:${Math.round(size.w * scale)}px;max-width:none">
<svg style="position:absolute;inset:0;width:100%;height:100%" viewBox="${bx} ${by} ${bw} ${bh}" preserveAspectRatio="none">${svg}</svg></div>`;
  }

  /** Red annotation markup (in the image's natural pixel coordinates) + a numbered badge. */
  static _annoSvg(b, shape, id) {
    const sw = Math.max(2, Math.round(Math.max(b.w, b.h) * 0.03));
    const RED = '#e11900';
    let mark;
    if (shape === 'circle') {
      mark = `<ellipse cx="${b.x + b.w / 2}" cy="${b.y + b.h / 2}" rx="${b.w / 2 + sw}" ry="${b.h / 2 + sw}" fill="none" stroke="${RED}" stroke-width="${sw}"/>`;
    } else if (shape === 'arrow') {
      const tipX = b.x, tipY = b.y, tailX = b.x - b.w * 0.6 - 30, tailY = b.y - b.h * 0.6 - 30;
      const a = sw * 3;
      mark = `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" fill="none" stroke="${RED}" stroke-width="${sw}" rx="4"/>` +
             `<line x1="${tailX}" y1="${tailY}" x2="${tipX}" y2="${tipY}" stroke="${RED}" stroke-width="${sw}"/>` +
             `<polygon points="${tipX},${tipY} ${tipX - a},${tipY - a * 0.4} ${tipX - a * 0.4},${tipY - a}" fill="${RED}"/>`;
    } else {
      mark = `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" fill="none" stroke="${RED}" stroke-width="${sw}" rx="4"/>`;
    }
    const r = sw * 3.2;
    const badge = `<circle cx="${b.x}" cy="${b.y}" r="${r}" fill="${RED}"/>` +
      `<text x="${b.x}" y="${b.y + r * 0.35}" font-size="${r * 1.1}" fill="#fff" text-anchor="middle" font-family="Arial" font-weight="700">${VisualComparisonHelper._esc(String(id).replace(/^F/i, ''))}</text>`;
    return mark + badge;
  }

  /** Read a PNG's natural width/height from its IHDR (no image library). Returns null on failure. */
  static _pngSize(file) {
    try {
      const fd = fs.openSync(file, 'r');
      const buf = Buffer.alloc(24);
      fs.readSync(fd, buf, 0, 24, 0);
      fs.closeSync(fd);
      // PNG signature + IHDR: width @16, height @20 (big-endian).
      if (buf.readUInt32BE(0) !== 0x89504e47) return null;
      return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
    } catch { return null; }
  }

  /** Rasterize an evidence HTML file to a PNG (for direct Jira attachment) using a Playwright page. */
  async rasterize(page, htmlPath, outPng) {
    const out = outPng || htmlPath.replace(/\.html$/i, '.png');
    await page.goto('file://' + path.resolve(htmlPath).replace(/\\/g, '/'));
    await page.screenshot({ path: out, fullPage: true });
    return out;
  }

  static _esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  static _slug(name) {
    return String(name).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  }
}

VisualComparisonHelper.DEFAULT_FILE_KEY = DEFAULT_FILE_KEY;
VisualComparisonHelper.DEFAULT_NODE = DEFAULT_NODE;
module.exports = VisualComparisonHelper;
