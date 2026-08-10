# Automation Plan & Framework Reference — B10-57771

**Target framework:** the canonical Breadfast Java framework (`D:\projects`) — web → **Java + Selenium + TestNG**.
**Generated code lives in the framework, never in this folder** ([automation-generation.md](../../docs/ai/automation/automation-generation.md) §8).
**Surface:** web Admin Portal (card panel), **EN only** — 1 combo.

## 1. Reuse ladder (reuse-before-build — checked before a single line was written)

| Need | Existing asset | Verdict |
|---|---|---|
| Card-panel login | `modals/cardsAdminPanel/CardAdminPanelLoginPage.java` → `goToPage()`, `fillLoginFormAndSubmit()` | **reuse as-is** |
| Reach Card perks | `modals/cardsAdminPanel/CardPanelDashboard.java` → `clickOnCardPerksTab()` | **reuse as-is** |
| Perks list + table readers | `PerksPage` → `waitForPerksPageToLoad()`, `perksTableIsDisplayed()`, `getPerksTableColumnValues()`, `getPerkSectionFromTable()`, `getPerksTableColumnIndex()` | **reuse as-is** |
| Create-perk form fields | `PerksPage` → `enterPerkTitles()`, `enterCouponCode()`, `getEnteredCouponCode()`, `getEnteredPerkTitleEn/Ar()`, `selectPerkTypeByName()`, `getSelectedSectionText()`, `getSelectedMerchantText()` | **reuse as-is** |
| Save flow | `PerksPage` → `clickOnPreviewAndSaveBtn()`, `confirmQuickPreviewIfDisplayed()` | **reuse as-is** |
| Form validation text | `PerksPage` → `getCreatePerkFormValidationErrors()` | **reuse as-is** |
| Add-perk entry point | `PerksPage` → `clickOnAddPerkBtn()`, `createPerkFormIsDisplayed()` | **reuse as-is** |
| API login + perk reads | `helpers/apiClients/webApiClients/CardAdminPanelPerksApiClient` → `loginAndGetJwtToken()`, `getPerkField()`, `getPerkAttribute()`, `listPerks()` | **reuse as-is** |
| Config | `configs.getCardServicesAdminPanelBaseURL()`, `getCardAdminPanelAdminUserName()`, `getCardAdminPanelAdminPassword()` | **reuse as-is** |
| Base | `base/BaseTest`, `modals/BaseWebPage` (`isElementDisplayed`, `enterStringIntoTextField`, `goToUrl`, `pause`, `wait`) | **reuse as-is** |

**Nothing above is duplicated.** Only the genuinely new surface is added.

## 2. New assets (the minimum the story actually needs)

Added to the **existing** `modals/cardsAdminPanel/PerksPage.java` — no new page object, because this is
the same page:

| Method | Why it cannot be reused from something existing |
|---|---|
| `openRowActionsMenuForPerk(perkId)` | the kebab button and its overlay menu did not exist in the page object |
| `getRowActionsMenuItems()` | returns the menu labels in DOM order — the AC1 oracle |
| `rowActionMenuItemIsEnabled(label)` | Delete's state-gating and Duplicate's always-enabled state |
| `getRowActionMenuItemTooltip(label)` | the "Only planned perks can be deleted" tooltip |
| `clickRowActionMenuItem(label)` | shared click for View / Duplicate / Delete |
| `closeRowActionsMenu()` | the menu is a cdk overlay that must be dismissed between rows |
| `duplicateFormIsDisplayedForPerk(perkId)` | asserts the `#/perks/duplicate/<id>` route + form |
| `duplicateFormIsStillOpenForPerk(id)` / `perkDetailsPageIsDisplayedForPerk(id)` | route predicates, so no test has to know the panel's routes (the way `createPerkFormIsDisplayed()` already works) |
| `getStartDateValue()` | the sibling of the existing `getEndDateValue()`, which now shares the same form-scoped locator |
| `getPerkFormImageCount()` | counts rendered image previews on the form |
| `perkFormImageLoadErrorIsDisplayed()` | the "Could not fetch … from storage" failure path |
| `get<Field>FieldValue()` readers | read the LIVE DOM value; the existing `getEntered…` family returns what a previous `fillValid…()` typed, which is the wrong oracle for a form the app filled itself |
| `perksTableContainsPerkTitle(title)` | locate the created duplicate |
| `getPerkIdFromTable(title)` | read the new perk id for the independence assertions |
| `goToPageContainingPerk(id)` / `perksTableContainsPerkId(id)` | the list pages at 15 rows newest-first, so a fixture **sinks** as tests create perks — a single-page read reports a perk that exists as missing |
| `openDuplicateFormForPerk(id)` | the open-the-duplicate-form interaction as **one** step (was a 3-call ritual in 15 tests) |
| `saveDuplicateWithUniqueTitleAndCouponCode()` | the save interaction as one step (was a 4-call ritual in 5 tests); returns the generated title. Title **and** coupon code are run-unique — saved perks are permanent, so a shared literal spreads one code over many perks |
| `getStartDateValueInStoredFormat()` / `...EndDate...` | keeps the `DD-MM-YYYY` ↔ `YYYY-MM-DD` difference on the page object instead of in a test assertion |
| `CardAdminPanelPerksApiClient.countPerks(jwt)` | the "this action created no perk" oracle. The **table cannot answer it** — it pages at 15 rows, so a before/after row count on page 1 is 15 either way |
| `setUniqueDuplicateTitle()` | a unique short title per duplicate — the framework's `editPerkTitle()` types a shared constant, so duplicates collide across tests |

**Locators captured live 2026-08-09** (not guessed): kebab `button.kebab-btn` (also `.mat-menu-trigger`),
menu panel `.perk-actions-menu`, items `[role="menu"] button` in DOM order View / Duplicate / Delete,
disabled Delete carries `disabled` + `aria-disabled="true"`, coupon input `app-bf-input[controlname='coupon_code']//input`.

## 3. Conventions followed
- Test class `B10_57771_DuplicatePerkTests` in `src/test/java/cardService/adminPanel/`, extends `BaseTest`.
- **One test per automatable BrowserStack case**, `@Test(description = "<exact BrowserStack title>")`
  and `@TmsLink("TC-xxxxx")` — results map by case id.
- `groups = {"regression", "B10-57771"}`, `@Tags({@Tag("web"), @Tag("cardservice")})`.
- **No private helpers in the test class** ([[java-framework-style]]) — all behaviour lives on the page object.
- Suite: `b10-57771-tests.xml`; run with `-Dsurefire.suiteXmlFiles=` ([[mvn-suite-override]]).

## 4. Coverage decisions (stated, not silent)
| BrowserStack case | Automated? | Reason |
|---|---|---|
| TC-54743 … TC-54752, TC-54756 … TC-54765 | ✅ 21 of 23 | |
| **TC-54754** (merchant-cashback type-conditional pre-fill) | ⚠️ **manual** | the merchant-cashback source has no coupon field, and its merchant picker is a nested mat-menu whose selection cannot be asserted without re-implementing `selectMerchantWithAllBranches` for a read path — executed manually with evidence |
| **TC-54759** (images survive source deletion) | ⚠️ **manual** | destructive: it permanently deletes a seeded perk. Run once, manually, with evidence, rather than on every regression pass |
| **AC4 / Featured** | ❌ **no case** | no Featured attribute exists on this surface — reported **Not Verifiable**, deliberately not automated and deliberately not filed as a bug |
