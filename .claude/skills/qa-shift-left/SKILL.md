---
name: qa-shift-left
description: >-
  Pre-Development QA (Workflow 1, shift-left). Use when starting QA on a Jira story
  BEFORE implementation — to produce the reusable analysis baseline (requirements,
  figma-analysis, clarifications, impact, HLS) and publish the HLS checklist to Jira.
  Clarify-first: stops to lock scope before HLS. Takes a Jira ticket key (e.g. B10-56729).
---

# qa-shift-left — entrypoint

> **Thin entrypoint** (the only Claude-Code-specific glue; discarded when QA migrates into the
> breadfast-workflow plugin). The workflow definition and skills live under `qa-workflow/`.

## What to do
1. Determine the **ticket** from the user's input (e.g. `B10-56729`) and optional `figmaUrl`/`appUrl`.
2. Execute the workflow in **[`qa-workflow/workflows/qa-shift-left.md`](../../../qa-workflow/workflows/qa-shift-left.md)** exactly, in order:
   - Init story dir + `qa-state.json` (`qa-workflow/bin/qa-cli.js`).
   - Run each phase skill from `qa-workflow/skills/<name>/SKILL.md` — read-heavy ones as **subagents** returning artifacts by path.
   - **Clarification is a gate** (grill-me): STOP and ask until scope is locked; do not generate HLS before then.
   - Fingerprint + `record` each artifact, and validate `qa-state.json`.
3. On completion, `qa-cli.js show <storyDir>` and report the reusable baseline.

## Guardrails
- Follow `docs/ai/QA_PROCESS.md` (authoritative methodology) and the reuse contract in `docs/ai/architecture/qa-artifact-contract.md`.
- Do not re-inline methodology; skills reference `docs/ai/**`.
- Publishing HLS to Jira is an outward action — do it per the workflow, adding a **separate checklist** (never editing the original AC).
