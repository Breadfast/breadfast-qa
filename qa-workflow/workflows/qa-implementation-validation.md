---
name: qa-implementation-validation
type: workflow
version: 1.0
description: Post-Development QA — reconcile & reuse Pre-Dev artifacts, then validate the delivered implementation.
purpose: Reuse the shift-left baseline (regenerating only what changed), then run execution, visual, defects, and QA summary.
inputs: { ticket: required, appUrl: optional, mobileAppIds: optional }
---

# Workflow 2 — Post-Development (Implementation Validation)

**Executor:** Claude Code (agent-followed). **Methodology (source of truth):**
[`../../docs/ai/QA_PROCESS.md`](../../docs/ai/QA_PROCESS.md) Phases 4–6.
**Reuse contract + freshness:** [`../../docs/ai/architecture/qa-artifact-contract.md`](../../docs/ai/architecture/qa-artifact-contract.md) §5.
**Discipline:** once scope is locked (Reconcile), execution runs **end-to-end without stopping** except
for a genuine blocker (unknown OTP/BCID, required backend status change, content not found).

> **Execution model:** read-heavy phases run as **subagents** returning artifacts by path; the
> orchestrator shuttles paths + summaries + `qa-state.json`. Skill bodies live in `../skills/<name>/SKILL.md`.

## Step −1 · Prerequisite Gate (`detect-prerequisites`) ⟵ **runs FIRST, before Reconcile**
Run [`../skills/detect-prerequisites/SKILL.md`](../skills/detect-prerequisites/SKILL.md) inline.
Enumerate every input this run needs (access, destinations, targets, test data, backend state, design,
locale scope), verify each access item with **one real authenticated call**, and **ask the operator in a
single batch** for whatever is missing. Write `prerequisites.md` into the story folder.

**Never report a step as blocked without having asked first.** Added 2026-07-26 because B10-56750
shipped two avoidable "blocked" outcomes (a BrowserStack upload that was actually a wrong-API-version
bug on our side, and an AC that only needed test data seeding) — both discoverable in minute one.
A `401`/`404` from a destination is as likely to be our wrong URL/version/path as a permissions problem:
diagnose before escalating.

## Step 0 · Reconcile (reuse the shift-left baseline) ⟵ the whole point
1. Fetch **current** source signals: Jira issue (Atlassian MCP) + Figma `lastModified`/`version`
   (Figma REST, `depth=1` — metadata only). Do **not** re-capture frames yet.
   - **If the metadata call `429`s** (Starter-plan quota): the Figma signal is **unknown**, not "unchanged".
     Do **not** pass stored fingerprints as live ones — `reconcile` would report a false `reuse`. Either
     read `version` via the authenticated browser session, or treat `figma-analysis` as **candidate-stale**
     and re-capture per the `figma-analysis` skill (session channel is PRIMARY). Record which you did.
2. Compute the plan:
   ```
   echo '<current-jira-issue-json>' | node qa-workflow/bin/qa-cli.js reconcile "<storyDir>" \
        --figma-file <key> --figma-nodes <ids> --figma-version <v> [--immaterial]
   ```
   → `{ reuse, stale, modified, conflicts, reasons }`.
3. **Reuse** the `reuse` set as-is. **Regenerate** only the `stale` set by invoking the matching
   shift-left skills (`story-analysis`/`figma-analysis`/`impact-analysis`/`test-design`/grill-me) in
   the printed order, then `record` each (refreshing fingerprints). For `figma` staleness, re-export
   frames and confirm `framesHash` before regenerating (contract §4).
4. **Conflicts** (hand-edited **and** source-changed): STOP and ask the operator
   (regenerate & lose edits · keep edits & accept staleness · merge). Never silently overwrite.
   `--apply-modified` re-baselines purely hand-edited artifacts (edits win).
5. If no baseline exists yet, run **`qa-shift-left`** first.

## Execution phases (after Reconcile)
1. **`exploratory-testing`** (inline) — charter-based notes; feed risks into test design.
2. **`test-design`** Phase B → `testcases` — expand HLS into granular cases (BrowserStack CSV).
3. **`browserstack-mgmt`** (inline) → `browserstack-import` — upload CSV, verify import.
4. **`automation-gen`** → `automation` — plan gate (written reuse ladder) → reuse framework assets;
   automate the generated cases → **`framework-conformance`** gate before recording (no new artifact;
   writes `automation/conformance-review.md`, blocking violations fixed first).
5. **Execution** (4 combos: iOS/Android × en/US + ar/EG) → `execution` — run, capture screenshots + structured dumps.
6. **`visual-testing`** → `visual-findings` — per screen: pair Expected↔Actual, apply dynamic-vs-defect rules, annotated Design-Bug evidence (per `CLAUDE_CODE_OPERATOR.md`).
7. **`defect-reporting`** (inline) → `defects` — file functional + Design bugs with evidence.
8. **QA Summary** → `qa-summary` — consolidate functional + visual results, coverage, risks, recommendation.

Record each produced artifact (`qa-cli.js record ... --derive-artifacts <upstream>`) and validate `qa-state.json`.

**Run these phases IN ORDER.** `automation-gen` (4) precedes execution (5) so the generated suite can
drive the runs, and recording `execution` is now **blocked** while `automation` is missing or `partial`
(`PHASE_DEPS` in `qa-cli.js`). On **B10-56717** the phases were reordered, automation landed last, and it
was never generated at all — no test class, no page objects, no story branch — while every other artifact
reported `complete`.

## Gates (added 2026-07-29)
```
node qa-workflow/bin/qa-cli.js branch-check    "<storyDir>" <TICKET>   # Step 0 — both repos on the story branch
node qa-workflow/bin/qa-cli.js complete-check  "<storyDir>"            # completion — exits 1 on any non-complete artifact
node qa-workflow/bin/qa-cli.js defer "<storyDir>" <key> --by "<op>" --reason "<why>"   # the ONLY way past either
```
`show` is **not** a gate — it always exits 0.

## Outputs
`prerequisites.md` + reused baseline + `testcases` · `browserstack-import` · `automation` · `execution` · `visual-findings` · `defects` · `qa-summary`.
