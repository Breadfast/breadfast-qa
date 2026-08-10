---
name: qa-shift-left
type: workflow
version: 2.0
description: Pre-Development QA (shift-left) — validate the story before implementation and establish the complete QA coverage baseline.
purpose: Produce the reusable baseline (requirements, figma-analysis, clarifications, impact, optional exploratory analysis, hls, testcases, testcase-review, browserstack-import) and publish the HLS checklist to Jira.
inputs: { ticket: required, figmaUrl: optional-override, appUrl: optional }
---

# Workflow 1 — Pre-Development (Shift-Left)

**Executor:** Claude Code (agent-followed). **Methodology (source of truth):**
[`../../docs/ai/QA_PROCESS.md`](../../docs/ai/QA_PROCESS.md) Phases 0–3 · `CLAUDE.md` §2 STEP 1–7.
**Reuse contract:** [`../../docs/ai/architecture/qa-artifact-contract.md`](../../docs/ai/architecture/qa-artifact-contract.md).
**Discipline:** **clarify-first** — this workflow has **two planned stops**: the Clarification gate
(Step 3) and the Test-Case Approval gate (Step 8). Neither may be self-granted.

> **Scope change 2026-08-09 — coverage is defined here, not after development.** Test-case generation,
> its review gate and the BrowserStack import moved from Workflow 2 into this workflow. Everything a
> complete suite needs — the AC map, the design, the impact analysis, the clarifications, and the
> optional exploratory analysis — exists **before** implementation; deferring case design until after
> it only means the cases are written under delivery pressure, against the build rather than the
> requirement. Workflow 2 now **reconciles and maintains** this baseline instead of regenerating it.
> ADR-001 §3.1 amendment · contract §1–2.

> **Execution model:** run each read-heavy phase skill as a **subagent** that writes its artifact file
> and returns a **compact summary** (artifact path + key facts), NOT the full content. The orchestrator
> shuttles paths + summaries + `qa-state.json`, keeping its own context lean. Skill bodies (the *how*)
> live in `../skills/<name>/SKILL.md`; each references `docs/ai/**`.

