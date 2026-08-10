# B10-57766 — Admin Portal · Homepage Perks Management (shift-left baseline)

Pre-development QA baseline, built 2026-08-10 with `/qa-shift-left`.
**Nothing is executed here** — the feature was not deployed when this was produced (every
`card/perks/homepage/*` endpoint 404'd against positive *and* negative controls, and all 33 deployed
frontend chunks lacked `Manage homepage`). `qa-validate` **reconciles** this baseline against what ships;
it does not regenerate it.

> Per the repo convention (`.gitignore`), only this `automation/` folder and the README are
> version-controlled per story. The analysis artifacts, design frames, CSVs and reports live in the story
> folder locally: `requirements-analysis/ figma-analysis/ clarification/ impact-analysis/ hls/ testcases/
> browserstack/ evidence/`.

## Scope

**Web Admin Portal (card panel), English only — 1 combo.** Not a mobile story (`Platform = BE`; the tech
plan puts mobile FE build/QA out of scope). The card panel has no Arabic UI, so an AR/RTL UI sweep is
**Not Applicable** — never reported as passed.

## Scripts

| Script | What it does |
|---|---|
| `gen_browserstack_csv.js` | Single source of the test cases. Emits the canonical 24-column CSV (one row per step) to `../testcases/testcases.csv`. Every asserted string traces to the AC, the captured design, or a live probe. Re-runnable and idempotent. |
| `upload_browserstack.js` | Uploads the **approved** cases to the fixed operator-supplied destination. Creates no project and no folder. Verifies by reading every case back — a `200` is not proof. `--dry` prints the resolved destination and first payload without writing. |

```bash
node B10-57766/automation/gen_browserstack_csv.js      # regenerate the CSV
node B10-57766/automation/upload_browserstack.js --dry # resolve + preview, change nothing
node B10-57766/automation/upload_browserstack.js       # upload + verify
```

Re-lint after any regeneration (this is a gate, exit 1 on failure):

```bash
node qa-workflow/bin/qa-cli.js testcase-lint "D:/breadfast-qa/B10-57766/testcases/testcases.csv" \
     --acs-from "D:/breadfast-qa/B10-57766/requirements-analysis/requirements.md" \
     --require-screens --new
```

## Baseline summary

**20 HLS** (published to Jira as comment 126077, as a separate checklist — the original AC untouched)
→ **28 cases · 249 steps · AC coverage 6/6** (computed by lint, not asserted) · 0 lint errors, 0 warnings.
14 Critical / 11 High / 3 Medium · 26 Functional / 2 Regression.

## BrowserStack traceability

**Destination:** project **PR-5 "BCard Squad"** (numeric `2407303`) · folder **`54235790` "Admin Portal -
Homepage Perks Management"** (parent `54229450` "Card Ops.Sprint3.4"). Imported as **TC-54916 … TC-54943**.
Verified: 28 cases, 249 steps, 0 duplicates, 0 sub-folders, every `ac:` tag present, all priorities and
case types round-tripped.

Full ref → id → AC table: `../browserstack/import-report.md`. Machine-readable binding source for
`@TmsLink`: `../browserstack/tc-map.json`.

| AC | Cases |
|---|---|
| AC1 | TC-54916, TC-54917, TC-54941, TC-54942 |
| AC2 | TC-54918, TC-54919, TC-54920, TC-54921, TC-54922, TC-54940 |
| AC3 | TC-54923 … TC-54930 |
| AC4 | TC-54931, TC-54932, TC-54933, TC-54936, TC-54938, TC-54939, TC-54940 |
| AC5 | TC-54937 |
| AC6 | TC-54934, TC-54935, TC-54936, TC-54943 |

> **This folder is a SYNC target from now on, not a re-import target.** Apply reconciliation deltas by
> `TC-xxxxx` id (create / update / archive). Re-uploading the CSV duplicates the folder and orphans every
> `@TmsLink`.

## Read this before automating

- **Target the Java framework** (`D:\projects`), web ⇒ Java + Selenium. Story class
  `B10_57766_HomepagePerksTests`, one `@TmsLink`-bound `@Test` per automatable case, `description` = the
  **verbatim** BrowserStack title. Check with `check_test_name_parity.js` before running.
- **Reuse before build:** `modals/cardsAdminPanel/PerksPage.java` (1 339 lines) already has
  `waitForPerksPageToLoad()`, `reopenPerksPage()`, `clickOnAddPerkBtn()`, `perksTableIsDisplayed()`,
  `filterPerksTableByCategory()`, `getPerksTableColumnValues()`, `getPerkSectionFromTable()` and the whole
  create-perk fill suite for seeding. `CardAdminPanelLoginPage.java` owns login. New page objects needed:
  `HomepagePerksPage`, `ReplacePerkModal`. Methods and data live on page objects, never as private helpers
  in the test class.
- **Drag-and-drop is the risky part.** CDK DragDrop is unreliable under Selenium `Actions.dragAndDrop`;
  expect a click-hold-move-move-release sequence. Classify those cases realistically.
- **Do the data-integrity cases at the API layer** (TC-54938, TC-54939). The cap of 5 is
  application-enforced, not a DB constraint, so the UI cannot over-fill it.
- **`listPerks` contract** the Replace modal reuses: `{ skip:<1-based page>, filter:{status,type,section_id} }`,
  **15 rows/page**, **no total count**, and **no text search**. Flat filter params look silently ignored —
  that is the wrong payload shape, not an API bug.
- **Seed, don't discover.** Perk `status` is virtual (date-derived) and only 2 planned perks exist; new
  perks push fixtures off page 1.

## Two cases that cannot pass yet — do not report them as passing

| Case | Why | Required handling |
|---|---|---|
| **TC-54924** | The `Featured (Yes/No)` column has no backing field — `featured` exists on none of the 195 live perks. It arrives with **B10-57764** | Report **Not Verifiable** with evidence |
| **TC-54941** | Permission gating needs a second admin account **without** the homepage permission. None exists; the only configured login holds every action | Report **Not Verifiable**; the required account is named in the case's Preconditions |

## Open items carried into validation

1. How the homepage is **first populated**, and whether it can hold fewer than 5 — no Add and no Remove
   affordance exists in the AC or the design.
2. **"Category" will name two different things** once B10-57777 (MCC Categories) ships; this baseline
   asserts mobile **Section**.
3. The **mobile read contract is contradictory and unfrozen** (plan appends `homepage[]` to
   `listFilteredV2` and rejects a dedicated endpoint; the 2026-08-10 Jira comment publishes
   `POST /card/perks/homepage/listFiltered`, "attributes could change"). **No case asserts the payload
   shape.** No sibling story consumes the rail.
4. **Free-text search is deliberately uncovered** — an explicit operator decision that the design wins
   over AC3's "searchable". If a text input ships, it arrives with zero coverage.
5. Expired/planned save rules are **plan-only, in no AC** — observe and report; file no defect against a
   plan-only rule.

Full context: `../clarification/clarifications.md` (decisions D1–D4, open items C-1…C-8) and
`../requirements-analysis/requirements.md`.
