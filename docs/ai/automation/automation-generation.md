# Automation Generation — Java Framework Contract (CANONICAL)

> **Operator decision 2026-07-27:** the QA workflow's **Automation Generation phase** generates
> automation **inside the Breadfast Java framework** (`org.breadfast:QA_Framework`, default
> `D:\projects`) instead of authoring Playwright specs.
>
> - **Web** stories → **Java + Selenium** (replaces Playwright generation).
> - **Mobile** stories → **Java + Appium** (no migration — the existing Appium framework, exactly as is).
> - **Playwright is generated only on explicit user request** (existing suites stay maintained — [playwright-framework.md](playwright-framework.md)).
>
> **Scope: implementation-only.** Every other workflow phase — story analysis, requirements, AC,
> HLS, Figma, screen discovery, expected models, BrowserStack Test Management, test-case
> generation, planner/freshness/dependency/incremental machinery, Conformance Engine, AI residual,
> findings, reports, Jira, evidence, publishing, orchestration — is **unchanged**. The
> `automation-gen` skill still consumes `testcases` and produces the `automation` artifact under
> the same contract; only its **how** changed. Consumed by
> [qa-workflow/skills/automation-gen/SKILL.md](../../qa-workflow/skills/automation-gen/SKILL.md).

---

## 1. Technology routing

| Surface under test | Generate | Where it lives | Deep reference |
|---|---|---|---|
| Web (card admin panel, main admin portal, control room, RMS, chatbot SDK, WordPress) | **Java + Selenium + TestNG** | `<framework>/src/test/java/<module>/`, page objects in `src/main/java/modals/<area>/` | [java-framework.md](java-framework.md) §4, §8 |
| Mobile native (customer app `androidNative`/`iosNative`) | **Java + Appium + TestNG** | same framework; screens per the native contracts | [mobile-native-framework.md](mobile-native-framework.md) — **canonical for all new mobile automation** |
| Mobile RN (legacy build), fleet, mid-mile | **Java + Appium + TestNG** | existing `android`/`ios`/`fleetApp`/`midMileApp` packages | [java-framework.md](java-framework.md) §3–4 |
| API / backend | **Java + REST-assured** via existing `helpers/apiClients` | `src/test/java/<module>/api/` | [java-framework.md](java-framework.md) §5, [api-clients.md](api-clients.md) |
| Playwright (JS) | **only when the user explicitly requests it** | in-repo `automation/` + `automation/legacy/` | [playwright-framework.md](playwright-framework.md) (legacy for new generation) |

## 2. Framework discovery — configurable, never assumed

The framework path is **configuration, not a constant**. Resolve it before generating anything:

1. `QA_FRAMEWORK_PATH` env var → 2. [`automation/config/framework.js`](../../automation/config/framework.js)
   (`frameworkPath`, default `D:\projects`) — `require(...).resolve()` returns the first candidate whose
   **`pom.xml` exists**, else `null`.
2. Verify it is really this framework: `pom.xml` declares `org.breadfast:QA_Framework`.
3. **If unresolved → ASK the operator for the location** (in the Phase 0 batch — see
   [detect-prerequisites](../../qa-workflow/skills/detect-prerequisites/SKILL.md)). Use the answer for
   this run and offer to persist it in `framework.js`. Generation must **never fail or report
   "blocked"** just because another engineer stores the framework elsewhere ([[ask-never-block]]).

## 3. Mandatory learning phase — before any generation

The framework is the **source of truth** for generated code. Generated automation must be
indistinguishable from what the framework authors would write. Learning order:

1. **This repo's distilled catalogs first** (they exist precisely to make this phase cheap):
   [java-framework.md](java-framework.md) (architecture, modals/helpers/apiClients/models/dataProviders/
   validators/config/suites), [mobile-native-framework.md](mobile-native-framework.md) (base-class
   contracts, locator + method conventions, reusable login/OTP/scroll/checkout workflows, BaseTest +
   `mobileng.xml` wiring), [reusable-components.md](reusable-components.md) (capability → asset index),
   [coding-standards.md](coding-standards.md), [page-objects.md](page-objects.md),
   [helpers.md](helpers.md), [api-clients.md](api-clients.md), [fixtures.md](fixtures.md).
