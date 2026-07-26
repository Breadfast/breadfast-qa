/**
 * Screen Registry domain model (BACKLOG-002 VT0-S3, ADR-002 Rev.2 §6).
 *
 * The single source of truth mapping a stable, semantic `screenId` (domain
 * identity) to its Figma frames, expected components, validation profile, and
 * capture rules. `figmaNodeId` etc. live on the *variant* (platform × locale) —
 * an infrastructure detail behind the aggregate.
 *
 * This module is **browser-safe** (no fs) and re-exported through the package
 * index. The fs LOADER lives in `screen-registry-loader.ts` (subpath export
 * `@qa/shared/screen-registry-loader`), mirroring the `paths` pattern.
 *
 * VT0-S3 defines types + a pure derive helper only; consumption (pairing,
 * component checks, tolerances) lands in later VT stories.
 */
import { z } from 'zod';
import { VISUAL_LAYERS } from './schemas.js';

/** A concrete rendering target for a screen variant. */
export const SCREEN_PLATFORMS = ['web', 'ios', 'android'] as const;
export type ScreenPlatform = (typeof SCREEN_PLATFORMS)[number];

/** Comparison mode a validation profile runs in. */
export const VALIDATION_MODES = ['design-conformance', 'regression', 'hybrid'] as const;
export type ValidationMode = (typeof VALIDATION_MODES)[number];

/** A rectangular region (px), e.g. an ignore/mask area. */
export const Rect = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
});
export type Rect = z.infer<typeof Rect>;

/** Per-dimension comparison tolerances (all optional, sane defaults). */
export const Tolerances = z.object({
  px: z.number().nonnegative().default(2), // layout/bounds px tolerance
  colorDeltaE: z.number().nonnegative().default(2), // perceptual color tolerance
  fontPx: z.number().nonnegative().default(1), // font-size px tolerance
  spacingPx: z.number().nonnegative().default(2), // spacing px tolerance
});
export type Tolerances = z.infer<typeof Tolerances>;

/** Optional per-severity weight overrides (deterministic severity — VT5). */
export const SeverityWeights = z.object({
  critical: z.number().optional(),
  major: z.number().optional(),
  minor: z.number().optional(),
  info: z.number().optional(),
});
export type SeverityWeights = z.infer<typeof SeverityWeights>;

/**
 * A reusable validation profile (entity referenced by many screens via
 * `profileId`). Defaults to design-conformance with all layers enabled.
 */
export const ValidationProfile = z.object({
  id: z.string(),
  mode: z.enum(VALIDATION_MODES).default('design-conformance'),
  enabledLayers: z.array(z.enum(VISUAL_LAYERS)).default([...VISUAL_LAYERS]),
  tolerances: Tolerances.default({}),
  weights: SeverityWeights.default({}),
});
export type ValidationProfile = z.infer<typeof ValidationProfile>;

/** Capture-time rules for a variant (dynamic-content handling, settle time). */
export const CaptureRules = z.object({
  ignoreRegions: z.array(Rect).default([]),
  maskSelectors: z.array(z.string()).default([]),
  settleMs: z.number().int().nonnegative().default(0),
  requireBothLocales: z.boolean().default(false),
});
export type CaptureRules = z.infer<typeof CaptureRules>;

/** Optional approved-baseline reference (enables regression mode — VT7). */
export const BaselineRef = z.object({
  path: z.string().optional(),
  ref: z.string().optional(), // git ref / branch the baseline was approved on
  updatedAt: z.string().optional(),
});
export type BaselineRef = z.infer<typeof BaselineRef>;

/**
 * The semantic component contract compared against the actual extracted set
 * (L2, VT4-S3). Curated — not a raw Figma-layer tree.
 */
export const ExpectedComponent = z.object({
  componentId: z.string(),
  role: z.string().default(''), // aria/role or semantic role, e.g. "button", "badge"
  accessibleName: z.string().optional(),
  required: z.boolean().default(true),
  order: z.number().int().optional(),
  parent: z.string().optional(), // componentId of expected ancestor
  maxCardinality: z.number().int().positive().optional(),
  // VT4 (additive) — expected geometry/styles for L4/L6. Authored or populated by
  // Figma structured extraction (follow-up); when absent, those layers skip this
  // component (dormant, not a false pass).
  bounds: Rect.optional(),
  styles: z.record(z.string()).optional(), // e.g. { color: '#fff', 'font-size': '16px' }
});
export type ExpectedComponent = z.infer<typeof ExpectedComponent>;

