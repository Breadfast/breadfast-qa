/**
 * Evidence Manifest schema (BACKLOG-002 VT0-S3, AIP-002 Part 4).
 *
 * A thin, framework-agnostic record emitted by the automation run — one row per
 * captured screen. It carries stable identity (`screenId`) + evidence paths;
 * the engine resolves the Figma frame / validation profile / expected
 * components from the Screen Registry, so the manifest never carries Figma
 * detail. Browser-safe (no fs); re-exported through the package index.
 *
 * VT0-S3 defines the schema only. The Selenium emitter (VT2-S2), the ingester +
 * synthetic shim (VT2-S1), and the structured dump (VT3) consume/extend it.
 */
import { z } from 'zod';
import { SCREEN_PLATFORMS, type ScreenPlatform } from './screen-registry.js';

/** Conventional manifest filename the emitter writes and the ingester reads. */
export const EVIDENCE_MANIFEST_FILENAME = 'evidence-manifest.json';

/** Captured viewport size (px) — optional, used for normalization later. */
export const Viewport = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});
export type Viewport = z.infer<typeof Viewport>;

/** One captured screen. `screenId` is the identity key into the Screen Registry. */
export const EvidenceManifestRow = z.object({
  screenId: z.string(),
  platform: z.enum(SCREEN_PLATFORMS),
  locale: z.string().default('en-US'),
  screenshotPath: z.string(),
  testCaseId: z.string().optional(), // traceability to the BrowserStack/automation test case
  structuredDumpPath: z.string().optional(), // DOM/a11y or page-source dump (VT3)
  viewport: Viewport.optional(),
  dpr: z.number().positive().optional(), // device pixel ratio
  timestamp: z.string().optional(), // ISO capture time
});
export type EvidenceManifestRow = z.infer<typeof EvidenceManifestRow>;

/** Versioned envelope so the manifest format can evolve additively. */
export const EvidenceManifest = z.object({
  manifestVersion: z.number().int().positive().default(1),
  rows: z.array(EvidenceManifestRow).default([]),
});
export type EvidenceManifest = z.infer<typeof EvidenceManifest>;

/** Map any platform token to a concrete ScreenPlatform (mobile/unknown → android). */
export function toScreenPlatform(s: string): ScreenPlatform {
  const t = (s ?? '').trim().toLowerCase();
  return t === 'web' ? 'web' : t === 'ios' ? 'ios' : 'android';
}

/**
 * Build a producer-agnostic Evidence Manifest DETERMINISTICALLY from execution
 * results (VT2-S2, Option A — the AI execution flow's emitter). One row per
 * image evidence path per case; `combo` ("<platform> · <locale>") sets
 * platform/locale, `title` sets testCaseId. Recordings (.mp4/.webm) and
 * duplicate paths are skipped. `screenId` is empty until the registry maps
 * test cases → screens (DEC-3). Pure — same input ⇒ same manifest.
 */
export function buildManifestFromExecution(
  exec: { cases?: Array<{ title?: string; combo?: string; evidence?: string[]; structuredDump?: string }> } | null | undefined,
  opts: { defaultPlatform?: ScreenPlatform; defaultLocale?: string } = {},
): EvidenceManifest {
  const isImg = (p: string) => /\.(png|jpe?g|webp)$/i.test(p);
  const rows: EvidenceManifestRow[] = [];
  const seen = new Set<string>();
  for (const c of exec?.cases ?? []) {
    const parts = (c.combo ?? '').split('·').map((s) => s.trim());
    const platform = parts[0] ? toScreenPlatform(parts[0]) : (opts.defaultPlatform ?? 'web');
    const locale = parts[1] || opts.defaultLocale || 'en-US';
    let first = true; // the case's structured dump attaches to its first screenshot row (VT3)
    for (const e of c.evidence ?? []) {
      if (!isImg(e) || seen.has(e)) continue;
      seen.add(e);
      rows.push({
        screenId: '', platform, locale, screenshotPath: e, testCaseId: c.title || undefined,
        ...(first && c.structuredDump ? { structuredDumpPath: c.structuredDump } : {}),
      });
      first = false;
    }
  }
  return { manifestVersion: 1, rows };
}

/**
 * Synthesize a manifest from bare screenshot paths (VT2-S1 back-compat shim) —
 * used when no real manifest was emitted (legacy stories). `screenId` is left
 * empty (unknown identity) so downstream registry matching is skipped and
 * pairing falls back to the heuristic, exactly as before manifests existed.
 */
export function synthesizeManifest(
  shots: string[],
  opts: { platform: ScreenPlatform; locale?: string },
): EvidenceManifest {
  return {
    manifestVersion: 1,
    rows: shots.map((screenshotPath) => ({
      screenId: '',
      platform: opts.platform,
      locale: opts.locale ?? 'en-US',
      screenshotPath,
    })),
  };
}
