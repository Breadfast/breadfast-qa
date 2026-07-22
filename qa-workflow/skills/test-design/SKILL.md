---
name: test-design
type: task
version: 1.0
description: Test Design (QA_PROCESS Phase 3). HLS generation (shift-left) and detailed test-case generation (validation). Runs as a subagent.
phase: HLS + Test Case Generation
workflow: [qa-shift-left, qa-implementation-validation]
runsAs: subagent
consumes:
  sources: []
  artifacts: [requirements, figma-analysis, impact, clarifications]
  domains: [card, payment, marketing]
produces:
  artifacts: [hls, testcases]
methodology: docs/ai/testing-process.md
---

# test-design (task skill)

> Thin wrapper. The **how** is in [`docs/ai/testing-process.md`](../../../docs/ai/testing-process.md) §3
> (test design) and [`docs/ai/browserstack-process.md`](../../../docs/ai/browserstack-process.md) §10 (case format).
> Two phases share one skill because HLS is the outline test cases expand from. Do not re-inline methodology.

## Phase A — HLS (in `qa-shift-left`) → `hls`
### Inputs (by path)
`requirements` · `figma-analysis` · `impact` · `clarifications` (+ domains `card`, `payment`, `marketing`).
### Steps (per methodology)
1. Read the baseline artifacts.
2. Generate **≤ 20** high-level scenarios (happy/negative/edge/state/validation/nav/permissions/localization/error/regression). Consolidate; do not pad. Honor any per-story `maxHls` override.
3. Write `hls/hls.md` in the canonical `HLS || <Story Name>` format.
4. **Publish to Jira as a separate checklist** (Atlassian MCP) — never modify the original AC.
### Recording
```
node qa-workflow/bin/qa-cli.js record "<storyDir>" hls \
     --path hls/hls.md --generator test-design@1.0 \
     --derive-artifacts requirements,figma-analysis,impact --domains card,payment,marketing
```

## Phase B — Test Cases (in `qa-implementation-validation`) → `testcases`
### Steps (per methodology)
1. Expand each HLS into detailed cases in the **canonical granular standard** (every step its own Expected Result; never combine actions).
2. Write `testcases/testcases.csv` (BrowserStack-compatible). Handed to `browserstack-mgmt` for import.
### Recording
```
node qa-workflow/bin/qa-cli.js record "<storyDir>" testcases \
     --path testcases/testcases.csv --generator test-design@1.0 --derive-artifacts hls,requirements
```

## Output
Returns `{ artifactPath, count, summary }` per phase — compact, not the full content.
