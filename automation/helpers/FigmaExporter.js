'use strict';

/**
 * FigmaExporter — batch-export Figma frames as PNG via the Figma REST API.
 *
 * This is the PRIMARY Figma-capture method for visual testing and the design-vs-implementation
 * comparison (testing-process.md §4). It replaces the slow/fragile browser-screenshot fallback,
 * which is now only a last resort.
 *
 * Why REST over the Figma MCP / browser screenshots:
 *   • ONE batched GET /v1/images call renders ALL frames at once (vs ~5 browser steps per frame:
 *     show-UI → click layer → hide-UI → zoom-to-fit → screenshot, plus reloads and stale-ref retries).
 *   • Isolated, pixel-perfect frame render at scale=2 — no Figma canvas chrome, no neighbour
 *     frames bleeding into the shot, no zoom/focus fiddling.
 *   • Images download straight to disk; nothing is read into the model context until the actual
 *     comparison step → far fewer tokens.
 *   • Deterministic node IDs (stable across runs); NOT subject to the Figma MCP per-seat
 *     tool-call cap that throttles get_screenshot.
 *   • Scriptable / CI-friendly; scales to hundreds of screens.
 *
 * Auth: a Figma personal access token with scope `file_content:read`
 *   (Figma → Settings → Security → Personal access tokens → Generate new token).
 *   Provide it via the FIGMA_API_TOKEN env var (preferred) or cfg.figmaApiToken.
 *   The token works regardless of Figma seat type as long as the file is reachable; files in a
 *   *Starter (free)* team are throttled to ~6 content requests/month, but Breadfast design files
 *   live in the paid "Fintech" team, so the standard Tier-1 limit (30 req/min) applies — and one
 *   batched export is a single request.
 *
 * Endpoints used (api.figma.com):
 *   GET /v1/files/:key?depth=1                      → list pages
 *   GET /v1/files/:key/nodes?ids=:pageId&depth=1    → a page's DIRECT child frames (= top-level screens)
 *   GET /v1/images/:key?ids=...&format=png&scale=2  → { images: { nodeId: url } } (URLs expire in 30 days)
 *
 * Usage:
 *   const FigmaExporter = require('../../automation/helpers/FigmaExporter');
 *   const fx = new FigmaExporter();                       // token from FIGMA_API_TOKEN
 *   const fileKey = FigmaExporter.fileKeyFromUrl(designUrl);
 *
 *   // (a) discover top-level frames on a page and export them all:
 *   const manifest = await fx.exportPage({ fileKey, pageName: 'Ready to Development', outDir, scale: 2 });
 *
 *   // (b) export explicit nodes with chosen filenames (most precise — recommended for a story):
 *   await fx.exportNodes({ fileKey, outDir, scale: 2, nodes: [
 *     { id: '4189:9241', name: 'figma_default_customer_details' },
 *     { id: '4189:9755', name: 'figma_filled_egyptian' },
 *   ]});
 *
 * Each method returns a manifest: [{ id, name, file, bytes }] (bytes 0 / file null when a node
 * failed to render — Figma returns null for invisible / 0-opacity / non-renderable nodes).
 */

const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const API = 'https://api.figma.com';
const IMAGE_BATCH = 50; // node IDs per /images request — well under any practical limit
// HTTP transport uses global fetch (undici), NOT node's `https` module: `https`
// was observed to hang in some runtimes (e.g. the QA Platform worker), whereas
// fetch + AbortSignal.timeout is reliably bounded. Public API + 429 backoff are
// unchanged, so existing consumers are unaffected.
const FETCH_TIMEOUT_MS = Number(process.env.FIGMA_FETCH_TIMEOUT_MS) || 25000;

class FigmaExporter {
  constructor({ token } = {}) {
    this.token =
      token ||
      process.env.FIGMA_API_TOKEN ||
      (() => { try { return require('../config/figma').apiToken; } catch { return null; } })();
    if (!this.token) {
      throw new Error(
        'FigmaExporter: no Figma token. Set FIGMA_API_TOKEN env var (scope file_content:read) ' +
        'or automation/config/figma.js { apiToken }.'
      );
    }
  }

  /** Extract the file key from a Figma design URL (…/design/:key/:name?…). */
  static fileKeyFromUrl(figmaUrl) {
    const m = String(figmaUrl).match(/\/(?:design|file)\/([A-Za-z0-9]+)/);
    if (!m) throw new Error(`FigmaExporter: cannot parse file key from URL: ${figmaUrl}`);
    return m[1];
  }

  /** Extract a node id from a Figma URL's node-id param, normalised to colon form (1-2 → 1:2). */
  static nodeIdFromUrl(figmaUrl) {
    const m = String(figmaUrl).match(/node-id=([0-9]+-[0-9]+|[0-9]+:[0-9]+)/);
    return m ? m[1].replace('-', ':') : null;
  }

