---
name: qa-validate
description: >-
  Post-Development QA (Workflow 2, implementation-validation). Use when validating a delivered
  implementation of a Jira story. FIRST reconciles the shift-left baseline (reuses requirements/
  figma-analysis/clarifications/impact/HLS unless the story or design changed), then runs test-case
  generation, BrowserStack import, automation, execution (4 combos), visual testing, defect reporting,
  and the QA summary. Takes a Jira ticket key (e.g. B10-56729).
---

# qa-validate — entrypoint

> **Thin entrypoint** (the only Claude-Code-specific glue; discarded when QA migrates into the
> breadfast-workflow plugin). Workflow + skills live under `qa-workflow/`.

## What to do
1. Determine the **ticket** (e.g. `B10-56729`) and optional `appUrl` / `mobileAppIds`.
2. Execute **[`qa-workflow/workflows/qa-implementation-validation.md`](../../../qa-workflow/workflows/qa-implementation-validation.md)** exactly:
   - **Reconcile first** (`qa-cli.js reconcile`): reuse the shift-left baseline; regenerate only the
     stale set (+ cascade); on **conflicts** (hand-edit + source change) STOP and ask; never overwrite edits.
     If no baseline exists, run `qa-shift-left` first.
   - Then run execution phases as subagents (test-cases → BrowserStack → automation → execution →
     visual-testing → defects → QA summary), recording + validating each artifact.
3. Report the QA summary (functional + visual results, coverage, risks, Pass / Pass-with-risks / Fail).

## Guardrails
- Authoritative methodology: `docs/ai/QA_PROCESS.md`; reuse contract: `docs/ai/architecture/qa-artifact-contract.md`.
- Execution runs end-to-end after Reconcile; pause only for a genuine blocker or a reconcile conflict.
- Filing Jira bugs / BrowserStack uploads are outward actions — do them per the story process.
