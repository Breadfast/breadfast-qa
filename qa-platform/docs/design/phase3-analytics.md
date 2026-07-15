# Phase 3 — QA Analytics (incl. Team Insights)

> Cross-run / cross-story analytics over the data Phase 1/2 already persist. **Deterministic, 0 AI invocations** (ADR-001) — pure aggregation, frozen workflow untouched. Built 2026-07-16 (certification pause lifted by the user).

## Engine
`computeAnalytics(records)` in [`analytics.ts`](../../packages/shared/src/analytics.ts) — pure. Input: one `AnalyticsRunRecord` per run (runId, story, owner, status, cost/tokens/timing + the persisted `parity` / `review` / `health` / `recommendations` snapshots + story defects). Output `AnalyticsSummary`:
- **totals** — stories (deduped), runs, completed, success rate, total cost/tokens, open/total defects.
- **averages** — parity, review confidence, story health (over runs that have them; null-safe).
- **distributions** — parity certification, story-health level, review level.
- **recommendations** — total + by category + by severity.
- **defects** — by severity + by status (deduped per story, so re-runs don't double-count).
- **trend** — chronological per-run parity/review/health series.
- **team insights** — per story-owner roll-up (runs, completed, avg health/review/parity, cost, open defects), sorted by name.

## API (read-side)
`AnalyticsService.analytics()` ([analytics.service.ts](../../apps/api/src/analytics/analytics.service.ts)) loads runs (+story+owner) and defects from SQLite, maps to records (attaching each story's defects to its first run for dedup), and delegates to the engine. Route: `GET /analytics` (guarded). Registered via `AnalyticsModule`.

## Web
`/analytics` ([page](../../apps/web/app/analytics/page.tsx)) — KPI tiles, distribution bars, recommendation/defect breakdowns, a **Team insights** table, and a chronological trend table. Nav link added to the shell.

## AI Impact Statement
New AI invocations **0** · token increase **0** · runtime negligible (in-memory aggregation over persisted rows) · derivable deterministically **yes**.

## Tests
`analytics.test.mjs` — determinism, story/defect dedup, success rate, averages, distributions, recommendation counts, team grouping/sort, chronological trend, empty-input safety.

## Notes / future
- Reads persisted `Run.*Json` directly. For large multi-tester datasets, the Phase-2 review recommended an **indexed projection** (view/table) instead of scanning JSON — deferred; fine at local-first pilot scale.
- No schema change (reuses existing columns).
