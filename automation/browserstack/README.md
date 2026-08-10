# `automation/browserstack/` — BrowserStack Test Management tooling

Promoted here **2026-08-10**. Every tool below previously existed only inside story folders — nine
near-copies of `upload_browserstack.js` and seven of `gen_browserstack_csv.js` had accumulated, one
per story. STEP 7 of the mandatory process depended on files that would vanish the moment a story
folder was cleaned up. It doesn't any more: **nothing in the workflow reads from a `B10-*` folder.**

## Generic tools — run them for any story, no copying

| Tool | What it does | Run |
|---|---|---|
| [`upload_browserstack.js`](upload_browserstack.js) | Uploads approved cases to Test Management **API v2**, then verifies by reading every case back. **Enforces the approval gate first** (see below) | `node automation/browserstack/upload_browserstack.js --cases <story>/automation/gen_browserstack_csv.js --story-dir <story> --project PR-5 --folder <id> --dry` |
| [`write_tc_ids.js`](write_tc_ids.js) | Writes the returned `TC-xxxx` ids back into `testcases.csv` so `@TmsLink` exists before automation | `node automation/browserstack/write_tc_ids.js --story-dir B10-xxxxx` |
| [`check_tmslink_parity.js`](check_tmslink_parity.js) | Offline check that every `@TmsLink` in the Java class resolves to a real case | `node automation/browserstack/check_tmslink_parity.js --project PR-5` |
| [`compare_stacks.js`](compare_stacks.js) | Joins TestNG XML and Playwright JSON on the case name to compare the two stacks | `node automation/browserstack/compare_stacks.js --story-dir B10-xxxxx [--md]` |

## The approval gate (added 2026-08-10, from the B10-57774 run)

`upload_browserstack.js` refuses to write anything unless **both** hold for the `--story-dir`:

1. `qa-state.json` carries **`approvals.testcases`** — an operator ran `qa-cli approve`.
2. `testcases/testcases.csv` is **byte-identical** to `testcases/testcases.approved.csv`, the checksummed
   snapshot that `approve` took.

Why both, and why here rather than only in `qa-cli`:

- `qa-cli record browserstack-import` already refuses without an approval — but that is *after* the
  upload. By then un-approved cases are live in test management, and removing them is manual.
- An approval covers the suite **as reviewed**. If the generator changed after approval, what would be
  uploaded is not what the operator approved, and only a checksum can tell you.

`--force-unapproved` skips the gate. It prints a warning and the import report must say it was used.

**Do not fill `Test Case ID` in `testcases.csv`** after an import — it must be blank on a new import
(§10.3) and editing it in place breaks the snapshot match above. `write_tc_ids.js` writes a separate
`testcases.with-tc-ids.csv` plus a `tc-map.json`; keep the approved CSV untouched.

The run/results half of the flow is [`../browserstack_test_run.js`](../browserstack_test_run.js) —
it supersedes the old per-story `create_browserstack_run.js` + `push_browserstack_results.js`, so
those were **not** promoted.

## Templates — copy into the story, then fill in

These embed story data by design (the cases, the Java class paths, the not-automated reasons), so
there is no single shared version. Copy, rename by dropping `.template`, and edit:

| Template | Copy to | Fill in |
|---|---|---|
| [`gen_browserstack_csv.template.js`](gen_browserstack_csv.template.js) | `<story>/automation/gen_browserstack_csv.js` | `PROJECT`, `ISSUES`, and the `CASES` array. Keep the 24-column `HEADER` and the step preambles as-is — that shape is the canonical import format ([browserstack-process.md](../../docs/ai/browserstack-process.md) §10.5). It must export `{ CASES, ISSUES }` for the uploader. |
| [`check_test_name_parity.template.js`](check_test_name_parity.template.js) | `<story>/automation/check_test_name_parity.js` | `CLASSES` (the story's Java test classes) and the `NOT_AUTOMATED` map, each entry with its reason |

## The API traps this encodes

`upload_browserstack.js` is the reference implementation, and most of its value is the failure modes
it already knows about ([browserstack-process.md](../../docs/ai/browserstack-process.md) §10.6):

- Test Management is **v2**. v1 answers `401` + an SSO `login_url` for perfectly valid keys.
- Auth is HTTP Basic `tmUsername:tmApiToken` — **not** the App Automate access key.
- The case field is **`name`** on write but comes back as **`title`** on read.
- Steps go in **`test_case_steps`**; a `steps` payload returns **200 and saves none**.
- Create is `POST /projects/{PR-x}/folders/{id}/test-cases` — **folders plural**.
- `GET /folders/{id}/test-cases` is **404**; list with `GET /projects/{PR-x}/test-cases?folder_id=`.
- Responses are wrapped: the created case is at `json.data.test_case`.
- **A 200 is not proof.** Every case is read back and its steps, tags, priority and
  `automation_status` verified, plus a check that nothing nested into a sub-folder.

Credentials come from [`../config/credentials.js`](../config/credentials.js) (env →
`credentials.local.js` → an actionable error). No secret is stored here.
