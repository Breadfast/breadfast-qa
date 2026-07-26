'use strict';

/**
 * L5 · Text / Copy — deterministic Conformance Validator (ADR-003 §3.5; methodology
 * ADR-002 Rev.2 L5 + CLAUDE_CODE_OPERATOR §7.2). Compares expected copy vs actual
 * with the documented severity sub-class:
 *   • pure casing / whitespace / punctuation-spacing difference → MINOR
 *   • word / meaning / number / localized-string change         → MAJOR
 *   • required copy missing or empty                            → MAJOR
 * Character-for-character match after Unicode (NFC) + whitespace normalize ⇒ nothing.
 *
 * Two expected models are supported (used disjointly in practice):
 *   1. COMPONENT model (registry / pyramid-faithful): matched `expected.components`
 *      with an `accessibleName` compared to the actual element's text/name by
 *      IDENTITY (test-id → role → name) — the same match used by L2/L3/L4/L6.
 *   2. TEXTS model (convenience): `expected.texts[{subject,text}]` keyed to
 *      `actual.texts` by subject.
 * Pure; same inputs ⇒ same findings.
 */

const { matchAll, label } = require('./components');

function normStrong(s) {
  return String(s == null ? '' : s).normalize('NFC').trim().replace(/\s+/g, ' ');
}
function normCaseless(s) {
  return normStrong(s).toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

/** Classify expected vs actual copy → {dimension,severity,description} or null (match). */
function classify(expText, actText) {
  if (actText == null || String(actText) === '') {
    return { dimension: 'copy', severity: 'major', description: 'Required copy is missing or empty in the implementation.' };
  }
  if (normStrong(expText) === normStrong(actText)) return null;
  if (normCaseless(expText) === normCaseless(actText)) {
    return { dimension: 'sentence-case', severity: 'minor', description: 'Copy differs only in casing / whitespace / punctuation.' };
  }
  return { dimension: 'copy', severity: 'major', description: 'Copy text does not match the design (word / meaning / number / localized string).' };
}

function toTextList(x) {
  if (Array.isArray(x)) return x;
  if (x && Array.isArray(x.texts)) return x.texts;
  return [];
}

function finding(cls, subject, expText, actText, location) {
  return {
    category: 'content',
    dimension: cls.dimension,
    severity: cls.severity,
    subject: subject || '',
    location,
    expected: String(expText),
    actual: String(actText == null ? '' : actText),
    description: cls.description,
    recommendation: 'Align the implemented copy with the approved Figma text layer.',
    confidence: 'high',
    extension: { component: subject || '' },
  };
}

function compareText(expected, actual, ctx = {}) {
  const location = ctx.screen || ctx.location || '';
  const out = [];

  // 1. Component model — matched component.accessibleName vs actual element text/name.
  const expComponents = (expected && expected.components) || [];
  if (expComponents.length) {
    const els = (actual && actual.elements) || [];
    for (const m of matchAll(expComponents, els)) {
      if (!m.actual || m.exp.accessibleName == null || m.exp.accessibleName === '') continue;
      const actText = m.actual.text != null ? m.actual.text : m.actual.name;
      const cls = classify(m.exp.accessibleName, actText);
      if (cls) out.push(finding(cls, label(m.exp), m.exp.accessibleName, actText, location));
    }
  }

  // 2. Texts model — subject-keyed expected vs actual texts.
  const expTexts = toTextList(expected);
  if (expTexts.length) {
    const bySubject = new Map(toTextList(actual).map((a) => [a.subject, a]));
    for (const e of expTexts) {
      if (!e || e.text == null || e.text === '') continue;
      const a = bySubject.get(e.subject);
      const cls = classify(e.text, a ? a.text : undefined);
      if (cls) out.push(finding(cls, e.subject, e.text, a ? a.text : '', location));
    }
  }

  return out;
}

module.exports = { compareText, normStrong, normCaseless, classify };
