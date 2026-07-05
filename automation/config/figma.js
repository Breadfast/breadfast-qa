'use strict';

/**
 * Figma REST API credentials for FigmaExporter (automation/helpers/FigmaExporter.js).
 * Personal access token, scope `file_content:read`
 * (Figma → Settings → Security → Personal access tokens).
 *
 * NO token is stored in this file — it is committed and shared. Resolution order:
 *   1. FIGMA_API_TOKEN / FIGMA_TOKEN env var
 *   2. `figmaApiToken` in credentials.local.js (gitignored, per-machine)
 *   3. undefined — the caller must ask the operator (ask-never-block)
 *
 * Note: since 2026-07-30 the REST image endpoints are DEPRECATED for design export
 * (the browser-native PNG export is the only sanctioned channel — CLAUDE.md §2 STEP 2).
 * This token is for METADATA only (`version`/`lastModified`/node metadata).
 */
let local = {};
try { local = require('./credentials.local'); } catch (_) { /* env-only machine */ }

const apiToken =
  process.env.FIGMA_API_TOKEN || process.env.FIGMA_TOKEN || local.figmaApiToken || undefined;

module.exports = {
  apiToken,
  /** Throwing accessor with a fix-it hint, for callers that genuinely require the token. */
  requireApiToken() {
    if (!apiToken) {
      throw new Error(
        'Missing credential: Figma API token.\n' +
        '  -> Create one at Figma > Settings > Security > Personal access tokens (scope: file_content:read),\n' +
        '     then set env FIGMA_API_TOKEN or figmaApiToken in automation/config/credentials.local.js'
      );
    }
    return apiToken;
  },
};
