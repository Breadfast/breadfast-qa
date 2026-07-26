'use strict';

/**
 * L7 · Pixel — ADVISORY only (relocated from qa-platform `pyramid.ts` `layerPixel`).
 * Emits one info-level advisory when a PRECOMPUTED whole-image diff exceeds a
 * threshold. In design-conformance mode two render sources never pixel-align, so
 * this is never a gate — the structural layers (L2–L6) are authoritative; L7 only
 * flags gross deltas / locates regions for the residual.
 *
 * The diff itself is produced by an injected `PixelComparator` adapter (Node-only:
 * pixelmatch/pngjs — lives worker-side, NOT a qa-workflow dependency) and attached
 * as `actual.pixelDiff` (or `ctx.pixelDiff`) as `{ diffRatio:0..1, regions? }`.
 * No diff ⇒ dormant. Pure, zero-dependency.
 */

function comparePixel(expected, actual, ctx = {}) {
  const diff = (actual && actual.pixelDiff) || (ctx && ctx.pixelDiff);
  if (!diff || typeof diff.diffRatio !== 'number') return []; // no adapter output ⇒ dormant
  const threshold = ctx.tolerances && ctx.tolerances.pixelRatio != null ? ctx.tolerances.pixelRatio : 0.02;
  if (diff.diffRatio <= threshold) return [];
  const pct = Math.round(diff.diffRatio * 100);
  return [{
    category: 'layout',
    dimension: 'pixel-diff',
    severity: 'info', // advisory — never a blocker in design-conformance mode
    subject: '',
    location: ctx.screen || ctx.location || '',
    expected: 'design frame',
    actual: `${pct}% pixels differ`,
    description: `Advisory: ${pct}% of pixels differ from the design (structural layers are authoritative).`,
    recommendation: 'Review the highlighted regions.',
    confidence: 'high',
    extension: {},
  }];
}

module.exports = { comparePixel };
