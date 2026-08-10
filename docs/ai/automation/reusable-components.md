# Reusable Components Index

> **Before writing new automation, search here first.** Most card-service and mobile building blocks already exist — call or extend them rather than duplicating.
> **New automation is generated in the Java framework** (web→Selenium, mobile→Appium — [automation-generation.md](automation-generation.md)); for those, the Java row-groups below and [java-framework.md](java-framework.md) §4–7 are the primary reuse surface. The JS (`b55168_pom`) rows serve legacy Playwright maintenance.

## Capability → existing asset

| Capability needed | Reuse this | File |
|-------------------|-----------|------|
| Admin-panel **login (UI)** | `LoginPage.fillLoginFormAndSubmit(user, pass)` | [pages/LoginPage.js](../../../automation/pages/LoginPage.js) |
| Admin-panel **login (API, get JWT)** | `ApiHelper.loginAndGetToken(request)` | [helpers/ApiHelper.js](../../../automation/helpers/ApiHelper.js) |
| **Create perk via UI** (General Spend Cashback) | `PerksPage` — `goToPerksPage` → `clickAddPerk` → `selectGeneralSpendCashbackType` → `fillMandatoryFields` → `submitPerkExpectSuccess` | [pages/PerksPage.js](../../../automation/pages/PerksPage.js) |
| **Create perk via API** | `ApiHelper.createGeneralCashbackPerk(request, token, ids, value, type, minTx, title)` | [helpers/ApiHelper.js](../../../automation/helpers/ApiHelper.js) |
| **Bulk merchant-ID generation** | `ApiHelper.buildMerchantIds(count, offset)` | [helpers/ApiHelper.js](../../../automation/helpers/ApiHelper.js) |
| **List perks** (verify created) | `ApiHelper.listPerks(request, token)` | [helpers/ApiHelper.js](../../../automation/helpers/ApiHelper.js) |
| **Excluded-merchant multi-select** (select/deselect/count) | `PerksPage.selectMerchantsByName / deselectMerchantsByName / selectMerchants / selectAllMerchants / getSelectedMerchantsCount` | [pages/PerksPage.js](../../../automation/pages/PerksPage.js) |
| **DB seeding** (clone/adjust a purchase) | `DbHelper.cloneEligiblePurchase / adjustPurchaseForTest / setRawTransactionData / findLatestPurchaseForMobile / resetPerkProcessed` | [helpers/DbHelper.js](../../../automation/helpers/DbHelper.js) |
| **DB verification** (cashback rows) | `DbHelper.countCashback / getCashbackRows / getPerkProcessed / getRow` | [helpers/DbHelper.js](../../../automation/helpers/DbHelper.js) |
| **Trigger cashback cron** | `CronHelper.triggerCashbackCron(request)` → `GET {cardBackend}/test?cronJobType=cashback` | [helpers/CronHelper.js](../../../automation/helpers/CronHelper.js) |
| **Read non-secret config** | `ConfigReader` singleton getters | [helpers/ConfigReader.js](../../../automation/helpers/ConfigReader.js) |
| **Read DB/SSH secrets** (from Java framework) | `PropertiesReader.getCardDbConfig(path)` | [helpers/PropertiesReader.js](../../../automation/helpers/PropertiesReader.js) |
| **Bug-repro video recording** | pattern in standalone runner | [record_bug_b10_56609.js](../../../automation/legacy/record_bug_b10_56609.js) |
| **Ad-hoc API perk seeding** (node, no test runner) | pattern in standalone runner | [create_perks_api.js](../../../automation/legacy/create_perks_api.js) |
| **Mobile WebDriver actions** (BrowserStack) | `bsReq, getSource, findElement(s), clickEl, typeText, tap, getAttr, screenshot, sleep` | [bs_helper.js](bs_helper.js) |
| **Mobile session caps / OTP / lang matrix** | process doc | [docs/ai/browserstack-process.md](../browserstack-process.md), [CLAUDE.md](CLAUDE.md) |

## Java framework (`D:\projects`) — primary/native automation

> Full catalog: [java-framework.md](java-framework.md). Java 25 + Maven + Appium + Selenium + REST-assured + TestNG. Prefer these over re-implementing in JS for mobile/web-portal/API/DB work.

