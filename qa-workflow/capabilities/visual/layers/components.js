'use strict';

/**
 * L2 · Component Tree — deterministic Conformance Validator for the visual capability.
 * Relocated faithfully from qa-platform `packages/shared/src/pyramid.ts` `layerComponents`
 * (ADR-003 §3.5; methodology ADR-002 Rev.2 §3, registry-grounded — NOT a naïve
 * Figma-layer ≟ DOM-tree match). Detects the four highest-value structural defects:
 *   • missing required component      → MAJOR
 *   • duplicate (> maxCardinality)    → MAJOR
 *   • wrong ordering                  → MINOR
 *   • wrong hierarchy (parent)        → MINOR
 * Matching is by IDENTITY (test-id → role → accessible name), never by raw tree shape.
 * No expected components ⇒ dormant (returns nothing; never a false "missing").
 *
 * Reads `expected.components` (ExpectedComponent[]) vs `actual.elements`
 * (StructuredElement[]). Pure; same inputs ⇒ same findings.
 */

const label = (exp) => exp.componentId || exp.accessibleName || exp.role || 'component';

/** Identity match: strongest available signal (test-id → role → accessible name). */
function elementMatches(exp, el) {
  if (el.testId && exp.componentId) return el.testId === exp.componentId;
  if (exp.role) return (el.role || '') === exp.role;
  if (exp.accessibleName) return el.name === exp.accessibleName || el.text === exp.accessibleName;
  return false;
}

/** For each expected component: the first unused matching element + total match count. */
function matchAll(expected, els) {
  const used = new Set();
  return expected.map((exp) => {
    let idx = -1;
    let count = 0;
    els.forEach((el, i) => {
      if (!elementMatches(exp, el)) return;
      count++;
      if (idx === -1 && !used.has(i)) idx = i;
    });
    if (idx >= 0) used.add(idx);
    return { exp, actual: idx >= 0 ? els[idx] : undefined, actualIndex: idx >= 0 ? idx : undefined, matchCount: count };
  });
}

function finding(dimension, severity, exp, expected, actual, description, recommendation, location) {
  return {
    category: 'components',
    dimension,
    severity,
    subject: label(exp),
    location,
    expected: String(expected),
    actual: String(actual),
    description,
    recommendation,
    confidence: 'high',
    extension: { component: label(exp) },
  };
}

/** @returns {object[]} partial Findings (the pipeline stamps capability/layer/source). */
function compareComponents(expected, actual, ctx = {}) {
  const expComponents = (expected && expected.components) || [];
  if (!expComponents.length) return []; // dormant — no expected model, no findings
  const els = (actual && actual.elements) || [];
  const screen = ctx.screen || ctx.location || '';
  const matches = matchAll(expComponents, els);
  const out = [];

  // Missing (required) + duplicate (> maxCardinality).
  for (const m of matches) {
    if (!m.actual && m.exp.required) {
      out.push(finding('missing-component', 'major', m.exp, `${label(m.exp)} present`, 'not found',
        `Required component "${label(m.exp)}" is missing from the screen.`, `Ensure "${label(m.exp)}" renders on this screen.`, screen));
    }
    const maxCard = m.exp.maxCardinality != null ? m.exp.maxCardinality : 1;
    if (m.matchCount > maxCard) {
      out.push(finding('duplicate-component', 'major', m.exp, `at most ${maxCard}`, `${m.matchCount} found`,
        `Component "${label(m.exp)}" appears ${m.matchCount} times (expected ≤ ${maxCard}).`, `Remove the duplicate "${label(m.exp)}".`, screen));
    }
  }

  // Ordering — components with an explicit order must appear in that order.
  const ordered = matches.filter((m) => m.exp.order != null && m.actualIndex != null).sort((a, b) => a.exp.order - b.exp.order);
  for (let i = 1; i < ordered.length; i++) {
    if (ordered[i].actualIndex < ordered[i - 1].actualIndex) {
      out.push(finding('ordering', 'minor', ordered[i].exp, `after "${label(ordered[i - 1].exp)}"`, 'before it',
        `"${label(ordered[i].exp)}" appears before "${label(ordered[i - 1].exp)}" but is expected after.`, `Fix the ordering of "${label(ordered[i].exp)}".`, screen));
    }
  }

  // Hierarchy — expected parent must be the actual element's parent.
  const byId = new Map(matches.filter((m) => m.actual).map((m) => [m.exp.componentId, m.actual]));
  for (const m of matches) {
    if (!m.exp.parent || !m.actual) continue;
    const parentEl = byId.get(m.exp.parent);
    if (parentEl && parentEl.id && m.actual.parentId && m.actual.parentId !== parentEl.id) {
      out.push(finding('hierarchy', 'minor', m.exp, `child of "${m.exp.parent}"`, `parent "${m.actual.parentId}"`,
        `"${label(m.exp)}" is not nested under "${m.exp.parent}" as expected.`, `Nest "${label(m.exp)}" under "${m.exp.parent}".`, screen));
    }
  }

  return out;
}

module.exports = { compareComponents, elementMatches, matchAll, label };
