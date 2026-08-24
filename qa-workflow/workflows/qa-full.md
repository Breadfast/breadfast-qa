---
name: qa-full
version: 2.0
type: workflow
description: Full QA lifecycle (the original end-to-end process) — Pre-Development baseline then Post-Development validation in one run.
purpose: Run Workflow 1 then Workflow 2 back-to-back for a story with no usable baseline, producing the complete artifact set (requirements → qa-summary).
inputs: { ticket: required, figmaUrl: optional-override, appUrl: optional, mobileAppIds: optional }
---

# Workflow 3 — Full QA Lifecycle (Pre-Dev + Post-Dev)

**Executor:** Claude Code (agent-followed). **Methodology (source of truth):**
[`../../docs/ai/QA_PROCESS.md`](../../docs/ai/QA_PROCESS.md) **Phases 0–6, all seven gates** · `CLAUDE.md` §2 STEP 0-pre–7 + §3/§4.
**Reuse contract:** [`../../docs/ai/architecture/qa-artifact-contract.md`](../../docs/ai/architecture/qa-artifact-contract.md).

> **This workflow composes; it does not restate.** It is the original single end-to-end QA process
> (as executed by the legacy QA Platform) expressed as **Workflow 1 → handoff → Workflow 2**. Every
> phase's *how* stays in exactly one place — the phase skills under `../skills/<name>/SKILL.md` and the
> two workflow files. If a step here and its source workflow ever diverge, **the source workflow wins**.

**Discipline (hybrid, per `CLAUDE.md` §2 resolved policy):**
- **Phase A (analysis/design) is clarify-first** — it holds the run's **two** planned stops: the
  **Clarification gate** (A3) and the **Test-Case Approval gate** (A8).
- **Phase B (execution) is auto-run** — after Gate A, run end-to-end without stopping, pausing only
  for a genuine blocker (unknown OTP/BCID, required backend status change, content not found), a
  handoff conflict (Step 6), or a **re-approval** of test cases Phase B changed (B2–B3).

> **Two planned stops, not one (changed 2026-08-09).** Test-case generation moved into Phase A, and its
> approval gate is an operator decision. Invoking `qa-full` authorizes the *run*; it does not
> pre-approve the coverage the run designs. Approving your own test cases because "the operator asked
> for the whole workflow" is exactly the self-exemption pattern that produced B10-56717.

## When to use which workflow

| Situation | Run |
|---|---|
| Story is groomed / pre-implementation; you want the reusable baseline + HLS in Jira now | **`qa-shift-left`** (W1) |
| Implementation delivered and a shift-left baseline already exists | **`qa-validate`** (W2) — reconciles, reuses, validates |
| Implementation delivered and **no baseline exists** (or it predates the split), and you want one uninterrupted pass | **`qa-full`** (W3) ⟵ this file |

`qa-full` is a **convenience composition, not a third methodology.** It produces artifacts that are
byte-for-byte contract-compatible with a `qa-shift-left` + `qa-validate` pair, so a later `qa-validate`
re-run reconciles them identically.

## Inputs
- `ticket` (required) — Jira key, e.g. `B10-56729`.
- `figmaUrl` (optional) — override; otherwise take **this story's** Figma link from the ticket.
- `appUrl` (web) / `mobileAppIds` (iOS + Android BrowserStack app IDs) — needed by Phase B execution;
  ask for them **at Step 6**, not at the start, so Phase A is never blocked on them.
