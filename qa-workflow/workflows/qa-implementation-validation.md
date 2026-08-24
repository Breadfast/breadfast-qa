---
name: qa-implementation-validation
type: workflow
version: 2.0
description: Post-Development QA — reconcile & reuse the shift-left baseline (analysis AND approved test cases), then validate the delivered implementation.
purpose: Reuse the shift-left baseline (regenerating only what changed), reconcile the approved test-case suite against what was built, then run automation, execution, visual, defects, and QA summary.
inputs: { ticket: required, appUrl: optional, mobileAppIds: optional }
---

# Workflow 2 — Post-Development (Implementation Validation)

**Executor:** Claude Code (agent-followed). **Methodology (source of truth):**
[`../../docs/ai/QA_PROCESS.md`](../../docs/ai/QA_PROCESS.md) Phases 4–6.
**Reuse contract + freshness:** [`../../docs/ai/architecture/qa-artifact-contract.md`](../../docs/ai/architecture/qa-artifact-contract.md) §5.
**Discipline:** once scope is locked (Reconcile), execution runs **end-to-end without stopping** except
for a genuine blocker (unknown OTP/BCID, required backend status change, content not found) — or a
**re-approval** of test cases this workflow changed (Step 3).

> **Scope change 2026-08-09 — this workflow no longer generates the test suite.** Test cases, their
> review gate and the BrowserStack import are **shift-left** outputs (`qa-shift-left` Steps 7–9), and
> they are part of the reconciled baseline. Here they are **reconciled and maintained**: add what is
> missing, update what the implementation changed, remove what became obsolete — each delta justified,
> logged and re-approved. **Do not regenerate the suite from scratch** because it is easier than diffing;
> that discards the coverage the squad agreed to before development. If no baseline exists at all, run
> **`qa-shift-left` first** (Step 0.5).
>
> **Shift left ⇒ establish the coverage baseline. Validate ⇒ reconcile and maintain it.**

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
   → `{ reuse, stale, modified, conflicts, reasons }`. The default set is the **eight-key** shift-left
   baseline — `requirements · figma-analysis · clarifications · impact · hls · testcases ·
   testcase-review · browserstack-import` — plus `exploratory-notes` when the story produced one.
3. **Reuse** the `reuse` set as-is. **Regenerate** only the `stale` set by invoking the matching
   shift-left skills (`story-analysis`/`figma-analysis`/`impact-analysis`/`test-design`/`testcase-review`/
   `browserstack-mgmt`/grill-me) in the printed order, then `record` each (refreshing fingerprints).
   For `figma` staleness, re-export frames and confirm `framesHash` before regenerating (contract §4).
   - A changed AC cascades `requirements → impact → hls → testcases → testcase-review →
     browserstack-import`: regenerated cases go back **through the review + approval gate** and are
     **synced**, not re-imported as duplicates.
4. **Conflicts** (hand-edited **and** source-changed): STOP and ask the operator
   (regenerate & lose edits · keep edits & accept staleness · merge). Never silently overwrite.
   `--apply-modified` re-baselines purely hand-edited artifacts (edits win).
5. If no baseline exists yet, run **`qa-shift-left`** first (Steps 0–9) — including the test cases, the
   review gate and the import. Then continue here. Do not improvise a suite inside this workflow.

## Execution phases (after Reconcile)
1. **`exploratory-testing`** (inline, **Mode B**) — charter-based exploration of the **delivered** build;
   appends a dated Post-Development section to `evidence/exploratory-notes.md`. Findings route to
   phase 2 (coverage change) or phase 8 (grounded defect).
2. **`test-design` Phase C** → `testcase-reconciliation` — **only if the approved suite needs to change.**
   Reconcile it against what was actually built: **add** missing cases · **update** existing ones ·
   **remove** obsolete/unrelated ones · **split/merge** · **mark obsolete** · **adjust expected results**
   where the implementation or design change justifies it · **add regression cases** found during
   validation. Every delta is logged in `testcases/reconciliation.md` with its **authority** (AC, design,
   or recorded clarification) and evidence — *"the app does X"* is not an authority, it is a defect
   candidate. Then re-record `testcases`.
   - **If nothing needs changing, record nothing** and say so in the QA Summary. The absence of deltas is
     a result.
3. **Re-review + re-approve (gate)** — re-run `qa-cli.js testcase-lint "<storyDir>" --acs-from …` (it
   must exit 0 after the edits), run **`testcase-review`** over the deltas only, re-record
   `testcase-review`, and get a fresh `qa-cli.js approve ... --by "<operator>"`. This is the one planned
   stop in this workflow: a validation-time edit is still an edit to approved coverage. Re-approval
   **keeps the original approver in `approvals.testcases.history`** — the record shows who signed off
   what, not just the latest signature.
4. **`browserstack-mgmt`** (inline, **Mode B — sync**) → re-record `browserstack-import`. Apply the deltas
   to the **existing** folder by `TC-xxxx` id (create/update/archive); never re-upload the whole CSV as
   new cases — that duplicates the folder and orphans every `@TmsLink`. Verify each write by reading it back.
