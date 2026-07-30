# B10-56750 — Java/Selenium Framework Reference (reuse map)

> Migration record (2026-07-27): the story's validated Playwright suite (HLS v2) was re-created as
> **Java + Selenium inside the Breadfast Java framework**, per
> [automation-generation.md](../../docs/ai/automation/automation-generation.md).
> Framework branch: **`2026/sprintQ3.3/B10-56750-add-section-to-all-perk-types`** (the naming
> convention the framework's `pre-push`/`pre-commit` hooks enforce — `readme.md` §Contributing).
> Single commit `75795e581`. The Playwright specs are archived in
> [`_archive_playwright_hls_v2/`](./_archive_playwright_hls_v2/) and remain the selector provenance.

## What was REUSED (no duplication)

| Asset | Where | Used for |
|---|---|---|
| `BaseTest` | `src/test/java/base/BaseTest.java` | fixture root: Chrome per test via `WebDriversFactory`, `Configs`, card-panel page ThreadLocals, BrowserStack TMS result sync |
| `CardAdminPanelLoginPage` | `modals/cardsAdminPanel/` | panel login (`goToPage`, `fillLoginFormAndSubmit`) |
| `CardPanelDashboard` | `modals/cardsAdminPanel/` | post-login assertion |
| `BaseWebPage` | `modals/` | `wait` (FluentWait 60s), `isElementDisplayed`, `enterStringIntoTextField`, `closeDropDown` (Escape), `performDoubleClickOnElement`, `goToUrl` |
| `BaseHelper` via `testExecutionHelper` | `helpers/` | `generateRandom7DigitNumber()` for unique Section/perk names — no `System.currentTimeMillis()` |
| `BrowserstackSyncListener` + `BrowserstackApiClient` | `helpers/factories/listeners/`, `helpers/apiClients/` | `@TmsLink` → Test Management result posting |
| `RetryListener` / `AllureTestNg` | suite XML listeners | retry + reporting, per the `b10-55168-tests.xml` precedent |
| Config keys | `config_testing.properties` + `cardServiceConfigs_testing.properties` | `cardServicesAdminPanelBaseURL`, `getCardAdminPanelAdminUserName/Password` |

## What was CREATED

| Class / file | Purpose |
|---|---|
| `modals/cardsAdminPanel/PerksPage.java` | Perks list + Create Perk form + Section dropdown + "+ Add section" modal + perks-table reads. Selectors ported from the live-verified JS page object |
| `src/test/java/cardService/adminPanel/B10_56750_AddSectionToPerksTests.java` | 27 `@Test` methods, one per automatable BrowserStack case |
| `b10-56750-tests.xml` | story suite — `mvn test -DsuiteXmlFile=b10-56750-tests.xml` |
| `resources/images/perks/*.jpg` + `perkCoverImagePath`/`perkLogoImagePath` config keys (`Configs`, `DataHelper`, `.properties.example`) | exact-spec upload assets for the perk-save case, referenced through config so the suite stays environment-agnostic (`readme.md` requires tests to run unchanged across QA/Staging/prod) |
| `BaseTest` wiring | `webCardPanelPerksPage` ThreadLocal (declaration + init inside the `getWebBuildEnabled()` block) |
| `checkstyle-suppressions.xml` | `TypeName` exemption scoped to `B10_\d+_\w+Tests.java` — checkstyle runs at `validate` with `includeTestSourceDirectory=true` and would otherwise fail the build on the story-class name |

## Verification is UI-only (no API client)

This is a **UI story**, so every assertion is made through the panel. The two data-level cases use
the UI evidence the panel already exposes — **the perks table's Category column is populated from the
perk's Section** (confirmed live 2026-07-26, `execution-reports/exploratory-notes.md`):

| Case | UI verification |
|---|---|
| TC-53897 perk saved with exactly one Section | save the perk, then read its row's Category cell |
| TC-53900 backfill | filter the perks table by Category = Breadfast / General Purchases and read the rows |
| TC-53899 ordering | the Section dropdown renders the server's order, so the option order is the evidence |
| "no Section was created" (blocked submits, Cancel, over-long name) | reopen the dropdown and assert the name is absent |
| "created exactly once" (double-click) | count the dropdown options carrying the name |

An earlier revision added `listSections`/`listPerks` to `CardAdminPanelPerksApiClient`; that was
**reverted** and the file left untracked exactly as found — it is another engineer's uncommitted work.

## Selenium ports of Playwright-only techniques

| Playwright technique | Selenium equivalent |
|---|---|
| `waitForResponse('/section/create')` | UI post-condition — the Section is//isn't listed in the dropdown |
| request-payload capture on perk create | the saved perk's Category cell in the perks table |
| `browser.newContext()` fresh session | `webDriver.get().manage().deleteAllCookies()` + fresh login (same page objects — tests never construct page objects) |
| `expect.soft` on known deviations | plain `Assert` ordered **last** in the test (the framework uses no SoftAssert anywhere), tagged `[DEFECT-EXPECTED]` |
| `filechooser` / `setInputFiles` | `sendKeys(absolutePath)` on the dialog's `input[type=file]` — the `ViewCardUsersDetails.uploadDocImage` precedent |
| `:has-text()` case-insensitive matching | `translate()`-lowercased XPath `contains()` (the panel's copy is sentence-case) |

## Style conformance (operator instruction 2026-07-27)

Both classes were re-created after a full study of the framework, to be indistinguishable from
existing code:

- **Page object** — `@FindBy(xpath=…)` package-private `WebElement` fields + `PageFactory`, no `By`
  constant fields, `String` template fields for dynamic xpaths, `@FindBy List<WebElement>` for table
  rows, cards-package compact spacing (no blank lines between members), `//` comments only (no
  Javadoc), `xxxIsDisplayed()` boolean naming, private helpers (`clickOnMatOptionByText`,
  `loadAllSectionOptions`, `clearField`, `pause`) last.
- **Test class** — class-level `@Test`, `extends BaseTest`, functional `@Tags({@Tag("web"),
  @Tag("cardservice")})` (they drive driver creation and card-service config), `groups = {"regression",
  "B10-56750"}`, page objects only via `webCardPanelPerksPage.get()`, and **each test a linear
  self-contained script** — login → navigate → act → assert with a `//Comment` per block, exactly as
  `CardAdminPanelTests`/`ControlRoomTests` do. No private helpers, no streams, no regex `Pattern`s, no
  `Map` juggling, no `SoftAssert`, explicit types throughout, every `Assert` carrying a message.

## Known-deviation semantics
Asserted last in their test and expected to fail until fixed: **F-01** (no X close icon), **F-03** (no
red field highlight on duplicate), **F-04** (missing required markers), **F-05** (placeholders differ),
**B10-58192** (Sections after Breadfast not alphabetical). TC-53886 stays not-automated (expectation
retracted; B10-58196 withdrawn).
