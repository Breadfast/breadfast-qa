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
import path from 'node:path';

const require = createRequire(import.meta.url);

const COMPANION_DIR = process.env.QA_COMPANION_DIR ?? 'D:\\BreadfastQA';
const FIGMA_EXPORTER_PATH =
  process.env.QA_FIGMA_EXPORTER_PATH || path.join(COMPANION_DIR, 'automation', 'helpers', 'FigmaExporter.js');

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

async function runExport(figmaUrls: string[], outDir: string, log: (l: string) => void): Promise<FigmaExportResult> {
  let Exporter: any;
  try {
    Exporter = require(FIGMA_EXPORTER_PATH);
  } catch (e) {
    return { frames: [], error: `FigmaExporter not loadable: ${(e as Error).message}` };
  }

  try {
    const fx = new Exporter();
    const fileKey: string = Exporter.fileKeyFromUrl(figmaUrls[0]);

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
      manifest = await fx.exportNodes({ fileKey, nodes, outDir, scale: 2 });
    } else {
      const pages: { id: string; name: string }[] = await fx.listPages(fileKey);
      if (!pages.length) return { fileKey, frames: [], error: 'no node-id in URL and no pages found' };
      manifest = await fx.exportPage({ fileKey, pageName: pages[0].name, outDir, scale: 2 });
    }

    const ok = manifest.filter((m) => m.file).length;
    log(`figma: exported ${ok}/${manifest.length} frame(s) from file ${fileKey} → ${outDir}`);
    return { fileKey, frames: manifest };
  } catch (e) {
    return { frames: [], error: (e as Error).message };
  }
}
