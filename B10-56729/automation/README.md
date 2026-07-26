# B10-56729 — Automation (Playwright, web / Card Admin Panel)

Automates the **Create Perk form enhancements** story. Specs mirror the approved
BrowserStack test cases 1:1 and cover AC1–AC18.

## Where things live
- **Specs (artifact copy):** `automation/tests/*.spec.js` (this folder).
- **Runnable copy:** `D:\Playwright\b55168_pom\tests\` — run from there (it has
  `playwright.config.js`, `pages/`, `helpers/`, and node_modules).
- **Page object:** reuses & extends the shared `pages/PerksPage.js` (new "B10-56729"
  method block) — no parallel page object was created (reuse-before-build).

## How to run
```bash
cd D:\Playwright\b55168_pom
npx playwright test tests/create_perk_labels_and_title.spec.js          # AC1-3, AC8
npx playwright test tests/create_perk_basic_details_section.spec.js     # AC6, AC7
npx playwright test tests/create_perk_new_sections.spec.js              # AC9-11
npx playwright test tests/create_perk_restructuring_and_coupon.spec.js  # AC12-17
npx playwright test tests/create_perk_preview.spec.js                   # AC18
npx playwright test tests/create_perk_image_specs_and_icon.spec.js      # AC4, AC5
# all six:
npx playwright test tests/create_perk_*.spec.js
```
Login uses `ConfigReader.getAdminUserName()/getAdminPassword()` (admin panel `agent`).
Specs are **non-destructive** (form inspection only). `create_perk_preview.spec.js`
opens the Quick Preview but does NOT persist unless `RUN_PERK_CREATE=1` is set.

## Live-captured selector map (card-panel-testing, 2026-07-14)
| Field / control | AC | Selector |
|---|---|---|
| Perk type | — | `mat-select[formcontrolname="type"]` → options: General spend cashback / Category cashback / Merchant cashback / Discount/Coupon |
| Section (required) | AC6 | `mat-select[formcontrolname="section_id"]` |
| Perk title EN/AR (cap 20) | AC3 | `app-bf-input[controlname="title_en"|"title_ar"] input` |
| Perk subheader EN/AR (cap 30) | AC7 | `app-bf-input[controlname="subheader_en"|"subheader_ar"] input` |
| Short usage description EN/AR (cap 200) | AC9 | `textarea[formcontrolname="usage_description_en"|"usage_description_ar"]` |
| List of valid branches EN/AR | AC10 | `textarea[formcontrolname="branches_description_en"|"branches_description_ar"]` |
| Short cashback description EN/AR (cap 45) | AC11 | `textarea[formcontrolname="cashback_processing_description_en"|"..._ar"]` |
| Coupon code | AC16 | `app-bf-input[controlname="coupon_code"] input` |
| Coupon type (Online/Physical) | AC16 | `mat-radio-button` "Online" / "Physical" (renders after a coupon code is typed) |
| Funding type | AC15 | `mat-select[formcontrolname="funding_types"]` |
| Section headers (sentence case) | AC2/13/14/15 | `h4` — Basic details / Value / Usage / Branches / Cashback processing / Duration / Cashback limit / Exclusions / Funding |
| Image labels | AC8 | `Cover photo EN/AR`, `Logo EN/AR` (upload buttons: "Add image") |

## BrowserStack test-case ↔ spec mapping
Each `test(...)` title is written to match its BrowserStack case title. Spec→AC:
- `create_perk_labels_and_title` → AC1, AC2, AC3, AC5, AC8
- `create_perk_basic_details_section` → AC6, AC7
- `create_perk_new_sections` → AC9, AC10, AC11
- `create_perk_restructuring_and_coupon` → AC12, AC13, AC14, AC15, AC16, AC17
- `create_perk_preview` → AC18
- `create_perk_image_specs_and_icon` → AC4, AC5

Full traceability incl. visual sources & results: [`ac-coverage-matrix.md`](./ac-coverage-matrix.md).

## Run status — re-verified live 2026-07-20 (Chromium)
**27 tests · 25 passed · 2 failed.** Both failures are ONE product defect, **DEF-3** ("Funding" section
missing for every perk type — contradicts Figma; see `defects/defects.md`), confirmed across 3 consecutive
live runs (deterministic, not flaky). Test titles were also renamed this session to match their
BrowserStack Test Case titles exactly (see `ac-coverage-matrix.md` for the TC# ↔ spec mapping).

The 2026-07-14 baseline below recorded 4 different failures (DEF-1, the character-cap checks) — those were
**retracted as false positives** on 2026-07-20: the caps ARE enforced, via an inline "Maximum length
should be N characters." validation error, not truncation. The original assertions checked the wrong
enforcement mechanism; fixed via `PerksPage.checkMaxLengthValidation()`. See `ac-coverage-matrix.md` note 4.

## Run status (superseded) — full suite validated live 2026-07-14 (Chromium)
**26 tests · 22 passed · 4 failed.** The 4 failures were believed to be one product defect (DEF-1) — see
above for the 2026-07-20 retraction.

- ✅ **AC1/AC2/AC8** page title, sentence-case headings, "Cover photo EN/AR" + "Logo EN/AR" labels.
- ✅ **AC5** wrong-spec cover image rejected, conforming 1080×1080 accepted (enforcement works). ✅ **AC4** sidebar Perks nav item + icon present (glyph = manual — no Figma sidebar frame).
- ✅ **AC6** Section dropdown (all 4 types + options). ✅ **AC7** subheader shown by default for General. ✅ **AC9/AC10/AC11** Usage / Branches (coupon only) / Cashback processing sections. ✅ **AC12–AC17** removals, renames, Funding, Coupon type, and section order. ✅ **AC18** preview renders title/subheader/usage.
- ❌ **AC3 (title EN+AR, 20), AC7 (subheader, 30), AC9 (usage, 200), AC11 (cashback processing, 45) → DEF-1:** none of these caps are enforced at the input level (no `maxlength`, no truncation, no counter/error). See [`../defects/defects.md`](../defects/defects.md). Open question for dev: is the limit enforced server-side on save?

### Fixes applied this run
- `getSectionOrder()` scanned only `<h4>`, but **"Basic details" renders as a plain container (not a heading)** — confirmed from the live a11y tree. AC17 now asserts "Basic details" presence separately, then the `h4` section sequence (`Value→…→Funding`). Order itself was always correct.
- Added `attemptImageUploadExpectRejection()` (AC5 negative) + `getPerksSidebarNav()` (AC4) to shared `PerksPage`, and exported `PHOTOS` for spec reuse.
- Mirrored the shared `LoginPage` absolute-URL fix into the runnable copy (parity).

## Known follow-ups (deferred, not yet automated — with reason)
- **AC7 auto-fill rule** (non-Breadfast merchant → subheader = merchant name; Category cashback →
  category name) + conditional *hide* for non-Breadfast coupon/merchant, and the auto-filled Preview
  variants (AC18 comment override): need the merchant/category selector DOM captured live and the
  Phase-1 "Breadfast = name contains 'Breadfast'" rule (Jira comment 123128 confirms Phase 1 auto-detect).
- **`PerksPage.fillCategoryPerk` / `setLimits`** remain stubs — Category MCC/category picker and
  limit-field selectors still need a live-DOM capture.
- **AC2/AC13 case-sensitivity:** heading checks are case-insensitive today; add a case-sensitive
  assertion once the intended casing per screen is confirmed (Figma shows Title-Case leakage on the
  General-cashback screen).
