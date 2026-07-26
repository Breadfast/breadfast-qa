/**
 * Pixel comparator (BACKLOG-002 producer #4, ADR-002 Rev.2 §4 L7 — advisory).
 *
 * Implements the shared `PixelComparator` with pngjs (decode) + pixelmatch
 * (diff). Node-only (fs + native buffers), so it lives in the worker, not
 * browser-safe `@qa/shared`. DIMENSION-GATED: design-conformance frames (Figma
 * @2x) and device screenshots rarely share dimensions, and pixelmatch requires
 * identical dimensions — so on a size mismatch we return null (skip, advisory
 * only). Real value in regression/matched-dimension mode. Never throws.
 */
import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import type { PixelComparator, PixelDiffResult } from '@qa/shared';

export const pngPixelComparator: PixelComparator = {
  async compare(expectedImg: string, actualImg: string): Promise<PixelDiffResult | null> {
    try {
      const a = PNG.sync.read(readFileSync(expectedImg));
      const b = PNG.sync.read(readFileSync(actualImg));
      if (a.width !== b.width || a.height !== b.height) return null; // dim mismatch → skip
      const diff = new PNG({ width: a.width, height: a.height });
      const changed = pixelmatch(a.data, b.data, diff.data, a.width, a.height, { threshold: 0.1 });
      return { diffRatio: changed / (a.width * a.height) };
    } catch {
      return null; // unreadable/undecodable → skip (advisory, never fatal)
    }
  },
};