/** A concrete platform × locale variant of a screen. */
export const ScreenVariant = z.object({
  platform: z.enum(SCREEN_PLATFORMS),
  locale: z.string().default('en-US'), // free-text so new locales don't break validation
  figmaFileKey: z.string().optional(),
  figmaNodeId: z.string().optional(), // the deterministic expected-frame key (progressive: may be absent)
  figmaFrameName: z.string().optional(), // human-readable, for drift detection (VT4-S7)
  baselineRef: BaselineRef.optional(),
  captureRules: CaptureRules.optional(),
});
export type ScreenVariant = z.infer<typeof ScreenVariant>;

/**
 * A logical screen — the aggregate root. Identity = `id` (stable, never
 * changes). `supportedTestCases` is intentionally NOT a field: it is a DERIVED
 * reverse-index (see `deriveSupportedTestCases`) so the test-case→screen
 * association has a single owner (the test case).
 */
export const Screen = z.object({
  id: z.string(),
  displayName: z.string().default(''),
  domain: z.string().default(''), // e.g. "perks", "address"
  owner: z.string().default(''),
  version: z.number().int().positive().default(1),
  profileId: z.string().optional(), // reference into ScreenRegistry.profiles
  expectedComponents: z.array(ExpectedComponent).default([]),
  variants: z.array(ScreenVariant).default([]),
});
export type Screen = z.infer<typeof Screen>;

/** The whole registry: reusable profiles + screens. Empty is valid. */
export const ScreenRegistry = z.object({
  profiles: z.array(ValidationProfile).default([]),
  screens: z.array(Screen).default([]),
});
export type ScreenRegistry = z.infer<typeof ScreenRegistry>;

/**
 * Derive the screenId → testCaseId[] reverse-index from test-case references.
 * Pure (no storage). This is how `supportedTestCases` is exposed without
 * duplicating the association on the Screen (ADR-002 Rev.2 §6). Ids are unique
 * and sorted for determinism; refs with an empty screenId are ignored.
 */
export function deriveSupportedTestCases(
  refs: Array<{ testCaseId: string; screenId: string }>,
): Record<string, string[]> {
  const map: Record<string, Set<string>> = {};
  for (const { testCaseId, screenId } of refs) {
    if (!screenId || !testCaseId) continue;
    (map[screenId] ??= new Set()).add(testCaseId);
  }
  const out: Record<string, string[]> = {};
  for (const [screenId, set] of Object.entries(map)) out[screenId] = [...set].sort();
  return out;
}

/** A registry-validation problem (VT4-S7). */
export interface RegistryValidationIssue {
  level: 'error' | 'warning';
  message: string;
}

/**
 * Validate a loaded registry (VT4-S7 — the pre-execution diagnostic's core).
 * Errors: duplicate `screenId`, duplicate `ValidationProfile.id`, a screen
 * referencing an unknown `profileId`. Warnings: a screen with no variants, or a
 * variant with no `figmaNodeId` (heuristic pairing only). Pure + deterministic.
 */
export function validateScreenRegistry(registry: ScreenRegistry): RegistryValidationIssue[] {
  const issues: RegistryValidationIssue[] = [];
  const seenScreen = new Set<string>();
  for (const s of registry.screens) {
    if (seenScreen.has(s.id)) issues.push({ level: 'error', message: `Duplicate screenId "${s.id}"` });
    seenScreen.add(s.id);
  }
  const seenProfile = new Set<string>();
  for (const p of registry.profiles) {
    if (seenProfile.has(p.id)) issues.push({ level: 'error', message: `Duplicate ValidationProfile id "${p.id}"` });
    seenProfile.add(p.id);
  }
  for (const s of registry.screens) {
    if (s.profileId && !seenProfile.has(s.profileId)) {
      issues.push({ level: 'error', message: `Screen "${s.id}" references unknown profileId "${s.profileId}"` });
    }
    if (!s.variants.length) issues.push({ level: 'warning', message: `Screen "${s.id}" has no variants` });
    for (const v of s.variants) {
      if (!v.figmaNodeId) {
        issues.push({ level: 'warning', message: `Screen "${s.id}" variant ${v.platform}/${v.locale} has no figmaNodeId (heuristic pairing only)` });
      }
    }
  }
  return issues;
}