2. **The framework's own documentation** — treat as engineering standards: `<framework>/CLAUDE.md`
   (the framework's ~130 KB manual), `DOCUMENTATION_INDEX.md`, `QUICK_START_GUIDE.md`,
   `TECHNICAL_SPECIFICATION.md`, every root `README`/`*.md`, and `uploadedDocs/` if present.
3. **Project resources** — how the framework consumes them: `resources/environments/*.properties`
   (config source of truth; loaded into the `Configs` model), data sets, scripts, images/screenshots,
   `checkstyle.xml` + `checkstyle-suppressions.xml` (build-failing quality gate).
4. **The target module's real code** — before writing for a module, read its existing page objects,
   tests, helpers end-to-end: setup/teardown (`BaseTest` ThreadLocal fixtures), execution helpers,
   assertions, annotations (`@Test(groups, description)`, `@Tags`, `@TmsLink`), naming, organization.
5. **Verify catalog freshness** against the live tree; when drift is found, **update the catalog**
   (knowledge-extraction duty, `CLAUDE.md` §1) — don't silently work around it.

**Initial learning scope** (highest-traffic domains): customer app **androidNative/iosNative**
(page hierarchy, reusable screens, navigation, components, helpers, existing tests) · **cards admin
panel** (`modals/cardsAdminPanel`, `cardService/adminPanel` tests, `CardAdminPanelPerksApiClient`) ·
**payment** (`modals/Payment`, `androidPayPage`, `CardServiceApiClient`, `MobilePayServicesApiClient`,
payment models) · **existing test packages** (`src/test/java/**`, ~230 classes).

## 4. Reuse-before-build (unchanged rule, Java target)

Before writing ANY code, search the framework for existing **page objects, components, helpers,
utilities, models, validators, API clients, data providers, base classes**. If it exists — reuse it;
never duplicate. Before creating a new page object, establish that the page doesn't already exist,
no similar page can be extended, and no reusable component covers it — only then create one,
following the module's base-class contract (`BaseAndroidScreen`/iOS equivalent + `PageFactory`,
or the Selenium page pattern of the target module). New mobile screens follow
[mobile-native-framework.md](mobile-native-framework.md) including **BaseTest wiring**.

## 5. Story-based test organization

- **One test class per Jira story**, named `B10_<id>_<Feature>Tests` (e.g.
  `B10_56336_CardActivationTests`), `extends BaseTest`, placed in the **module package matching the
  surface** (`cardService/adminPanel`, `mainAdminPortal/...`, `customerApp/androidNative/...`, …).
  All of the story's automated cases live in that class.
- **TestNG groups:** include the story key as a group (`groups = {"B10-56336", ...}`) — existing
  framework precedent — plus `regression`/`smoke` as the impact analysis dictates; `@Tags` per the
  module's convention (e.g. `@Tag("web")`, `@Tag("cardservice")`).
- **Story suite XML** at the framework root, `b10-<id>-tests.xml` (precedent: `b10-55168-tests.xml`),
  so the story runs standalone via `mvn test -DsuiteXmlFile=b10-<id>-tests.xml`. Wire into shared
  suites (`fintechng.xml`, `mobileng.xml`, …) only when regression scope calls for it.
- ⚠️ **Checkstyle trap (one-time framework wiring):** `checkstyle.xml`'s `TypeName` format
  `^[A-Z][a-zA-Z0-9]*$` **rejects underscores** and fails the build at `validate`. Before the first
  story class is committed, add a scoped suppression to `checkstyle-suppressions.xml`:
  `<suppress checks="TypeName" files="[/\\]B10_\d+_\w+Tests\.java$"/>` (precedent: a `MemberName`
  suppression already exists). This is a framework change — **propose it and get approval first**
  ([coding-standards.md](coding-standards.md) Framework Architecture Standard); surface it in the
  Phase 0 prerequisite batch, not mid-generation.

