# B10-57393 — Framework reuse map

> Reuse-before-build record (CLAUDE.md §1, [coding-standards.md](../../docs/ai/automation/coding-standards.md)).
> What already existed and was reused, what had to be added, and why.
> Framework: `D:\projects` · branch `2026/sprintQ3.3/B10-57393-mobile-app-preview-for-perk-creation`.

## Reused as-is (no changes)

| Asset | Used for |
|---|---|
| `base/BaseTest` | driver/config lifecycle, `configs.get()`, `ThreadLocal` page objects |
| `modals/BaseWebPage` | `goToUrl`, `isElementDisplayed`, `enterStringIntoTextField`, `closeDropDown`, `selectTheDropDownList` |
| `cardsAdminPanel/CardAdminPanelLoginPage` | `goToPage`, `fillLoginFormAndSubmit` |
| `cardsAdminPanel/CardPanelDashboard` | `clickOnCardPerksTab` — the SPA is hash-routed, so a URL navigation only changes the fragment; the tab click is the only reliable route |
| `cardsAdminPanel/PerksPage` (B10-56750) | `clickOnAddPerkBtn`, `selectPerkTypeByName`, `selectSection`, `enterPerkTitles`, `enterPerkSubheadersIfDisplayed`, `enterPerkDescriptions`, `enterPerkUsageDescriptions`, `choosePercentageCashback`, `selectFundingType`, `uploadImageToNextSlot`, `clickOnPreviewAndSaveBtn`, `getCreatePerkFormValidationErrors`, `createPerkFormIsDisplayed`, `sectionDropDownIsDisplayed`, `waitForPerksPageToLoad`, `perksTableIsDisplayed`, `getPerksTableColumnValues`, `getPerkSectionFromTable`, `closeOpenOverlays` |
| `resources/environments/cardServiceConfigs_testing.properties` | `cardServicesAdminPanelBaseURL`, `adminUserName`, `adminPassword`, `perkCoverImagePath`, `perkLogoImagePath` |
| `b10-56750-tests.xml` | suite/listener shape copied for `b10-57393-tests.xml` |

**Nothing was duplicated.** The whole Create-perk form up to the Value section already existed from
B10-56750; only the fields that story never needed were added.

## Added

### `modals/cardsAdminPanel/AppPreviewModal.java` — new page object
The modal is a genuinely new surface, so it gets its own page object rather than swelling `PerksPage`.
DOM shape captured live 2026-07-27:

```
mat-dialog-container
  phone-frame > div.iphone (bezel) > div.screen > div.screen-scroll   [0] Card perks tile view
  phone-frame > div.iphone         > div.screen > div.screen-scroll   [1] perk detail screen
  each detail section = static div.card whose header is div.card-head (mat-icon + label)
```

Method groups: modal presence/chrome · device-frame measurement (AC1) · scrolling (AC2) · sections
(AC3) · tile isolation (AC4) · preview language + RTL (AC5) · images · "See more" · Save/Cancel/close (AC6).

**The measurement subtlety worth knowing:** an ancestor `div.frames` applies
`transform: scale(0.8)`, so `getBoundingClientRect()` returns the **scaled** box while
`offsetWidth/offsetHeight` return the true CSS layout box. AC1's 375×812 assertion must read the
layout box — hence `getBezelLayoutSize()` / `getScreenLayoutSize()` alongside
`getBezelRenderedSize()` and `getFrameAncestorTransform()`, so a failure message can state both
numbers and the transform that explains the difference.

### `modals/cardsAdminPanel/PerksPage.java` — extended
New locators: `merchantPickerTrigger`, `branchesDescriptionEn/ArField`, `cashbackProcessingEn/ArField`,
`durationDescriptionEn/ArField`, `couponCodeField`, `cashBackLimitField`, `consumptionLimitField`,
`consumptionIntervalDropDown`.

New methods: `selectMerchantWithAllBranches`, `getSelectedMerchantText`, `enterBranchesDescriptions`,
`enterCashbackProcessingDescriptions`, `enterDurationDescriptions`, `enterCouponCode`,
`selectCouponTypeIfDisplayed`, `enterCashbackConsumptionLimit`, `getCashbackLimitValidationErrorText`,
`setEndDate`, `getEndDateValue`, the five whole-form fills, and the `getEntered*()` readbacks.

Default perk content lives as `private static final String` constants in the page object (matching how
`PerksPage` already declares its constants) and the `getEntered*()` getters expose what the last fill
entered — so the test class asserts against the page object instead of restating literals, and holds
no helper methods of its own.

### `base/BaseTest.java` — extended
`webCardPanelAppPreviewModal` `ThreadLocal` declared and initialised alongside `webCardPanelPerksPage`.

## Live-DOM findings the automation had to encode

These cost real debugging time; they are recorded so nobody re-derives them.

1. **The merchant picker is not an autocomplete.** It is a **read-only** `matInput` that opens a
   nested two-level `mat-menu`: merchants, then that merchant's branch checklist. Typing into it does
   nothing. "Select All" must be clicked through its `<label>` — clicking the wrapping menu-item
   leaves `aria-checked="false"` and the trigger empty.
2. **The merchant menu leaves a `cdk-overlay-backdrop` alive after one `Escape`**, which then
   silently swallows clicks on every field below it (`section_id` was visible + enabled but
   unclickable for 30 s). `closeOpenOverlays()` must run after the picker.
3. **Image slots collapse as they fill**, so the next empty slot is always the *first remaining*
   "Add image" button — indexing by original slot number targets the wrong slot once one is filled.
   Specs are exact: cover **1080×1080** ≤500 KB, logo **240×180** ≤80 KB; a wrong size is rejected and
   silently blocks Preview & save.
4. **`Perk subheader EN/AR` only render after a Section is selected** — and they are mandatory, so
   filling the form in the wrong order leaves an invisible required field and the preview never opens.
5. **Cashback limit + duration are validated as a pair** — "Both limit and duration are required together".
6. **The end date is a readonly picker.** Both the start and end picker render a `.dp-popup`, so the
   **visible** one must be targeted, not the first in the DOM.
7. **The Discount/coupon type has a different required set** — Arabic description and Arabic usage are
   mandatory there (optional on Merchant cashback), and "Coupon type" only renders once a coupon code
   has been entered. Missing it blocks the preview with no visible error near the button.
8. **Two "Preview & save" buttons exist** (page header + form footer). `PerksPage` already pins the
   first; the form-footer one is the submit.
9. **The admin session expires mid-run** — a long manual session died with `401` on
   `auth/refresh-session`. Long flows must be scripted, not hand-driven.

## Not automated (and why)
- **TC-53972** (failed save) — needs the create request forced to fail; no request-interception hook in
  this Selenium/BrowserStack setup. Covered manually by `preview_modal_edge.js --savefail`.
- **TC-53974** (visual fidelity vs Figma) — a design comparison against exported baselines, not a DOM
  assertion. Covered by `execution-reports/visual-findings.md`.
