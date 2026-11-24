---
name: qa-shift-left
description: >-
  Pre-Development QA (Workflow 1, shift-left). Use when starting QA on a Jira story
  BEFORE implementation — to establish the complete QA coverage baseline: requirements,
  figma-analysis, clarifications, impact, optional exploratory analysis, HLS (published to
  Jira), test cases, the mandatory test-case review/approval gate, and the BrowserStack
  import of the approved cases. Two planned stops: clarification and test-case approval.
  Takes a Jira ticket key (e.g. B10-XXXXX).
---

# qa-shift-left — entrypoint

> **Thin entrypoint** (the only Claude-Code-specific glue; discarded when QA migrates into the
> breadfast-workflow plugin). The workflow definition and skills live under `qa-workflow/`.

## What to do
0. **Readiness first — before reading the ticket.** If the doctor reports `firstRun: true`, run the one-time
   [`qa-setup`](../qa-setup/SKILL.md) workflow first, then come back here. Run `node scripts/doctor.mjs --json`, check the
   Atlassian/Figma connections, and ask for everything missing (team, credentials, installs) in ONE batch,
   exactly as in the *Readiness* section of
   [`detect-prerequisites`](../../../qa-workflow/skills/detect-prerequisites/SKILL.md). Re-run the doctor
   only to confirm what was added. **Nothing the tester hasn't done yet stops the run**: anything skipped is
   recorded in `prerequisites.md` with the step that needs it (`fix.when`), the run carries on, and it is asked
   for again right before that step. Only a doctor `blocking` item (old Node, no Git, wrong folder) stops it.
   **Team knowledge:** the brief names the selected team. Its product knowledge is ONLY what
   `node qa-workflow/bin/qa-cli.js knowledge` lists. Never read another team's domain (`qa-workflow/domains/<d>/`)
   or `teams/<other>/` folder. A story that needs one gets an operator-approved `qa-cli.js cross-domain` first.
1. Determine the **ticket** from the user's input (e.g. `B10-XXXXX`) and optional `figmaUrl`/`appUrl`.
2. Execute the workflow in **[`qa-workflow/workflows/qa-shift-left.md`](../../../qa-workflow/workflows/qa-shift-left.md)** exactly, in order:
   - Init story dir + `qa-state.json` (`qa-workflow/bin/qa-cli.js`).
   - Run each phase skill from `qa-workflow/skills/<name>/SKILL.md` — read-heavy ones as **subagents** returning artifacts by path.
   - **Clarification is a gate** (grill-me): STOP and ask until scope is locked; do not generate HLS before then.
   - **Exploratory analysis (Step 5) is conditional** — run it when it will change the cases; if you skip it, say so and why.
   - **Test-case review (Step 8) is the second gate:** review → revise → re-review until the ten checks
     pass, then **STOP for the operator's approval**. Do not import before it.
   - Fingerprint + `record` each artifact, and validate `qa-state.json`.
3. On completion, `qa-cli.js complete-check <storyDir> --profile shift-left` and report the reusable baseline.

## Guardrails
- Follow `docs/ai/QA_PROCESS.md` (authoritative methodology) and the reuse contract in `docs/ai/architecture/qa-artifact-contract.md`.
- Do not re-inline methodology; skills reference `docs/ai/**`.
- Publishing HLS to Jira and importing to BrowserStack are outward actions — do them per the workflow, adding a **separate checklist** (never editing the original AC).
- **The HLS post to Jira is HLS-ONLY.** No questions, no clarification list, no analysis commentary.
  Questions go to Jira **only** when the operator says an item needs the Product Owner, and then as a
  separate comment. Gate questions the operator answered are internal — they are never published.
- **Never run `qa-cli.js approve` on your own authority.** Reviewing the cases is yours; approving them is
  the operator's. Without `approvals.testcases` the import cannot be recorded — that is the design, not an obstacle.
