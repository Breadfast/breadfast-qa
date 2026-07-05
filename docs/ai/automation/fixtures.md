# Test Fixtures & Setup

> What setup/fixture mechanisms actually exist in `b55168_pom/` today, and where formal fixtures should go when added.

## No custom Playwright fixtures yet

The framework does **not** define any custom Playwright fixtures (no `test.extend(...)`, no `fixtures.js`, no `tests/fixtures/` directory). Tests rely only on Playwright's **built-in** fixtures:

- `{ page }` — used by the UI spec ([mid_exclusion_ui.spec.js](b55168_pom/tests/mid_exclusion_ui.spec.js)).
- `{ request }` — the `APIRequestContext`, used by the API spec ([mid_exclusion_api.spec.js](b55168_pom/tests/mid_exclusion_api.spec.js)) and the cashback spec ([cashback_processing.spec.js](b55168_pom/tests/cashback_processing.spec.js)).

## Current setup mechanisms

### 1. Config injection — `ConfigReader` singleton

Configuration is injected by `require`, not by a fixture. [playwright.config.js](b55168_pom/playwright.config.js) imports the [ConfigReader](b55168_pom/helpers/ConfigReader.js) singleton and sets `use.baseURL = config.getCardServicesAdminPanelBaseURL()`. Specs `require('../helpers/ConfigReader')` directly and read getters as needed.

### 2. `beforeEach` — UI login

The UI spec logs into the admin panel before every test:

```js
test.beforeEach(async ({ page }) => {
  const loginPage = new LoginPage(page);
  await loginPage.fillLoginFormAndSubmit(config.getAdminUserName(), config.getAdminPassword());
});
```

A local helper `openCreateForm(page)` then composes navigation (`goToPerksPage` → `clickAddPerk` → `selectGeneralSpendCashbackType`) — this is a plain function, not a fixture.

### 3. `beforeAll` — shared API token / DB connection

- API spec: fetches one JWT per worker into a module-scoped `TOKEN`.
  ```js
  test.beforeAll(async ({ request }) => { TOKEN = await ApiHelper.loginAndGetToken(request); });
  ```
- Cashback spec: skips until SETUP is filled, then opens the DB-over-SSH connection; closes it in `afterAll`.
  ```js
  test.beforeAll(async () => {
    test.skip(!SETUP.templateTxId, 'Set SETUP.templateTxId ...');
    db = await new DbHelper(config.getBfPropertiesPath()).connect();
  });
  test.afterAll(async () => { if (db) await db.close(); });
  ```

### 4. In-spec `SETUP` blocks

The cashback spec carries a top-of-file `SETUP` object (`templateTxId`, `mids`, `mccs`, `perkIds`) that a human fills before running. This is the de-facto fixture for that suite today — see [AUTOMATION_B10-55185.md](b55168_pom/AUTOMATION_B10-55185.md) "One-time setup".

## Where fixtures SHOULD live when added

When this graduates to real fixtures, add a `tests/fixtures.js` (or `fixtures/` dir) exporting an extended `test` via `base.test.extend({...})`, and have specs `require('./fixtures')` instead of `@playwright/test`. Good first candidates to convert:

- **`authedPage`** — a `page` already logged into the admin panel (replaces the `beforeEach` + `LoginPage` boilerplate).
- **`apiToken`** — worker-scoped JWT (replaces the module-level `TOKEN` + `beforeAll`).
- **`db`** — a connected `DbHelper` with auto-`close()` in teardown (replaces the cashback `beforeAll`/`afterAll`), guarded by the same skip condition.
- **`perksPage`** — a `PerksPage` already on the create form.