## 6. BrowserStack Test Management mapping (source of truth)

One **automatable BrowserStack case → one test method**, 1:1, using the framework's **native TMS
idiom** (better than comments — it is machine-consumed):

```java
@Test(groups = {"B10-56336", "regression"}, description = "Verify card activation with valid OTP")
@Tags({@Tag("web"), @Tag("cardservice")})
@TmsLink("TC-1452")   // ← the BrowserStack case id; @TmsLinks({...}) for multi-case methods
public void verifyCardActivationWithValidOtp() { ... }
```

- **`@TmsLink("TC-xxxx")` is the binding.** `BrowserstackSyncListener` reads it at test start and
  `BaseTest` teardown posts pass/skip/fail to BrowserStack TMS whenever `targetProjectId` +
  `targetRunId` are set in `browserStackConfigs.properties` (`BrowserstackApiClient
  .postTestResultsToBrowserstack`). The listener's method-name regex fallback exists — never rely on it.
- **`description` = the exact BrowserStack case title, verbatim** — this carries the existing
  "test title = BS title" rule ([coding-standards.md](coding-standards.md) Naming,
  [testing-process.md](../testing-process.md) §3.8) into Java. Method name = camelCase of the title.
- **Traceability table stays mandatory** in the story's `automation/README.md`
  (Case ID · BS title · test class#method · automated? · reason if not). Non-automatable cases are
  declared with a reason, never dropped. Verify title parity against the imported folder before a
  run (adapt `check_test_name_parity.js` to read `@Test(description)` / the table — it previously
  read spec titles).

## 7. Coding standards & validation gate

Follow the framework, not preference: package structure, imports, formatting, naming, logging
(`logger.get()`), waits, assertions (TestNG `Assert` with messages), helper usage
(`testExecutionHelper`, data factories, `defaultTestData` ThreadLocals), Allure reporting,
exception handling. No hardcoded values (config → `resources/environments` + `Configs`), no
duplicated selectors/flows. **Java 25; Checkstyle runs at `validate` and fails the build.**

**Before recording the `automation` artifact:** `mvn -q test-compile` (from the framework root)
must pass — compile + checkstyle green. A generation that doesn't compile is not done.

## 8. What lands where

| Artifact | Location |
|---|---|
| Story test class, new page objects, helpers/API clients, story suite XML | **inside the framework** (single source — never copied into the story folder) |
| `framework-reference.md` — reuse map: assets reused, new classes + method signatures, per-case navigation notes | story folder `automation/` |
| `README.md` — how to run (Maven commands), preconditions, **traceability table** | story folder `automation/` |
| Generators / story-specific scripts (CSV gen, parity check) | story folder `automation/` |
| `record` bookkeeping | unchanged: `qa-cli.js record "<storyDir>" automation --path automation/README.md --generator automation-gen@2.0 --derive-artifacts testcases` |

## 9. Field-proven rules — MANDATORY

> Learned by generating B10-56750 end to end and running it five times against the live panel. Each
> rule below cost a failed run or a wrong result; none of them are theoretical. **Apply them to every
> new story.**

### 9.1 Working-tree discipline (the framework is shared)
- **Branch name is hook-enforced:** `<currentYear>/sprintQ<n>.<n>/<name>` (lowercase, digits, `-`,
  capital `B` allowed) — e.g. `2026/sprintQ3.3/B10-56750-add-section-to-all-perk-types`. The
  `pre-commit`/`pre-push` hooks reject anything else (`readme.md` §Contributing). Never work on `main`.
- **Other engineers and sessions edit the same tree.** Before committing run `git status` and commit
  **only the files you authored, by path**. Never `git add -A`/`git add .`, never commit a file that
  was already untracked or modified when you arrived — that is someone's in-flight work. (This
  happened: an untracked `CardAdminPanelPerksApiClient.java` was swept into a commit and had to be
  reverted and un-tracked.)
