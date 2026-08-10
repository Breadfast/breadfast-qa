---
name: testcase-review
description: Test Case Review Gate (QA_PROCESS Phase 3 exit). Reviews generated test cases against the AC map, the design and the format standard; revises until clean; then stops for operator approval. Nothing is imported to BrowserStack before it passes. Runs as a subagent, ends inline at the approval stop.
metadata:
  type: task
  version: 1.0
  phase: Test Case Review / Approval
  workflow: [qa-shift-left]
  runsAs: subagent
  consumes:
    sources: []
    artifacts: [testcases, hls, requirements, figma-analysis, impact, clarifications]
    domains: [card, payment, marketing]
  produces:
    artifacts: [testcase-review]
  methodology: docs/ai/testing-process.md
---

# testcase-review (task skill)

> The gate between **generating** coverage and **committing** it to the test-management system.
> Methodology: [`docs/ai/testing-process.md`](../../../docs/ai/testing-process.md) §3 (design rules,
> §3.7 the canonical step structure) and [`docs/ai/browserstack-process.md`](../../../docs/ai/browserstack-process.md)
> §10 (case format). Do not re-inline them.

```
Generate Test Cases  →  Review / Validate  →  Approved?  ──yes──►  BrowserStack import
                              ▲                    │
                              └──────── no ────────┘  revise
```

**Why a gate and not a note.** An imported suite is what the squad, the automation `@TmsLink` map and
every later run treat as the definition of coverage. Importing first and fixing later leaves duplicated,
unrelated or mis-scoped cases in the shared folder, where they are read as agreed scope. Cheaper by an
order of magnitude to reject a case before it is imported.

## Inputs (by path)
`testcases/testcases.csv` + `testcases/coverage-notes.md` · `hls` · `requirements` (AC map) ·
`figma-analysis` · `impact` · `clarifications`.

## Step 1 — run the mechanical checks (they are an exit code, not an opinion)

```
node qa-workflow/bin/qa-cli.js testcase-lint "<storyDir>" \
     --acs-from "<storyDir>/requirements-analysis/requirements.md" --require-screens
```
**Exits 1 on any error.** Fix and re-run until it is clean — do not carry a lint error into the manual
pass, and do not "explain" one in `review.md`. It covers duplicate titles and duplicate step-sequences,
every step having its own Expected Result, the canonical 24-column format, the
Priority/Type/Automation-Status vocabulary, `ac:` tags and **AC coverage** (computed from the AC list,
not asserted). Convention for the tags: [`browserstack-process.md`](../../../docs/ai/browserstack-process.md) §10.2a.

## Step 2 — the checklist — every item gets an explicit verdict
Run it as a written pass over the actual file, not from memory of having generated it. **M** = the lint
proves it; **J** = your judgement, and the reason this gate is not just a script.

| # | Check | | Fails when |
|---|---|---|---|
| 1 | **No duplicates** | **M**+J | two cases assert the same behaviour on the same screen/state, or differ only in wording (the lint catches identical titles and identical step-sequences; near-duplicates are yours) |
| 2 | **No unrelated cases** | J | a case tests something this story neither changes nor puts at risk (padding, or a dimension outside the ACs) |
| 3 | **No missing AC coverage** | **M**+J | an AC has no case (lint: `uncovered-ac`); **or** an AC's *negative*/boundary side has none — that half is yours. Every AC → ≥ 1 case, stated in `coverage-notes.md` |
| 4 | **Correct expected results** | J | an expected result restates the action, is vague ("works correctly"), or contradicts the AC/design. **AC wins over design on conflict** |
| 5 | **Correct granularity** | **M**+J | a step has no expected result (lint); steps combine actions, or navigation/verification are implied rather than explicit (§3.7 — yours) |
| 6 | **Correct categorization** | **M**+J | value outside the Priority/Type/Automation-Status vocabulary or a missing `screen:` tag (lint); the *right* type/priority for this case is yours |
| 7 | **Correct automatable classification** | J | a case marked automatable depends on something the framework cannot drive (external OTP-free assumption, manual backend state, visual judgement) — or a plainly automatable case is marked manual |
| 8 | **Regression coverage justified** | J | a regression case cites no impacted area from `impact`; or an impacted area from `impact` has no case |
| 9 | **Format conformance** | **M** | the CSV will not import cleanly: header, required author fields, orphan step rows, per-step structure. Encoding/RTL round-trip of `*_ar` content is yours to eyeball |

**Scope check (before all of the above):** confirm the platform/locale scope the cases assume matches
what `prerequisites.md` established about the surface under test. Cases that sweep AR/RTL on a surface
with no Arabic UI are check-2 failures, not coverage.

## Steps
1. Read the cases and every input artifact.
2. Run `testcase-lint` until it exits 0, then run all nine checks; record **pass / fail + evidence
   (case ids)** for each.
3. **Revise:** fix every failure by editing `testcases/testcases.csv` (re-invoke `test-design` Phase B for
   substantial regeneration), then **re-run lint + the checklist from the top**. Loop until all nine pass.
4. Write `testcases/review.md`: the lint output (final, clean), the checklist with verdicts, every
   revision made and why, the AC→case coverage table, the automatable/manual split, and the counts
   (`before → after`).
