# Coding Standards & Conventions

> Conventions observed in the real framework code (`b55168_pom/` + `bs_helper.js`). Follow these when extending the suite.

## Framework Architecture Standard (MANDATORY)

**`D:/projects` (Java + Appium + Selenium + TestNG + Maven) is the source of truth and reference architecture for all automation.** Preserve the existing architecture — do **not** introduce a new architecture, folder structure, naming convention, or design pattern **unless explicitly approved by the user**.

- Maintain the existing **Page Object Model**. Extend the framework; never build a **parallel implementation** of something that already exists.
- Follow the existing structure under `D:/projects`: page objects in `src/main/java/modals/<area>/` (e.g. `cardsAdminPanel/`), tests in `src/test/java/<area>/`, plus `helpers/`, `helpers/apiClients/`, configs in `resources/environments/`. New tests integrate into this structure — never ad-hoc locations.
- **Before creating ANY new file, search the framework and reuse:** (1) page objects, (2) helper methods, (3) utilities, (4) fixtures, (5) API clients, (6) common components. Only create new when no suitable reusable implementation exists. Catalogs: [java-framework.md](java-framework.md), [reusable-components.md](reusable-components.md), [page-objects.md](page-objects.md), [helpers.md](helpers.md), [api-clients.md](api-clients.md), [fixtures.md](fixtures.md).
- **Page Object rules:** UI interactions live in Page Objects; test data + assertions live in test classes; common actions live in helper/utility classes. No hardcoded values, no duplicated selectors, no duplicated business flows.
- **Consistency:** follow existing naming conventions, package/folder structure, coding style, reporting implementation, and test-organization patterns.
- **Any framework change must be proposed first:** explain why it's needed, describe the impact, and **ask for approval before restructuring** any part of the framework.

**Two sanctioned frameworks (resolved 2026-06-22):**
- **`D:/projects` (Java/Appium/Selenium/TestNG/Maven)** — the canonical source of truth and reference architecture; used for **mobile (Appium) and Selenium**, and the **single source of truth for config** (`resources/environments/*.properties`).
- **`D:/Playwright/b55168_pom` (Playwright/JS)** — the **sanctioned framework for web/backend JS automation** (Admin Portal, card backend). It follows the same POM architecture and **reads `D:/projects` config** via `PropertiesReader`. New web automation goes here (CLAUDE.md §8).

These are NOT a license to fork a third architecture. The Architecture Standard above applies **within** each framework: reuse-before-build, extend don't parallel-implement, POM rules, existing naming/structure/style, and approval before restructuring. The Java `cardsAdminPanel` Selenium page objects (`EditCustomerDetailsPage`, `SearchCardsUsers`, `ViewCardUsersDetails`, `CardAdminPanelLoginPage`…) coexist with the Playwright web suite (e.g. B10-56336's `EditCustomerPage.js`/`CollectDialogPage.js`); within Playwright, reuse `BasePage`/`LoginPage`/existing POMs and never duplicate selectors/flows.

## #0 Search before you build — reuse over duplicate

Before writing any new automation, **check the existing assets first** — see [reusable-components.md](reusable-components.md) for the capability → asset index. Login, perk creation (UI + API), DB seeding, cron triggering, config reading, and mobile WebDriver actions already exist. Add to or call existing helpers/pages instead of duplicating logic. (This rule is also why DB/SSH secrets are read from the Java framework rather than re-declared — one source of truth.)

## Module pattern — CommonJS

- Every file is CommonJS: `require(...)` + `module.exports`. No ESM `import`/`export`.
- Every file opens with `'use strict';`.
- Helpers export a **class with static methods** ([ApiHelper.js](b55168_pom/helpers/ApiHelper.js), [CronHelper.js](b55168_pom/helpers/CronHelper.js)) **or a singleton instance** (`module.exports = new ConfigReader()` in [ConfigReader.js](b55168_pom/helpers/ConfigReader.js)) **or a class to instantiate** (`new DbHelper(...)` in [DbHelper.js](b55168_pom/helpers/DbHelper.js)).
- Pages export a class extending `BasePage` ([LoginPage.js](b55168_pom/pages/LoginPage.js), [PerksPage.js](b55168_pom/pages/PerksPage.js)).
- `bs_helper.js` exports a flat object of plain functions.

## Naming

- Files: page classes PascalCase (`PerksPage.js`); helpers PascalCase (`DbHelper.js`); test specs `snake_case.spec.js` (`mid_exclusion_api.spec.js`); standalone runners `snake_case.js` (`create_perks_api.js`, `record_bug_b10_56609.js`).
- Methods: camelCase, verb-first (`fillLoginFormAndSubmit`, `selectMerchantsByName`, `cloneEligiblePurchase`, `triggerCashbackCron`).
- Config getters: `get<Thing>()` (`getAdminUserName`, `getCardBackendBaseURL`).
- Constants: UPPER_SNAKE at module top (`LOGIN_ENDPOINT`, `TABLE`, `TYPE_PURCHASE`, `BS_USER`).
- **Test title = the exact BrowserStack case title, verbatim** (the `Verify …` sentence as imported). One automated test per BrowserStack case; do **not** invent internal titles or `[TC_xxx]` prefixes. The BrowserStack case id (`TC-49826`) is the traceability key and lives in the **mapping table** (below), not in the title. This supersedes the older `[TC_UI_010]`-style tag. Full rule: [testing-process.md](../testing-process.md) §3.7 (1:1 mirror).

