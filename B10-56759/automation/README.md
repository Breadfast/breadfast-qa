# B10-56759 — Automation (Playwright, web / Card Admin Panel)

Automates **"Admin Portal: Perk Details – Enable Partial Editing of Active Perks"**:
the Perk Details page header **Delete + Edit** buttons, their **status-aware state**
(Planned active / Active & Expired dimmed), the **Planned delete confirmation flow**,
and the **status/type-aware EDIT mode** (Planned full edit; Active permitted-field
matrix; Expired read-only). Specs mirror the approved BrowserStack test cases 1:1
and cover **AC-01 through AC-14** plus **AC-17** (creation-parity validations).

WEB-ONLY story (execution directive `platforms=["web"]`) — no Appium/mobile class.

## Where things live
- **Specs (artifact copy = runnable copy):** `automation/tests/*.spec.js` (this
  folder), with a self-contained `playwright.config.js` here that imports the
  shared config/POMs/helpers from `D:\breadfast-qa\automation` by relative path.
  Dependencies resolve from the repo-root `D:\breadfast-qa\node_modules`.
- **Shared page objects / helpers (reused — not duplicated):**
  - `pages/PerkDetailsPage.js` — Perk Details header (Delete/Edit presence +
    enabled/dimmed + magenta styling), status/type/**title**-driven navigation
    (reuses `PerksPage` table methods), edit-mode entry/detection, and AC-14 reads.
  - `pages/PerksPage.js` — edit-mode field-state readers (`isFieldEditable` /
    `isFieldLocked` / `isFieldEditableByLabel` / `getEditableFieldMatrix`) reusing
    the creation-form `controlname`/`formcontrolname` selectors, plus the
    delete-confirmation modal.
  - `pages/LoginPage.js`, `helpers/ConfigReader.js`, `helpers/VisualComparisonHelper.js`,
    `helpers/FigmaExporter.js`, `config/figma.js` — reused as-is.
- **No mirror (2026-08-10):** the two files edited for this story
  (`helpers/ApiHelper.js`, `pages/PerkDetailsPage.js`) have one copy each under
  `<repo root>/automation/`. The out-of-repo mirror this line used to require was imported
  and retired — there is nothing left to keep in sync.

**Reuse-before-build:** no new page object was created. The only shared-code
changes are:
- `ApiHelper.createPerk({type,status,…})` — status/type-aware fixture factory
  (generalizes `createGeneralCashbackPerk`; supports discount-coupon /
  merchant-cashback / category-cashback / general-cashback; drives lifecycle by
  date: Planned = starts in future, Active = started & not ended, Expired = ended;
  returns the created perk's title/id for table lookup).
- `PerkDetailsPage.openPerkByTitle(title)` — open the exact fixture just created.

## How to run
```bash
cd D:\breadfast-qa\B10-56759\automation
npx playwright test                                                          # all 7 specs
npx playwright test tests/perk_details_header_buttons.spec.js                # AC-01/02/03/04
npx playwright test tests/delete_planned_perk_confirmation.spec.js           # AC-02
npx playwright test tests/edit_planned_full_edit_mode.spec.js                # AC-05/17
npx playwright test tests/edit_active_common_fields.spec.js                  # AC-06/07/13
npx playwright test tests/edit_active_type_specific_fields.spec.js           # AC-08/09/10/11/12
npx playwright test tests/edit_active_save_integrity_and_regression.spec.js  # AC-14 + regression
npx playwright test tests/perk_details_localization_and_figma_visual.spec.js # AC-13 + visual
```
Login uses `ConfigReader.getAdminUserName()/getAdminPassword()` against
`card-panel-testing.breadfast.tech`.

### Environment gates (destructive tests, off by default)
| Env flag | Enables |
|----------|---------|
| `RUN_PERK_DELETE=1`    | confirm-and-permanently-delete the throwaway Planned fixture (`delete_planned_perk_confirmation`) |
| `RUN_PERK_EDIT_SAVE=1` | save edits to an Active perk — status/start-date preservation (`edit_active_save_integrity_and_regression`) |
| `FIGMA_API_TOKEN`      | export the scope Figma frame as the visual "Expected" pane (optional — visual spec still runs without it) |

Prompt-appears, cancel, field-state, negative-no-op and regression checks are
non-destructive and always run.

## Preconditions
- Admin Portal reachable at `getCardServicesAdminPanelBaseURL()` with a
  Perks-management admin account (config read from the `D:\projects` source of truth).
- The perks **create API** (`POST /api/v1/web/card/perks/create`) is reachable —
  **every spec CREATES the Planned/Active/Expired × type fixture it needs** via
  `ApiHelper.createPerk` rather than skipping when the environment lacks one (per
  tester feedback). If a type-specific create payload is rejected, the spec falls
  back to an existing perk of that status/type; it **never** silently skips on
  fixture absence.
- Node deps installed once at the repo root: `cd D:\breadfast-qa && npm install`.

## Known selector caveats (re-confirm on first green run)
- `PerkDetailsPage` header Delete/Edit locators and the edit-mode locked-field
  markers were authored during a `card-panel-testing` backend outage
  (`POST /card/perks/list` 502); they are grounded in the exported Figma
  "Perk Details" frames (node-id `5893-378873`) + proven Angular Material
  conventions, made tolerant (role/text + header-region scoping + computed-style
  reads). Re-confirm and tighten against the live detail DOM once the backend recovers:
  - Header Delete/Edit hooks and the **magenta** brand colour value.
  - The edit-mode **locked** marker (native `disabled`/`readonly` vs a greyed class).
- **Cashback limit**, **End date & time**, **Exclusions**, **Short duration
  description** have no confirmed create-form `controlname` (`PerksPage.setLimits`
  is still a throwing stub) — read by label; the type-specific/common specs apply
  a **narrow env-limitation `test.skip` only when a control cannot be resolved**
  on the current build (not a fixture-absence escape).
- `ApiHelper.createPerk` type-specific `perk_attributes` (merchant ids / category
  code / coupon code+type) are best-effort and UNCONFIRMED against the live API;
  pass explicit values or an `attributes` override once the payload shape is known.

## AC-12 clarification (story comments — Rasha Mohamed, ashrakat.elkhalifa)
For Active **Category Cashback** perks only **Category name & MCC** are locked; the
**Section** stays editable like every other type. Both are asserted in
`edit_active_type_specific_fields.spec.js`.

## BrowserStack test-case ↔ spec mapping (1:1)
Each `test(...)` title matches its BrowserStack case title (verbatim, or a merged
super-set where one spec test asserts two closely related cases — noted below).

| # | BrowserStack Title | Spec file | Automated? | Note |
|---|--------------------|-----------|-----------|------|
| 1 | header shows Delete + Edit — Planned | `perk_details_header_buttons.spec.js` | ✅ | |
| 2 | header shows Delete + Edit — Active | `perk_details_header_buttons.spec.js` | ✅ | |
| 3 | header shows Delete + Edit — Expired | `perk_details_header_buttons.spec.js` | ✅ | |
| 4 | Delete active & magenta — Planned | `perk_details_header_buttons.spec.js` | ✅ | merged: magenta + opens prompt |
| 5 | clicking Delete on Planned → confirmation prompt | `delete_planned_perk_confirmation.spec.js` | ✅ | also asserted in #4 |
| 6 | confirming deletion permanently deletes Planned | `delete_planned_perk_confirmation.spec.js` | ✅ | env-gate `RUN_PERK_DELETE=1` |
| 7 | cancelling deletion keeps Planned intact | `delete_planned_perk_confirmation.spec.js` | ✅ | |
| 8 | Delete dimmed/non-interactive — Active | `perk_details_header_buttons.spec.js` | ✅ | |
| 9 | Delete dimmed/non-interactive — Expired | `perk_details_header_buttons.spec.js` | ✅ | |
| 10 | Edit dimmed/non-interactive — Expired | `perk_details_header_buttons.spec.js` | ✅ | |
| 11 | Edit Planned → full edit, all editable except type | `edit_planned_full_edit_mode.spec.js` | ✅ | |
| 12 | Perk type locked in Planned edit mode | `edit_planned_full_edit_mode.spec.js` | ✅ | asserted in #11 test |
| 13 | Edit Active → only permitted fields editable | `edit_active_common_fields.spec.js` | ✅ | |
| 14 | common permitted fields editable across types | `edit_active_common_fields.spec.js` | ✅ | End date read by label |
| 15 | Coupon code + type editable — Discount/Coupon | `edit_active_type_specific_fields.spec.js` | ✅ | |
| 16 | Cashback limit editable — Merchant Cashback | `edit_active_type_specific_fields.spec.js` | ✅ | label-gated skip if unresolvable |
| 17 | Cashback limit editable — Category Cashback | `edit_active_type_specific_fields.spec.js` | ✅ | label-gated skip if unresolvable |
| 18 | Cashback limit + Exclusions editable — General | `edit_active_type_specific_fields.spec.js` | ✅ | |
| 19 | Category name & MCC locked — Category Cashback | `edit_active_type_specific_fields.spec.js` | ✅ | merged with #20 |
| 20 | Section stays editable — Category Cashback | `edit_active_type_specific_fields.spec.js` | ✅ | asserted in #19 test (AC-12 comment) |
| 21 | locked fields greyed out / read-only | `edit_active_common_fields.spec.js` | ✅ | |
| 22 | saving Active edit does not change status | `edit_active_save_integrity_and_regression.spec.js` | ✅ | env-gate `RUN_PERK_EDIT_SAVE=1` |
| 23 | saving Active edit does not reset start date | `edit_active_save_integrity_and_regression.spec.js` | ✅ | env-gate `RUN_PERK_EDIT_SAVE=1` |
| 24 | Perk type locked in Active edit mode | `edit_active_common_fields.spec.js` | ✅ | asserted in #13 test |
| 25 | non-Discount Active perks expose no coupon fields | `edit_active_type_specific_fields.spec.js` | ✅ | |
| 26 | permitted fields support EN + AR variants | `edit_active_common_fields.spec.js`, `perk_details_localization_and_figma_visual.spec.js` | ✅ | |
| 27 | header button states match Figma across statuses | `perk_details_localization_and_figma_visual.spec.js` | ✅ | scope-only Figma frames; REVIEW verdict |

Regression coverage (HLS 16/20) — dimmed-button no-op + leaving edit mode persists
nothing — lives in `edit_active_save_integrity_and_regression.spec.js`.
