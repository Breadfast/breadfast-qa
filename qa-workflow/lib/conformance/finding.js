'use strict';

/**
 * Finding — the capability-neutral finding model + deterministic aggregation.
 * ADR-003 §3.7: hoisted (generalized) from the visual-specific `computeVisualHealth`
 * / `detectVisualPatterns` (qa-platform `packages/shared/src/visual.ts`) so EVERY
 * conformance capability (visual today; accessibility / api / performance / etc.
 * later) shares one Finding shape, one health score, and one pattern grouping.
 *
 * A capability extends the base via `finding.extension` (an opaque bag) and MAY
 * supply a custom pattern-key; the health math stays identical across capabilities.
 * Zero-dependency (Node built-ins only), pure — same findings ⇒ same output.
 *
 * Contract: docs/ai/architecture/adr-003-visual-conformance-engine-plugin-aligned.md
 */

const SEVERITIES = ['critical', 'major', 'minor', 'info'];
const CONFIDENCE = ['high', 'medium', 'low'];
const SOURCES = ['deterministic', 'ai', 'ocr'];

// Kept identical to visual.ts so the generic score reproduces the visual score.
const SEVERITY_PENALTY = { critical: 25, major: 10, minor: 3, info: 0 };
const SEVERITY_RANK = { critical: 3, major: 2, minor: 1, info: 0 };

/** Deterministic severity from a magnitude ratio (delta ÷ tolerance): ≥3× ⇒ major, >1× ⇒ minor, else info. */
function severityForRatio(ratio) {
  if (ratio >= 3) return 'major';
  if (ratio > 1) return 'minor';
  return 'info';
}

/**
 * Apply defaults to a partial finding (mirrors the zod defaults in schemas.ts).
 * `subject` is the capability-neutral name of the affected thing (visual: a
 * component; a11y: an element; api: an endpoint). `location` is where it was
 * observed (visual: a screen; api: a route). `extension` carries capability
 * specifics (visual: { component, token }).
 * @returns {object} a normalized finding
 */
function normalizeFinding(f) {
  f = f || {};
  return {
    capability: f.capability || '',
    category: f.category || '',
    dimension: f.dimension || '',
    severity: f.severity || 'minor',
    subject: f.subject || '',
    location: f.location || '',
    expected: f.expected || '',
    actual: f.actual || '',
    description: f.description || '',
    recommendation: f.recommendation || '',
    confidence: f.confidence || 'medium',
    source: f.source || 'ai',
    layer: f.layer || '', // which pipeline stage produced it (e.g. "component-tree")
    sources: Array.isArray(f.sources) ? f.sources : [],
    coverageGap: f.coverageGap === true,
    needsResidual: f.needsResidual === true, // deterministic flagged it but cannot classify ⇒ AI residual
    extension: f.extension && typeof f.extension === 'object' ? f.extension : {},
  };
}

/**
 * Validate a finding. Returns { valid, errors:[{path,message}] }.
 * Only the enum/type invariants are enforced — everything else defaults.
 */
function validateFinding(f) {
  const errors = [];
  const err = (path, message) => errors.push({ path, message });
  if (!f || typeof f !== 'object' || Array.isArray(f)) return { valid: false, errors: [{ path: '', message: 'finding must be an object' }] };
  if (typeof f.capability !== 'string' || !f.capability) err('capability', 'required non-empty string');
  if (!SEVERITIES.includes(f.severity)) err('severity', 'must be one of ' + SEVERITIES.join('|'));
  if (f.confidence != null && !CONFIDENCE.includes(f.confidence)) err('confidence', 'must be one of ' + CONFIDENCE.join('|'));
  if (f.source != null && !SOURCES.includes(f.source)) err('source', 'must be one of ' + SOURCES.join('|'));
  if (f.coverageGap != null && typeof f.coverageGap !== 'boolean') err('coverageGap', 'must be boolean');
  if (f.sources != null && !Array.isArray(f.sources)) err('sources', 'must be an array');
  return { valid: errors.length === 0, errors };
}

/**
 * Deterministic health from a flat finding list. Capability-neutral: it does NOT
 * know about screens/pass-rates (those are a per-capability overlay). Coverage-gap
 * notices never penalize health (they reduce coverage, they are not defects).
 * @returns {{ total:number, bySeverity:object, byCategory:object, score:number, level:('high'|'medium'|'low') }}
 */
function computeHealth(findings) {
  const list = (findings || []).map(normalizeFinding).filter((f) => !f.coverageGap);
  const bySeverity = { critical: 0, major: 0, minor: 0, info: 0 };
  const byCategory = {};
  let penalty = 0;
  for (const f of list) {
    bySeverity[f.severity] = (bySeverity[f.severity] || 0) + 1;
    byCategory[f.category] = (byCategory[f.category] || 0) + 1;
    penalty += SEVERITY_PENALTY[f.severity] || 0;
  }
  const score = Math.max(0, Math.min(100, 100 - penalty));
  const level = score >= 80 ? 'high' : score >= 50 ? 'medium' : 'low';
  return { total: list.length, bySeverity, byCategory, score, level };
}

/** Default grouping key — capability-neutral (category · dimension · subject). */
function defaultPatternKey(f) {
  return [f.category, f.dimension || '', f.subject || ''].join('|');
}

/**
 * Group findings into recurring patterns (occurrences ≥ 2) so a shared root cause
 * is fixed once. A capability may pass a custom `keyFn` (visual keys on
 * component+token) via opts; the default keys on (category, dimension, subject).
 * Sorted by severity then occurrences then key — stable, useful output.
 */
function detectPatterns(findings, opts = {}) {
  const keyFn = typeof opts.keyFn === 'function' ? opts.keyFn : defaultPatternKey;
  const groups = new Map();
  for (const raw of findings || []) {
    const f = normalizeFinding(raw);
    if (f.coverageGap) continue;
    const k = keyFn(f);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(f);
  }
  const patterns = [];
  for (const [key, fs] of groups) {
    if (fs.length < 2) continue;
    const severity = fs.map((f) => f.severity).sort((a, b) => SEVERITY_RANK[b] - SEVERITY_RANK[a])[0];
    const rep = fs.find((f) => f.severity === severity) || fs[0];
    const locations = [...new Set(fs.map((f) => f.location).filter(Boolean))].sort();
    patterns.push({
      key,
      capability: rep.capability,
      category: rep.category,
      dimension: rep.dimension,
      subject: rep.subject,
      severity,
      occurrences: fs.length,
      locations,
    });
  }
  return patterns.sort(
    (a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || b.occurrences - a.occurrences || a.key.localeCompare(b.key),
  );
}

module.exports = {
  SEVERITIES,
  CONFIDENCE,
  SOURCES,
  SEVERITY_PENALTY,
  SEVERITY_RANK,
  severityForRatio,
  normalizeFinding,
  validateFinding,
  computeHealth,
  detectPatterns,
  defaultPatternKey,
};
