# B10-56757 — Automation (Playwright, web / Card Admin Panel)

Automates the **Perks table management** story (filters, Type/Category columns,
category-scoped sorting/reorder, row Actions, delete confirmation, empty state,
batched "Save order", and post-create redirect). Specs mirror the approved
BrowserStack test cases 1:1 and cover AC-01 through AC-12.

## Where things live
- **Specs (artifact copy = runnable):** `automation/tests/*.spec.js` (this folder),
  with a self-contained `playwright.config.js` here.
- **Shared page object / helpers:** reuses & extends `D:\breadfast-qa\automation\`
  — `pages/PerksPage.js` (new **"B10-56757"** table method group), `pages/LoginPage.js`,
  `helpers/ConfigReader.js`, `helpers/ApiHelper.js`. No parallel page object was
  created (reuse-before-build): the perks-list methods were added to the existing
  `PerksPage` (same `#/perks` route) alongside the create-form methods.
- **No mirror (2026-08-10):** `PerksPage.js` has exactly one copy, `<repo root>/automation/pages/`.
  The former out-of-repo mirror was imported and retired; specs run from **this** folder against
  the shared assets.
- **Dependencies:** installed once at the repo root `D:\breadfast-qa\node_modules`.

## How to run
```bash
cd D:\breadfast-qa\B10-56757\automation
npx playwright test                                    # whole suite (23 tests)
npx playwright test tests/perks_table_filters.spec.js  # AC-01
npx playwright test tests/perks_table_columns.spec.js  # AC-02
npx playwright test tests/perks_table_sorting.spec.js  # AC-03/04
npx playwright test tests/perks_table_actions.spec.js  # AC-06/07/08
npx playwright test tests/perks_table_reorder.spec.js  # AC-11/12
npx playwright test tests/perks_table_empty_state.spec.js  # AC-10
npx playwright test tests/perk_create_redirect.spec.js     # AC-05
```
Login uses `ConfigReader.getAdminUserName()/getAdminPassword()` (admin panel `agent`)
against `card-panel-testing.breadfast.tech`.

### Destructive tests (opt-in, off by default)
| Env flag | Enables |
|----------|---------|
| `RUN_PERK_DELETE=1` | actually confirm-delete a planned perk (`perks_table_actions`) |
| `RUN_SAVE_ORDER=1`  | persist a reordered list via "Save order" (`perks_table_reorder`) |
| `RUN_PERK_CREATE=1` | create a real perk for the post-create redirect (`perk_create_redirect`) |

All other tests are non-destructive (read-only inspection, prompt open+cancel,
reorder-without-save). They auto-`skip` when the required test data is absent
(e.g. no planned/Active/Expired perk, or a category with < 2 perks).

## Preconditions
- Admin `agent` can log in and reach `#/perks`, and the perks backend is up
  (`POST /api/v1/web/card/perks/list` returns 2xx — see the blocker below).
- Perks of each **status** exist for AC-07 (a **planned**, an **Active**, and an
  **Expired** perk). Tests skip the status they can't find rather than fail.
- At least one **category with ≥ 2 perks** for reorder/Save-order (AC-11/12).
- A **Type + Category combination with no matching perk** for the empty state (AC-10).
- Exact-spec image assets (`PerksPage.PHOTOS.coverSpec/logoSpec`) present for the
  `RUN_PERK_CREATE` redirect test.
- `perks_table_filters` / `perks_table_columns` seed a couple of General-cashback
  perks via `ApiHelper` in `beforeAll` (best-effort; a seed failure is non-fatal).

## ⚠️ Live-DOM selector verification blocker (2026-07-14)
The live `#/perks` table could **not** be captured while authoring these specs:
the backend returned **502 Bad Gateway** on `POST /api/v1/web/card/perks/list`
and `.../perks/section/list`, so the table never rendered (the same env outage as
`screenshots/exploratory_10/11`). The `PerksPage` "B10-56757" table selectors are
therefore grounded in the **exported Figma frames** + the portal's **proven
Angular Material / `mat-table` conventions**, made tolerant (role/text + structural
`.or()` fallbacks), and flagged in a dated comment block. **Re-confirm every table
selector against the live DOM once the backend recovers**, then tighten any
fallbacks. (Same open-dependency pattern used for the B10-56729 create-form fields.)

