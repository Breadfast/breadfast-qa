/**
 * Figma frame export — REST API (second-chance fallback for the worker).
 *
 * Export priority in nodes.ts (analyze_figma):
 *   1. Playwright MCP Ctrl+Shift+E batch export  →  tryPlaywrightBatchExport()
 *   2. REST API via FigmaExporter.js              →  exportStoryFrames()  ← THIS FILE
 *   3. Playwright browser screenshot fallback     →  tryPlaywrightScreenshotFallback()
 *
 * ⚠️  This REST path is rate-limited aggressively on the Figma View seat —
 * Retry-After up to 77+ hours observed 2026-06-29. It is called only when the
 * Playwright batch export yields no frames (frames without designer-configured
 * export settings). See testing-process.md §4.1/§4.5.
 *
 * The per-story file key + frame node IDs come from the Figma URL in the Jira
 * ticket. Bounded by a hard timeout so a stalled call degrades gracefully;
 * never throws (returns an error string).
 */
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { companionPath } from '@qa/shared/paths';
import { figmaNodesToStructuredDump } from '@qa/shared';

const require = createRequire(import.meta.url);

const FIGMA_EXPORTER_PATH =
  process.env.QA_FIGMA_EXPORTER_PATH || companionPath('automation', 'helpers', 'FigmaExporter.js');

export interface FigmaFrame {
  id: string;
  name: string;
  file: string | null;
  bytes: number;
}
export interface FigmaExportResult {
  fileKey?: string;
  frames: FigmaFrame[];
  error?: string;
}

/** Export the frames referenced by the story's Figma URL(s) into outDir at scale 2.
 *  Hard-timeout bounded so a stalled call degrades to spec-only analysis. */
export async function exportStoryFrames(
  figmaUrls: string[],
  outDir: string,
  log: (l: string) => void,
): Promise<FigmaExportResult> {
  if (!figmaUrls.length) return { frames: [] };
  const timeoutMs = Number(process.env.QA_FIGMA_EXPORT_TIMEOUT_MS || 90000);
  return Promise.race([
    runExport(figmaUrls, outDir, log),
    new Promise<FigmaExportResult>((resolve) =>
      setTimeout(() => resolve({ frames: [], error: `figma export timed out after ${timeoutMs}ms` }), timeoutMs),
    ),
  ]);
}

/** Top-level Figma node types that represent an exportable "screen". */
const SCREEN_TYPES = new Set(['FRAME', 'SECTION', 'COMPONENT', 'COMPONENT_SET', 'GROUP', 'INSTANCE']);

/**
 * Expand any container node (PAGE/CANVAS or SECTION) among the URL-derived nodes
 * into its direct screen children, so a section like "Phase 1" yields one image
 * per screen instead of a single collapsed PNG. Leaf frames (and nodes we cannot
 * resolve) are kept as-is. Result is de-duplicated by node id, order preserved.
 */
async function expandContainers(
  fx: any,
  fileKey: string,
  nodes: { id: string; name: string }[],
  log: (l: string) => void,
): Promise<{ id: string; name: string }[]> {
  const out: { id: string; name: string }[] = [];
  for (const n of nodes) {
    let doc: any = null;
    try {
      const data = await fx._getJson(
        `https://api.figma.com/v1/files/${fileKey}/nodes?ids=${encodeURIComponent(n.id)}&depth=1`,
      );
      doc = data?.nodes?.[n.id]?.document ?? null;
    } catch {
      /* structure read failed (rate limit etc.) — fall back to exporting node as-is */
    }
    const isContainer = doc && (doc.type === 'SECTION' || doc.type === 'CANVAS');
    const kids: { id: string; name: string }[] = isContainer
      ? (doc.children ?? [])
          .filter((c: any) => SCREEN_TYPES.has(c.type))
          .map((c: any) => ({ id: c.id, name: c.name }))
      : [];
    if (kids.length) {
      log(`figma: node ${n.id} is a ${doc.type} ("${doc.name}") with ${kids.length} screen(s) — exporting children`);
      out.push(...kids);
    } else {
      out.push(n);
    }
  }
  const seen = new Set<string>();
  return out.filter((x) => (seen.has(x.id) ? false : (seen.add(x.id), true)));
}

