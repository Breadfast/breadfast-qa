'use strict';

/**
 * L4 · Layout — matched component's actual bounds vs expected bounds beyond a px
 * tolerance ⇒ finding, severity by magnitude (relocated from qa-platform
 * `pyramid.ts` `layerLayout`). Tolerance from `ctx.tolerances.px` (default 4).
 * Reads `expected.components` vs `actual.elements`; dormant without expected
 * components / bounds. Pure.
 */

const { matchAll, label } = require('./components');
const { severityForRatio } = require('../../../lib/conformance');

function maxBoundsDelta(a, b) {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.width - b.width), Math.abs(a.height - b.height));
}

function compareLayout(expected, actual, ctx = {}) {
  const expComponents = (expected && expected.components) || [];
  if (!expComponents.length) return [];
  const els = (actual && actual.elements) || [];
  const screen = ctx.screen || ctx.location || '';
  const px = ctx.tolerances && ctx.tolerances.px != null ? ctx.tolerances.px : 4;
  const fmt = (r) => `${r.x},${r.y} ${r.width}×${r.height}`;
  const out = [];
  for (const m of matchAll(expComponents, els)) {
    if (!m.actual || !m.actual.bounds || !m.exp.bounds) continue;
    const delta = maxBoundsDelta(m.exp.bounds, m.actual.bounds);
    if (delta > px) {
      out.push({
        category: 'layout',
        dimension: 'position',
        severity: severityForRatio(delta / Math.max(1, px)),
        subject: label(m.exp),
        location: screen,
        expected: fmt(m.exp.bounds),
        actual: fmt(m.actual.bounds),
        description: `"${label(m.exp)}" is ${Math.round(delta)}px off its expected box (tolerance ${px}px).`,
        recommendation: `Align "${label(m.exp)}" to the design bounds.`,
        confidence: 'high',
        extension: { component: label(m.exp) },
      });
    }
  }
  return out;
}

module.exports = { compareLayout, maxBoundsDelta };
