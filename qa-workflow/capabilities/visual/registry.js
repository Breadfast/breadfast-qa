'use strict';

/**
 * Screen Registry — loader · validator · profile/tolerance resolution.
 * Port of qa-platform `screen-registry(-loader).ts` (ADR-002 Rev.2 §6), as a
 * zero-dependency JS reader over `docs/ai/screens/*.json`. The registry maps a
 * stable `screenId` → curated `expectedComponents` + a `ValidationProfile`
 * (mode · enabledLayers · tolerances) + variants (figma node per platform×locale).
 * Files beginning with `_` (templates/examples) are NOT loaded.
 */

const fs = require('fs');
const path = require('path');

const VISUAL_LAYERS = ['identity', 'component-tree', 'visibility', 'layout', 'text', 'styles', 'pixel'];

/** Built-in default profile (used when a screen declares no `profileId`). */
const DEFAULT_PROFILE = Object.freeze({
  id: 'default',
  mode: 'design-conformance',
  enabledLayers: [...VISUAL_LAYERS],
  tolerances: { px: 2, colorDeltaE: 2, fontPx: 1, spacingPx: 2 },
});

/** Resolve the registry directory: env override → <repoRoot>/docs/ai/screens. */
function screenRegistryDir() {
  if (process.env.QA_SCREEN_REGISTRY_DIR) return process.env.QA_SCREEN_REGISTRY_DIR;
  return path.join(__dirname, '..', '..', '..', 'docs', 'ai', 'screens'); // visual → capabilities → qa-workflow → repo root
}

function normalizeTolerances(t) {
  t = t || {};
  return {
    px: t.px != null ? t.px : DEFAULT_PROFILE.tolerances.px,
    colorDeltaE: t.colorDeltaE != null ? t.colorDeltaE : DEFAULT_PROFILE.tolerances.colorDeltaE,
    fontPx: t.fontPx != null ? t.fontPx : DEFAULT_PROFILE.tolerances.fontPx,
    spacingPx: t.spacingPx != null ? t.spacingPx : DEFAULT_PROFILE.tolerances.spacingPx,
    ...(t.pixelRatio != null ? { pixelRatio: t.pixelRatio } : {}),
  };
}

function normalizeProfile(p) {
  return {
    id: p.id,
    mode: p.mode || 'design-conformance',
    enabledLayers: Array.isArray(p.enabledLayers) && p.enabledLayers.length ? p.enabledLayers : [...VISUAL_LAYERS],
    tolerances: normalizeTolerances(p.tolerances),
  };
}

/** Apply the schema default `required:true` (omitted ⇒ required). */
function normalizeComponents(components) {
  return (components || []).map((c) => ({ ...c, required: c.required !== false }));
}

/** Load + merge every non-`_` JSON in the registry dir. Missing dir ⇒ empty registry. */
function loadScreenRegistry(dir) {
  const d = dir || screenRegistryDir();
  const registry = { profiles: [], screens: [] };
  let files;
  try { files = fs.readdirSync(d); } catch { return registry; }
  for (const file of files) {
    if (file.startsWith('_') || !file.endsWith('.json')) continue;
    let json;
    try { json = JSON.parse(fs.readFileSync(path.join(d, file), 'utf8')); } catch { continue; }
    for (const p of json.profiles || []) registry.profiles.push(normalizeProfile(p));
    for (const s of json.screens || []) registry.screens.push({ ...s, expectedComponents: normalizeComponents(s.expectedComponents) });
  }
  return registry;
}

/** The ValidationProfile for a screen (its `profileId`, else the built-in default). */
function profileFor(registry, screen) {
  if (screen && screen.profileId) {
    const p = (registry.profiles || []).find((x) => x.id === screen.profileId);
    if (p) return p;
  }
  return DEFAULT_PROFILE;
}

/** Registry-validation diagnostic (errors block; warnings inform). Pure, deterministic. */
function validateRegistry(registry) {
  const issues = [];
  const seenScreen = new Set();
  for (const s of registry.screens || []) {
    if (seenScreen.has(s.id)) issues.push({ level: 'error', message: `Duplicate screenId "${s.id}"` });
    seenScreen.add(s.id);
  }
  const seenProfile = new Set();
  for (const p of registry.profiles || []) {
    if (seenProfile.has(p.id)) issues.push({ level: 'error', message: `Duplicate ValidationProfile id "${p.id}"` });
    seenProfile.add(p.id);
  }
  for (const s of registry.screens || []) {
    if (s.profileId && !seenProfile.has(s.profileId)) issues.push({ level: 'error', message: `Screen "${s.id}" references unknown profileId "${s.profileId}"` });
    if (!(s.variants && s.variants.length)) issues.push({ level: 'warning', message: `Screen "${s.id}" has no variants` });
    for (const v of s.variants || []) {
      if (!v.figmaNodeId) issues.push({ level: 'warning', message: `Screen "${s.id}" variant ${v.platform}/${v.locale} has no figmaNodeId (heuristic pairing only)` });
    }
  }
  return issues;
}

module.exports = { DEFAULT_PROFILE, VISUAL_LAYERS, screenRegistryDir, loadScreenRegistry, profileFor, validateRegistry, normalizeComponents, normalizeProfile };