- Story folder: `D:\breadfast-qa\<ticket>\` (create if missing).

> **Execution model** (unchanged from W1/W2): read-heavy phase skills run as **subagents** that write
> their artifact file and return a **compact summary** (path + key facts), never full content. The
> orchestrator shuttles paths + summaries + `qa-state.json`, keeping its own context lean.

---

## Phase 0 — Prerequisite Gate (`detect-prerequisites`) ⟵ **runs FIRST, before Phase A**

Run [`../skills/detect-prerequisites/SKILL.md`](../skills/detect-prerequisites/SKILL.md) inline.
Enumerate every input the whole run will need — access, destinations, targets, test data, backend state,
design links, locale scope — verify each access item with **one real authenticated call**, and **ask the
operator in a single batch** for whatever is missing. Write `prerequisites.md` into the story folder.

Because `qa-full` runs end-to-end, this gate matters most here: a missing BrowserStack destination or
absent test data discovered in Phase B wastes the entire Phase A run. **Never report a step as blocked
without asking first**, and diagnose a `401`/`404` as a possible wrong URL/API-version/path on our side
before calling it a permissions blocker. *(Added 2026-07-26 — see the skill for the motivating failures.)*

## Phase 0b — Story-branch gate ⟵ **runs with Step 0, before any generation**

```
node qa-workflow/bin/qa-cli.js branch-check "<storyDir>" <TICKET>
```
Asserts **both** repos — the companion (`D:\breadfast-qa`) and the Java framework (resolved via
`automation/config/framework.js`) — are on this story's branch
`<year>/sprintQ<n>.<n>/<ticket>-<slug>`. Exit 1 otherwise. If it fails, create the branch in **each**
repo before continuing.

*Why this is a gate and not a note (added 2026-07-29):* the framework's git hooks validate the branch
**name on push only**, so they cannot catch the failure that actually happened on **B10-56717** — no
story branch was ever created, both repos stayed on the **previous** story's branch
(`…/B10-56652-…`), no automation was generated into the framework at all, and the run still reported
every quality gate met. One second at Step 0 replaces that.

## Phase A — Pre-Development baseline (Workflow 1)

Execute [`qa-shift-left.md`](qa-shift-left.md) **Steps 0–9 exactly as written**, in order:

| Step | Skill (runsAs) | Artifact key |
|---|---|---|
| 0 · Initialize (`qa-cli.js init`) **+ story-branch gate (below)** | — | — |
| 1 · Story Analysis | `story-analysis` (subagent) | `requirements` |
| 2 · Figma Analysis | `figma-analysis` (subagent) | `figma-analysis` |
| 3 · Clarification ⟵ **GATE, may STOP** | `grill-me` (inline, interactive) | `clarifications` |
| 4 · Impact Analysis | `impact-analysis` (subagent) | `impact` |
| 5 · Exploratory Analysis ⟵ **conditional** | `exploratory-testing` (inline, Mode A) | `exploratory-notes` |
| 6 · HLS (+ publish checklist to Jira) | `test-design` (subagent, Phase A) | `hls` |
| 7 · Test Case Generation | `test-design` (subagent, Phase B) | `testcases` |
| 8 · Test Case Review ⟵ **GATE, WILL STOP for approval** | `testcase-review` (subagent → inline stop) + `automation/gen_testcase_review_page.js --story "<storyDir>"` | `testcase-review` |
| 9 · BrowserStack Import (approved cases only) | `browserstack-mgmt` (inline, Mode A) | `browserstack-import` |

At step 8 the operator gets the **review page** (standard for every story since 2026-08-10): one case at a
time with a per-case **Accept / Needs update / Invalid-delete** verdict **and a comment**. Apply whatever
its "Copy review" block returns, re-run lint + the nine checks from the top, then present again.

Fingerprint + `record` each artifact with the commands given in `qa-shift-left.md` — **use the same
per-skill `--generator` values** (`story-analysis@1.0`, `figma-analysis@1.0`, `clarification@1.0`,
`impact-analysis@1.0`, `exploratory-testing@2.0`, `test-design@2.0`, `testcase-review@1.0`,
`browserstack-mgmt@2.0`). Do **not** stamp artifacts with `qa-full@2.0`: generators are
skill-scoped so `version:` bumps invalidate the right artifacts and a later reconcile behaves identically
regardless of which workflow produced the baseline. Only the state-level `generatedBy` records the
orchestrating workflow (`qa-full@2.0`).

**Gate A (QA_PROCESS Phase 1–3 exit):** scope locked, test cases reviewed **and operator-approved**,
imported and verified — `complete-check --profile shift-left` passes and `qa-state.json` validates.
Do not enter Phase B until Gate A passes.
```
node qa-workflow/bin/qa-cli.js complete-check "<storyDir>" --profile shift-left
```

---

## Step 6 · Handoff — continuity check (replaces W2's Reconcile)

W2 Step 0 exists to reuse a baseline produced in an **earlier session**. Here the baseline was produced
minutes ago, so the same machinery runs as an **assertion**, not a reuse plan:

1. Re-fetch current signals: Jira issue (Atlassian MCP) + Figma `lastModified`/`version` (REST, `depth=1`
   — metadata only). On a `429` the Figma signal is **unknown, not unchanged** — handle per
   [`qa-implementation-validation.md`](qa-implementation-validation.md) §0.1, never by passing stored
   fingerprints as live.
2. ```
   echo '<current-jira-issue-json>' | node qa-workflow/bin/qa-cli.js reconcile "<storyDir>" \
        --figma-file <key> --figma-nodes <ids> --figma-version <v>
   ```
3. **Expected result: all eight baseline keys in `reuse`** (nine with `exploratory-notes`),
   **`stale`/`conflicts` empty.** Proceed.
4. **If anything is `stale`** — the story or design changed *during* the run. Do not ignore it: regenerate
   the stale set (+ cascade) per [`qa-implementation-validation.md`](qa-implementation-validation.md) §0.3,
   re-record, then re-run this check. Report the mid-run drift in the QA Summary.
5. **If anything is in `conflicts`** — STOP and ask, per §0.4. Never silently overwrite hand edits.
6. Collect `appUrl` / `mobileAppIds` if not already supplied and the story needs them.

**Gate B:** reconcile returns a clean all-`reuse` plan against live sources.

---

## Phase B — Post-Development validation (Workflow 2)

Execute [`qa-implementation-validation.md`](qa-implementation-validation.md) **Execution phases 1–10 exactly
as written** — skipping only its Step 0 (satisfied by Step 6 above):

| # | Skill (runsAs) | Artifact key |
|---|---|---|
| 1 | `exploratory-testing` (inline, Mode B — the delivered build) | `exploratory-notes` (appended) |
| 2 | `test-design` Phase C (subagent) — **only if the approved suite must change** | `testcase-reconciliation` (+ re-record `testcases`) |
| 3 | `testcase-review` over the deltas ⟵ **GATE, stops for re-approval** — only if 2 ran | `testcase-review` (re-recorded) |
| 4 | `browserstack-mgmt` (inline, Mode B — **sync**, by `TC-xxxx` id) — only if 2 ran | `browserstack-import` (re-recorded) |
| **5** | **Manual execution of the approved suite** ⟵ **BEFORE automation** (operator instruction 2026-08-20, standing). Per-case verdict + evidence. Includes the cases excluded from automation. | — (`execution-reports/manual-execution.md`; folded into `execution` at 7) |
| 6 | `automation-gen` (subagent) — automates **only the operator-selected** cases | `automation` |
| 6b | `framework-conformance` (subagent) — gate, runs before 6 is recorded | — (`automation/conformance-review.md`) |
| 7 | Automated execution — mobile 4 combos (iOS/Android × en/US + ar/EG); web-admin 1 combo (EN) | `execution` (manual + automated) |
| 8 | `visual-testing` (subagent) | `visual-findings` |
| 9 | `defect-reporting` (inline) | `defects` |
| 10 | QA Summary | `qa-summary` |

**Step 5 records no artifact and bypasses no gate.** `PHASE_DEPS = { execution: 'automation' }` still holds:
the manual verdicts are written to disk at 5 and folded into `execution` at 7. If a run ends after the manual
pass, `automation` is **owed** and needs a recorded operator deferral — never silence (the B10-56717 hole).

Phases 2–4 are **conditional**: in a `qa-full` run the suite was designed minutes ago against the same
implementation, so it will often need no deltas at all. Record nothing and say so — an empty
reconciliation is a result, not a skipped phase.

Record each artifact (`qa-cli.js record ... --derive-artifacts <upstream>`) and validate `qa-state.json`.

**Gate C (QA_PROCESS Phases 5 + 6 exit):** visual evidence produced per captured screen; QA Summary states
functional + visual results, coverage, risks, and a Pass / Pass-with-risks / Fail recommendation.

---

## Interruption & resume

The run is **resumable at the artifact boundary**, because state lives in `qa-state.json`, not in the
session:

| Interrupted… | Resume with |
|---|---|
| during Phase A | `qa-full` (or `qa-shift-left`) again — completed artifacts reconcile as `reuse` |
| after Gate A / anywhere in Phase B | **`qa-validate`** — its Reconcile finds the fresh baseline and continues |

There is no `qa-full`-only state, so nothing is stranded by resuming through a different entrypoint.

## Completion
- ```
  node qa-workflow/bin/qa-cli.js complete-check "<storyDir>" --profile full
  ```
  **Exits 1** while any of the thirteen required artifacts is missing or not `complete` and has no recorded
  operator deferral — and while an **approved** test-case suite has drifted with no recorded
  `testcase-reconciliation`. **This is the completion gate — `show` is not**, because `show` prints state and
  always exits 0, which is how a `partial` **automation** artifact sat beside eleven `complete` ones on
  B10-56717 and never contradicted the QA summary. Run `show` for detail, `complete-check` to pass.
- A phase may only be skipped with an **operator-approved, recorded** deferral:
  ```
  node qa-workflow/bin/qa-cli.js defer "<storyDir>" automation --by "<operator>" --reason "<why>"
  ```
  Recording `execution` is **blocked** while `automation` is missing or `partial` and no such deferral
  exists (`PHASE_DEPS` in `qa-cli.js`). Deferral is a decision with a name attached, never a
  self-exemption.
- Verify the **quality gates** in `CLAUDE.md` §5 and the six phase gates in `docs/ai/QA_PROCESS.md`.
- Report: baseline summary + QA Summary + defects filed + coverage/risks + recommendation.

## Outputs (the full artifact set)
`requirements` · `figma-analysis` · `clarifications` · `impact` · *(`exploratory-notes`)* · `hls` ·
`testcases` · `testcase-review` · `browserstack-import` · *(`testcase-reconciliation`)* · `automation` ·
`execution` · `visual-findings` · `defects` · `qa-summary`
— under `<storyDir>/`, each recorded in `qa-state.json` (`generatedBy: qa-full@2.0`).
