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
panel** (`modals/cardsAdminPanel`, `cardService/adminPanel` tests, `CardServiceApiClient`'s perks region) ·
**payment** (`modals/Payment`, `androidPayPage`, `CardServiceApiClient`, `MobilePayServicesApiClient`,
payment models) · **existing test packages** (`src/test/java/**`, ~230 classes).

## 4. Reuse-before-build — the framework teaches you how the code should be written

**The framework is the source of truth. Adapt the generated code to the framework; never adapt the
framework to what is easier to generate.** The finished suite has to read as if the engineers who
built the framework wrote it — same architecture, same client boundaries, same authentication, same
page-object shape, same test-class shape, same locator/wait/assertion/logging idiom. A reader should
not be able to tell which stories were generated.

### 4.1 The question to ask before writing anything

> *Does the framework already have something that solves this, or something structurally equivalent?*

- **Yes** → reuse it, or extend it in place.
- **No, but something is close** → copy the **structure and style** of the closest existing
  implementation and put the new behaviour inside it.
- **Genuinely nothing** → only then create something new, and say in `framework-reference.md` what
  you searched for and why nothing fit.

"Easier for me to write" is never a reason. Neither is "cleaner by general software-engineering
principles" — where generic good practice conflicts with an established Breadfast pattern, the
Breadfast pattern wins.

### 4.2 Name the golden references first — before the first line

**The references MUST be human-authored.** This is the first thing to establish, because the framework
now contains a growing amount of previously *generated* code, and calibrating against that reproduces
and amplifies whatever it got wrong. Check authorship before trusting a file as a reference:

```bash
git log --format='%an %ad' --date=short -1 -- <path>     # who last touched it
git log --format='%an' -- <path> | sort -u               # everyone who has
```

The framework's long-standing authors are the reference (`mthms`/`M.Sharaf`, `Asmaa`/`AsmaRamadan`,
`Amira Badawy`/`Amirabadawy`, `islam-abdelaziz83`, `Mai Youssef`, `kfayz`, `Rawan Mohamed`). A file
whose only author is a QA-automation story run is **not** a reference, however clean it looks.

*This rule exists because of B10-58603.* A new mobile screen was matched against three sibling
screens in its own package — all three of which had been generated by earlier story runs. The review
that followed "confirmed conformance" against generated code, and the class shipped at 392 lines with
35 public methods, 40 lines of Javadoc, its own gesture and geometry code and thirteen
expected-value getters. Measured against the **human-authored** `AndroidNativeMoreScreen` (mthms,
Asmaa) and `AndroidNativeAccountSettingsScreen` (Asmaa, mthms) it was ~3× too large, inverted the
locator-to-logic ratio, and reimplemented a helper the framework already had. Rebuilt against the
human references it came to 163 lines / 23 methods / 12 `@FindBy` / 0 Javadoc.

For every new class or method, identify **two or three existing human-authored implementations closest
to the scenario** and record them in `framework-reference.md` with paths **and authors**. Then match
them on:
architecture · package · class and method structure · naming · constructor/config pattern ·
authentication · request and response handling · error handling · logging · models · assertions ·
setup/teardown · imports and formatting. The plan gate reviews those references, not just the plan.

**Match the file you are editing, not a house style you bring with you** (§9.13): its import block,
blank-line rhythm, comment density, separator comments, package-private vs `private final` fields.

### 4.3 One domain, one client — one ecosystem, one authentication

The single most damaging thing generation can do is ship a *parallel* implementation of something
the framework already owns. Two hard rules:

- **A service gets exactly one API client.** If the functionality belongs to a service the framework
  already has a client for, it goes **into that client**, in that client's idiom — not into a new
  class next to it, and not into a new package because the surface is "web" rather than "mobile".
  The existing client's package is where it lives, even when the new endpoints are admin-panel ones:
  `CardServiceApiClient` sits in `mobileApiClients` and owns `/api/v1/web/...` endpoints already.
