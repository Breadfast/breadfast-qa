/**
 * Unified frame↔screenshot resolver (BACKLOG-002 VT1-S1, ADR-002 Rev.2 §1/§4-L1).
 *
 * The single pairing authority, replacing the two divergent heuristics
 * (`bestShot` always-returns + `matchExpected` case-anchored). Precedence:
 *   1. Registry-first — deterministic `screenId` equality (confidence 1).
 *   2. Heuristic — normalized token overlap, gated by a confidence floor.
 *   3. Abstain — a coverage gap (shot = null); NEVER force-pairs.
 *
 * Browser-safe + pure (no fs, no node:path) so it is unit-testable and shared by
 * the AI data path and the report embed. The registry (`screenId`) branch is
 * built here but stays dormant until the Evidence Manifest wires screenIds (VT2)
 * and registry data exists (DEC-3).
 */

/** Minimum fraction of a frame's tokens that must appear in the shot name. */
export const DEFAULT_MATCH_FLOOR = 0.3;

export interface FrameRef {
  name: string;
  file?: string; // Figma frame image path (Expected evidence)
  nodeId?: string;
  screenId?: string; // set once the registry resolves nodeId → screenId (VT2+)
}

export interface ShotRef {
  path: string; // actual screenshot path
  screenId?: string; // set once the manifest carries identity (VT2+)
}

export type PairMethod = 'registry' | 'heuristic' | 'none';

export interface ResolvedPair {
  frame: FrameRef;
  shot: ShotRef | null; // null ⇒ coverage gap (no confident pair)
  confidence: number; // 0..1
  method: PairMethod;
  coverageGap: boolean;
}

export interface ResolveOptions {
  floor?: number; // confidence floor for the heuristic branch (default DEFAULT_MATCH_FLOOR)
}

function tokens(s: string): string[] {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
}

/** Basename without extension — pure (no node:path), handles / and \ separators. */
function baseNameNoExt(p: string): string {
  const base = p.split(/[\\/]/).pop() ?? p;
  return base.replace(/\.[a-z0-9]+$/i, '');
}

/**
 * Heuristic confidence that `shotPath` is the actual screenshot for `frameName`:
 * the fraction of the frame's tokens that also appear in the shot basename (0..1).
 */
export function pairConfidence(frameName: string, shotPath: string): number {
  const ft = tokens(frameName);
  if (!ft.length) return 0;
  const st = new Set(tokens(baseNameNoExt(shotPath)));
  const matched = ft.filter((t) => st.has(t)).length;
  return matched / ft.length;
}

/**
 * Resolve the best actual screenshot for one Figma frame. Deterministic:
 * registry match first, then the highest-confidence heuristic pair that meets
 * the floor, otherwise abstain.
 *
 * TIE-BREAKING RULE (for maintainers): the heuristic scan uses a STRICT `>`
 * comparison (`c > bestScore`), so when two or more shots have equal confidence
 * the FIRST one in `shots` iteration order wins — later equal-scoring shots do
 * NOT replace it. Pairing is therefore fully determined by the caller's `shots`
 * ordering. Callers MUST pass `shots` in a stable order (e.g. sorted by path, or
 * the manifest's row order) so results are reproducible across runs; do not rely
 * on filesystem enumeration order. The registry branch has no ties (identity is
 * unique). Changing `>` to `>=` would flip this to "last wins" — don't, without
 * updating this note and the resolver tests.
 */
export function resolvePair(frame: FrameRef, shots: ShotRef[], opts: ResolveOptions = {}): ResolvedPair {
  const floor = opts.floor ?? DEFAULT_MATCH_FLOOR;

  // 1) Registry-first — deterministic identity match.
  if (frame.screenId) {
    const hit = shots.find((s) => s.screenId && s.screenId === frame.screenId);
    if (hit) return { frame, shot: hit, confidence: 1, method: 'registry', coverageGap: false };
  }

  // 2) Heuristic — best token-overlap confidence, gated by the floor.
  let best: ShotRef | null = null;
  let bestScore = 0;
  for (const s of shots) {
    const c = pairConfidence(frame.name, s.path);
    if (c > bestScore) {
      bestScore = c;
      best = s;
    }
  }
  if (best && bestScore >= floor) {
    return { frame, shot: best, confidence: bestScore, method: 'heuristic', coverageGap: false };
  }

  // 3) Abstain — coverage gap, never a forced pair.
  return { frame, shot: null, confidence: bestScore, method: 'none', coverageGap: true };
}