| Capability needed | Reuse this (Java) | File (`D:\projects\src\main\java\...`) |
|-------------------|-------------------|-----------------------------------------|
| **Customer mobile auth** (OTP/register/login → `User`) | `MobileAuthorizationApiClient` | `helpers/apiClients/mobileApiClients/MobileAuthorizationApiClient.java` |
| **Admin / RMS auth** (tokens, RMS retry) | `AdminAuthorizationApiClient` | `helpers/apiClients/webApiClients/AdminAuthorizationApiClient.java` |
| **Card service** (token, status, passcode/PIN, link/activate/replace, balance, transfers, invitation codes) | `CardServiceApiClient` | `helpers/apiClients/mobileApiClients/CardServiceApiClient.java` |
| **Card-panel perks via API** (general cashback variants) | `CardAdminPanelPerksApiClient` | `helpers/apiClients/webApiClients/CardAdminPanelPerksApiClient.java` |
| **Control Room** (warehouses/orders/stock/status) | `ControlRoomV2ApiClient` | `helpers/apiClients/webApiClients/ControlRoomV2ApiClient.java` |
| **Orders via API** (COD/CC/coupon/tipping/multi-product, cancel, sync) | `OrderApiClient` | `helpers/apiClients/mobileApiClients/OrderApiClient.java` |
| **Chatbot / FreshChat** | `ChatbotApiClient`, `FreshChatApiClient` | `helpers/apiClients/mobileApiClients/` |
| **Login OTP from Slack** | `SlackApiClient.findMessageForOTP` | `helpers/apiClients/SlackApiClient.java` |
| **Push results to BrowserStack test mgmt** | `BrowserstackApiClient` | `helpers/apiClients/BrowserstackApiClient.java` |
| **Page objects — customer app** (native + RN, per platform) | `modals/customerApp/{androidNative,iosNative,android,ios}/*` — see [mobile-native-framework.md](mobile-native-framework.md) for the native build's conventions | `modals/customerApp/...` |
| **Page objects — admin / card panel / RMS** | `mainAdminPortal/*`, `cardsAdminPanel/*`, `rmsDashboards/*` | `modals/...` |
| **Driver / server creation** (BrowserStack app select by type) | `MobileDriversFactory`, `WebDriversFactory`, `ServerFactory` | `helpers/factories/` |
| **Test data + sessions** | `dataFactories/*` (User/Otp, customerApp, fintech, foodAggregator, testSessions) | `helpers/factories/dataFactories/` |
| **Perk upload artwork** (cover 1080x1080 + logo 240x180, EN + AR, per merchant) | `PerkArtwork.breadfastCoffeeCashback()` / `breadfastCoffeeCoupon()` / `breadfastMarketCashback()` / `hmDiscount()` / `zaraCashback()` / `fromSet(name)` — resolves the four slot files, absolute paths, fails with the regeneration command if one is missing | `models/PerkArtwork.java`; assets in `resources/images/perks/<set>/` (see its `README.md`) |
| **Perk for an OUTSIDE (non-Breadfast) merchant** | `PerksPage.fillValidOutsideMerchantDiscountPerk()` — whole-form H&M Discount/coupon fill; `selectOutsideMerchantWithAllBranches()` creates the merchant through the picker's `+ Add merchant` dialog on first run and reuses it after (a merchant cannot be deleted from the panel) | `modals/cardsAdminPanel/PerksPage.java` |
| **Generating new perk artwork** (any merchant, exact spec, guaranteed under the byte cap) | `generate_perk_images.py` — add a `CATALOG` entry + `THEMES` palette, re-run; Breadfast perks use the Breadfast brand system, outside perks (H&M, Zara…) their own | `resources/scripts/generate_perk_images.py` |
| **JSON → POJO parsing** | `dataParsers/*` (26 parsers, `BaseDataParser`) | `helpers/dataParsers/` |
| **RBAC permission assertions** | `rolesValidators/*` (39, `BaseRolesValidator`) + `RolesDataProviderSource` | `helpers/rolesValidators/`, `helpers/dataProviders/` |
| **Per-tag config mutation** | `ConfigurationsManagementHelper.updateConfigsToMatchTestTag` | `helpers/ConfigurationsManagementHelper.java` |
| **Card encryption** | `EncryptionHelper` | `helpers/EncryptionHelper.java` |
| **Config source of truth** (this framework feeds the in-repo `automation/`) | `config_testing.properties`, `cardServiceConfigs_testing.properties`, `browserStackConfigs.properties` | `resources/environments/` |
| **Parallel-safe fixture root** | `BaseTest` (all state `ThreadLocal<>`) | `src/test/java/base/BaseTest.java` |