- **Commit the story test class and its suite XML on the story branch — an untracked file is not on any
  branch, so it follows every `checkout` and breaks the build of every other branch it lands on.** The
  page object it calls *is* tracked, so it stays behind on the story branch while the test class travels;
  the next branch then reports dozens of `cannot find symbol` errors against a page object that looks
  untouched, and the errors name a story nobody on that branch is working on. Leaving generated code
  uncommitted is not a neutral "not finished yet" state.
- **A sweeping commit puts other stories' work on your branch.** `git add -A` (or an IDE "commit all")
  on a shared tree collects every in-flight file, so one commit can carry three stories and strand two
  of them on a branch that will never be merged into theirs. Commit **by path**, and check
  `git show --stat` afterwards — the file list is the proof.
- A build can fail for a moment because another session is mid-edit. **Re-run before diagnosing.**
- **Never recompile while a suite is running** — surefire's forked JVM picks up newly written classes
  lazily and the run's results become meaningless.

### 9.2 Read the right documents
`readme.md` is the framework's real standard (setup, branch naming, PR rules). The other root
`*.md` files are one-off debugging reports for a single iOS test, **not** conventions. There is no
`CLAUDE.md` in the framework — the conventions live in the code, so read the sibling page objects
and tests of the module you are generating into. Two standing `readme.md` requirements shape design:
**tests must run unchanged across QA/Staging/prod**, and **0 flakiness**.

### 9.3 Locators — verify against the running app, never infer
Drive the real page (authenticated browser) and read the DOM before shipping a locator. Order of
preference, best first:
1. **The app's own contract:** `formcontrolname` / `controlname`, Angular component tags
   (`app-perk-form`, `app-create-section-dialog`), route `href` (`//a[@href='#/perks']`).
2. **Semantic classes the app authored:** `perks-table`, `btn-search`, `add-section-btn`.
3. **A label the DOM associates with the control** (e.g. `div.filter-field[label='Category']//select`)
   when a field has no id or name.
4. **Visible text, scoped to a component**, only when nothing above exists — case-normalised with
   `translate()`, because this panel renames copy ("Add Perk" → "Add perk").

Never use: positional `(//x)[1]` as the *only* discriminator, bare `//table`, Angular build
attributes (`_ngcontent-jhv-c166`), or Bootstrap layout classes.

**Check the match count of every locator** (`document.evaluate(...).snapshotLength`). More than one
match means `@FindBy` silently takes the first — if that is intended, pin the index and say why.

**A loose `contains()` can create a false PASS**, which is worse than a failure. `contains(@class,
'close')` matched `close-icon`, so an assertion for a *missing* close icon passed on two buttons that
were `visibility: hidden`. Match a class as a whole token —
`contains(concat(' ', @class, ' '), ' close-icon ')` — and when the question is "can a user use this
control", filter on `isDisplayed()`.

### 9.4 Known traps in inherited `BaseWebPage` helpers
- **`selectTheDropDownList(el, text)`** selects correctly, then waits for the `<select>`'s **value
  attribute** to equal the visible text. Angular writes `"1: 1"` there, so the wait can never pass
  and the call always times out. Drive `new Select(el).selectByVisibleText(...)` yourself.
- **`enterStringIntoTextField(el, text)`** cannot refill a **pre-filled** field: its `clear()` guard
  reads `getText()`, which is always `""` for an `<input>`, so it appends (`0` + `1` → `01`) and
  loops. Clear explicitly (select-all + delete) and verify with `attributeToBe(el, "value", …)`.
- `getText()` returns only **rendered** text: use `getAttribute("textContent")` to read `mat-option`s
  and a `mat-select` trigger, otherwise scrolled-out options come back empty.

### 9.5 Angular Material + SPA behaviour
- **Hash routing:** `driver.get(base + "/#/perks")` from another `#/route` changes only the fragment,
  so the app never re-routes and the old screen stays. Navigate via the app's own menu, or set the
  fragment **and `navigate().refresh()`**.
- **After any dialog, re-enter the page with a reload.** A leftover `cdk-overlay-backdrop` covers the
  shell and the side menu becomes unreachable.