## Inputs
- `ticket` (required) — Jira key, e.g. `B10-56729`.
- `figmaUrl` (optional) — override; otherwise take **this story's** Figma link from the ticket.
- Story folder: `D:\breadfast-qa\<ticket>\` (create if missing).

## Steps

### −1 · Prerequisite Gate (`detect-prerequisites`) ⟵ **runs FIRST**
Run [`../skills/detect-prerequisites/SKILL.md`](../skills/detect-prerequisites/SKILL.md) inline before
anything else. Enumerate every input the run needs (access, destinations, targets, test data, backend
state, design links, locale scope), verify each access item with **one real authenticated call**, and
**ask the operator in a single batch** for whatever is missing. Write `prerequisites.md` into the story
folder.

**Never report a step as blocked without asking first.** A `401`/`404` from a destination is as likely
to be our own wrong URL/API-version/path as a permissions problem — diagnose before escalating.
*(Added 2026-07-26; see the skill for the B10-56750 failures that motivated it.)*

### 0 · Initialize
```
node qa-workflow/bin/qa-cli.js init "<storyDir>" <ticket>
```
Creates the story folder (with standard subfolders per `CLAUDE.md` STEP 0) + a `qa-state.json` skeleton.

### 1 · Story Analysis  → `requirements`
- Run the **`story-analysis`** skill (subagent). It fetches the Jira issue (Atlassian MCP: description, **AC, comments**), writes `requirements-analysis/requirements.md`.
- Fingerprint + record:
  ```
  echo '<issue-json>' | node qa-workflow/bin/qa-cli.js fingerprint-jira "<storyDir>"
  node qa-workflow/bin/qa-cli.js record "<storyDir>" requirements \
       --path requirements-analysis/requirements.md --generator story-analysis@1.0 \
       --derive-sources jira --domains <domains>
  ```

### 2 · Figma Analysis  → `figma-analysis`
- Run the **`figma-analysis`** skill (subagent). It takes the per-story Figma file key from the ticket, captures frames at **2×** (EN **and** AR), writes `figma-analysis/analysis.md` (+ `frames/`, `extract/`).
- **Capture channel (updated 2026-07-26):** the **authenticated Playwright browser session** (`Ctrl+Shift+C` Copy-as-PNG) is **PRIMARY**; **REST** (`qa-cli.js figma-export`) is a **fallback** used only when the Starter-plan quota is available; the **Figma MCP** is last resort. The skill runs the **session gate first** (`figma-connect.js --status`) and, if the session is stale, **opens the reconnect browser and asks the user to sign in** — capture is never reported as "blocked". Channel order + the frame-set **completeness** rules (enumerate the whole sibling cluster; capture the **outer** frame) are in the skill; do not restate them here.
- Fingerprint + record:
  ```
  node qa-workflow/bin/qa-cli.js fingerprint-figma "<storyDir>" --file <fileKey> --nodes <ids> --version <v> [--frames <sha256>]
  node qa-workflow/bin/qa-cli.js record "<storyDir>" figma-analysis \
       --path figma-analysis/analysis.md --generator figma-analysis@1.0 --derive-sources figma
  ```

### 3 · Clarification  ⟵ **gate (may STOP)**  → `clarifications`
- Run the existing **`grill-me`** skill (inline, interactive). Resolve every ambiguity; **do not proceed until scope is locked.**
- Write `clarification/clarifications.md`, then record:
  ```
  node qa-workflow/bin/qa-cli.js record "<storyDir>" clarifications \
       --path clarification/clarifications.md --generator clarification@1.0 --derive-sources jira
  ```

### 4 · Impact Analysis  → `impact`
- Run the **`impact-analysis`** skill (subagent). Produces Impacted / Regression / Smoke / Automation areas → `impact-analysis/impact.md`.
- Record (derives from upstream artifacts):
  ```
  node qa-workflow/bin/qa-cli.js record "<storyDir>" impact \
       --path impact-analysis/impact.md --generator impact-analysis@1.0 \
       --derive-artifacts requirements,figma-analysis
  ```

### 5 · Exploratory Analysis  ⟵ **conditional**  → `exploratory-notes`
- Run the **`exploratory-testing`** skill (inline, **Mode A**) **when it will change the test cases** —
  ambiguous requirements or Figma states, undocumented existing flows, dependency/reachability questions,
  suspected edge cases, colliding upcoming scope, or an impacted area nobody has looked at. Full trigger
  list + skip rule: [`../skills/exploratory-testing/SKILL.md`](../skills/exploratory-testing/SKILL.md).
- It explores the **current** build for observability, produces no verdicts, and files no defects.
- **If skipped, record the decision** — a machine-readable one, so "decided against" never looks like
  "never considered":
  ```
  node qa-workflow/bin/qa-cli.js skip "<storyDir>" exploratory-notes --by "<operator>" --reason "<why>"
  ```
  `exploratory-notes` is a *conditional* artifact: reconcile includes it only once a record exists, so
  skipping never leaves a permanently-stale key.
- Record (only if it ran):
  ```
  node qa-workflow/bin/qa-cli.js record "<storyDir>" exploratory-notes \
       --path evidence/exploratory-notes.md --generator exploratory-testing@2.0 \
       --derive-artifacts requirements,figma-analysis,impact
  ```

### 6 · HLS  → `hls`  (+ publish to Jira)
- Run the **`test-design`** skill (subagent, **Phase A**). Generate ≤ 20 HLS, write `hls/hls.md`, and **publish them to Jira as a separate checklist** (never modify the original AC).
- **The Jira post is HLS-ONLY** (operator instruction 2026-08-10): no open questions, no clarification
  list, no analysis or risk commentary, no planning asides. Questions belong in
  `clarification/clarifications.md` and gaps in `testcases/coverage-notes.md`. **Only when the operator
  says an item needs the Product Owner** does it go to Jira, as a **separate** comment holding just those
  questions. Anything the operator answered at the clarification gate stays internal.
- Record:
  ```
  node qa-workflow/bin/qa-cli.js record "<storyDir>" hls \
       --path hls/hls.md --generator test-design@2.0 \
       --derive-artifacts requirements,figma-analysis,impact --domains <domains>
  ```

### 7 · Test Case Generation  → `testcases`
- Run the **`test-design`** skill (subagent, **Phase B**). Expand every HLS into granular cases in the
  canonical standard (every step its own Expected Result), covering **ACs · functional requirements ·
  edge cases · validation rules · error states · empty states · in-scope localization · permissions and
  state transitions · the regression coverage from `impact` · the exploratory findings**.
- **Tag every case** `ac:AC-<n>` (≥ 1, mandatory) + `screen:<screenId>` in the Tags column
  ([browserstack-process](../../docs/ai/browserstack-process.md) §10.2a), and set its
  **automatable / not-automatable** Automation Status.
- Write `testcases/testcases.csv` + `testcases/coverage-notes.md` (AC → case map).
- Record:
  ```
  node qa-workflow/bin/qa-cli.js record "<storyDir>" testcases \
       --path testcases/testcases.csv --generator test-design@2.0 \
       --derive-artifacts hls,requirements,impact --domains <domains>
  ```
- **Do not import yet.** Go to Step 8.

### 8 · Test Case Review + Approval  ⟵ **gate (WILL STOP)**  → `testcase-review`
- Run the **`testcase-review`** skill (subagent). It first runs the **mechanical** checks —
  ```
  node qa-workflow/bin/qa-cli.js testcase-lint "<storyDir>" \
       --acs-from "<storyDir>/requirements-analysis/requirements.md" --require-screens
  ```
  which **exits 1** on duplicate titles/step-sequences, a step with no Expected Result, a format or
  vocabulary violation, a case citing no AC, or **an AC with no case** — then the nine-check review
  (unrelated cases · correct expected results · granularity · categorization · automatable
  classification · justified regression coverage). It **revises and re-runs until all nine pass**, and
  writes `testcases/review.md`.
- **Build the operator's review page** — standard for every story since 2026-08-10:
  ```
  node automation/gen_testcase_review_page.js --story "<storyDir>"
  ```
  One case at a time, with a per-case **Accept / Needs update / Invalid-delete** verdict **and a comment**.
  Its "Copy review" block is the revision list: apply it to `testcases.csv`, re-run lint + the nine checks
  from the top, record the changes in `review.md`, and present again. (Skill §*Operator review page*.)
- Record the review, then **present the counts, the AC-coverage table and every revision to the operator
  and STOP.** Approval is theirs:
  ```
  node qa-workflow/bin/qa-cli.js record "<storyDir>" testcase-review \
       --path testcases/review.md --generator testcase-review@1.0 --derive-artifacts testcases
  node qa-workflow/bin/qa-cli.js approve "<storyDir>" testcases --by "<operator>" [--note "<note>"]
  ```
- `approve` snapshots the approved CSV (`testcases/testcases.approved.csv`) + its checksum, so nothing
  downstream can overwrite the approved baseline unnoticed.
- **Reviewing is yours; approving is not.** Recording the review does not open the gate — Step 9 dies
  without `approvals.testcases`. The only alternative is a recorded deferral with the operator's name:
  `qa-cli.js defer "<storyDir>" testcase-review --by "<operator>" --reason "<why>"`.

### 9 · BrowserStack Import  → `browserstack-import`
- Run the **`browserstack-mgmt`** skill (inline, **Mode A**) — approved cases only. Upload, **verify the
  import** (folder count, no nested folder, granular steps render), and write the `TC-xxxx` map back into
  `testcases/testcases.csv` so `@TmsLink` binding exists before automation.
- Record:
  ```
  node qa-workflow/bin/qa-cli.js record "<storyDir>" browserstack-import \
       --path browserstack/import-report.md --generator browserstack-mgmt@2.0 \
       --derive-artifacts testcase-review
  ```

## Completion
```
node qa-workflow/bin/qa-cli.js status         "<storyDir>" --profile shift-left   # where things stand
node qa-workflow/bin/qa-cli.js complete-check "<storyDir>" --profile shift-left   # the gate
```
**Exits 1** while any of the eight baseline artifacts is missing or not `complete` without a recorded
operator deferral. `show` is **not** a gate — it always exits 0. Report the baseline summary; these
artifacts are the **reusable input** to Workflow 2, which reconciles rather than regenerates them.

## Outputs (the reusable baseline)
`requirements` · `figma-analysis` · `clarifications` · `impact` · *(`exploratory-notes`)* · `hls` ·
`testcases` · `testcase-review` · `browserstack-import` — under `<storyDir>/`, each recorded in `qa-state.json`.
