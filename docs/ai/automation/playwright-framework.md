# Playwright POM Framework (`automation/` + `automation/legacy/`) — LEGACY for new web generation

> **Status change (operator decision 2026-07-27):** new web automation is generated as **Java + Selenium
> inside the Java framework** — see [automation-generation.md](automation-generation.md) (canonical).
> **Do not generate new Playwright automation unless the user explicitly requests it.** This supersedes
> the 2026-06-22 "sanctioned web counterpart" resolution below for *new* generation only: this framework
> and the existing story suites remain **maintained** (bug fixes, re-runs, extending an existing
> Playwright suite when the user asks), and this doc stays their reference.

> **This framework now lives entirely inside the repo** — shared page objects/helpers/config at
> [`automation/`](../../../automation/), the imported suite + runners at
> [`automation/legacy/`](../../../automation/legacy/). It **is** the primary reference for
> web/backend-JS automation structure: before touching any web Playwright test, page object, or
> helper, read this and **follow its POM implementation, folder organization, naming conventions,
> helper/utility patterns, fixture/config patterns, reporting implementation, and test-organization
> strategy.** Most building blocks already exist — reuse them (reuse-before-build,
> [coding-standards.md](coding-standards.md)). `D:/projects` (Java) stays the source of truth for
> mobile/Selenium + config.
>
> **Relocated 2026-08-10.** This used to live at the external, un-versioned `D:\Playwright\b55168_pom`
> — a folder that was never a git repository and therefore never pushed, so a colleague who cloned
> this repo got a workflow pointing at a path they did not have. Nothing outside the repository is
> required any more; see [`automation/legacy/README.md`](../../../automation/legacy/README.md) for
> what moved and the mirror drift it resolved.

## Overview

A Playwright Page-Object-Model framework that automates the **Breadfast card-service** backend + admin-panel UI. It is a backend/UI QA framework (Node.js / CommonJS), **separate** from the Appium/BrowserStack mobile layer documented in [appium-framework.md](appium-framework.md).

Feature areas automated today:

| Area | What it does | Entry points |
|------|--------------|--------------|
| **Perks creation** | Create General Spend Cashback / Merchant perks via the Card Admin Panel (UI + API) | [PerksPage.js](../../../automation/pages/PerksPage.js), [ApiHelper.js](../../../automation/helpers/ApiHelper.js), [create_perks_api.js](../../../automation/legacy/create_perks_api.js) |
| **MID exclusion capacity (B10-55168)** | Verify excluded-merchant cap raised 60 → 200, via both UI and API | [mid_exclusion_ui.spec.js](../../../automation/legacy/tests/mid_exclusion_ui.spec.js), [mid_exclusion_api.spec.js](../../../automation/legacy/tests/mid_exclusion_api.spec.js) |
| **Cashback processing (B10-55185)** | Seed a purchase → trigger the cashback cron → verify the type-30 cashback row in MySQL | [cashback_processing.spec.js](../../../automation/legacy/tests/cashback_processing.spec.js), [DbHelper.js](../../../automation/helpers/DbHelper.js), [CronHelper.js](../../../automation/helpers/CronHelper.js) |
| **KYC fields + collect flow (B10-56336)** | Edit Customer Details validations + card-collection flow + KYC PDF, asserting on real API calls | [EditCustomerPage.js](../../../automation/pages/EditCustomerPage.js), [CollectDialogPage.js](../../../automation/pages/CollectDialogPage.js), [kyc_edit_customer.spec.js](../../../automation/legacy/tests/kyc_edit_customer.spec.js), [kyc_collect_flow.spec.js](../../../automation/legacy/tests/kyc_collect_flow.spec.js) |

Full context for the cashback work is in [AUTOMATION_B10-55185.md](../../../automation/legacy/AUTOMATION_B10-55185.md).

