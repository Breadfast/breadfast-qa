---
name: test-design
description: Test Design (QA_PROCESS Phase 3). HLS + detailed test-case generation (both shift-left), and test-case reconciliation against the delivered implementation (validation). Runs as a subagent.
metadata:
  type: task
  version: 2.0
  phase: HLS + Test Case Generation + Test Case Reconciliation
  workflow: [qa-shift-left, qa-implementation-validation]
  runsAs: subagent
  consumes:
    sources: []
    artifacts: [requirements, figma-analysis, impact, clarifications, exploratory-notes]
    domains: [card, payment, marketing]
  produces:
    artifacts: [hls, testcases, testcase-reconciliation]
  methodology: docs/ai/testing-process.md
---

# test-design (task skill)

> Thin wrapper. The **how** is in [`docs/ai/testing-process.md`](../../../docs/ai/testing-process.md) §3
> (test design) and [`docs/ai/browserstack-process.md`](../../../docs/ai/browserstack-process.md) §10 (case format).
> The phases share one skill because HLS is the outline test cases expand from, and reconciliation edits
> what those phases produced. Do not re-inline methodology.

> **Phases A and B both run in `qa-shift-left` (changed 2026-08-09).** Defining coverage is a
> pre-development act: the AC map, the design, the impact analysis and (when it ran) the exploratory
> analysis are exactly the inputs a complete suite needs, and they all exist before implementation.
> Phase C is the post-development counterpart — it **reconciles** that approved suite against what was
> actually built. Workflow 2 no longer regenerates a suite from scratch.

## Phase A — HLS (in `qa-shift-left`) → `hls`
### Inputs (by path)
`requirements` · `figma-analysis` · `impact` · `clarifications` (+ domains `card`, `payment`, `marketing`).
### Steps (per methodology)
1. Read the baseline artifacts.
2. Generate **≤ 20** high-level scenarios (happy/negative/edge/state/validation/nav/permissions/localization/error/regression). Consolidate; do not pad. Honor any per-story `maxHls` override.
3. Write `hls/hls.md` in the canonical `HLS || <Story Name>` format.
4. **Publish to Jira as a separate checklist** (Atlassian MCP) — never modify the original AC.
   **The comment carries the HLS block and nothing else** (operator instruction 2026-08-10): no open
   questions, no clarification summary, no analysis or risk notes, no planning asides. Questions stay in
   `clarification/clarifications.md`; coverage gaps stay in `testcases/coverage-notes.md`. A question is
   published **only** when the operator says it needs the Product Owner — then as a **separate** comment
   containing just those questions. Questions the operator already answered are internal, never posted.
### Recording
```
node qa-workflow/bin/qa-cli.js record "<storyDir>" hls \
     --path hls/hls.md --generator test-design@2.0 \
     --derive-artifacts requirements,figma-analysis,impact --domains card,payment,marketing
```

## Phase B — Test Cases (in `qa-shift-left`) → `testcases`
### Inputs (by path)
`hls` · `requirements` · `impact` · `clarifications` · `exploratory-notes` *(when the conditional
exploratory analysis ran — its observations of real, existing behaviour are what keep the cases
grounded rather than speculative)*.
### Steps (per methodology)
1. Expand each HLS into detailed cases in the **canonical granular standard** (every step its own Expected Result; never combine actions; navigation/validation/verification are explicit steps).
2. Cover, explicitly: **Acceptance Criteria · functional requirements · edge cases · validation rules ·
   error states · empty states · in-scope localization · permissions and state transitions · the
   regression coverage identified in `impact` · anything the exploratory analysis surfaced.**
   Scope localization to the surface's real capability (a surface with no locale switch gets no AR/RTL
   sweep — see `CLAUDE.md` scope rules), never to a default.
3. **Tag every case for traceability** in the Tags column (§10.2a): `ac:AC-<n>` for **each** AC it
   verifies — **at least one, mandatory** — plus `screen:<screenId>` for the screen(s) it exercises
   (QA_PROCESS Phase 3), alongside the existing `ai-created`. Mark each case
   **automatable / not-automatable** via Automation Status — `automation-gen` and the BrowserStack
   `automation_status` sync both read that classification.
4. Write `testcases/testcases.csv` (BrowserStack-compatible) + `testcases/coverage-notes.md`
   (AC → case map, and the reason for every AC with no case).
5. **Self-check before handing off** — the review gate runs this anyway, so do not hand it a suite that
   fails on mechanics:
   ```
   node qa-workflow/bin/qa-cli.js testcase-lint "<storyDir>" \
        --acs-from "<storyDir>/requirements-analysis/requirements.md" --require-screens
   ```
### Recording
```
node qa-workflow/bin/qa-cli.js record "<storyDir>" testcases \
     --path testcases/testcases.csv --generator test-design@2.0 \
     --derive-artifacts hls,requirements,impact --domains card,payment,marketing
```
**Then hand off to [`testcase-review`](../testcase-review/SKILL.md) — do NOT import.** `browserstack-mgmt`
cannot record its import until the review artifact is `complete` **and** an operator approval is recorded
(`qa-cli.js` `PHASE_DEPS` + `APPROVAL_DEPS`).

## Phase C — Reconciliation (in `qa-implementation-validation`) → `testcase-reconciliation`
The approved suite is the starting point, **not** a draft to be regenerated. Run this phase only when
execution, exploratory testing, the implementation or the live application shows the suite needs to change.
### Steps
1. Diff intent vs implementation: read `execution` outcomes, `evidence/exploratory-notes.md`, and the
   delivered behaviour against the approved cases.
2. Apply only **justified** deltas: add missing cases · update existing ones · remove obsolete/unrelated
   ones · split or merge · mark obsolete · adjust expected results where the implementation or design
   change justifies it · add regression cases discovered during validation.
   **An adjusted expected result needs an authority — an AC, the design, or a recorded clarification.
   "The app does X" is not one** (that is a defect candidate; route it to `defect-reporting`).
3. Write `testcases/reconciliation.md`: one row per delta — `case id · action · reason · authority
   (AC/design/rule) · evidence`. Then edit `testcases/testcases.csv` in place.
4. Re-run `testcase-review` **over the deltas only**, and get a fresh operator approval, before the
   BrowserStack sync. A validation-time change is still a change to approved coverage.
### Recording
```
node qa-workflow/bin/qa-cli.js record "<storyDir>" testcase-reconciliation \
     --path testcases/reconciliation.md --generator test-design@2.0 --derive-artifacts testcases
node qa-workflow/bin/qa-cli.js record "<storyDir>" testcases \
     --path testcases/testcases.csv --generator test-design@2.0 \
     --derive-artifacts hls,requirements,impact --domains card,payment,marketing
node qa-workflow/bin/qa-cli.js approve "<storyDir>" testcases --by "<operator>" --note "<what changed>"
```
> The approved baseline is never overwritten: `approve` snapshots it as `testcases/testcases.approved.csv`
> and stores its checksum. `complete-check` **fails** a run whose approved suite drifted with no
> `testcase-reconciliation` recorded — traceability is enforced, not requested.

## Output
Returns `{ artifactPath, count, summary }` per phase — compact, not the full content.
Phase C additionally returns `{ added, updated, removed, split, merged, obsoleted }`.
