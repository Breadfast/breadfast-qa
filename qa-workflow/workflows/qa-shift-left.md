---
name: qa-shift-left
type: workflow
version: 1.0
description: Pre-Development QA (shift-left) — validate the story before implementation; produce reusable analysis artifacts.
purpose: Produce the reusable baseline (requirements, figma-analysis, clarifications, impact, hls) and publish the HLS checklist to Jira.
---

# Workflow 1 — Pre-Development (Shift-Left)

> **Scaffold stub.** Full sequencing authored in the implementation phase.
> Methodology: [`../../docs/ai/QA_PROCESS.md`](../../docs/ai/QA_PROCESS.md) Phases 1–5-analysis (STEP 1–5).
> Reuse contract: [`../../docs/ai/architecture/qa-artifact-contract.md`](../../docs/ai/architecture/qa-artifact-contract.md).

## Sequence (clarify-first; may stop and ask)
1. `story-analysis`   → `requirements`
2. `figma-analysis`   → `figma-analysis`
3. `clarification` (grill-me, inline) → `clarifications`   ⟵ gate: stop until scope locked
4. `impact-analysis`  → `impact`
5. `test-design` (HLS phase) → `hls` + publish HLS checklist to Jira

## Outputs
The reusable baseline in `<TICKET>/`, each recorded in `<TICKET>/qa-state.json`
(validated against `qa-state.schema.json`). These are consumed — not regenerated — by Workflow 2.