## Patterns to follow (this framework is the template)
- **POM:** every page is a class `extends BasePage` ([BasePage.js](../../../automation/pages/BasePage.js) — `waitForVisible`/`isElementDisplayed`/`goToUrl`, `DEFAULT_TIMEOUT`). Locators are declared as **constructor fields** and reused by methods; methods are verb-first camelCase actions. **UI interactions live in the page object; assertions + test data live in the spec; cross-page actions live in helpers.** Prefer role/text locators + Angular hooks (`app-bf-input[...] input`, `[formcontrolname=...]`); custom `app-bf-input` wrappers → target the inner input by role. Document live-verified selectors with a dated comment.
- **Folder organization:** `pages/` (POM classes), `helpers/` (helpers/utilities/config/API/DB), `config/environments/` (per-env config), `tests/` (`*.spec.js`), standalone `node` runners at the package root.
- **Naming:** PascalCase page/helper files; `snake_case.spec.js` specs; `snake_case.js` runners; camelCase verb-first methods; `get<Thing>()` config getters; UPPER_SNAKE module constants. **Each test title = the exact BrowserStack case title, verbatim** (one automated test per case; no invented titles or `[TC_...]` prefixes — the BrowserStack case id is the traceability key and lives in the mapping table). Every automatable case is mapped to a test and tracked in the story README's traceability table; non-automatable cases are listed with a reason. See [coding-standards.md](coding-standards.md) "Test naming" + "Test-case → script traceability" and [testing-process.md](../testing-process.md) §3.7.
- **Helpers/utilities:** static-method classes (`ApiHelper`, `CronHelper`), a singleton (`module.exports = new ConfigReader()`), or an instantiable class (`new DbHelper()`). API helpers throw with HTTP status+body on failure. Assert on the **real network response** (status + payload), not URL navigation (e.g. `submitPerkAndCaptureCreate`, `submitAndCapture`).
- **Fixtures/config:** non-secret values in `config/environments/cardServiceConfigs_<ENV>.js` via `ConfigReader`; secrets read from the Java `config_testing.properties` via `PropertiesReader` — never committed. Shared setup via `test.beforeAll` (API token/DB) or `test.beforeEach` (UI login).
- **Reporting:** Playwright `list` + `html` reporters (`playwright-report/`); `screenshot: 'on'` + `trace: 'on'` so **every** test (passed + failed) carries evidence ([release-validation.md](release-validation.md) §2.1).
- **Test organization:** specs grouped by feature in `tests/`; `beforeEach` login; known defects via `test.fail(true, 'B10-xxxxx')` (don't delete); env-gated suites `test.skip(condition, reason)`; cron/DB suites serialized (`workers:1`). **Test data is provisioned dynamically** via `CardUserFactory` — the static `test_data_inventory.csv` ledger is **deprecated and not in this repo** ([testing-process.md](../testing-process.md) §"DEPRECATED"). If a flow genuinely cannot be provisioned via API, ask for the data — never invent it.

## Architecture / folder structure

```
<repo root>/
├── package.json                # scripts + deps (@playwright/test, mysql2, ssh2, pdf-parse)
├── automation/                 # THE shared JS layer — one copy, no mirror
│   ├── pages/                  # Page Object Model classes
│   │   ├── BasePage.js         # waitForVisible / isElementDisplayed / goToUrl
│   │   ├── LoginPage.js        # admin-panel login form
│   │   ├── PerksPage.js        # perks list + create form (General + Merchant; coupon/category stubbed)
│   │   ├── EditCustomerPage.js # KYC customer-details edit form
│   │   ├── CollectDialogPage.js# card-collection Popup 1 / Popup 2
│   │   └── ReplaceCardPage.js  # replace / reapply card modals
│   ├── helpers/
│   │   ├── ConfigReader.js     # loads config/environments/cardServiceConfigs_<ENV>.js
│   │   ├── PropertiesReader.js # reads Java framework's config_testing.properties (DB+SSH secrets)
│   │   ├── ApiHelper.js        # Card Admin Panel REST client (login, create perk, list perks)
│   │   ├── CronHelper.js       # triggers the cashback cron over HTTP
│   │   └── DbHelper.js         # MySQL-over-SSH-tunnel seed/adjust/verify (with connect retry)
│   ├── config/environments/
│   │   └── cardServiceConfigs_testing.js   # non-secret URLs + admin creds + test mobile
│   └── legacy/                 # the imported suite (was the external b55168_pom)
│       ├── playwright.config.js        # workers=1, baseURL from ConfigReader, headed Chromium
│       ├── tests/                      # 13 specs / 98 tests
│       │   ├── mid_exclusion_api.spec.js
│       │   ├── mid_exclusion_ui.spec.js
│       │   ├── cashback_processing.spec.js
│       │   ├── kyc_*.spec.js           # ×8 — edit customer, collect flow, file number, PDF, visual
│       │   └── replacement_fee_display.spec.js
│       ├── create_perks_api.js         # standalone runner (node, not a spec)
│       └── record_bug_b10_56609.js     # standalone bug-repro video recorder (node)
└── B10-<key>/automation/       # per-story specs + their own playwright.config.js
```

## How configuration flows

Two layers, by sensitivity:

1. **Non-secret config** — [config/environments/cardServiceConfigs_testing.js](../../../automation/config/environments/cardServiceConfigs_testing.js) holds admin panel URL, card-backend URL, admin username/password, test mobile, and the path to the Java properties file. [ConfigReader.js](../../../automation/helpers/ConfigReader.js) loads `cardServiceConfigs_${process.env.ENV || 'testing'}.js` and exposes getters (`getCardServicesAdminPanelBaseURL`, `getAdminUserName`, `getCardBackendBaseURL`, `getBfPropertiesPath`, `getTestMobileNumber`, …).

2. **Secrets (DB password, SSH key)** — never copied into this repo. [PropertiesReader.js](../../../automation/helpers/PropertiesReader.js) parses the **external Java framework's** `config_testing.properties` (default `D:\projects\resources\environments\config_testing.properties`, override via `BF_PROPERTIES_PATH`). This is the single source of truth for `mysqlHost`, `mysqlUserPassword`, `sshKeyPath`, etc. `DbHelper` calls `getCardDbConfig()` to build its connection.

`playwright.config.js` pulls `baseURL` from `config.getCardServicesAdminPanelBaseURL()` at load time, so every UI test starts against the configured admin panel.

## Test execution

npm scripts ([package.json](../../../package.json)):

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

The cashback suite reads/writes `cards_hades_testing` MySQL **through an SSH tunnel** ([DbHelper.js](../../../automation/helpers/DbHelper.js): `ssh2` `forwardOut` + `mysql2`). This requires:

- The SSH private key referenced by `sshKeyPath` in `config_testing.properties` present locally.
- Network reachability to the bastion host.

Per [AUTOMATION_B10-55185.md](../../../automation/legacy/AUTOMATION_B10-55185.md): *"The DB layer can't run from CI without the SSH key + network path to the bastion; it's designed to run from a developer machine that already reaches the test DB (same as the Java framework)."* The cashback suite also **auto-skips** in `beforeAll` until `SETUP.templateTxId` is filled.

## Relationship to the external Java framework

This Playwright framework was built as a companion/extension to an existing Java QA framework that lives in a sibling checkout (`D:\projects\resources\…`):

- It **reuses** the Java framework's `config_testing.properties` for DB/SSH secrets (via `PropertiesReader`) rather than duplicating them.
- `DbHelper` deliberately mirrors the Java `DatabaseConnectionFactory` (JSch `-L` forward → `ssh2 forwardOut`).
- Several `PerksPage` selectors (Merchant cashback form) are **ported from** the Java `MerchantPerkCreatePage.java` / `PerksPage.java`.

---

## Authoring traps in the Card-Panel admin UI (Angular Material) — read before writing specs

Learned the hard way on **B10-56750**, where **6 of 11** first-run failures were bugs in the *tests*, not
the product. Each one below looked exactly like a product defect. Check these before writing up any
failure as a bug.

### 1. The Create-Perk form is PROGRESSIVE
Landing on `#/perks/create` renders **only** `Perk type`. Every other Basic-details control — including
`Section (Mobile display)` — is created **after** a perk type is selected. A probe that asserts a field
"exists on the form" without selecting a type reports `count: 0` and reads exactly like *"the field is
missing"*. **Always select the perk type first.**

### 2. Two stacked `cdk` overlays — the panel survives the dialog
The `mat-select` panel stays **open behind** a dialog opened from inside it, and dismissing the dialog
closes only the dialog. The orphaned `.cdk-overlay-backdrop` then intercepts pointer events, so the next
click reports *"element is visible, enabled and stable"* and still times out after 30 s. Tear overlays
down between interactions:
```js
async function settleOverlays(page) {
  for (let i = 0; i < 4; i += 1) {
    if (!(await page.locator('.cdk-overlay-backdrop').count().catch(() => 0))) break;
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(350);
  }
}
```

### 3. Validation renders through TWO DISJOINT channels
| State | Element | The other element's count |
|---|---|---|
| required / max-length (per field) | `<mat-error>` | `span.text-danger` = **0** |
| form-level error (e.g. duplicate name) | `<span class="text-danger d-block">` | `mat-error` = **0** |

Reading only one channel returns `''`, which in an assertion is **indistinguishable from "no validation
fired"** — this produced two false defects. `PerksPage` now exposes `getAddSectionFieldErrorTexts()`
(mat-error), `getAddSectionErrorText()` (form-level) and `getAnyAddSectionErrorText()`.

### 4. Transient states need an armed wait, never a fixed sleep
Toasts auto-dismiss and in-flight windows are ~400 ms. **Arm the wait before the action, await it after:**
```js
const seen = page.locator('snack-bar-container').filter({ hasText: /…/ }).first()
  .waitFor({ state: 'visible', timeout: 20_000 }).then(() => true).catch(() => false);
await doTheThing();
const ok = await seen;
```
A wait *started after* the action misses it; a short wait *started before* expires before it renders.
Sample in-flight button state in a poll loop, not once. And beware the viewport: a `fullPage:false`
screenshot taken while scrolled away from the header will "prove" a toast is absent when it fired.

### 5. Floating labels double as placeholders
Material fields here use `mat-form-field-can-float`. While unfocused and empty the **label occupies the
placeholder slot** (`mat-form-field-hide-placeholder`) and `input.getAttribute('placeholder')` returns
**`null`**. Reading a placeholder without focusing the field yields a false *"placeholder is missing"*.
Focus first, or read both states and report the difference.

### 6. Never re-run the login helper on an authenticated page
Navigating to `#/pages/login` with a live session redirects to `#/dashboard`, so the username field never
appears and `fillLoginFormAndSubmit` times out waiting for it. Reuse the session (re-navigate to the
form) instead of logging in twice on the same `page`.

### 7. Perk-image assets: use the exact-spec helper
`fillMandatoryFields()` still points at old composite images that (a) are **absent** from the shared
`automation/perks photos/` folder (`ENOENT`) and (b) are rejected as *"Image resolution is invalid"* by
the redesigned form anyway. Use **`fillGeneralCashbackMandatory()`**, which uploads the exact-spec
`exact_1080x1080.jpg` / `exact_240x180.jpg` assets and fills every currently-required field.

### 8. Every test logging in separately is a flake source
A full 29-test pass performs 30+ logins in ~11 min and produced a login timeout. Prefer one
authentication reused via `storageState` (project dependency or `globalSetup`).

### Rule that ties these together
> **Reconcile every automated failure against hand-captured evidence before writing it up as a defect.**
> In this UI a failing assertion is as likely to be a locator/sequencing bug as a product bug. Skipping
> that step would have reported 11 defects instead of the 5 that were real.
