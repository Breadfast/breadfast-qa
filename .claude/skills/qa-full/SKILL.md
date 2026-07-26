---
name: qa-full
description: >-
  Full QA lifecycle (Workflow 3) — the original end-to-end QA process in one run: Pre-Development
  baseline (requirements, figma-analysis, clarifications, impact, HLS → published to Jira) followed by
  Post-Development validation (test cases, BrowserStack import, automation, execution across 4 combos,
  visual testing, defects, QA summary). Use when a delivered story has NO shift-left baseline, or when
  the user wants the whole process start-to-finish in a single pass. If a baseline already exists prefer
  qa-validate; if implementation has not landed yet prefer qa-shift-left. Clarify-first through the
  clarification gate, then auto-run. Takes a Jira ticket key (e.g. B10-56729).
---

# qa-full — entrypoint

> **Thin entrypoint** (the only Claude-Code-specific glue; discarded when QA migrates into the
> breadfast-workflow plugin). Workflow + skills live under `qa-workflow/`.

## What to do
1. Determine the **ticket** (e.g. `B10-56729`) and optional `figmaUrl` / `appUrl` / `mobileAppIds`.
2. Execute **[`qa-workflow/workflows/qa-full.md`](../../../qa-workflow/workflows/qa-full.md)** exactly:
   - **Phase A** = `qa-shift-left.md` Steps 0–5 (init → story-analysis → figma-analysis → **grill-me
     gate** → impact → HLS+publish). The clarification gate is the one planned STOP — do not generate
     HLS before scope is locked.
   - **Step 6 handoff** = run `qa-cli.js reconcile` as a *continuity assertion*; expect all-`reuse`.
     Stale ⇒ mid-run drift, regenerate + re-check. Conflicts ⇒ STOP and ask.
   - **Phase B** = `qa-implementation-validation.md` execution phases 1–8 (skip its Step 0),
     end-to-end without stopping except for a genuine blocker.
   - Fingerprint + `record` every artifact with its **per-skill** generator; validate `qa-state.json`.
3. Report the baseline summary **and** the QA Summary (functional + visual, coverage, risks,
   Pass / Pass-with-risks / Fail).

## Choosing between the three workflows
- No implementation yet → **`qa-shift-left`**.
- Implementation delivered **and** a baseline exists → **`qa-validate`**.
- Implementation delivered, **no** baseline (or one uninterrupted pass wanted) → **`qa-full`**.
- Interrupted mid-`qa-full` after the baseline landed → resume with **`qa-validate`**.

## Guardrails
- Authoritative methodology: `docs/ai/QA_PROCESS.md` (Phases 1–6, all gates); reuse contract:
  `docs/ai/architecture/qa-artifact-contract.md`. This entrypoint re-inlines neither.
- Artifacts must stay contract-compatible with a `qa-shift-left` + `qa-validate` pair: stamp artifacts
  with the **producing skill's** generator (`story-analysis@1.0`, …), never `qa-full@1.0` — only the
  state-level `generatedBy` names the workflow.
- Outward actions (publishing the HLS checklist to Jira — a **separate** checklist, never editing the
  original AC; BrowserStack uploads; filing Jira bugs) are done per the workflow.