- The `mat-select` panel stays open **behind** a dialog (two stacked overlays) and survives its
  dismissal; close it explicitly. Do **not** send Escape while a value is committing — it cancels the
  pending selection.
- A `mat-option` wrapping a disabled ancestor is not clickable by WebDriver; click it via JS.
- Long option lists **lazy-load in pages of 20**; exhaust them before reading, and be aware that
  scrolling a panel is itself destabilising — do not over-tune the scroll loop (making it more
  aggressive turned 5 failures into 9).

### 9.6 Data, config and re-runnability
- Unique names must be unique in **every** locale field. Randomising only the English name while
  hard-coding the Arabic one makes the suite pass once and fail forever after, because the duplicate
  rule matches on either name.
- Uniqueness comes from the framework: `testExecutionHelper.get().generateRandom7DigitNumber()`.
- File paths belong in `resources/environments/*.properties` — and **`java.util.Properties` treats a
  backslash as an escape** (`D:\projects\resources` became `D:projectsesources`). Use forward slashes.
- Prefer deriving data from the environment (select the *first* Section) over hard-coding a name, so
  the suite stays environment-agnostic.
- There is no cleanup path for some entities (Sections cannot be deleted in the panel). Say so in the
  story README rather than pretending the run leaves no trace.

### 9.7 Running the suite
The pom **hardcodes `<suiteXmlFiles>`, so `-DsuiteXmlFile=…` is silently ignored** and the entire
default regression set runs instead. Use:
```bash
mvn test -Dtest=B10_<id>_<Feature>Tests                 # the story class
mvn test -Dtest=B10_<id>_<Feature>Tests#<method>        # one case
mvn test -Dsurefire.suiteXmlFiles=b10-<id>-tests.xml    # the story suite XML
```

### 9.8 Reading results honestly
- **The framework screenshots every failure** to `resources/screenshots/` and attaches it to Allure.
  Open it first — it identified the SPA-routing bug and the un-selected Section in seconds.
- **Distinguish three outcomes** and report them separately: a test bug (fix it), a genuine product
  defect (the suite working — leave it failing and link the Jira subtask), and a **vacuous pass** (a
  loop that never executed because a list came back short). Guard against the third: assert the list
  is complete before asserting on its order.
- **One BrowserStack case may cover several open defects.** Hard assertions stop at the first, so the
  rest are invisible. Collect the deviations and assert once with all of them in the message.
- Cross-check coverage against the story's **Jira bug subtasks**, not against your own notes — every
  open bug should map to a test, or be explicitly declared as visual-only/not-automated.
- The panel invalidates **concurrent sessions for the same admin user**, so never run the suite in
  parallel with a manual session on that account.

### 9.9 Fixture data lives in the page object — and it has to be real

> Added 2026-07-27 from B10-57393. The suite uploaded flat colour blocks and typed placeholder copy;
> both passed validation and proved nothing.

- **The page object owns the story's form data, not the test class.** Whole-form fixture values are
  `private static final` constants next to the fill methods in the POM (`PERK_TITLE_EN`,
  `PERK_COUPON_CODE`, `PERK_ARTWORK`, …), and the fill methods take **no data arguments** —
  `fillValidMerchantCashbackPerk()`, `fillValidDiscountCouponPerk()`. A test class declares **no
  data constants and no literals**; it reads back what was entered through the POM's getters
  (`getEnteredPerkTitleEn()`, `getEnteredCouponCode()`, `getPerkSectionName()`) so the assertion and
  the input can never drift apart. A value the test needs to vary at runtime (a uniqueness suffix)
  stays a parameter; a value that merely *is* the fixture does not.
- **An action that changes fixture data is a POM method too**, returning what it entered:
  `String editedTitle = perksPage.editPerkTitle();`. Keep the original readback intact so a test can
  assert both the new value and the absence of the replaced one.