- **An ecosystem gets exactly one authentication path.** Reuse the existing token method and the
  existing state object; never add a second login for the same service. Before writing any auth
  code, **prove** the existing token is not accepted — issue the call and read the status. A `401`
  with a token the framework already mints is a claim that needs evidence, not an assumption.

**This is not hypothetical.** `CardAdminPanelPerksApiClient` (829 lines) was generated over B10-56652
→ B10-56717 → B10-57764 alongside `CardServiceApiClient`, for the **same service** (`/api/v1/web/...`
on the same host) behind the **same login endpoint** (`/api/v1/web/user/login`). It shipped a second
auth (`loginAndGetJwtToken` + `Bearer` prefix + a 5-attempt retry loop), a second parameter
convention (`String jwtToken` first, where every other card method takes `CardService` last), a
second base-URL getter, and its own date and image helpers. Three test classes and 250 call sites
were written against it. It was merged into `CardServiceApiClient` and deleted on 2026-08-20; the
probe that should have been run at the start took one minute and showed the perks endpoints accept
the plain card-service token with no `Bearer` prefix at all.

### 4.4 The reuse ladder, per asset type

| Need | Look here first, in this order |
|---|---|
| API call | the service's existing client → a sibling client in the same package → a new client only for a genuinely new service |
| Authentication | the ecosystem's existing token method + state model (`CardService`, `User`, …) |
| Page/screen | the exact page → a similar page to extend → a shared component/helper → a new page object on the module's base-class contract |
| A reader or action on a page object | **grep that file** for a method already touching the same control (§9.13) before adding one |
| Utility (dates, random, format, encryption) | `BaseHelper`, `helpers/*`, existing validators — never a private re-implementation |
| Environment value / pinned record | `resources/environments/*.properties` → a `Configs` getter (§9.15) |
| Form data | the page object owns it (§9.9) |
| Which record to act on | a shape-finder on the module's API client (§9.15) |

### 4.5 Do not ship what nothing calls

Every generated public method needs a caller in the same change. The deleted perks client carried
**11 unused public methods** — a whole `createGeneralCashbackPerkWith*` family (5 methods plus its
private poster) written for a story whose tests never landed — which later readers had to treat as
supported API. Speculative helpers are duplication waiting to happen: delete them, or don't write
them. Anything a future story genuinely needs can be added by that story.

### 4.6 Page objects, specifically

Before creating a page object: establish that the page doesn't already exist, that no similar page
can be extended, and that no reusable component covers it — only then create one, following the
module's base-class contract (`BaseAndroidScreen`/iOS equivalent + `PageFactory`, or the Selenium
page pattern of the target module). New mobile screens follow
[mobile-native-framework.md](mobile-native-framework.md) including **BaseTest wiring**. Page objects
carry **no** story-specific or environment-specific data — no ids, phone numbers, card numbers,
amounts, merchant ids, OTPs, credentials, environment values (§9.9, §9.15).

**The page object's responsibility boundary.** A page object holds locators, small semantic
interaction methods, minimal state/visibility methods, and calls to existing framework helpers. These
belong to the framework and must **not** be reimplemented inside it:

| Do not put in a page object | Use instead |
|---|---|
| `PointerInput`/`Sequence` scroll loops, swipe logic, scroll budgets, `MAX_*_SCROLLS` tuning constants | `scrollUntilACertainElementIsFound(...)` — expose `getScrollableContentContainer()` + a selector-string accessor and call the helper. Signatures and the prefix convention: [mobile-native-framework.md](mobile-native-framework.md) §3. **The argument order differs per platform** (Android `driver, scrollView, direction, selector`; iOS `driver, direction, scrollView, selector`) — follow each, do not "normalise" them |
| Geometry — rect maths, viewport bounds checks, centre/tolerance comparisons | Nothing. No human-authored screen contains geometry. If a requirement seems to need it, it is a visual check and belongs in manual/visual testing, not in a page object |
| `getExpected*()` accessors of any kind | Expected values live in the **test**, as literals, selected there per locale where needed. Human precedent: `B10_57806_IdExpiryWarningTests` builds `List.of("متابعة","الرجوع")` inline from the session's `language` capability while the modal exposes only `getTitle()`/`getActionLabels()` |
| Generic string-dispatch (`pressRow(String label)`) over a fixed, known set of controls | One explicit method per control — `pressChangePinBtn()`, `pressCloseCardBtn()` — per [mobile-native-framework.md](mobile-native-framework.md) §4 |
| Long Javadoc: story history, investigation narrative, evidence paths, measured dates, decision logs | Nothing. The human-authored screens carry **zero** Javadoc and at most one or two short `//` lines. Durable findings go in `docs/ai/**` or the story folder, never in a production page object |
| Nullable/boolean "did it work" returns that swallow a failure | Let the framework's `wait.until(...)` throw, so the failure names the locator |

**Locator structure follows [mobile-native-framework.md](mobile-native-framework.md) §2 exactly:**
an individual `@FindBy` per fixed control (bilingual `or` conditions baked into one xpath where the
accessible name is localized), and a plain `String …Selector` format field **only** for genuinely
dynamic/templated lookups. Do not collapse a fixed control set into one parameterised selector to
reduce field count — consistency with the framework outranks brevity.

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

### 7.1 Framework-alignment self-review — run it before recording, answer every line

A green compile proves the code is valid Java, not that it belongs in this framework. Walk this list
and write the answers into `framework-reference.md`; anything answered "no" is rework, not a note.

**Measure it, don't eyeball it.** Put each new class beside the two or three **human-authored**
references from §4.2 and record the numbers in `framework-reference.md`. Being an outlier on any row
is rework:

```bash
for f in <new-class> <human-ref-1> <human-ref-2>; do
  printf "%-40s lines=%-5s methods=%-4s findby=%-4s selectors=%-3s javadoc=%s\n" "$(basename $f .java)" \
    "$(wc -l < $f)" "$(grep -c '^    public ' $f)" "$(grep -c '@FindBy' $f)" \
    "$(grep -cE '^    String ' $f)" "$(grep -c '^\s*\*' $f)"
done
```

The tell is the **locator-to-logic ratio**: a human-authored screen is locator-heavy and logic-light
(`AndroidNativeMoreScreen`: 24 `@FindBy`, 26 one-to-three-line methods, 0 Javadoc). Generated code
inverts it — few locators, much logic, heavy Javadoc. If the new class has more Javadoc lines than
`@FindBy` fields, it is not conforming.

**Fit**
- Does it read like existing Breadfast automation, or like generated code? Name the golden references
  it was matched against (§4.2), **with their authors, confirmed human**.
- Did I search before creating each new class, and is the search recorded?
- Is there any duplicate implementation — a second client, page object, helper, utility or model for
  something the framework already has (§4.3)?
- Is authentication the ecosystem's single existing path, with no second login and no second token
  shape (§4.3)?
- Does every new public method have a caller in this same change (§4.5)?

**Shape**
- Page objects: module base-class contract, locators as fields, UI interaction only, no story or
  environment data (§4.6, §9.9)?
- Test class: `B10_<id>_<Feature>Tests extends BaseTest`, in the module package, one test per
  automatable case, `@Test(groups, description)` + `@Tags` + `@TmsLink` (§5, §6)?
- Test methods: setup → action → validation → cleanup, in page-object calls and `Assert.*`, with no
  Selenium/Appium mechanics, URL/date string surgery, collection algebra or index arithmetic inline
  (§9.13)?
- Test data: form data on the page object, environment values in `Configs`, the record under test
  discovered by shape from the live API (§9.9, §9.15)?
