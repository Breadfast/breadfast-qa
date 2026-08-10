# B10-57774 — Admin Portal · Perks Nav re-structure

Pre-development QA baseline (`/qa-shift-left`, run 2026-08-10).
Jira: [B10-57774](https://breadfast.atlassian.net/browse/B10-57774) · parent PRD
[B10-57757](https://breadfast.atlassian.net/browse/B10-57757) *Perks Enhancement – Phase 3* ·
Card Ops Squad · sprint *card OPS Sprint 3 ‖ H2 2026*.

> **Note on what is tracked here.** The repo's `.gitignore` keeps per-story folders lean: only
> `automation/` and this README are version-controlled. The analysis artifacts
> (`prerequisites.md`, `requirements-analysis/`, `figma-analysis/` incl. the 42 captured frames,
> `clarification/`, `impact-analysis/`, `hls/`, `testcases/`, `evidence/`) live on disk at
> `D:\breadfast-qa\B10-57774\` and are indexed in `qa-state.json`.

## Scope

**web Admin Portal (card panel) → 1 combo: web + English.** The panel has no Arabic UI (no locale
switch; `html[lang]` hard `en`), so an AR/RTL **UI** sweep is **Not Applicable** — never reported as
passed. Arabic is in scope as **content**: `Merchant name AR` and `Section name AR` are required fields
and render RTL inside their inputs.

## What this story does

`Card perks` stops being a single flat nav link to `/perks` and becomes an expandable parent with four
sub-links — **Perks · Merchants · Categories · Mobile sections** — where the last three are new
standalone management screens for entities that today exist only as dialogs inside the perk form.

## Baseline produced

| Artifact | Result |
|---|---|
| Prerequisites | 15 categories, every access item proven with one live authenticated call |
| Requirements | 3 ACs + the one dev comment (which adds a per-sub-item **permissions** requirement absent from every AC) |
| Figma | **42/42 frames** captured at 2× from the three "Managing …" sections; `framesHash` recorded |
| Clarifications | 4 operator scope decisions (Q1 entity map · Q2 add+delete, design is the oracle · Q3 permissions out of scope · Q4 AC2 = reachability) |
| Impact | 9 impacted areas · 10 regression areas · 6-step smoke · automation impact |
| Exploratory | Mode A pass over the current build; corrected two of my own risk assumptions |
| HLS | **20** scenarios, published as Jira comment **126113** (HLS-only; original AC untouched) |
| Test cases | **40 cases · 372 steps**; `testcase-lint` → 3/3 ACs covered, **0 errors, 0 warnings** |
| Test-case review | nine checks pass after 3 rounds of revision (18 steps split for granularity) |
| BrowserStack import | **awaiting operator approval** — the gate is doing its job |

## Ground truth read from the environment (2026-08-10)

The feature is **not deployed**, which is why this run is shift-left:

```
sidebar        Card Perks → routerLink ["/perks"]     (flat, no children)
route paths    perks | create | duplicate/:id | :id   (no merchants/categories/mobile-sections)
FE bundles     main + 33 lazy chunks grepped → 0 hits for "Mobile section" in any casing

POST /api/v1/web/card/perks/…            (authenticated)
  list                        → 200   (positive control)
  definitelyNotARoute         → 404   (negative control)
  merchant/list  200   merchant/create  400   merchant/update 404   merchant/delete 404
  category/list  200   category/create  400   category/update 404   category/delete 404
  section/list   200   section/create   400   section/update  400   section/delete  404

/#/perks/merchants · /#/perks/categories · /#/perks/mobile-sections
  → all silently land on Create perk today, with NO error
```

That last line is why every "renders its own screen" step asserts the **page title** and never merely
"navigated without an error".

## Entity map (operator decision Q1)

| Nav sub-item | Endpoint family | Live shape |
|---|---|---|
| Perks | `card/perks/*` | existing |
| Merchants | `card/perks/merchant/*` | `id, name_en, name_ar, merchant_id, is_breadfast, merchantBranches[]` |
| Categories | `card/perks/category/*` | `id, name_en, name_ar, category_code` (MCC) |
| Mobile sections | `card/perks/section/*` | `id, name_en, name_ar, is_active, display_order` |

Vocabulary warning: what B10-57764 / B10-57766 called a perk's **"category"** is this story's
**Mobile section**.

## Rules that exist only in the design (no AC mentions them)

Nine cases assert these; they are the substance of making Figma the oracle.

- **Delete is disabled whenever the entity is in use** — enforced in *both* the row `•••` menu and the
  details header. Predicate differs: Merchants and Categories key on **"Added to a perk" = Yes**; Mobile
  sections key on **"Perks added" = Yes** (i.e. the section *contains* perks).
- A merchant in use stays editable and can gain branches, but its **existing branches cannot be removed**.
- The **first branch row never has a delete control** — a merchant always keeps at least one.
- **Merchants** gates its submit button until valid; **Categories** and **Mobile sections** do not.
- **Categories has two independent uniqueness rules** — name *and* MCC code, reported separately and
  simultaneously. Merchants has one (name).
- **Mobile sections are reorderable by drag** — the only such control of the three, and the only property
  here whose effect reaches the mobile app.

## Design defects found (recorded, not filed — nothing is built yet)

| # | Defect |
|---|---|
| D-2 | Merchants empty state reads *"You can merchants by tapping the add merchants button"* — missing a verb. Proven a typo by the Categories frame, which reads *"You can **add** categories …"* |
| D-10 | the **Categories and Mobile sections details screens are titled "Create category" / "Create section"** even read-only; only Merchants reads "Merchant details" |
| D-8 | the Categories form has a **single** `Category name` with no Arabic input, yet `category/list` returns `name_en` **and** `name_ar` — nothing says what populates the Arabic value |

Cases assert the AC-level intent for all three, so a fix cannot fail a case and a defect cannot become a
requirement.

## Open items for the approval gate

1. **DATA-EMPTY** — the three empty-state cases need a zero-row environment; the environment holds
   10 / 10 / 12 rows, has no bulk delete, and rows in use cannot be deleted at all.
2. **G-DEL** — 7 cases (4 delete, 3 edit) are written against a design whose backend routes 404 today, on a
   story the dev comment scopes to "frontend changes only".
3. **Q3 consequence** — the suite has **zero** permission cases, by operator decision, while the dev comment
   promises "each with a separate permissions".
4. **R-4 uncovered** — the perk form's merchant/category/section pickers are not covered (operator Q4), even
   though those entities now have a second write path.

## Run commands

```bash
# regenerate the CSV from the case definitions
node B10-57774/automation/gen_browserstack_csv.js

# the mechanical half of the review gate (exit 1 on any violation)
node qa-workflow/bin/qa-cli.js testcase-lint "D:/breadfast-qa/B10-57774" \
     --acs-from "D:/breadfast-qa/B10-57774/requirements-analysis/requirements.md" --require-screens

# where the story stands / the completion gate
node qa-workflow/bin/qa-cli.js status         "D:/breadfast-qa/B10-57774" --profile shift-left
node qa-workflow/bin/qa-cli.js complete-check  "D:/breadfast-qa/B10-57774" --profile shift-left

# OPERATOR ONLY — approval, which unblocks the import
node qa-workflow/bin/qa-cli.js approve "D:/breadfast-qa/B10-57774" testcases --by "<operator>"
```

### Environment probes (re-runnable)

```bash
node B10-57774/automation/explore/probe-prereq.js        # login, permissions, route/verb matrix, data volumes
node B10-57774/automation/explore/probe-fe-nav.js        # is the nav re-structure in the deployed bundle?
node B10-57774/automation/explore/explore-current-nav.js # Mode-A pass over the current build (headless)
```

### Figma capture (authenticated browser session — REST 429s on this Starter PAT)

```bash
node qa-workflow/bin/figma-connect.js --status               # session gate; exit 3 = reconnect needed
node qa-workflow/bin/figma-connect.js                       # headed reconnect (sign in with Google)
node B10-57774/figma-analysis/tools/enumerate-section.js 5893-267497 merchants
node B10-57774/figma-analysis/tools/capture-frames.js       # Ctrl+Shift+C Copy-as-PNG, 2x
node B10-57774/figma-analysis/tools/recapture-missing.js    # re-capture stale-clipboard rejects
```

**Two session traps worth knowing** (both cost real time on this story and are fixed in
`figma-analysis/tools/session.js`):

1. Restoring `auth/figma-auth.json` through Playwright's `storageState` **silently drops every
   `__Host-`prefixed cookie** — which on Figma is exactly the auth set. The freshness gate still reports
   `FRESH` because it only counts cookies and checks `savedAt`. Re-inject `__Host-*` cookies **by url**, and
   always verify the session by loading a real page.
2. `Ctrl+Shift+C` can return a **stale** clipboard image — not the previous frame either, but one from much
   earlier in the run. 6 of 42 frames hit this. The capture rejects any PNG whose sha256 is already saved,
   and `recapture-missing.js` re-copies until a genuinely new sha appears.

## BrowserStack traceability

| | |
|---|---|
| Project | **PR-5 — "BCard Squad"** (numeric `2407303`) |
| Folder | **54241929** — *"Admin Portal- Perks Nav re-structure"*, parent `54229450` "Card Ops.Sprint3.4" |
| State before import | `cases_count = 0`, `sub_folders_count = 0` (verified via `GET /api/v2/projects/PR-5/folders/54241929`) |
| Cases to import | 40 |
| `TC-xxxx` map | **not yet assigned** — written back into `testcases.csv` after the import so `@TmsLink` binding exists before automation |

## Next

`/qa-validate B10-57774` once the implementation lands. It **reconciles** this baseline rather than
regenerating it — starting with G-DEL (do delete and edit actually exist?) and the `name_ar` question in D-8.

Planned automation: **Java + Selenium** in the Java framework (`D:\projects`), story class
`B10_57774_PerksNavRestructureTests`, one `@TmsLink`-bound test per automatable case. Nav locators must be
scoped to the `Card perks` parent — the wallet-merchants module also uses the label "Merchants" for a
different entity.
