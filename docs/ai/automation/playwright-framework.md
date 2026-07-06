# Playwright POM Framework (`b55168_pom/`) — PRIMARY WEB-AUTOMATION REFERENCE

> **`D:/Playwright/b55168_pom` is the primary reference for web/backend-JS automation structure.** Before adding any web Playwright test, page object, or helper, read this and **follow its POM implementation, folder organization, naming conventions, helper/utility patterns, fixture/config patterns, reporting implementation, and test-organization strategy.** Most building blocks already exist — reuse them (reuse-before-build, [coding-standards.md](coding-standards.md)). `D:/projects` (Java) stays the source of truth for mobile/Selenium + config; this is its sanctioned web counterpart (resolved 2026-06-22).

## Overview

A Playwright Page-Object-Model framework that automates the **Breadfast card-service** backend + admin-panel UI. It is a backend/UI QA framework (Node.js / CommonJS), **separate** from the Appium/BrowserStack mobile layer documented in [appium-framework.md](appium-framework.md).

Feature areas automated today:

| Area | What it does | Entry points |
|------|--------------|--------------|
| **Perks creation** | Create General Spend Cashback / Merchant perks via the Card Admin Panel (UI + API) | [PerksPage.js](b55168_pom/pages/PerksPage.js), [ApiHelper.js](b55168_pom/helpers/ApiHelper.js), [create_perks_api.js](b55168_pom/create_perks_api.js) |
| **MID exclusion capacity (B10-55168)** | Verify excluded-merchant cap raised 60 → 200, via both UI and API | [mid_exclusion_ui.spec.js](b55168_pom/tests/mid_exclusion_ui.spec.js), [mid_exclusion_api.spec.js](b55168_pom/tests/mid_exclusion_api.spec.js) |
| **Cashback processing (B10-55185)** | Seed a purchase → trigger the cashback cron → verify the type-30 cashback row in MySQL | [cashback_processing.spec.js](b55168_pom/tests/cashback_processing.spec.js), [DbHelper.js](b55168_pom/helpers/DbHelper.js), [CronHelper.js](b55168_pom/helpers/CronHelper.js) |
| **KYC fields + collect flow (B10-56336)** | Edit Customer Details validations + card-collection flow + KYC PDF, asserting on real API calls | `pages/EditCustomerPage.js`, `pages/CollectDialogPage.js`, `tests/kyc_edit_customer.spec.js`, `tests/kyc_collect_flow.spec.js` |

Full context for the cashback work is in [AUTOMATION_B10-55185.md](b55168_pom/AUTOMATION_B10-55185.md).

