/**
 * Knowledge Lint — Roadmap Phase 2, Milestone 8 (final).
 *
 * A DETERMINISTIC check of the `knowledge_update` proposals against the
 * documentation governance protocol (CLAUDE.md §6): does the info already exist
 * (duplicate), does it contradict existing knowledge (conflict), is it placed
 * correctly (placement), and is it well-formed (quality) — BEFORE anything is
 * persisted. Adds ZERO AI invocations (ADR-001): lexical comparison over text
 * the platform already has (docs/ai + prior proposals). Same inputs ⇒ same output.
 *
 * The linter is pure; the caller (worker `knowledge_update`) assembles the corpus
 * (existing docs/ai entries) and surfaces the verdicts for human confirmation —
 * it never auto-persists or auto-rejects; it enforces "present conflicts, ask".
 */

export interface KnowledgeProposalInput {
  docPath: string;
  summary: string;
  rationale?: string;
}

/** An existing knowledge entry to compare against (docs/ai file or prior proposal). */
export interface KnowledgeCorpusEntry {
  path: string;
  title?: string;
  text?: string;
}

export interface KnowledgeLintInput {
  proposals: KnowledgeProposalInput[];
  corpus?: KnowledgeCorpusEntry[];
  /** Allowed path roots; a proposal outside these is a placement error. */
  allowedRoots?: string[];
}

export type LintKind = 'placement' | 'duplicate' | 'conflict' | 'quality';
export type LintSeverity = 'error' | 'warning' | 'info';
export type LintVerdict = 'ok' | 'review' | 'reject';

export interface KnowledgeLintIssue {
  kind: LintKind;
  severity: LintSeverity;
  message: string;
  relatedPath?: string;
  score?: number; // similarity 0–1 where relevant
}

export interface KnowledgeLintProposal extends KnowledgeProposalInput {
  verdict: LintVerdict;
  issues: KnowledgeLintIssue[];
  similarTo?: { path: string; score: number };
}

export interface KnowledgeLintResult {
  proposals: KnowledgeLintProposal[];
  summary: {
    total: number;
    ok: number;
    review: number;
    reject: number;
    duplicates: number;
    conflicts: number;
    placementIssues: number;
  };
}

const DEFAULT_ROOTS = ['docs/ai/'];
const DUP_WARN = 0.5; // Jaccard ≥ this ⇒ likely duplicate
const CONFLICT_MIN = 0.3; // shared-topic threshold before checking contradiction markers
const CONFLICT_MARKERS = ['instead', 'no longer', 'deprecat', 'replace', 'override', 'contrary', 'supersede', 'remove', ' not '];
const GENERIC_SUMMARY = /^(update|misc|various|general|notes?|stuff|changes?)\b/i;

const STOP = new Set([
  'the', 'a', 'an', 'and', 'or', 'to', 'of', 'in', 'on', 'for', 'with', 'is', 'are', 'be', 'this', 'that',
  'it', 'as', 'at', 'by', 'from', 'into', 'when', 'per', 'via', 'new', 'add', 'use', 'used', 'should',
]);

function tokens(s: string | undefined): Set<string> {
  return new Set(
    (s ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 2 && !STOP.has(t)),
  );
}
function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}
function norm(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Lint knowledge proposals against the governance protocol. Pure + deterministic. */
export function lintKnowledgeProposals(input: KnowledgeLintInput): KnowledgeLintResult {
  const roots = input.allowedRoots?.length ? input.allowedRoots : DEFAULT_ROOTS;
  const corpus = input.corpus ?? [];
  const corpusPaths = new Set(corpus.map((c) => c.path));
  const batchSummaries = input.proposals.map((p) => norm(p.summary));

  const proposals: KnowledgeLintProposal[] = input.proposals.map((p, i) => {
    const issues: KnowledgeLintIssue[] = [];

    // 1) Placement — must live under an allowed root and be a markdown file.
    const okRoot = roots.some((r) => p.docPath.startsWith(r));
    if (!okRoot) {
      issues.push({ kind: 'placement', severity: 'error', message: `Path must live under ${roots.join(' or ')} (got "${p.docPath}").` });
    } else if (!/\.md$/i.test(p.docPath)) {
      issues.push({ kind: 'placement', severity: 'error', message: `Knowledge docs must be .md files (got "${p.docPath}").` });
    }

    // 2) Duplicate — lexical similarity vs existing knowledge.
    const propTokens = tokens(`${p.summary} ${p.rationale ?? ''}`);
    let best: { path: string; score: number } | undefined;
    for (const c of corpus) {
      const score = jaccard(propTokens, tokens(`${c.title ?? ''} ${c.text ?? ''}`));
      if (!best || score > best.score) best = { path: c.path, score };
    }
    if (best && best.score >= DUP_WARN) {
      const updatesExisting = corpusPaths.has(p.docPath);
      issues.push({
        kind: 'duplicate',
        severity: 'warning',
        message: updatesExisting
          ? `Overlaps existing "${best.path}" (score ${best.score.toFixed(2)}) — update that doc rather than duplicating.`
          : `Similar to existing "${best.path}" (score ${best.score.toFixed(2)}) — confirm this is not a duplicate.`,
        relatedPath: best.path,
        score: Number(best.score.toFixed(2)),
      });
    }

    // 3) Conflict — shares the topic AND uses contradiction language ⇒ present it.
    const lower = `${p.summary} ${p.rationale ?? ''}`.toLowerCase();
    const hasMarker = CONFLICT_MARKERS.some((m) => lower.includes(m));
    if (hasMarker && best && best.score >= CONFLICT_MIN) {
      issues.push({
        kind: 'conflict',
        severity: 'warning',
        message: `May contradict existing "${best.path}" — present the conflict and confirm precedence (governance §6).`,
        relatedPath: best.path,
        score: Number(best.score.toFixed(2)),
      });
    }

    // 4) Quality — vague/short/generic summary, missing rationale, in-batch dup.
    if (norm(p.summary).length < 15) {
      issues.push({ kind: 'quality', severity: 'warning', message: 'Summary is too short/vague to be actionable.' });
    } else if (GENERIC_SUMMARY.test(p.summary)) {
      issues.push({ kind: 'quality', severity: 'warning', message: 'Summary is generic — state the specific reusable knowledge.' });
    }
    if (!p.rationale || !p.rationale.trim()) {
      issues.push({ kind: 'quality', severity: 'info', message: 'Missing rationale (why this is reusable).' });
    }
    if (batchSummaries.indexOf(norm(p.summary)) !== i) {
      issues.push({ kind: 'quality', severity: 'warning', message: 'Duplicate of another proposal in this batch.' });
    }

    const verdict: LintVerdict = issues.some((x) => x.severity === 'error')
      ? 'reject'
      : issues.some((x) => x.severity === 'warning')
        ? 'review'
        : 'ok';

    return { ...p, issues, verdict, similarTo: best && best.score >= CONFLICT_MIN ? best : undefined };
  });

  const summary = {
    total: proposals.length,
    ok: proposals.filter((p) => p.verdict === 'ok').length,
    review: proposals.filter((p) => p.verdict === 'review').length,
    reject: proposals.filter((p) => p.verdict === 'reject').length,
    duplicates: proposals.filter((p) => p.issues.some((x) => x.kind === 'duplicate')).length,
    conflicts: proposals.filter((p) => p.issues.some((x) => x.kind === 'conflict')).length,
    placementIssues: proposals.filter((p) => p.issues.some((x) => x.kind === 'placement')).length,
  };

  return { proposals, summary };
}