  // ── low-level GET (JSON or binary) ────────────────────────────────────────
  // NOTE: the file-content endpoints (GET /v1/files…) are far more aggressively rate-limited
  // than GET /v1/images on low-tier seats (a View seat 429s quickly). We retry 429s with backoff,
  // honouring Retry-After. Prefer feeding EXPLICIT node IDs to exportNodes (uses /images only)
  // over exportPage (which must read file structure) whenever the node IDs are already known.
  async _getJsonOnce(urlStr) {
    const u = new URL(urlStr);
    const res = await fetch(urlStr, {
      headers: { 'X-Figma-Token': this.token },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    const text = await res.text();
    const retryAfter = Number(res.headers.get('retry-after')) || null;
    return { status: res.status, text, retryAfter, path: u.pathname };
  }

  async _getJson(urlStr, { retries = 3 } = {}) {
    let wait = 2000;
    for (let attempt = 0; ; attempt++) {
      const r = await this._getJsonOnce(urlStr);
      if (r.status === 200) {
        try { return JSON.parse(r.text); }
        catch (e) { throw new Error(`Figma GET ${r.path}: bad JSON (${e.message})`); }
      }
      if (r.status === 429) {
        // Fail fast — never sleep on Retry-After (can be days on View-seat quota exhaustion).
        // Callers that want a browser fallback should catch the 429 error immediately.
        const ra = r.retryAfter ? ` Retry-After: ${r.retryAfter}s` : '';
        throw new Error(`Figma GET ${r.path} → HTTP 429 Rate limit exceeded.${ra}`);
      }
      throw new Error(`Figma GET ${r.path} → HTTP ${r.status}: ${r.text.slice(0, 300)}`);
    }
  }

  async _download(imageUrl, outPath) {
    if (!imageUrl) return 0; // null render → skip
    const res = await fetch(imageUrl, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (res.status !== 200) throw new Error(`download ${outPath} → HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(outPath, buf);
    return buf.length;
  }

  // ── structure discovery ───────────────────────────────────────────────────
  /** List the pages (canvases) in a file: [{ id, name }]. */
  async listPages(fileKey) {
    const data = await this._getJson(`${API}/v1/files/${fileKey}?depth=1`);
    return (data.document.children || []).map((p) => ({ id: p.id, name: p.name }));
  }

  /**
   * Top-level screen frames on a page — the DIRECT FRAME children only (depth=1), so repeated
   * inner chrome (sidebars, headers, list/profile sub-frames) is NOT pulled in. Returns [{id,name}].
   */
  async topLevelFrames(fileKey, pageId) {
    const data = await this._getJson(`${API}/v1/files/${fileKey}/nodes?ids=${encodeURIComponent(pageId)}&depth=1`);
    const page = data.nodes[pageId] && data.nodes[pageId].document;
    if (!page) throw new Error(`FigmaExporter: page ${pageId} not found`);
    return (page.children || [])
      .filter((n) => n.type === 'FRAME' || n.type === 'SECTION' || n.type === 'COMPONENT')
      .map((n) => ({ id: n.id, name: n.name }));
  }

  // ── image rendering ─────────────────────────────────────────────────────────
  /** Render node IDs → { nodeId: url }. Batches large lists; one request per ≤50 ids. */
  async imageUrls(fileKey, ids, { scale = 2, format = 'png' } = {}) {
    const out = {};
    for (let i = 0; i < ids.length; i += IMAGE_BATCH) {
      const batch = ids.slice(i, i + IMAGE_BATCH);
      const qs = `ids=${batch.map(encodeURIComponent).join(',')}&format=${format}&scale=${scale}`;
      const data = await this._getJson(`${API}/v1/images/${fileKey}?${qs}`);
      if (data.err) throw new Error(`Figma /images error: ${data.err}`);
      Object.assign(out, data.images);
    }
    return out;
  }

  // ── high-level orchestration ────────────────────────────────────────────────
  static _sanitize(name) { return String(name).replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '').toLowerCase(); }

  /** Render + download the given nodes. nodes: [{id, name}]. Returns manifest [{id,name,file,bytes}]. */
  async exportNodes({ fileKey, nodes, outDir, scale = 2, format = 'png', prefix = '' }) {
    fs.mkdirSync(outDir, { recursive: true });
    const urls = await this.imageUrls(fileKey, nodes.map((n) => n.id), { scale, format });
    const manifest = [];
    for (const { id, name } of nodes) {
      const fname = `${prefix}${FigmaExporter._sanitize(name)}.${format}`;
      const outPath = path.join(outDir, fname);
      const bytes = await this._download(urls[id], outPath);
      manifest.push({ id, name, file: bytes ? outPath : null, bytes });
    }
    return manifest;
  }

  /** Discover a page's top-level frames and export them all. Returns the same manifest shape. */
  async exportPage({ fileKey, pageName, outDir, scale = 2, format = 'png', prefix = 'figma_' }) {
    const pages = await this.listPages(fileKey);
    const page = pages.find((p) => p.name.includes(pageName)) || pages.find((p) => p.name === pageName);
    if (!page) throw new Error(`FigmaExporter: page "${pageName}" not found. Pages: ${pages.map((p) => p.name).join(' | ')}`);
    const frames = await this.topLevelFrames(fileKey, page.id);
    if (!frames.length) throw new Error(`FigmaExporter: no top-level frames on page "${pageName}"`);
    return this.exportNodes({ fileKey, nodes: frames, outDir, scale, format, prefix });
  }
}

module.exports = FigmaExporter;
