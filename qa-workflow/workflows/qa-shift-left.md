---
name: qa-shift-left
type: workflow
version: 1.0
description: Pre-Development QA (shift-left) — validate the story before implementation; produce reusable analysis artifacts.
purpose: Produce the reusable baseline (requirements, figma-analysis, clarifications, impact, hls) and publish the HLS checklist to Jira.
inputs: { ticket: required, figmaUrl: optional-override, appUrl: optional }
---

# Workflow 1 — Pre-Development (Shift-Left)

**Executor:** Claude Code (agent-followed). **Methodology (source of truth):**
[`../../docs/ai/QA_PROCESS.md`](../../docs/ai/QA_PROCESS.md) Phases 1–5-analysis · `CLAUDE.md` §2 STEP 1–5.
**Reuse contract:** [`../../docs/ai/architecture/qa-artifact-contract.md`](../../docs/ai/architecture/qa-artifact-contract.md).
**Discipline:** **clarify-first** — Step 3 may STOP and ask; do not proceed past it until scope is locked.

> **Execution model:** run each read-heavy phase skill as a **subagent** that writes its artifact file
> and returns a **compact summary** (artifact path + key facts), NOT the full content. The orchestrator
> shuttles paths + summaries + `qa-state.json`, keeping its own context lean. Skill bodies (the *how*)
> live in `../skills/<name>/SKILL.md`; each references `docs/ai/**`.

## Inputs
- `ticket` (required) — Jira key, e.g. `B10-56729`.
- `figmaUrl` (optional) — override; otherwise take **this story's** Figma link from the ticket.
- Story folder: `D:\breadfast-qa\<ticket>\` (create if missing).

## Steps

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

### 5 · HLS  → `hls`  (+ publish to Jira)
- Run the **`test-design`** skill (subagent, HLS phase). Generate ≤ 20 HLS, write `hls/hls.md`, and **publish them to Jira as a separate checklist** (never modify the original AC).
- Record:
  ```
  node qa-workflow/bin/qa-cli.js record "<storyDir>" hls \
       --path hls/hls.md --generator test-design@1.0 \
       --derive-artifacts requirements,figma-analysis,impact --domains <domains>
  ```

## Completion
- `node qa-workflow/bin/qa-cli.js show "<storyDir>"` — confirm all five baseline artifacts are `complete` and `qa-state.json` validates.
- Report the baseline summary. These artifacts are the **reusable input** to Workflow 2 (`qa-implementation-validation`), which reconciles rather than regenerates them.

## Outputs (the reusable baseline)
`requirements` · `figma-analysis` · `clarifications` · `impact` · `hls` — under `<storyDir>/`, each recorded in `qa-state.json`.
