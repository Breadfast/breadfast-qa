'use strict';

/**
 * Figma identifier resolution (ADR-003 Decision 2). The Screen Registry stays a
 * STABLE description of each screen; the live `figmaFileKey` / `figmaNodeId` are
 * resolved at EXECUTION time from the story's Figma URL (by the exporter), not
 * hardcoded. This module extracts the fileKey from a Figma URL and enriches a loaded
 * registry's variants with live identifiers — filling ONLY placeholders / missing
 * values, so any real authored id is preserved. Pure (no fetch); the actual export
 * lives in automation/** (FigmaExporter).
 */

const PLACEHOLDER = /^(PLACEHOLDER|REPLACE)/i;

/** Extract the Figma file key from a `/design/<key>/…` or `/file/<key>/…` URL. */
function fileKeyFromUrl(url) {
  if (!url) return null;
  const m = String(url).match(/\/(?:file|design)\/([A-Za-z0-9]+)/);
  return m ? m[1] : null;
}

function isFillable(v) {
  return v == null || v === '' || PLACEHOLDER.test(String(v));
}

/**
 * Return a NEW registry with variants enriched from live Figma identifiers.
 * @param {{screens:any[]}} registry
 * @param {object} opts
 * @param {string} [opts.fileKey]                       live file key (or derive via fileKeyFromUrl)
 * @param {string} [opts.figmaUrl]                      story Figma URL → fileKey
 * @param {Record<string,string>} [opts.nodeIdByFrameName]      figmaFrameName → live nodeId
 * @param {Record<string,string>} [opts.nodeIdByScreenVariant]  "screenId|platform|locale" → live nodeId
 */
function enrichRegistryWithFigma(registry, opts = {}) {
  const fileKey = opts.fileKey || fileKeyFromUrl(opts.figmaUrl);
  const byFrame = opts.nodeIdByFrameName || {};
  const bySV = opts.nodeIdByScreenVariant || {};
  const screens = (registry.screens || []).map((s) => ({
    ...s,
    variants: (s.variants || []).map((v) => {
      const out = { ...v };
      const svKey = `${s.id}|${v.platform}|${v.locale}`;
      const liveNode = bySV[svKey] != null ? bySV[svKey] : (v.figmaFrameName != null ? byFrame[v.figmaFrameName] : undefined);
      if (fileKey && isFillable(out.figmaFileKey)) out.figmaFileKey = fileKey;
      if (liveNode != null && isFillable(out.figmaNodeId)) out.figmaNodeId = liveNode;
      return out;
    }),
  }));
  return { ...registry, screens };
}

module.exports = { fileKeyFromUrl, enrichRegistryWithFigma };