- **Test data must be data the product could really receive.** `Mega Cashback Bonan`,
  `Edited Title 77` and a 25%-cashback description on a 15% perk all pass the form and hide real
  rendering bugs. Write the copy a merchant would publish, keep it internally consistent with the
  numbers the form enters, and — for max-length cases — keep the **exact character count** while
  making the string read like real copy.
- **Uploaded images are fixture data, not filler.** A form that only validates dimensions will accept
  a solid colour block, and then no assertion can tell a right-slot render from a wrong-slot one, a
  correct aspect ratio from a squashed one, or an English asset from the Arabic one. Ship artwork
  that carries the merchant brand, the offer headline and a motif for the perk, in **both languages**,
  and upload the Arabic asset into the Arabic slot.
- **Generate binary fixtures from a checked-in script; never hand-place stray files.** The generator
  (`D:\projects\resources\scripts\generate_perk_images.py`, the perk precedent) holds a catalog
  keyed by merchant, asserts the exact dimensions and steps JPEG quality down until each file fits
  the byte cap, so anything it emits is guaranteed to pass upload validation and any teammate can
  reproduce the set. Assets land in `resources/images/<domain>/<set>/` with a README stating the rule.
- **Brand rule for merchant artwork:** a Breadfast perk uses the Breadfast brand system; an outside
  perk (H&M, Zara, …) uses that merchant's own colours and wordmark, so the preview tile reads the way
  a real merchant tile would.
- **Resolve asset paths through a model, not raw strings.** `models.PerkArtwork` maps a set name to
  the four slot files, resolves them to absolute paths (a file input accepts nothing else) and fails
  with the regeneration command if one is missing — instead of surfacing three steps later as
  "Preview & save does nothing".

### 9.10 Two traps that make a form fill fail silently

> Both cost a full debugging cycle on B10-57393; both were invisible in the failure message until
> the error reporter was taught to name the field.

- **`normalize-space(.)='Label'` does not match an Angular Material label.** Material prefixes radio
  and checkbox labels with `&nbsp;` (U+00A0), and XPath's `normalize-space()` strips ASCII whitespace
  only — the non-breaking space survives, so the equality test never fires. Match Material labels
  with `contains(normalize-space(.), 'Label')`.
- **`…IfDisplayed()` on a REQUIRED field is a silent failure waiting to happen.** "Coupon type"
  renders only after the coupon code registers, so a one-shot `findElements` lost the race, skipped
  the click, and left a mandatory field empty; the only symptom was "Preview & save" doing nothing.
  Reserve the *IfDisplayed* pattern for genuinely optional fields — for a required one, **wait** for
  the control, click it, and **confirm the selection registered** (`mat-radio-checked`).
- **Make the form's validation errors name their field.** The panel prints the same
  "This field is required." under every empty control, so an unlabelled dump cannot tell you which
  one is blocking. `getCreatePerkFormValidationErrors()` now walks up from each message to its
  `<label>` and prefixes it (`Coupon type *: This field is required.`) — that one change turned a
  30-minute hunt into a one-line answer.

### 9.11 Outside-merchant coverage

> Most perks the product will ever preview belong to a third-party brand, but the environment ships
> Breadfast merchants only, so a suite that never leaves Breadfast tests the easy half.

- The **merchant picker doubles as a merchant factory** (`+ Add merchant` → name EN/AR + one or more
  branch/MID pairs, CTA disabled until valid). An outside-merchant fill creates the merchant on
  first run and reuses it afterwards, because the panel offers **no way to delete a merchant** —
  the same one-way-door caveat as Sections (§9.6). Guard the creation with a
  "does the picker already list it?" check so the suite stays re-runnable.
- Give the outside perk a **non-Breadfast section** (`General Purchases`) and that merchant's own
  artwork set, so the preview is exercised end to end as a third-party tile.
- A **Discount/coupon tile shows the merchant name under the title**, where a Merchant-cashback tile
  shows the subheader. Assert per perk type; don't copy the assertion across.

### 9.12 A failing assertion is a question, not a bug report — probe before you patch

