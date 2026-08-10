---
name: browserstack-mgmt
description: BrowserStack Test Management (QA_PROCESS Phase 3 / CLAUDE.md STEP 7). Imports the APPROVED test cases pre-development, and syncs validation-time deltas afterwards. Inline (creds + destination + verify).
metadata:
  type: task
  version: 2.0
  phase: BrowserStack Management
  workflow: [qa-shift-left, qa-implementation-validation]
  runsAs: inline
  consumes:
    sources: []
    artifacts: [testcases, testcase-review, testcase-reconciliation]
    domains: []
  produces:
    artifacts: [browserstack-import]
  methodology: docs/ai/browserstack-process.md
---

# browserstack-mgmt (task skill)

> Thin wrapper. The **how** is in [`docs/ai/browserstack-process.md`](../../../docs/ai/browserstack-process.md)
> §10.5–10.6 (CSV format, upload, import verification) and §10.8 (runs + `automation_status`).
> Credentials are configured (see `automation/config/credentials.js`) — do not ask the user; use the loader.

## Mode A — Import (in `qa-shift-left`) → `browserstack-import`

**Precondition, enforced by the CLI:** `testcase-review` is `complete` **and** `approvals.testcases`
exists. `record browserstack-import` dies otherwise (`PHASE_DEPS` + `APPROVAL_DEPS` in `qa-cli.js`).
**Only approved cases are imported** — if the review is still looping, wait; do not import a draft
"to save a round trip".

1. Convert the approved `testcases/testcases.csv` to the BrowserStack-compatible CSV (granular steps, each with its Expected Result).
2. Confirm project/folder destination (settled in Phase 0; ask only if neither provided nor saved).
3. Upload; **verify the import**: folder count matches, cases land directly (no nested folder), granular steps render.
4. Write `browserstack/import-report.md` (destination, counts, verification result, the case-id ↔ `TC-xxxx` map).
5. Record the returned `TC-xxxx` ids back into `testcases/testcases.csv` — `automation-gen` binds tests to
   them via `@TmsLink`, so the map has to exist before automation, not after.

### Recording
```
node qa-workflow/bin/qa-cli.js record "<storyDir>" browserstack-import \
     --path browserstack/import-report.md --generator browserstack-mgmt@2.0 \
     --derive-artifacts testcase-review
```

## Mode B — Sync (in `qa-implementation-validation`)

Runs **only** when `test-design` Phase C produced a `testcase-reconciliation` and the deltas were
re-reviewed and re-approved. The folder already exists; this is an update, not a fresh import.

1. Read `testcases/reconciliation.md` and apply each delta to the existing folder: **create** new cases ·
   **update** changed ones (steps/expected results) · **archive or delete** obsolete ones · re-link split
   or merged cases.
2. **Never re-upload the whole CSV as new cases** — that duplicates the folder and orphans every
   `@TmsLink` the automation already binds. Match on the recorded `TC-xxxx` id.
3. **Verify every write by reading it back.** A `200` from this API is not proof (§10.8).
4. Update `browserstack/import-report.md` with a dated sync section (deltas applied, ids created/updated/
   removed, verification result) and re-record `browserstack-import`.

## Test runs + `automation_status` (standing step, after automation has run)
A shared test-case **folder link** is the trigger — see `docs/ai/browserstack-process.md` §10.8:
```
node automation/browserstack_test_run.js --folder-url "<link>" --story <TICKET> --dry
node automation/browserstack_test_run.js --folder-url "<link>" --story <TICKET>
```
One run **per platform**; results sourced from App Automate (latest session per test name, filtered by
session `os`); every write read back. Record the run ids in the story report.
