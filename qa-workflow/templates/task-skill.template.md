---
name: <skill-name>                # lowercase-kebab, unique
type: task
version: 1.0                      # bump (minor) to force targeted artifact regeneration — the `lock` seam
description: <one line; used for skill selection — say when to use it>
phase: <QA_PROCESS phase, e.g. "Phase 2 — Figma Analysis">
workflow: [qa-shift-left]         # which workflow(s) invoke this skill
runsAs: subagent                  # subagent (read-heavy, returns artifact by path) | inline (needs the user)
consumes:
  sources: []                     # e.g. [jira, figma]
  artifacts: []                   # upstream artifact keys, e.g. [requirements, figma-analysis]
  domains: []                     # business domains consumed, e.g. [card, payment]
produces:
  artifacts: []                   # artifact keys this skill writes, e.g. [impact]
methodology: docs/ai/<file>.md    # SOURCE OF TRUTH — this skill is a thin wrapper, do not re-inline
---

# <Skill Name> (task skill)

> Thin wrapper. The **how** lives in `methodology` above; this file defines the skill's
> contract and its qa-state bookkeeping. Do not duplicate methodology here.

## Purpose
<one paragraph: what this phase accomplishes>

## Inputs (by path — never by value)
- Sources: <which live sources it reads>
- Artifacts: <which upstream artifact files it reads from the story folder>
- Domains: <which domain knowledge skills it consults>

## Steps
Follow `methodology` (the referenced doc). Summary of the deterministic-first steps:
1. …
2. …

## Outputs
- Writes: `<story>/<path>` (the produced artifact)
- Returns to the orchestrator: `{ artifactPath, status, <compact summary> }` — NOT the full content.

## qa-state responsibility
On completion, update `<story>/qa-state.json` for each produced artifact:
`path`, `status: complete`, `generatedAt`, `generator: <name>@<version>`,
`derivedFrom` (fingerprints of the sources/artifacts used), `checksum`, `domains`.
Validate against `docs/ai/architecture/qa-state.schema.json` before writing.
