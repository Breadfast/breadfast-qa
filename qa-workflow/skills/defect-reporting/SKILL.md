---
name: defect-reporting
description: Defect Reporting (QA_PROCESS Phase 6). File Jira bugs — functional and visual Design bugs — with evidence, severity, and priority. Inline (files to Jira).
metadata:
  type: task
  version: 1.1
  phase: Defect Reporting
  workflow: [qa-implementation-validation]
  runsAs: inline
  consumes:
    sources: []
    artifacts: [execution, visual-findings]
    domains: []
  produces:
    artifacts: [defects]
  methodology: docs/ai/bug-reporting.md
---

# defect-reporting (task skill)

> **STOP. Before filing anything, open [`docs/ai/bug-reporting.md`](../../../docs/ai/bug-reporting.md) and
> read §1.1 (the Defect Grounding Gate) and §4 (the B10 bug structure). Citing that document is not reading
> it.** **v1.1 (2026-07-28)** exists because on **B10-56652 five bugs were filed without doing either — and
> all five were rejected.** The filer had named the document in the defect log and never opened it, so the
> bugs carried a wrong title shape, an empty Steps/Actual/Expected set, the whole report dumped in
> `description`, and **zero attachments**.

## Inputs (by path)
`execution` (functional failures + evidence) + `visual-findings` (confirmed Design defects + annotated evidence).

---

## Step 1 · Run the Grounding Gate over YOUR OWN candidate list — in writing

Take every candidate finding and write the verdict of §1.1 checks 1–8 next to it. **Do not skip this because
the findings are your own — that is exactly when it gets skipped.**

The two checks that killed all five B10-56652 bugs:

- **Check 1 — Source cited.** Name the exact **AC**, **Figma element** or **business rule** violated. If the
  sentence starts *“it should…”* and you cannot point at where it says so, it is an **observation**, not a
  defect. Four of five died here — filed against invented expectations, one of them a whole dimension
  (accessibility) that was never in scope.
  - **When an AC and the design disagree, the AC wins** (check 7). If your own write-up says *“the build
    follows the AC literally”*, that is a **stop**, not a footnote.
  - **A clarification-gate decision is not a spec.** An assumption you asked to have locked cannot outrank an
    explicit AC — if they conflict, raise a **requirements question**, do not file a bug.
  - **Never test a dimension outside the story's ACs** (accessibility, API contracts, performance) unless
    asked. Real-but-out-of-scope observations belong in the report or the automation notes.
- **Check 8 — verify the negative.** A negative read from an accessibility/DOM dump is worthless until the
  container is exhausted: **scroll a scrollable list to its end** (or query the data layer) before concluding
  something is absent. One B10-56652 bug was a plain factual error from dumping a scrollable grid once.

Everything that fails the gate becomes a **report-only observation** in `defects/defects.md` — the value is
kept and Jira stays clean.

## Step 2 · Capture the evidence BEFORE building the ticket

Attachments are **mandatory**, so gather them first rather than bolting them on:

| # | File | Naming |
|---|---|---|
| 1 | the **actual** screenshot of the wrong result | `actual-<slug>.png` |
| 2 | the **design / expected** frame (when a design exists) | `design-<slug>.png` |
| 3 | a **short screen recording** of the failing flow | `F-0N-<slug>.mp4` |

Convert `.webm` → `.mp4`. Never `image1.png`. For BrowserStack runs the session video is a legitimate source.

## Step 3 · File it with the script — never by hand

```
node automation/file_jira_bug.js --spec <bug.json> --dry   # validate + preview, writes nothing
node automation/file_jira_bug.js --spec <bug.json>         # create + attach + verify
node automation/file_jira_bug.js --verify <ISSUE-KEY>      # audit any bug against the standard
```

[`automation/file_jira_bug.js`](../../../automation/file_jira_bug.js) encodes §4 completely: the
`[System Testing][<combo>]` title, the three template fields (**Steps** `customfield_10042`, **Actual
Result** `10043`, **Expected Result** `10044`), every required field (Severity `10076`, Testing Phase
`10078`, Bug type `10079`, Environment `10348`, Platform `10467`, Squad `10183`, Components, Priority,
Labels), **`description` left EMPTY**, `parent` = the story key (`Bug` is a **sub-task**), attachment upload
with the correct per-file `Content-Type`, and a **post-create re-read that prints what actually landed**.

It **refuses to write** when a spec has no attachments, carries an AC number in any field, restates Severity
in text, populates `description`, uses a generic attachment filename, or puts an **Environment block on a web
bug**. It also **assembles the Steps block for you** from `builds` / `language` / `precondition` / `stepList`,
so the Environment shape cannot be got wrong:

- **Environment = version + build number only** (mobile). No device, locale, account or BrowserStack session.
- **Web bugs get NO Environment block.**
- `Language : Arabic` only when the bug is **locale-specific**.
- **`Precondition:` is omitted unless genuinely mandatory** to reproduce.

And it **warns when Actual/Expected read as machine-written** — methodology notes, hedging (*“plausibly”*,
*“arguably”*), essay connectives (*“furthermore”*, *“in other words”*), *“Note for triage:”* paragraphs, or
first person. Those fields are a senior QA engineer's note: state the fact, give the number or exact string,
cite the authority, stop.

## Step 4 · Read the verify output before telling anyone the bug is filed

**HTTP 201 is not proof of a well-formed bug.** The script prints a ✓/✗ line per required element plus the
attachment list. If any line is ✗, fix it *before* the bug appears in a summary, a Jira comment or a report.
Never report a bug as filed on the strength of the create call alone — that is how five malformed bugs got
announced as done.

## Step 5 · Write the index

`defects/defects.md` — filed bugs with keys, severity, **the gate verdict that justified each one**, evidence
links, **and the report-only observations with the reason each was not filed**.

## Guardrails
- Filing Jira bugs is an **outward action** — file per the story process; never fabricate, never duplicate an
  existing bug. Group a recurring issue (one shared component/token) into a single bug.
- **One defect = one bug.** Never bundle.
- Severity/Priority live in the **Jira fields only** — never restated in any text field.
- If a filed bug is later shown to be invalid, **retract it explicitly**: comment the reason on the ticket,
  correct `defects.md` and the QA summary, and correct every report that cited it. Never leave a rejected bug
  standing as if it were valid.

## Recording
```
node qa-workflow/bin/qa-cli.js record "<storyDir>" defects \
     --path defects/defects.md --generator defect-reporting@1.0 --derive-artifacts execution,visual-findings
```