- Control flow: the simplest form that is still correct — no nested `if`, nested loops, streams,
  speculative abstraction or duplicated fallback paths. Where complexity is genuinely required
  (retry, synchronisation, platform branching), is it implemented **once**, on the page object, with
  a comment naming what forced it (§9.13, §10)?

**Truth**
- Does every assertion have a concrete answer to *"what change in the product would turn this red?"*,
  and is that answer in the assertion message (§9.14)?
- Is every noun in the BrowserStack case title actually asserted (§9.14)?
- Do the `@TmsLink` ids and the verbatim `description` titles match the imported folder (§6)?
- Does it compile, does checkstyle pass, and did the selected cases actually run?

## 8. What lands where

| Artifact | Location |
|---|---|
| Story test class, new page objects, helpers/API clients, story suite XML | **inside the framework** (single source — never copied into the story folder) |
| `framework-reference.md` — reuse map: assets reused, new classes + method signatures, per-case navigation notes | story folder `automation/` |
| `README.md` — how to run (Maven commands), preconditions, **traceability table** | story folder `automation/` |
| Generators / story-specific scripts (CSV gen, parity check) | story folder `automation/` |
| `record` bookkeeping | unchanged: `qa-cli.js record "<storyDir>" automation --path automation/README.md --generator automation-gen@2.2 --derive-artifacts testcases` |

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

### 9.16 The parallel client is the failure mode this process actually has

> Added 2026-08-20 from the `CardAdminPanelPerksApiClient` merge. Three stories in a row passed the
> plan gate, the conformance gate, checkstyle and a green run while building a second card API client
> beside the framework's own. Every individual generation looked reasonable; the accumulation did not.

The rule is in §4.3. These are the three habits that let it happen anyway, and the checks that catch
them:

- **A new surface is not a new service.** "The perks screens are in the web admin panel, and the
  existing client is in `mobileApiClients`" is a *packaging* observation, and packaging is the weakest
  possible reason to fork a client. Ask what **host and login** the endpoint sits behind, not which
  screen calls it. Here both clients hit the same host and the same `/api/v1/web/user/login`.
- **Never infer an auth requirement — probe it.** The second client sent `Authorization: Bearer <jwt>`
  because that is the common convention, and nothing ever tested the alternative. One HTTP call
  settles it: mint the framework's existing token, call the new endpoint with it, and read the status.
  A `401` **without** a token and a `200`/`400`/`404` **with** it is proof the existing token works;
  anything else is the evidence you need before adding a login. Record the probe and its date in a
  comment beside the endpoint fields.
- **Drift compounds silently across stories.** Each story only adds a few methods, so the divergence
  never looks like a decision. Before extending any client, page object or helper that a *previous
  story* created rather than the framework, check it against its nearest framework-owned sibling — if
  the parameter order, auth, base URL, error handling or logging disagree, the fix is to converge
  them, not to match the newer file.

**Merging one back is expensive and it is on the generator to avoid, not the reviewer to catch:** this
one moved 24 methods, deleted 11 unused ones, rewrote ~250 call sites across six test classes and
touched four catalog documents.

*Restructured 2026-07-27 (operator directive): web automation generation re-based from Playwright onto
the Java framework; mobile unchanged. Supersedes the 2026-06-22 "new web automation goes to
`b55168_pom`" resolution — see [process-parity-audit.md](../process-parity-audit.md) §E and
[playwright-framework.md](playwright-framework.md) for the legacy scope. §9 added the same day from
the B10-56750 migration's five live runs. §9.13–9.15 added 2026-08-09 from a second-pass review of
B10-57771, which had already passed the conformance gate and run 21/21 green — readability, oracle
falsifiability and fixture selection are the three dimensions no build gate and no green run can check.
§4 rewritten and §7.1 + §9.16 added 2026-08-20 (operator directive: generated automation must be
indistinguishable from the framework's own) after merging `CardAdminPanelPerksApiClient` back into
`CardServiceApiClient` — one client per service, one authentication per ecosystem, golden references
named before generation, and no shipped code without a caller.*