## Patterns to follow (this framework is the template)
- **POM:** every page is a class `extends BasePage` ([BasePage.js](b55168_pom/pages/BasePage.js) — `waitForVisible`/`isElementDisplayed`/`goToUrl`, `DEFAULT_TIMEOUT`). Locators are declared as **constructor fields** and reused by methods; methods are verb-first camelCase actions. **UI interactions live in the page object; assertions + test data live in the spec; cross-page actions live in helpers.** Prefer role/text locators + Angular hooks (`app-bf-input[...] input`, `[formcontrolname=...]`); custom `app-bf-input` wrappers → target the inner input by role. Document live-verified selectors with a dated comment.
- **Folder organization:** `pages/` (POM classes), `helpers/` (helpers/utilities/config/API/DB), `config/environments/` (per-env config), `tests/` (`*.spec.js`), standalone `node` runners at the package root.
- **Naming:** PascalCase page/helper files; `snake_case.spec.js` specs; `snake_case.js` runners; camelCase verb-first methods; `get<Thing>()` config getters; UPPER_SNAKE module constants. **Each test title = the exact BrowserStack case title, verbatim** (one automated test per case; no invented titles or `[TC_...]` prefixes — the BrowserStack case id is the traceability key and lives in the mapping table). Every automatable case is mapped to a test and tracked in the story README's traceability table; non-automatable cases are listed with a reason. See [coding-standards.md](coding-standards.md) "Test naming" + "Test-case → script traceability" and [testing-process.md](../testing-process.md) §3.7.
- **Helpers/utilities:** static-method classes (`ApiHelper`, `CronHelper`), a singleton (`module.exports = new ConfigReader()`), or an instantiable class (`new DbHelper()`). API helpers throw with HTTP status+body on failure. Assert on the **real network response** (status + payload), not URL navigation (e.g. `submitPerkAndCaptureCreate`, `submitAndCapture`).
- **Fixtures/config:** non-secret values in `config/environments/cardServiceConfigs_<ENV>.js` via `ConfigReader`; secrets read from the Java `config_testing.properties` via `PropertiesReader` — never committed. Shared setup via `test.beforeAll` (API token/DB) or `test.beforeEach` (UI login).
- **Reporting:** Playwright `list` + `html` reporters (`playwright-report/`); `screenshot: 'on'` + `trace: 'on'` so **every** test (passed + failed) carries evidence ([release-validation.md](release-validation.md) §2.1).
- **Test organization:** specs grouped by feature in `tests/`; `beforeEach` login; known defects via `test.fail(true, 'B10-xxxxx')` (don't delete); env-gated suites `test.skip(condition, reason)`; cron/DB suites serialized (`workers:1`). Test data pulled from `D:/BreadfastQA/test_data_inventory.csv` (use Available first).

## Architecture / folder structure

```
b55168_pom/
├── package.json                # scripts + deps (@playwright/test, mysql2, ssh2)
├── playwright.config.js        # workers=1, baseURL from ConfigReader, headed Chromium
├── pages/                      # Page Object Model classes
│   ├── BasePage.js             # waitForVisible / isElementDisplayed / goToUrl
│   ├── LoginPage.js            # admin-panel login form
│   └── PerksPage.js            # perks list + create form (General + Merchant; coupon/category stubbed)
├── helpers/
│   ├── ConfigReader.js         # loads config/environments/cardServiceConfigs_<ENV>.js
│   ├── PropertiesReader.js     # reads Java framework's config_testing.properties (DB+SSH secrets)
│   ├── ApiHelper.js            # Card Admin Panel REST client (login, create perk, list perks)
│   ├── CronHelper.js           # triggers the cashback cron over HTTP
│   └── DbHelper.js             # MySQL-over-SSH-tunnel seed/adjust/verify
├── config/environments/
│   └── cardServiceConfigs_testing.js   # non-secret URLs + admin creds + test mobile
├── tests/                      # *.spec.js Playwright specs
│   ├── mid_exclusion_api.spec.js
│   ├── mid_exclusion_ui.spec.js
│   └── cashback_processing.spec.js
├── create_perks_api.js         # standalone runner (node, not a spec)
└── record_bug_b10_56609.js     # standalone bug-repro video recorder (node)
```

## How configuration flows

Two layers, by sensitivity:

1. **Non-secret config** — [config/environments/cardServiceConfigs_testing.js](b55168_pom/config/environments/cardServiceConfigs_testing.js) holds admin panel URL, card-backend URL, admin username/password, test mobile, and the path to the Java properties file. [ConfigReader.js](b55168_pom/helpers/ConfigReader.js) loads `cardServiceConfigs_${process.env.ENV || 'testing'}.js` and exposes getters (`getCardServicesAdminPanelBaseURL`, `getAdminUserName`, `getCardBackendBaseURL`, `getBfPropertiesPath`, `getTestMobileNumber`, …).

2. **Secrets (DB password, SSH key)** — never copied into this repo. [PropertiesReader.js](b55168_pom/helpers/PropertiesReader.js) parses the **external Java framework's** `config_testing.properties` (default `D:\projects\resources\environments\config_testing.properties`, override via `BF_PROPERTIES_PATH`). This is the single source of truth for `mysqlHost`, `mysqlUserPassword`, `sshKeyPath`, etc. `DbHelper` calls `getCardDbConfig()` to build its connection.

`playwright.config.js` pulls `baseURL` from `config.getCardServicesAdminPanelBaseURL()` at load time, so every UI test starts against the configured admin panel.

## Test execution

npm scripts ([package.json](b55168_pom/package.json)):

| Script | Command | Notes |
|--------|---------|-------|
| `npm test` | `npx playwright test` | all specs |
| `npm run test:api` | `npx playwright test tests/mid_exclusion_api.spec.js` | API-only, no browser |
| `npm run test:ui` | `npx playwright test tests/mid_exclusion_ui.spec.js` | headed Chromium |
| `npm run test:cashback` | `npx playwright test tests/cashback_processing.spec.js --workers=1` | DB + cron; **serialized** |
| `npm run report` | `npx playwright show-report` | opens HTML report |

Key `playwright.config.js` settings: `testDir: './tests'`, `timeout: 120_000`, `expect.timeout: 15_000`, `fullyParallel: false`, **`workers: 1`**, reporters `list` + `html` (outputFolder `playwright-report`, `open: 'never'`), `use.headless: false` (headed), viewport 1400×900, `screenshot: 'only-on-failure'`, `video`/`trace: 'retain-on-failure'`, single `chromium` project.

**`--workers=1` (cron serialization):** the cashback cron is a single shared backend job. Two parallel test workers triggering `GET /test?cronJobType=cashback` would interleave and process each other's seeded purchases, making counts non-deterministic. `test:cashback` forces `--workers=1`; the global config already sets `workers: 1` too.

## Running a story's suite on BrowserStack Automate (browserstack-node-sdk)

To run a story's Playwright web suite against real BrowserStack Automate browsers (not just locally), wrap the run with `browserstack-node-sdk` from the **workspace root** (`D:\BreadfastQA`), since that's where `node_modules`/`playwright.config.js` live and `browserstack-node-sdk` reads `browserstack.yml` only from the current working directory:

1. Create `<STORY>/browserstack.yml` (per-story, not shared) modeled on an existing one (e.g. `B10-55570/browserstack.yml`):
   ```yaml
   userName: "fintech_6WdvD1"
   accessKey: "m1yw4TJV3pdwhJuHxeBj"
   buildName: "<Story name>"
   projectName: "BCard Squad"
   CUSTOM_TAG_1: "<STORY-ID>"
   testObservability: true
   ```
2. Copy it to the workspace root (temporary — remove afterward; don't overwrite an existing root `browserstack.yml` without checking first):
   ```powershell
   cd D:\BreadfastQA
   Copy-Item .\<STORY>\browserstack.yml .\browserstack.yml
   ```
3. Run the wrapped suite, pointing at the story's spec files and the root config:
   ```powershell
   $env:PLAYWRIGHT_HTML_OPEN='never'
   npx browserstack-node-sdk playwright test <STORY>/automation/tests/<spec1>.spec.js <STORY>/automation/tests/<spec2>.spec.js --config=playwright.config.js
   ```
4. Remove the temporary root config: `Remove-Item .\browserstack.yml`.

The BrowserStack Automate `userName`/`accessKey` above are a shared org credential already used for `B10-55570` — reuse them rather than asking for new ones unless they've been rotated. This is the same pattern used for `B10-55570` (see `B10-55570/BrowserStack-Suite-Run.md`) and was reused for `B10-56336`'s KYC suite (`kyc_edit_customer.spec.js`, `kyc_collect_flow.spec.js`, `kyc_pdf_content.spec.js`).

## DB-over-SSH-tunnel requirement (cannot run from CI)

The cashback suite reads/writes `cards_hades_testing` MySQL **through an SSH tunnel** ([DbHelper.js](b55168_pom/helpers/DbHelper.js): `ssh2` `forwardOut` + `mysql2`). This requires:

- The SSH private key referenced by `sshKeyPath` in `config_testing.properties` present locally.
- Network reachability to the bastion host.

Per [AUTOMATION_B10-55185.md](b55168_pom/AUTOMATION_B10-55185.md): *"The DB layer can't run from CI without the SSH key + network path to the bastion; it's designed to run from a developer machine that already reaches the test DB (same as the Java framework)."* The cashback suite also **auto-skips** in `beforeAll` until `SETUP.templateTxId` is filled.

## Relationship to the external Java framework

This Playwright framework was built as a companion/extension to an existing Java QA framework that lives in a sibling checkout (`D:\projects\resources\…`):

- It **reuses** the Java framework's `config_testing.properties` for DB/SSH secrets (via `PropertiesReader`) rather than duplicating them.
- `DbHelper` deliberately mirrors the Java `DatabaseConnectionFactory` (JSch `-L` forward → `ssh2 forwardOut`).
- Several `PerksPage` selectors (Merchant cashback form) are **ported from** the Java `MerchantPerkCreatePage.java` / `PerksPage.java`.
