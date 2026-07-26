'use strict';

/**
 * L3 · Visibility — a matched REQUIRED component that is present but has
 * zero/negative bounds ⇒ MAJOR (present-but-not-visible). Relocated from
 * qa-platform `pyramid.ts` `layerVisibility`. Reads `expected.components` vs
 * `actual.elements`; dormant without expected components. Pure.
 */

const { matchAll, label } = require('./components');

function compareVisibility(expected, actual, ctx = {}) {
  const expComponents = (expected && expected.components) || [];
  if (!expComponents.length) return [];
  const els = (actual && actual.elements) || [];
  const screen = ctx.screen || ctx.location || '';
  const out = [];
  for (const m of matchAll(expComponents, els)) {
    if (!m.actual || !m.exp.required) continue;
    const b = m.actual.bounds;
    if (b && (b.width <= 0 || b.height <= 0)) {
      out.push({
        category: 'states',
        dimension: 'component-visibility',
        severity: 'major',
        subject: label(m.exp),
        location: screen,
        expected: 'visible (non-zero bounds)',
        actual: `${b.width}×${b.height}`,
        description: `"${label(m.exp)}" is present but not visible (zero-area bounds).`,
        recommendation: `Ensure "${label(m.exp)}" is visible.`,
        confidence: 'high',
        extension: { component: label(m.exp) },
      });
    }
  }
  return out;
}

module.exports = { compareVisibility };
