/**
 * Citation resolver — Roadmap Phase 2, Milestone 1 (Citation & Traceability
 * completion). Turns the raw `Citation` refs captured on artifacts (Phase 1
 * foundation) into resolved, human-readable, linkable provenance for the report
 * and web. Pure and deterministic — no I/O.
 *
 * Jira/BrowserStack/Figma/KB-native only (no Azure DevOps concepts).
 */
import type { Citation, CitationKind } from './schemas.js';

export interface CitationContext {
  jiraBaseUrl?: string; // e.g. https://breadfast.atlassian.net
  storyKey?: string; // the story a comment belongs to
  /** AC id → AC text, so an `ac` citation can show what it references. */
  acById?: Record<string, string>;
  /** Figma file key so a `figma` citation can deep-link. */
  figmaFileKey?: string;
  /** BrowserStack browse base (optional) for `testcase` links. */
  browserstackBaseUrl?: string;
}

export interface ResolvedCitation {
  kind: CitationKind;
  ref: string;
  /** Short chip label, e.g. "AC-3", "B10-56336", "Comment". */
  label: string;
  /** Optional hover text (e.g. the AC text). */
  title?: string;
  /** Optional external link. */
  href?: string;
}

const KIND_PREFIX: Record<CitationKind, string> = {
  story: '',
  ac: '',
  comment: 'Comment ',
  figma: 'Figma: ',
  rule: 'Rule: ',
  testcase: 'TC ',
  requirement: 'Req ',
};

const trimSlash = (u?: string) => (u ? u.replace(/\/+$/, '') : undefined);

/** Resolve one citation to a label + optional link/title using the run context. */
export function resolveCitation(c: Citation, ctx: CitationContext = {}): ResolvedCitation {
  const jira = trimSlash(ctx.jiraBaseUrl);
  const out: ResolvedCitation = {
    kind: c.kind,
    ref: c.ref,
    label: c.label?.trim() || `${KIND_PREFIX[c.kind] ?? ''}${c.ref}`,
  };
  switch (c.kind) {
    case 'story':
      if (jira) out.href = `${jira}/browse/${c.ref}`;
      break;
    case 'comment':
      out.title = `Story comment ${c.ref}`;
      if (jira && ctx.storyKey) out.href = `${jira}/browse/${ctx.storyKey}?focusedCommentId=${c.ref}`;
      break;
    case 'ac':
      if (ctx.acById?.[c.ref]) out.title = ctx.acById[c.ref];
      break;
    case 'figma':
      out.title = `Figma frame ${c.ref}`;
      if (ctx.figmaFileKey) out.href = `https://www.figma.com/design/${ctx.figmaFileKey}`;
      break;
    case 'rule':
      out.title = `Knowledge: ${c.ref}`;
      break;
    case 'testcase':
      if (trimSlash(ctx.browserstackBaseUrl)) out.href = `${trimSlash(ctx.browserstackBaseUrl)}/${c.ref}`;
      break;
    case 'requirement':
      break;
  }
  return out;
}

/** Resolve a list, skipping empties. */
export function resolveCitations(cites: Citation[] | undefined, ctx: CitationContext = {}): ResolvedCitation[] {
  return (cites ?? []).filter((c) => c && c.ref).map((c) => resolveCitation(c, ctx));
}
