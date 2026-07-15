# Phase 4 — Coverage Matrix

> Cross-story coverage view built by **reusing** each run's Platform Parity Certification. **Deterministic, 0 AI invocations** (ADR-001). Built 2026-07-16.

## Engine
`computeCoverageMatrix(stories)` in [`coverage.ts`](../../packages/shared/src/coverage.ts) — pure. Input: one `CoverageStoryRecord` per story (its latest parity-bearing run's `ParityCertification` + test-case count). Output `CoverageMatrix`:
- **rows** (per story, sorted by key): AC coverage %, combo coverage % (executed/required), automation coverage % ((cases−unautomated)/cases), visual coverage % ((required−missingVisual)/required), certified flag, and a plain-language `gaps` list. Unmeasured dimensions are `null` (e.g. AC coverage when no citations exist; visual when no Figma frames).
- **overall** — stories, certified count, and averaged AC/combo/automation/visual coverage.
- **gaps** — counts of stories with missing AC / combos / automation / visual.

Reuses the Run Evaluation engine's parity output verbatim — no re-derivation of coverage logic.

## API (read-side)
`AnalyticsService.coverage()` picks each story's latest run that carries a `parityJson`, plus `_count.testCases`, and delegates to the engine. Route: `GET /coverage` (guarded).

## Web
`/coverage` ([page](../../apps/web/app/coverage/page.tsx)) — overall KPI tiles + a per-story matrix table (AC / combos / automation / visual color-graded, certification chip, gaps). Nav link added.

## AI Impact Statement
New AI invocations **0** · token increase **0** · runtime negligible · derivable deterministically **yes**.

## Tests
`coverage.test.mjs` — determinism + key sort, per-story derivation from parity, certified full-coverage, null-safety for stories without a run, overall roll-up + gap counts.

## Notes
- No schema change (reuses `parityJson` + `Story.testCases` count).
- A story with no completed (parity-bearing) run appears with null/zero coverage until it runs.