## Design reconciliation captured in the page object
- **AC-03/04 "sorting" = drag-reorder.** The design has no column-header sort
  arrows; it uses 6-dot drag handles in a category view. `isSortingAvailable()`
  detects that affordance (with a column-sort fallback). See figma-analysis
  "Gaps vs spec".
- **Type-label copy** in the UI is `Discount/coupon` · `Category cashback` ·
  `Merchant cashback` · `General spend cashback`; the AC casing differs, so the
  Type-options assertion matches on tokens (general/category/merchant/coupon).
- **AC-07 table-menu gating** may not be enforced in the current design (gating is
  only shown on the detail page per figma-analysis). `isDeleteEnabled()` reports
  the real state so those tests reveal a defect rather than masking it.

## BrowserStack test-case ↔ spec mapping (1:1 traceability)
Each `test(...)` title matches its BrowserStack case title verbatim.

| BrowserStack Title | AC | Spec file | Automated? | Note |
|--------------------|----|-----------|-----------|------|
| Verify Type filter control is present above the perks table with all four type options | AC-01 | `perks_table_filters.spec.js` | ✅ | |
| Verify Category filter control is present and lists all existing categories | AC-01 | `perks_table_filters.spec.js` | ✅ | |
| Verify applying only the Type filter returns matching perks | AC-01 | `perks_table_filters.spec.js` | ✅ | skips if no matching data |
| Verify applying only the Category filter returns matching perks | AC-01 | `perks_table_filters.spec.js` | ✅ | skips if no matching data |
| Verify Type and Category filters applied in combination | AC-01 | `perks_table_filters.spec.js` | ✅ | skips if no matching data |
| Verify the new filters combine correctly with the existing status filter (regression) | AC-01 | `perks_table_filters.spec.js` | ✅ | |
| Verify the perks table displays new Type and Category columns | AC-02 | `perks_table_columns.spec.js` | ✅ | |
| Verify column sorting is hidden when no category filter is selected | AC-03 | `perks_table_sorting.spec.js` | ✅ | |
| Verify column sorting becomes available when a category filter is selected | AC-04 | `perks_table_sorting.spec.js` | ✅ | |
| Verify redirect to category-filtered, sort-enabled table after creating a perk | AC-05 | `perk_create_redirect.spec.js` | ✅ | `RUN_PERK_CREATE=1` |
| Verify Actions column is the last column with View and Delete actions per row | AC-06 | `perks_table_actions.spec.js` | ✅ | |
| Verify View action navigates to the perk detail page | AC-06 | `perks_table_actions.spec.js` | ✅ | |
| Verify Delete action is enabled for planned perks | AC-07 | `perks_table_actions.spec.js` | ✅ | skips if no planned perk |
| Verify Delete action is dimmed/disabled for Active perks | AC-07 | `perks_table_actions.spec.js` | ✅ | skips if no Active perk |
| Verify Delete action is dimmed/disabled for Expired perks | AC-07 | `perks_table_actions.spec.js` | ✅ | skips if no Expired perk |
| Verify Delete on an eligible perk triggers a confirmation prompt | AC-08 | `perks_table_actions.spec.js` | ✅ | |
| Verify confirming the delete prompt removes the planned perk | AC-08 | `perks_table_actions.spec.js` | ✅ | `RUN_PERK_DELETE=1` |
| Verify cancelling the delete prompt aborts the deletion | AC-08 | `perks_table_actions.spec.js` | ✅ | |
| Verify empty state is shown when a filter combination returns no results | AC-10 | `perks_table_empty_state.spec.js` | ✅ | needs a known-empty combo |
| Verify 'Save order' button appears only after the perk order is changed | AC-11 | `perks_table_reorder.spec.js` | ✅ | |
| Verify 'Save order' button is not shown when no order change is made | AC-11 | `perks_table_reorder.spec.js` | ✅ | |
| Verify the new perk order is persisted upon clicking 'Save order' | AC-12 | `perks_table_reorder.spec.js` | ✅ | `RUN_SAVE_ORDER=1` |
| Verify reordering without saving does not persist the new order | AC-11/12 | `perks_table_reorder.spec.js` | ✅ | |
| Verify localization of the new filter, column, action, and Save-order UI (en/ar) | — | — | ⏭️ manual | Usability/RTL case; no ar-EG frames exist for this table (figma-analysis) — verify manually |

**23 automated tests across 7 specs; 1 case (localization/RTL) is manual-only.**