5. **Build the operator's review page** (standard since 2026-08-10, operator instruction — see
   *Operator review page* below) and hand over its link.
6. **STOP and present for approval.** Give the operator the counts, the AC coverage table, the deltas
   from the review, and anything you deliberately left out. This is a planned stop in `qa-shift-left`
   and in `qa-full`.
7. **Apply what comes back.** The page returns a structured block — `NEEDS UPDATE` / `INVALID (DELETE)`
   / `ACCEPTED, WITH A NOTE` / `AUTOMATE` / `DO NOT AUTOMATE` / `OVERRIDES`, each entry carrying the
   operator's comment. Treat it as the revision list: edit `testcases.csv`, **re-run lint and the nine
   checks from the top**, and append an *Operator-requested revisions* table to `review.md` recording
   case id → instruction → what changed. Then present again. Only when nothing is left in the update and
   delete sections is the suite ready to approve. Carry the `AUTOMATE` selection into the automation
   phase — it is the scope, and `DO NOT AUTOMATE` cases are `Automation Not Required` in the CSV.

## Operator review page (standard for every story)

The nine checks are the *reviewer's* pass. This is the **operator's** pass, and it is not optional —
a suite reaches the approval stop with a link to it.

```
node automation/gen_testcase_review_page.js --story "<storyDir>"        # -> <storyDir>/testcases/review-page.html
node automation/gen_testcase_review_page.js --story "<storyDir>" --out <path>   # to publish as an Artifact
```

It reads the CSV with **this repo's own parser**, so the page can never disagree with what
`testcase-lint` sees. One case at a time: metadata chips, the description, the preconditions, and every
step as **Action → Expected result**; a rail lists all cases with their verdict marks; verdicts persist
in `localStorage` keyed by ticket, so a long review survives a closed tab.

Per case the operator records **one of three verdicts plus a comment**:

| Verdict | Meaning | What the comment must carry |
|---|---|---|
| **Accept** | correct as written | optional |
| **Needs update** | keep the case, change it | *what* to change — a step number makes it unambiguous |
| **Invalid — delete** | the case should not exist | *why* |

### Automation scope is decided at the same gate

Approval settles **which cases get automated**, not just which are correct — so the page carries a
per-case automation recommendation and a pick-list. Author
`<storyDir>/testcases/automation-plan.json` alongside the CSV:

```json
{ "ticket": "B10-XXXXX", "target": "Java + Selenium …", "storyClass": "B10_XXXXX_FeatureTests",
  "traps": ["[[memory-link]] — why it bites here"],
  "cases": [ { "n": 1, "recommend": "yes|no|partial", "layer": "selenium|api|manual",
               "effort": "S|M|L", "reason": "…", "reuse": ["…"], "blockers": ["…"], "traps": ["…"] } ] }
```

`recommend` is the reviewer's judgement with its reason, effort and any blocker stated; the checkbox is
the **operator's** decision. The recommended set is pre-ticked on first open so the operator *overrides*
rather than starts from nothing, and the export names every override in both directions. A case marked
**Invalid** drops out of the automation scope automatically — there will be nothing to automate.

The plan is **optional**: with no file the page degrades to the CSV's Automation Status and says no plan
has been authored. It is **validated** — the generator warns when the plan and the CSV have drifted
(a case with no entry, or an entry pointing at a case that does not exist).

Then, after approval: automate **only** the selected set, and set the CSV's `Automation Status` to match
the operator's picks before the BrowserStack import, so test management and the framework agree from the
start rather than being reconciled later.

**Why three verdicts and a comment, not a flag.** On **B10-57776** the first version of this page offered
only ok/flag. It could say *that* a case was wrong but not *what to change*, and it had nowhere to say
"delete this one" — so the operator's review came back as a bare count (`24 of 24 accepted, 0 flagged`)
with no revision instructions attached. The operator asked for the comment field and for this page to be
unified across stories; both are now part of the gate.

**Approving is still not this skill's job.** The page records the operator's *review*; it does not run
`approve`. A page reporting every case accepted is evidence for the operator's decision, never a
substitute for the command below carrying their name.

## Recording
```
node qa-workflow/bin/qa-cli.js record "<storyDir>" testcase-review \
     --path testcases/review.md --generator testcase-review@1.0 --derive-artifacts testcases
# ...then, and only then, on the operator's explicit word:
node qa-workflow/bin/qa-cli.js approve "<storyDir>" testcases --by "<operator>" [--note "<note>"]
```

> **Reviewing is this skill's job; approving is not.** `record` alone does not open the gate —
> `browserstack-mgmt` cannot record `browserstack-import` without `approvals.testcases`
> (`APPROVAL_DEPS` in `qa-cli.js`). Never run `approve` with your own name, an assumed consent, or
> "the operator asked for the whole workflow" as the authority. If the operator wants to skip the gate,
> that is a recorded deferral with their name on it:
> `qa-cli.js defer "<storyDir>" testcase-review --by "<operator>" --reason "<why>"`.

## Output
Returns `{ artifactPath, reviewPagePath, checks: {passed, failed}, revisions, operatorRevisions, before, after, acCoverage, awaitingApproval: true }`.
