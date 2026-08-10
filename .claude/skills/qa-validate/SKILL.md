---
name: qa-validate
description: >-
  Post-Development QA (Workflow 2, implementation-validation). Use when validating a delivered
  implementation of a Jira story. FIRST reconciles the shift-left baseline — requirements/
  figma-analysis/clarifications/impact/HLS AND the approved test cases, their review and the
  BrowserStack import — reusing everything the story and design did not change. Then reconciles the
  test suite against what was actually built (add/update/remove, logged and re-approved), syncs
  BrowserStack, and runs automation, execution (4 combos), visual testing, defect reporting and the
  QA summary. Does NOT regenerate the suite from scratch. Takes a Jira ticket key (e.g. B10-56729).
---

# qa-validate — entrypoint

> **Thin entrypoint** (the only Claude-Code-specific glue; discarded when QA migrates into the
> breadfast-workflow plugin). Workflow + skills live under `qa-workflow/`.

## What to do
1. Determine the **ticket** (e.g. `B10-56729`) and optional `appUrl` / `mobileAppIds`.
2. Execute **[`qa-workflow/workflows/qa-implementation-validation.md`](../../../qa-workflow/workflows/qa-implementation-validation.md)** exactly:
   - **Reconcile first** (`qa-cli.js reconcile`): reuse the **eight-key** shift-left baseline — including
     `testcases`, `testcase-review` and `browserstack-import`; regenerate only the stale set (+ cascade);
     on **conflicts** (hand-edit + source change) STOP and ask; never overwrite edits.
     If no baseline exists, run `qa-shift-left` first — all of it, gates included.
   - Then run execution phases as subagents (exploratory → **test-case reconciliation** *(only if the
     suite must change)* → re-review + re-approve → BrowserStack **sync** → automation → execution →
     visual-testing → defects → QA summary), recording + validating each artifact.
3. Report the QA summary (functional + visual results, coverage, risks, Pass / Pass-with-risks / Fail),
   stating the test-case reconciliation explicitly — cases added/updated/removed and why, or "no deltas".

## Guardrails
- Authoritative methodology: `docs/ai/QA_PROCESS.md`; reuse contract: `docs/ai/architecture/qa-artifact-contract.md`.
- Execution runs end-to-end after Reconcile; pause only for a genuine blocker, a reconcile conflict, or a
  **re-approval** of test cases this run changed.
- **Do not regenerate the test suite because diffing is harder.** The approved baseline is the agreed
  coverage; changes to it are deltas with an authority, logged in `testcases/reconciliation.md`.
- BrowserStack is **synced by `TC-xxxx` id**, never re-uploaded wholesale — that duplicates the folder and
  orphans every `@TmsLink`.
- Filing Jira bugs / BrowserStack writes are outward actions — do them per the story process.