## Test-case → script traceability (mandatory)

Every generated automation suite must be traceable back to the BrowserStack test cases it mirrors:

- **1:1 coverage:** every **automatable** BrowserStack case maps to exactly one automated test, named with that case's exact title (see Naming). Its assertion checks **that case's expected result**, so a per-case FAIL maps straight to a defect.
- **Non-automatable cases are declared, never silently dropped:** list them with a reason (manual-only, needs backend fault injection, env-gated, etc.). Env-gated tests that auto-skip (`test.skip(condition, reason)`) still count as mapped.
- **Maintain a mapping table** in the story's automation `README.md` (or `framework-reference.md`) so coverage is auditable at a glance. Columns:

  | BrowserStack Case ID | BrowserStack Title | Spec file | Automated? | Note (if not / env-gate) |
  |----------------------|--------------------|-----------|-----------|--------------------------|
  | `TC-49826` | `Verify DOB … is rejected in Admin Portal` | `kyc_edit_customer.spec.js` | ✅ | |
  | `TC-49840` | `Verify … on card replacement` | — | ⏭️ env-gated | `QA_REPLACE_ENABLED=1` |

- The table is the single source of truth linking the imported BrowserStack folder to the runnable specs; keep it updated whenever cases or specs are added.

## Async / await

- All I/O is `async/await`. No raw `.then()` chains in test logic.
- Standalone runners end with `main().catch(e => { console.error(e); process.exit(1); });` ([create_perks_api.js](b55168_pom/create_perks_api.js), [record_bug_b10_56609.js](b55168_pom/record_bug_b10_56609.js)).
- Deliberate waits use `page.waitForTimeout(ms)` (Playwright) or `sleep(ms)` (bs_helper). Network/element waits prefer `waitFor({ state, timeout })` and `waitForURL(...)`.

## Selectors / locators

- **Playwright:** locators are declared **in the page-object constructor** as fields, then reused by methods ([PerksPage.js](b55168_pom/pages/PerksPage.js) lines 51–93). Prefer role/text locators (`getByRole('combobox', { name })`, `locator("button:has-text('Add Perk')")`) and Angular hooks (`app-bf-input[controlname="title_en"] input`, `textarea[formcontrolname="description_en"]`).
- Dynamic Angular fields (inside `*ngIf`) are located only after the triggering action, with an explicit `waitFor({ state: 'visible' })`.
- Selectors are documented with a dated comment block when verified against the live DOM (see PerksPage header, "verified against live form (2026-06-09)").
- **Mobile (`bs_helper.js`):** locators are passed inline by strategy (`'xpath'`, `'accessibility id'`, `'class name'`) or by absolute coordinates via `tap(sid, x, y)`.

## Error handling

- API helpers throw descriptive errors on failure, embedding the HTTP status and body: `throw new Error(`Admin login failed: HTTP ${...} — ${await response.text()}`)` ([ApiHelper.js](b55168_pom/helpers/ApiHelper.js)).
- UI flows surface on-screen errors when navigation doesn't happen (`submitPerkExpectSuccess` reads the snackbar/`mat-error` text into the thrown message).
- Best-effort cleanup/optional steps use `.catch(() => {})` or `.catch(() => null)` to swallow non-fatal failures (overlay-backdrop detach, optional dialog buttons, `db.close()`).
- Stubs that aren't implemented yet **throw explicitly** rather than silently passing (`fillCouponPerk`/`fillCategoryPerk`/`setLimits` in PerksPage).
- DB resources are released in `test.afterAll` (`if (db) await db.close()`).

## Config & secrets out of the repo

- Non-secret env values live in `config/environments/cardServiceConfigs_<ENV>.js`, selected by `process.env.ENV` (default `testing`).
- **Secrets (DB password, SSH key) are never committed.** They are read at runtime from the external Java framework's `config_testing.properties` via [PropertiesReader.js](b55168_pom/helpers/PropertiesReader.js), overridable with `BF_PROPERTIES_PATH`.
- Other runtime overrides via env vars: `BF_TX_TABLE` (DB table name), `ENV` (config environment).
- Note: `bs_helper.js` currently hard-codes BrowserStack credentials — keep new secrets out of source going forward.

## Test file conventions

- Specs end in `*.spec.js` and live in `tests/`. Standalone `node` runners (not Playwright tests) live at the package root and are run with `node <file>.js`.
- Shared setup uses `test.beforeAll` (API token, DB connect) or `test.beforeEach` (UI login).
- Data-driven specs build a `TEST_CASES` array of `{ id, title, run }` and register them in a loop ([mid_exclusion_api.spec.js](b55168_pom/tests/mid_exclusion_api.spec.js)).
- Known defects are tracked with `test.fail(true, '...')` plus a linked Jira id, not by deleting the test ([mid_exclusion_ui.spec.js](b55168_pom/tests/mid_exclusion_ui.spec.js) TC_UI_021 → B10-56609).
- Suites that depend on unfilled SETUP auto-skip via `test.skip(condition, reason)` ([cashback_processing.spec.js](b55168_pom/tests/cashback_processing.spec.js)).

## Worker serialization for cron tests

The cashback cron is a shared backend job; parallel workers would interleave runs. The cashback spec is always run with `--workers=1`, and `playwright.config.js` globally sets `fullyParallel: false` + `workers: 1`. Keep cron-dependent tests serialized.