5. **Manual execution of the approved suite** ⟵ **runs BEFORE automation (operator instruction 2026-08-20, standing)**
   Execute every approved case **by hand**, recording a per-case verdict (pass / fail / blocked / skipped)
   with evidence, into **`execution-reports/manual-execution.md`**. A story is proven manually before effort
   is spent encoding it, and an automated test written against unverified behaviour tends to enshrine
   whatever the app currently does. Cases the operator **excluded from automation are executed here too** —
   excluded from automation is not excluded from testing.
   - **No artifact is recorded at this step, and no gate is bypassed.** `PHASE_DEPS = { execution: 'automation' }`
     still holds: the manual results are written to disk now, automation follows, and the automated results are
     appended before `execution` is recorded. That gate exists because on **B10-56717** the phases were
     reordered and automation fell off the end of the run; manual-first must not reopen that hole.
   - Findings route to phase 2 (a coverage change → loop back through the gate) or phase 9 (a grounded defect).
6. **`automation-gen`** → `automation` — plan gate (written reuse ladder) → reuse framework assets;
   automate **only the operator-selected** cases → **`framework-conformance`** gate before recording (no new
   artifact; writes `automation/conformance-review.md`, blocking violations fixed first).
7. **Automated execution** (mobile: 4 combos iOS/Android × en/US + ar/EG; web-admin: 1 combo EN) → `execution`
   — run the suite, capture screenshots + structured dumps, and **append** to the manual results so the
   recorded `execution` artifact carries both passes.
8. **`visual-testing`** → `visual-findings` — per screen: pair Expected↔Actual, apply dynamic-vs-defect rules, annotated Design-Bug evidence (per `CLAUDE_CODE_OPERATOR.md`).
9. **`defect-reporting`** (inline) → `defects` — file functional + Design bugs with evidence.
10. **QA Summary** → `qa-summary` — consolidate functional + visual results, coverage, risks, recommendation.
   State the **test-case reconciliation** explicitly: cases added/updated/removed and why, or "no deltas".

Record each produced artifact (`qa-cli.js record ... --derive-artifacts <upstream>`) and validate `qa-state.json`.

**Run these phases IN ORDER.** The **manual** pass (5) precedes `automation-gen` (6) so the story is proven
before it is encoded; `automation-gen` (6) precedes **automated** execution (7) so the generated suite can
drive the runs; and recording `execution` is **blocked** while `automation` is missing or `partial`
(`PHASE_DEPS` in `qa-cli.js`). Manual-first therefore changes the **order of work**, not the order of
**recorded artifacts** — the manual results land in `execution-reports/manual-execution.md` at step 5 and are
folded into the `execution` artifact at step 7. On **B10-56717** the phases were reordered, automation landed
last, and it was never generated at all — no test class, no page objects, no story branch — while every other
artifact reported `complete`. That is the hole the gate closes, and manual-first must not reopen it: **if the
manual pass ends the run, `automation` is owed and needs a recorded operator deferral, not silence.**

**Late deltas.** Execution (7) or visual testing (8) may still reveal a needed case change. Loop back
through 2 → 3 → 4 for it; do not smuggle the change into the CSV afterwards. `complete-check` **fails**
a run whose approved suite drifted with no `testcase-reconciliation` recorded.

## Gates (added 2026-07-29; approval + lint gates added 2026-08-09)
```
node qa-workflow/bin/qa-cli.js branch-check    "<storyDir>" <TICKET>              # Step 0 — both repos on the story branch
node qa-workflow/bin/qa-cli.js testcase-lint   "<storyDir>" --acs-from <reqs>     # mechanical review checks; exits 1 on any error
node qa-workflow/bin/qa-cli.js approve "<storyDir>" testcases --by "<op>"         # the test-case gate; required before an import/sync
node qa-workflow/bin/qa-cli.js complete-check  "<storyDir>" --profile validate    # completion — exits 1 on any non-complete artifact
node qa-workflow/bin/qa-cli.js defer "<storyDir>" <key> --by "<op>" --reason "<why>"   # the ONLY way past any of them
```
`show` and `status` are **not** gates — both always exit 0. Use `status "<storyDir>"` to see where the
run stands, what is next, and what blocks it.

**Reconcile now honours the `lock` seam.** A phase skill whose `version:` was bumped since an artifact
was produced marks that artifact stale (rule d), as does a bumped business-domain version (rule e).
Both were dead until 2026-08-09 — a story carrying an `hls` from `test-design@1.0` (before test cases
were a shift-left output) is *correctly* stale today. `--ignore-lock` carries it forward deliberately,
and the plan says so.

## Outputs
`prerequisites.md` + reconciled baseline (incl. `testcases` · `testcase-review` · `browserstack-import`)
+ *(`testcase-reconciliation`)* · `automation` · `execution` · `visual-findings` · `defects` · `qa-summary`.

---

## Coverage-changing decisions apply to this workflow too

Any decision here that **reduces or changes planned validation** — a reconciliation delta that removes a
case, an exploratory conclusion that narrows scope, a requirement declared untestable — is recorded and
ratified like any other:

```
node qa-workflow/bin/qa-cli.js coverage-change add    "<storyDir>" <id> --source reconciliation ...
node qa-workflow/bin/qa-cli.js coverage-change list   "<storyDir>"
node qa-workflow/bin/qa-cli.js coverage-change approve "<storyDir>" <id> --by "<operator>"
```

Re-approval of the suite and `complete-check` both **fail** while one is `proposed`. Authoritative rule:
[`../../docs/ai/QA_PROCESS.md`](../../docs/ai/QA_PROCESS.md) *Coverage-changing decisions*.