**When a count or content assertion disagrees with expectation, capture the rendered state and compare it
against the oracle BEFORE changing any code.** Adjusting the reader and re-running is a guess: it cannot
distinguish *"my reader is wrong"* from *"the product is wrong"*, and that is the only question worth
answering. Ship a throwaway probe that prints what is actually on screen (`<story>/automation/explore/
probe-*.js`); it costs one run instead of several and doubles as the evidence that either grounds the
defect or disproves it.

Two defaults, both learned the expensive way:

| Failure | Correct default |
|---|---|
| An **interaction** did nothing | *my tap did not land* — not "the product is broken" |
| A **count or string** is surprising | *my reader is miscounting* — not "the product renders the wrong value" |

Measured cost of skipping this on B10-56711: three device round-trips at ~8 min each on a single
assertion, each one "fixing" a boundary that was never the problem — the app rendered the correct 3 lines
throughout. The probe that settled it printed every text node with its `y` in one pass. Platform-specific
reason this bites hardest on mobile — **container rects do not bound their own content on Compose
surfaces** — is in [mobile-native-framework.md](mobile-native-framework.md) §2.1, with the measurements.

Related and already in this document: **§9.3** (verify a locator by issuing a find and getting an element
back — an id appearing in a dump is not verification) and **§9.8** (guard the vacuous pass: assert a list
is complete *before* asserting on its order — an `expected` derived from `actual` passes on an empty
screen).

### 9.13 Readability is a conformance requirement, not a preference

> Added 2026-08-09 from the B10-57771 review. The suite compiled, passed the conformance gate and ran
> 21/21 green — and still read as machine-written on a second pass. **The QA team maintains this code.
> A method that a QA engineer cannot understand on first reading is a defect, whether or not it passes.**

- **A test method reads as a business flow.** Setup → act → assert, in page-object calls and
  `Assert.*`. Anything a reader would have to *decode* belongs on the page object: route/URL string
  handling, `substring`/date-format slicing, collection algebra, index arithmetic. B10-57771 shipped
  `getCurrentPageUrl().contains("/perks/duplicate/" + id)` in three tests; the framework's own idiom is
  a predicate on the page object (`createPerkFormIsDisplayed()`), which is why no other test in the
  module knows a route string.
- **Prefer the simplest control flow that is still correct.** No nested `if`, no nested loops, no
  streams, no clever one-liners, no duplicate fallback paths. Where a flow is *genuinely* complex —
  multi-page search, retry, platform branching — implement it properly, but implement it **once**, on
  the page object, with a comment saying what forced the complexity.
- **A method on a shared page object outlives the story that added it, so it must not carry the
  story's vocabulary.** Name it for the control and the operation, not for the scenario:
  `getCouponCodeFieldValue()`, not `getPrefilledCouponCode()`. B10-57771's `getPrefilled*` family had
  to be read by a *later* test that asserts the field is **blank** — where the name says the opposite.
  Same rule for constants and locator fields.
- **Before adding a reader or an action to an existing page object, grep that file for one that
  already touches the same control.** §4's reuse ladder is applied per *class*; this is the per
  *method* form of it, and it is where duplication actually enters. B10-57771 added
  `getPrefilledEndDate()` next to a pre-existing `getEndDateValue()` reading the same input through a
  second locator. Record the grep in `framework-reference.md` beside the method.
- **Match the file you are editing, not a house style you bring with you** — its import block (no
  fully-qualified `java.util.ArrayList<>` inline when the file imports its types at the top), its
  blank-line rhythm, its comment density, its separator comments. If a file has no banner convention,
  do not invent one.

### 9.14 An oracle has to be able to fail

> Also 2026-08-09, B10-57771. Three tests asserted "this action created no perk" by comparing the
> perks-table row count before and after. **The list pages at 15 rows**, so the count is 15 either
> way: the assertion could not go red, and all three passed for a year's worth of runs' worth of
> reasons that had nothing to do with the product. §9.8's vacuous-pass guard covers a loop that never
> executes; these are the other three shapes.

