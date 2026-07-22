---
name: browserstack-mgmt
type: task
version: 1.0
description: BrowserStack Test Management (QA_PROCESS Phase 3 / CLAUDE.md STEP 7). Generate the BrowserStack CSV from testcases, upload, and verify the import. Inline (creds + destination + verify).
phase: BrowserStack Management
workflow: [qa-implementation-validation]
runsAs: inline
consumes:
  sources: []
  artifacts: [testcases]
  domains: []
produces:
  artifacts: [browserstack-import]
methodology: docs/ai/browserstack-process.md
---

# browserstack-mgmt (task skill)

> Thin wrapper. The **how** is in [`docs/ai/browserstack-process.md`](../../../docs/ai/browserstack-process.md)
> §10.5–10.6 (CSV format, upload, import verification). Credentials are configured (see
> `automation/config/credentials.js`) — do not ask the user; use the loader.

## Steps
1. Convert `testcases/testcases.csv` to the BrowserStack-compatible CSV (granular steps, each with its Expected Result).
2. Confirm project/folder destination (ask only if not provided/saved).
3. Upload; **verify the import**: folder count matches, cases land directly (no nested folder), granular steps render.
4. Write `browserstack/import-report.md` (destination, counts, verification result).

## Recording
```
node qa-workflow/bin/qa-cli.js record "<storyDir>" browserstack-import \
     --path browserstack/import-report.md --generator browserstack-mgmt@1.0 --derive-artifacts testcases
```
