---
name: story-analysis
type: task
version: 1.0
description: Requirements Analysis (QA_PROCESS Phase 1). Fetch the Jira story (description, AC, comments) and produce a structured requirements artifact. Runs as a subagent in qa-shift-left.
phase: Phase 1 — Requirements Analysis
workflow: [qa-shift-left]
runsAs: subagent
consumes:
  sources: [jira]
  artifacts: []
  domains: [card, payment]
produces:
  artifacts: [requirements]
methodology: docs/ai/QA_PROCESS.md
---

# story-analysis (task skill)

> Thin wrapper. The **how** is in [`docs/ai/QA_PROCESS.md`](../../../docs/ai/QA_PROCESS.md) Phase 1 and
> `CLAUDE.md` §2 STEP 1. This file defines the contract + qa-state bookkeeping — do not re-inline methodology.

## Purpose
Turn the Jira story into a structured, reusable **requirements** baseline.

## Inputs
- **Jira issue** via Atlassian MCP (`getJiraIssue`): summary, description, **acceptance criteria, and all comments** (comments may override/clarify/invalidate AC — always analyze them), plus linked docs/attachments/related tickets.
- **Domains consumed:** `card`, `payment` — consult `../../domains/<id>/SKILL.md` for business rules to apply; do not re-derive them here.

## Steps (per methodology)
1. Fetch the issue + comments; note the `updated` timestamp.
2. Extract: business objective, functional + non-functional requirements, dependencies, risks, **missing requirements**, testability concerns. Fold in comment overrides.
3. Write **`requirements-analysis/requirements.md`** (objective · requirements · dependencies · risks · gaps · open questions).

## Output & recording
- Writes: `<storyDir>/requirements-analysis/requirements.md`.
- Return to the workflow: `{ artifactPath, updated, domains, summary }` (compact — not the file body).
- The workflow fingerprints Jira and records the artifact:
  ```
  echo '<issue-json:{updated,summary,description,ac,comments[]}>' | node qa-workflow/bin/qa-cli.js fingerprint-jira "<storyDir>"
  node qa-workflow/bin/qa-cli.js record "<storyDir>" requirements \
       --path requirements-analysis/requirements.md --generator story-analysis@1.0 \
       --derive-sources jira --domains card,payment
  ```
