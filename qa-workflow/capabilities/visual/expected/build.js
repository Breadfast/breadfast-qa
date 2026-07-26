'use strict';

/**
 * Expected-side builder — ties the Screen Registry to Figma extraction (ADR-003
 * §3.7). Produces the `expected` screens the Conformance pipeline consumes, each
 * carrying its curated `components`, the profile's `tolerances`, and `enabledLayers`
 * so per-screen ValidationProfiles flow into L2–L7.
 *
 * Expected model per variant:
 *   • curated `expectedComponents` when the registry has them (authoritative), OR
 *   • Figma-extracted components (required:false) when uncurated and a frame node
 *     is available (via `figmaByNode`), else empty (screen falls to the residual).
 * Pure, zero-dependency.
 */

const { profileFor, normalizeComponents } = require('../registry');
const { figmaNodesToStructuredDump, structuredDumpToExpectedComponents } = require('./figma-extract');

/**
 * @param {{screens:any[],profiles:any[]}} registry
 * @param {{ figmaByNode?:Record<string,object>, platforms?:string[], locales?:string[] }} [opts]
 *        figmaByNode: figmaNodeId → raw Figma REST frame node (live/fixture export).
 * @returns {Array<{screenId,platform,locale,components,tolerances,enabledLayers}>}
 */
function expectedScreensFromRegistry(registry, opts = {}) {
  const figmaByNode = opts.figmaByNode || {};
  const out = [];
  for (const screen of registry.screens || []) {
    const profile = profileFor(registry, screen);
    for (const v of screen.variants || []) {
      if (opts.platforms && !opts.platforms.includes(v.platform)) continue;
      if (opts.locales && !opts.locales.includes(v.locale)) continue;

      let components = normalizeComponents(screen.expectedComponents || []);
      if (!components.length && v.figmaNodeId && figmaByNode[v.figmaNodeId]) {
        // Uncurated screen → derive a conservative (required:false) model from Figma.
        components = structuredDumpToExpectedComponents(
          figmaNodesToStructuredDump(figmaByNode[v.figmaNodeId], { screenId: screen.id, platform: v.platform }),
        );
      }

      out.push({
        screenId: screen.id,
        platform: v.platform,
        locale: v.locale,
        components,
        tolerances: profile.tolerances,
        enabledLayers: profile.enabledLayers,
      });
    }
  }
  return out;
}

module.exports = { expectedScreensFromRegistry };