## Detailed catalogs

- Framework overview & execution → [playwright-framework.md](playwright-framework.md)
- Mobile native automation (canonical, `androidNative`/`iosNative`) → [mobile-native-framework.md](mobile-native-framework.md)
- Page objects → [page-objects.md](page-objects.md)
- Helpers → [helpers.md](helpers.md)
- API clients → [api-clients.md](api-clients.md)
- Mobile layer → [appium-framework.md](appium-framework.md)
- Conventions → [coding-standards.md](coding-standards.md)
- Fixtures / setup → [fixtures.md](fixtures.md)

## Known gaps / open items

From [AUTOMATION_B10-55185.md](../../../automation/legacy/AUTOMATION_B10-55185.md) and the code — build these out when needed instead of assuming they exist:

1. **Perk-form selectors — PARTIALLY RESOLVED 2026-07-27 (B10-57393).** The JS `PerksPage.fillCouponPerk` / `fillCategoryPerk` / `setLimits` are still **stubs that throw**, but the selectors they were waiting on are now **captured live** and implemented in the **Java** `modals/cardsAdminPanel/PerksPage` — port them rather than re-recording:
   - coupon code `app-bf-input[controlname='coupon_code'] input`; **coupon type** `mat-radio-button` `Online`/`Physical`, which **only renders after a coupon code is entered** (missing it silently blocks Preview & save)
   - cashback value `input[formcontrolname='cashback_value']`, limit `input[formcontrolname='cash_back_limit']`, minimum transaction `input[formcontrolname='minimum_transaction_amount']` (renders pre-filled with `0`)
   - consumption limit `input[formcontrolname='consumption_limit']` + interval `mat-select[formcontrolname='consumption_interval']` (`daily|weekly|monthly|yearly`) — **validated as a pair**: "Both limit and duration are required together"
   - still genuinely open: **category / MCC** referencing (see gap 3)
2. **Merchant-cashback form — RESOLVED 2026-07-27 (B10-57393).** The cashback-value / limit fields are captured (above), and the merchant picker is fully worked out: the trigger is a **read-only** `matInput` (`input[readonly][data-placeholder*='Select'][data-placeholder*='branch']`) opening a **nested two-level `mat-menu`** — merchants, then that merchant's branch checklist whose **"Select All" must be clicked via its `<label>`** (a click on the wrapping menu-item leaves `aria-checked="false"`). It also leaves a `cdk-overlay-backdrop` alive after one `Escape`, which then **swallows clicks on every field below it** — press Escape until the backdrop count is zero. Implemented as Java `selectMerchantWithAllBranches`. *Still open:* no API client for merchant/coupon/category creation (only `general-cashback`).
3. **Category / MCC referencing (open dep #10)** — unknown how a category perk references MCCs in the panel; blocks `fillCategoryPerk`.
4. **Eligibility predicate (open dep #1)** — exact success/cleared definition (status value, `external_response_code='00'`, `externalSettlementDateTime`) unconfirmed; `cloneEligiblePurchase` copies a known-good template to sidestep it.
5. **`transaction_data` column type** — `adjustPurchaseForTest` assumes JSON (`JSON_SET`); if it's plain TEXT, callers must use `setRawTransactionData`.
6. **Table name assumption** — `transactions_requests` is assumed from the export sample; override via `BF_TX_TABLE` if the live schema differs.
7. **No CI for the DB suite** — the cashback suite needs the SSH key + bastion network path and cannot run from CI; it auto-skips until `SETUP.templateTxId` is set.
8. **Open bug B10-56609** — after a rejected over-limit (206-MID) save, deselecting a merchant doesn't re-submit the corrected list; tracked via `test.fail()` in [mid_exclusion_ui.spec.js](../../../automation/legacy/tests/mid_exclusion_ui.spec.js) TC_UI_021.
9. **No formal Playwright fixtures yet** — auth/token/db are set up via `beforeEach`/`beforeAll`; see [fixtures.md](fixtures.md) for where to add `test.extend(...)`.
