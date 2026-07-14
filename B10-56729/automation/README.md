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
# all five:
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

## Run status (validated live 2026-07-14, `create_perk_labels_and_title.spec.js`)
- ✅ **AC1** page title "Create perk", ✅ **AC2** sentence-case section headings, ✅ **AC8** "Cover photo EN/AR" + "Logo EN/AR" labels — PASS.
- ❌ **AC3 (candidate DEFECT):** the Perk title EN **and** AR fields accept **30 characters** with real keyboard input — the 20-char limit is **not enforced at the input level** (no `maxlength`, no truncation, no counter/error observed). File a bug or confirm the limit is only validated on save.
- Fixed two pre-existing fragilities in the shared `PerksPage` while running: the create heading locator still expected the old title-case "Create Perks" (AC1 renamed it), and `Add Perk` matched two elements (strict-mode). Both corrected.

## Known follow-ups (not yet automated)
- **AC7 auto-fill rule** (non-Breadfast merchant → subheader = merchant name;
  Category cashback → category name): needs the merchant/category selector flow and
  the stakeholder-confirmed "Breadfast merchant = name contains 'Breadfast'" rule
  (per the Jira comment thread) before asserting auto-filled values.
- **`PerksPage.fillCategoryPerk`** remains a stub — the Category cashback MCC/category
  picker selectors still need a live-DOM capture.
- **Char-cap assertions** assume the field hard-caps input; if the form instead shows
  a counter + validation error without truncating, switch those assertions to check
  the error message / counter instead of `inputValue().length`.
