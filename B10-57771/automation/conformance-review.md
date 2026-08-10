# Framework Conformance Review — B10-57771

Gate run before recording the `automation` artifact ([automation-generation.md](../../docs/ai/automation/automation-generation.md)).
Rules are checked **against what the Breadfast Java framework actually does**, not against generic
Java/Selenium advice — a "violation" that the whole framework commits is a house style, not a defect.

## Files under review
| File | Change |
|---|---|
| `D:\projects\src\test\java\cardService\adminPanel\B10_57771_DuplicatePerkTests.java` | **new** — 21 tests |
| `D:\projects\src\main\java\modals\cardsAdminPanel\PerksPage.java` | **extended** — 5 locator groups, 22 methods |
| `D:\projects\b10-57771-tests.xml` | **new** — story suite |

## Checks

| # | Rule | Result | Evidence |
|---|---|---|---|
| 1 | Test class named `B10_<id>_<Feature>Tests`, under the right package | ✅ | `cardService.adminPanel.B10_57771_DuplicatePerkTests`; `TypeName` already suppressed by `checkstyle-suppressions.xml` for `B10_\d+_\w+Tests` — **no new suppression needed** |
| 2 | Extends `BaseTest`; uses the `ThreadLocal` page/API accessors | ✅ | `webCardPanelLoginPage.get()`, `webCardPanelPerksPage.get()`, `cardAdminPanelPerksApiClient.get()`, `configs.get()` — all pre-existing `BaseTest` fields |
| 3 | One test per automatable BrowserStack case | ✅ | 21 tests ↔ 21 `@TmsLink` ids, no duplicates (duplicate-id check in the parity script) |
| 4 | `@Test(description = ...)` is the **verbatim** BrowserStack case name | ✅ | verified by `automation/check_tmslink_parity.js` against PR-66 — **21/21 exact** |
| 5 | `groups` + `@Tags` match the card-panel convention | ✅ | `groups = {"regression", "B10-57771"}`, `@Tags({@Tag("web"), @Tag("cardservice")})` — mirrors `B10_56750_AddSectionToPerksTests` |
| 6 | **No private helpers in the test class** ([[java-framework-style]]) | ✅ | zero private methods; all behaviour is on `PerksPage` / the API client |
| 7 | Page object owns its own locators + data | ✅ | all new `@FindBy` live on `PerksPage`; no `By` literals leak into the test class |
| 8 | Reuse-before-build | ✅ | 11 existing assets reused unchanged (`framework-reference.md` §1); no page object duplicated, no login re-implemented |
| 9 | No `Thread.sleep` in test code | ✅ (n/a to page code) | zero in the test class. `PerksPage.pause()` wraps `Thread.sleep` and is used by the new methods — that is the **framework's own house style** (347 pre-existing occurrences); deviating would be the inconsistency |
| 10 | `Assert`, not `SoftAssert` | ✅ | framework has **0** `SoftAssert` usages; all 48 new assertions are hard `Assert` with a failure message |
| 11 | Every assertion carries a diagnostic message | ✅ | 48/48; date assertions interpolate expected vs actual |
| 12 | Suite XML matches the sibling convention | ✅ | same listeners as `b10-56750-tests.xml` (`AllureTestNg`, `RetryListener`, `BrowserstackSyncListener`) |
| 13 | `mvn test-compile` green before recording | ✅ | `B10_57771_DuplicatePerkTests.class` + `PerksPage.class` built 2026-08-09 11:14 |
| 14 | Locators verified against the live DOM, not invented | ✅ | every new locator captured in the 2026-08-09 probes (`automation/explore/*.json`) |
| 15 | Coverage gaps stated, not silent | ✅ | TC-54754 and TC-54759 declared **manual** with reasons; AC4 declared **Not Verifiable** — all three in `framework-reference.md` §4 and the QA summary |

## Blocking violations
**None.**

## Style refactor — 2026-08-09 (post-execution)
Refactored against **`CardAdminPanelTests.replaceActiveCardUser()`** as the reference for structure and
readability. Behaviour-preserving: re-run after the refactor gave **21/21 pass, BUILD SUCCESS**, and
`check_tmslink_parity.js` still reports **21/21**.

What the reference does better, and what changed here:

| Reference trait | Deviation found | Fix |
|---|---|---|
| No intermediate locals — reads are inlined into assertions | 4 oracle locals in TC-54748, 2 in TC-54751, `menuItems` in TC-54743 | inlined; kept only the `...Before` locals in TC-54757, where capturing *before* the mutation is the point |
| Page objects expose meaningful actions; tests read as intent | a 3-call "open the duplicate form" ritual in **15** tests | `PerksPage.openDuplicateFormForPerk(id)` |
| — | a 4-call save ritual in **5** tests | `PerksPage.saveDuplicateWithUniqueTitleAndCouponCode(code)` |
| No computation in the test | `substring(8,10)` / `substring(0,4)` date slicing in TC-54751 | `getPrefilledStartDateInStoredFormat()` / `...EndDate...` on the page object |
| Methods do one thing | `duplicateFormIsDisplayedForPerk()` (a **boolean**) called as a statement for its wait side effect in 14 of 15 uses | wait extracted to private `waitForDuplicateFormToPreFill()`; the boolean is now only called where TC-54747 actually asserts it |
| Constants outside the method | repeated XPath literals; `"This field is required."` ×2; the menu-item list ×2 | `PERK_TYPE_DROPDOWN_XPATH`, `PERK_TITLE_EN_FIELD_XPATH`, `ROW_ACTIONS_MENU_XPATH`, `REQUIRED_FIELD_ERROR`, `ROW_ACTIONS` |
| No redundant calls | `waitForPerksPageToLoad()` called immediately after `reopenPerksPage()`, which already calls it | removed (8 tests) |

**Deliberately NOT changed**, because the reference does the same: the per-test login/navigation
repetition (the reference repeats its whole registration flow per test), and inline string literals
for menu labels and expected copy.

### One semantic change, flagged
TC-54751's date check was `prefilled.contains(source.substring(8,10)) && prefilled.contains(source.substring(0,4))`
— effectively *"the form contains `09` and `2026`"*. `09` also occurs in the timestamp, and the check
**cannot detect a wrong month**, so a test titled *"copies the validity date range"* would pass on a
wrong date. Treated as a clear defect in the test and replaced with an exact equality against the
stored value (via the new page-object converter). Verified passing. Revert on request — it is the only
non-structural change in this refactor.

## Non-blocking notes
1. `getPrefilledStartDate()` / `getPrefilledEndDate()` read the Duration inputs **positionally** (first
   and second date field). The panel renders no `formcontrolname` on them, so there is no stable
   attribute to key on; if a third date field is ever added ahead of them these break loudly (empty
   string → assertion failure with the actual value printed), rather than silently passing.
2. `TC-54751` compares the date **parts** (year + day) rather than the whole string, because the form
   renders `DD-MM-YYYY HH:mm:ss` while the API stores `YYYY-MM-DD HH:mm:ss`. A whole-string compare
   would fail on formatting alone and manufacture a false defect.
3. **Three authoring traps were found by RUNNING the suite, not by compiling it** (run 1: 11 pass /
   10 fail — **all ten were automation defects, zero product defects**). Recorded because each will
   bite the next card-panel story:
   - **`<app-perk-form>` mounts EMPTY.** It is filled only after `getMerchantCategories()`,
     `getMerchants()`, `getSections()` and `perkService.getById()` resolve. So neither the
     `/perks/duplicate/<id>` route nor `createPerkFormIsDisplayed()` means the form is readable —
     both are true while every field is still absent, and 8 tests died on `NoSuchElementException`
     for the framework's own long-standing `title_en` / `type` / `coupon_code` locators.
     → `duplicateFormIsDisplayedForPerk()` now waits on **content**: the perk-type select visible,
     the title input visible **and** carrying a non-empty value.
   - **`getText()` returns `""` for a cdk tooltip.** Angular CDK parks its `aria-describedby`
     messages in a visually-hidden container, and Selenium's `getText()` yields only *rendered*
     text. → read `getAttribute("textContent")` (the same fix the framework already applies in
     `readOpenDropDownOptions`).
   - **`editPerkTitle()` types a shared CONSTANT.** Six tests each created a perk with the identical
     title, so `getPerkIdFromTable(title)` could return an earlier test's perk cloned from a
     *different* source — which is what made the API field-parity assertion fail on `title_ar`.
     → added `setUniqueDuplicateTitle()`, which stamps a unique short title (title_en has a ~20-char
     max-length validator) and returns it.
4. The tests deliberately do **not** clean up the perks they create. There is no delete path for a
   non-Planned perk, so a created duplicate is permanent — each run adds one row per creating test.
   Titles come from `editPerkTitle()`'s framework constant, so they are identifiable.

*Gate: PASS. Cleared to record the `automation` artifact.*
