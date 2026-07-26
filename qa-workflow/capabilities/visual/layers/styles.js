'use strict';

/**
 * L6 · Styles / Tokens — matched component's expected styles vs actual, normalized
 * and tolerant (relocated from qa-platform `pyramid.ts` `layerStyles`). Color via
 * ΔE, lengths via px normalization, font-family canonicalized; magnitude-based
 * severity where a ratio exists (else minor). Emits the design token as the root
 * cause. Tolerances from `ctx.tolerances` ({ colorDeltaE, px, fontPx }; defaults
 * 2 / 4 / 1). Reads `expected.components` vs `actual.elements`; dormant without
 * expected components / styles. Pure.
 */

const { matchAll, label } = require('./components');
const { severityForRatio } = require('../../../lib/conformance');
const { colorDeltaE, normalizeLength, normalizeFontFamily } = require('./normalize');

const COLOR_KEYS = /color|background|border-color|fill|stroke/i;
const LENGTH_KEYS = /size|width|height|padding|margin|radius|spacing|gap|line-height|letter-spacing/i;

function compareStyles(expected, actual, ctx = {}) {
  const expComponents = (expected && expected.components) || [];
  if (!expComponents.length) return [];
  const els = (actual && actual.elements) || [];
  const screen = ctx.screen || ctx.location || '';
  const tol = ctx.tolerances || {};
  const colorTol = tol.colorDeltaE != null ? tol.colorDeltaE : 2;
  const pxTol = tol.px != null ? tol.px : 4;
  const fontTol = tol.fontPx != null ? tol.fontPx : 1;
  const out = [];

  for (const m of matchAll(expComponents, els)) {
    if (!m.actual || !m.actual.styles || !m.exp.styles) continue;
    for (const [key, ev] of Object.entries(m.exp.styles)) {
      const av = m.actual.styles[key];
      if (av == null) continue; // can't compare — skip (dormant, not a false finding)
      let mismatch = false;
      let dim = 'style';
      let cat = 'color';
      let sev = 'minor';
      if (COLOR_KEYS.test(key)) {
        const d = colorDeltaE(ev, av);
        if (d != null && d > colorTol) { mismatch = true; sev = severityForRatio(d / Math.max(1, colorTol)); }
        dim = 'color'; cat = 'color';
      } else if (/font-family/i.test(key)) {
        mismatch = normalizeFontFamily(ev) !== normalizeFontFamily(av); dim = 'font-family'; cat = 'typography';
      } else if (LENGTH_KEYS.test(key)) {
        const a = normalizeLength(ev);
        const b = normalizeLength(av);
        const t = /font-size|line-height|letter-spacing/i.test(key) ? fontTol : pxTol;
        if (a != null && b != null && Math.abs(a - b) > t) { mismatch = true; sev = severityForRatio(Math.abs(a - b) / Math.max(1, t)); }
        dim = key; cat = /font/i.test(key) ? 'typography' : 'color';
      } else {
        mismatch = String(ev).trim() !== String(av).trim(); dim = key;
      }
      if (mismatch) {
        const kind = cat === 'typography' ? 'typography' : cat === 'color' ? 'color' : 'spacing';
        out.push({
          category: cat,
          dimension: dim,
          severity: sev,
          subject: label(m.exp),
          location: screen,
          expected: String(ev),
          actual: String(av),
          description: `"${label(m.exp)}" ${key} is "${av}" but expected "${ev}".`,
          recommendation: `Update the ${key} token on "${label(m.exp)}".`,
          confidence: 'high',
          extension: { component: label(m.exp), token: { kind, name: key, expected: ev, actual: av } },
        });
      }
    }
  }
  return out;
}

module.exports = { compareStyles };
