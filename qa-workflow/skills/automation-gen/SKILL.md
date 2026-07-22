---
name: automation-gen
type: task
version: 1.0
description: Automation Generation (QA_PROCESS Phase 4). Automate the generated test cases reusing framework assets (Playwright/Appium/Java). Runs as a subagent.
phase: Automation Generation
workflow: [qa-implementation-validation]
runsAs: subagent
consumes:
  sources: []
  artifacts: [testcases]
  domains: []
produces:
  artifacts: [automation]
methodology: docs/ai/automation/playwright-framework.md
---

# automation-gen (task skill)

> Thin wrapper. The **how** is in [`docs/ai/automation/`](../../../docs/ai/automation/) —
> [`playwright-framework.md`](../../../docs/ai/automation/playwright-framework.md),
> [`coding-standards.md`](../../../docs/ai/automation/coding-standards.md),
> [`reusable-components.md`](../../../docs/ai/automation/reusable-components.md) (reuse-before-build),
> and the canonical Java/Appium framework at `D:\projects`.

## Reuse-before-build
Search the framework catalogs first; never duplicate existing page objects, helpers, fixtures, or API
clients. New reusable assets go in shared `automation/` (mirrored to the runnable `b55168_pom`).

## Steps
1. Map each generated case to framework page-objects/helpers; identify gaps.
2. Author specs under the story's `automation/tests/`; story name traceable in assets.
3. Automate **all** generated cases; validate against expected results.

## Recording
```
node qa-workflow/bin/qa-cli.js record "<storyDir>" automation \
     --path automation/README.md --generator automation-gen@1.0 --derive-artifacts testcases
```
Returns `{ specsAdded, reusedAssets, gaps }` (compact).