- **Before/after comparison: prove the measured value can actually change.** A paged, filtered,
  capped or truncated read cannot. Ask the *system* — an API count — when the question is "does it
  exist / how many are there", and reserve the screen for "is it rendered correctly". (The perks
  finder already had `listPerks`; the count oracle was one method away.)
- **A negative assertion must first prove its subject exists.** `assertNotEquals(actual, source)` and
  `assertFalse(...contains(x))` are both satisfied by an empty read, so a lookup that silently returns
  `""` turns "the duplicate has its own images" into a guaranteed pass. Assert the subject was found,
  then assert what differs about it.
- **The BrowserStack case title is the contract: every noun in it needs an assertion.** B10-57771's
  TC-54749 is titled *"…pre-fills the source perk type, section, merchant **and funding type**"* and
  never asserts funding type at all — and asserts section and merchant only as *non-empty*, so it
  passes when the form pre-fills the **wrong** section. A `!isEmpty()` check is a smoke test; if the
  case says a value is *copied from the source*, the source's stored value is the oracle.
- **The one question to ask of every assertion you write:** *what change in the product would turn
  this red?* If there is no concrete answer, it is not a test yet. Put the answer in the assertion
  message — that is where it is useful when it does go red.

### 9.15 Choosing which record to test against

> B10-57771 again: the suite pinned four perks by id (`DC_29`, `DC_30`, `DC_31`, `GC_63`) seeded by hand.

- **Discover the fixture by the property the assertion depends on, not by id** — the framework's own
  idiom (`findActivePerkWithCouponType`, `findActivePerkWithMoreThanThreeDistinctBranchLines`). A
  shape-finder must require *every* property the assertion reads, or it hands back a record that
  satisfies the search and breaks the check ([[shape-finder-must-require-assertion-property]]).
- **A fixture whose state is derived from time decays.** A "planned" perk becomes Active the moment
  its start date passes, silently inverting any test that asserts a state-gated control. **Never pin a
  lifecycle-state test to a hardcoded id**; resolve the record by its current status at run time.
- **Keep a pinned id only when the record's *content* is the point** (a curated perk with all four
  images and full bilingual copy), and say so in `framework-reference.md` with what makes it curated,
  so the next engineer can rebuild it.
- **A pinned id is environment data, so it lives where the framework already keeps environment data:**
  `resources/environments/*.properties` → a `Configs` getter (the live precedent is the card-user
  fixture block — mobile number, national id, BCID, last four digits — and the perk image paths). It is
  **never** a `private static final` in the test class: a test-class constant cannot be overridden per
  environment, which breaks the framework's standing "runs unchanged across QA/Staging/prod"
  requirement (§9.2), and it is invisible to anyone reseeding fixtures. Adding a key is a framework
  change — **propose it in the plan gate**, don't add it mid-generation
  ([coding-standards.md](coding-standards.md) Framework Architecture Standard).
- **Do not introduce a new data-holder for this.** Reuse the ladder that exists: environment values →
  `Configs`; form/input data → the page object (§9.9); binary assets → a model such as the artwork
  resolver; record selection → a finder on the module's API client. A `dataFactories` package exists,
  but check for live consumers before following it — an unused pattern is not a precedent, and building
  on one creates the parallel architecture the standard forbids.
- **Every value that must not collide across permanent records is run-unique — not just the name.**
  §9.6 says this for locale fields; the same applies to any business key on a record the environment
  cannot delete. B10-57771's five saving tests all wrote the same coupon code into perks that can
  never be removed.

*Restructured 2026-07-27 (operator directive): web automation generation re-based from Playwright onto
the Java framework; mobile unchanged. Supersedes the 2026-06-22 "new web automation goes to
`b55168_pom`" resolution — see [process-parity-audit.md](../process-parity-audit.md) §E and
[playwright-framework.md](playwright-framework.md) for the legacy scope. §9 added the same day from
the B10-56750 migration's five live runs. §9.13–9.15 added 2026-08-09 from a second-pass review of
B10-57771, which had already passed the conformance gate and run 21/21 green — readability, oracle
falsifiability and fixture selection are the three dimensions no build gate and no green run can check.*