/**
 * Producer #1 — Figma structured extraction. For each frame node, fetch its node
 * tree via REST and cache a StructuredDump (EXPECTED design side) to
 * <outDir>/extract/<nodeId>.json for the pyramid's L4/L5/L6. Best-effort +
 * bounded; never throws. Opt-in via QA_FIGMA_EXTRACT (the REST path is heavily
 * rate-limited — see file header). Returns the count cached.
 */
export async function extractFigmaStructures(
  fileKey: string,
  nodes: { id: string; name: string }[],
  outDir: string,
  log: (l: string) => void,
): Promise<number> {
  let Exporter: any;
  try {
    Exporter = require(FIGMA_EXPORTER_PATH);
  } catch (e) {
    log(`figma extract: exporter not loadable: ${(e as Error).message}`);
    return 0;
  }
  const fx = new Exporter();
  const depth = Number(process.env.QA_FIGMA_EXTRACT_DEPTH || 6);
  const dir = path.join(outDir, 'extract');
  try { mkdirSync(dir, { recursive: true }); } catch { /* ignore */ }
  const safe = (s: string) => s.replace(/[^a-z0-9]+/gi, '_');
  let n = 0;
  for (const node of nodes) {
    try {
      const data = await fx._getJson(
        `https://api.figma.com/v1/files/${fileKey}/nodes?ids=${encodeURIComponent(node.id)}&depth=${depth}`,
      );
      const doc = data?.nodes?.[node.id]?.document;
      if (!doc) continue;
      const dump = figmaNodesToStructuredDump(doc);
      writeFileSync(path.join(dir, `${safe(node.id)}.json`), JSON.stringify(dump));
      n++;
    } catch (e) {
      log(`figma extract ${node.id} failed: ${(e as Error).message}`);
    }
  }
  return n;
}

async function runExport(figmaUrls: string[], outDir: string, log: (l: string) => void): Promise<FigmaExportResult> {
  let Exporter: any;
  try {
    Exporter = require(FIGMA_EXPORTER_PATH);
  } catch (e) {
    return { frames: [], error: `FigmaExporter not loadable: ${(e as Error).message}` };
  }

  // Resolve the file key up front so it is reported even if the render/download
  // step later throws (rate limit / timeout) — the analysis should still record
  // which file was targeted rather than "File key: —".
  let fileKey: string | undefined;
  try {
    const fx = new Exporter();
    const key: string = Exporter.fileKeyFromUrl(figmaUrls[0]);
    fileKey = key;

    // Prefer the explicit frame node-ids in the URLs (one /images call, no
    // rate-limited file-structure read). Fall back to the first page's frames.
    const nodes = figmaUrls
      .map((u, i) => {
        const id = Exporter.nodeIdFromUrl(u);
        return id ? { id, name: `figma_frame_${i + 1}` } : null;
      })
      .filter(Boolean) as { id: string; name: string }[];

    let manifest: FigmaFrame[];
    if (nodes.length) {
      // A URL node-id often points at a PAGE or SECTION container (e.g. a
      // "Phase 1" section holding ~71 screen frames), not a single frame.
      // Rendering the container as one image would collapse the whole design
      // into a single PNG, so expand any container node into its top-level
      // screen children and export those; leaf frames are exported as-is.
      const expanded = await expandContainers(fx, key, nodes, log);
      manifest = await fx.exportNodes({ fileKey: key, nodes: expanded, outDir, scale: 2 });
    } else {
      const pages: { id: string; name: string }[] = await fx.listPages(key);
      if (!pages.length) return { fileKey: key, frames: [], error: 'no node-id in URL and no pages found' };
      manifest = await fx.exportPage({ fileKey: key, pageName: pages[0].name, outDir, scale: 2 });
    }

    const ok = manifest.filter((m) => m.file).length;
    log(`figma: exported ${ok}/${manifest.length} frame(s) from file ${key} → ${outDir}`);
    return { fileKey: key, frames: manifest };
  } catch (e) {
    return { fileKey, frames: [], error: (e as Error).message };
  }
}
