# B10-56750 — Automation (Java + Selenium, Breadfast Java framework)

Automates the **Add Section to All Perk Types** story: the required Section dropdown
(shared surface with B10-56729) and the **"Add section"** inline-creation modal.
**One `@Test` per approved BrowserStack case, 1:1** (27 automated + 1 declared
not-automated), with `@TmsLink("TC-xxxxx")` bindings and `description` = the exact
BrowserStack title.

> **Migrated 2026-07-27** from the validated Playwright suite (HLS v2, 2026-07-26) to
> **Java + Selenium inside the Breadfast Java framework**, per the new
> [automation-generation contract](../../docs/ai/automation/automation-generation.md).
> The Playwright specs are archived (selector provenance + port reference) in
> [`_archive_playwright_hls_v2/`](./_archive_playwright_hls_v2/); the v1 suite remains in
> [`_archive_hls_v1/`](./_archive_hls_v1/). **No new Playwright automation** for this story.

## Where things live

| What | Where |
|---|---|
| Story test class (27 tests) | `<framework>/src/test/java/cardService/adminPanel/B10_56750_AddSectionToPerksTests.java` |
| Page object (new) | `<framework>/src/main/java/modals/cardsAdminPanel/PerksPage.java` |
| Story suite XML | `<framework>/b10-56750-tests.xml` |
| Image assets (perk-save case) | `<framework>/resources/images/perks/` — referenced via the `perkCoverImagePath` / `perkLogoImagePath` config keys, never hardcoded |
| Framework branch | **`2026/sprintQ3.3/B10-56750-add-section-to-all-perk-types`** (the convention the git hooks enforce; never on main) — single commit `75795e581` |

**Verification is UI-only** — no API client is used. The perks table's Category column is populated
from the perk's Section, which is the UI evidence for the perk-save and backfill cases. See
[`framework-reference.md`](./framework-reference.md), which also holds the reuse map and migration notes.

`<framework>` = the Breadfast Java framework — default `D:\projects`, resolved via
`QA_FRAMEWORK_PATH` → [`automation/config/framework.js`](../../automation/config/framework.js).

## How to run

```bash
cd D:\projects            # or your framework location
git checkout 2026/sprintQ3.3/B10-56750-add-section-to-all-perk-types

# whole story class (fresh Chrome per test; framework setup builds test data each test)
mvn test -Dtest=B10_56750_AddSectionToPerksTests            # the pom ignores -DsuiteXmlFile

# a single case
mvn test -Dtest=B10_56750_AddSectionToPerksTests#verifySectionFieldDisplayedForDiscountCouponPerkType

# by story group
mvn test -Dgroups=B10-56750
```

Login + URL come from `resources/environments/config_testing.properties` +
`cardServiceConfigs_testing.properties` (`cardServicesAdminPanelBaseURL` =
card-panel-testing, `getCardAdminPanelAdminUserName/Password`). Requires **Java 25**;
Checkstyle runs at `validate` and fails the build on violations.

**BrowserStack TMS result sync:** set `targetProjectId` + `targetRunId` in
`browserStackConfigs.properties` and results post automatically per `@TmsLink`
(`BrowserstackSyncListener` → `BaseTest` → `BrowserstackApiClient`). Leave them blank to
run without posting.

## Test data notes (unchanged semantics from the JS suite)
- There is **no delete-section flow** — every successful create permanently adds a
  `QA ...`-stamped Section to the shared environment; creates are kept to the minimum the
  ACs require. Duplicate-rule cases reuse an EXISTING section name so they create nothing.
- The perk-save case (TC-53897) **creates a real perk** when the form completes; if the
  save never fires it skips with the outstanding validation errors listed (never a
  silent pass).
- Assertions target the **spec**, not the shipped build, so tests covering an open defect are
  **expected to fail** until it is fixed. The framework has no `SoftAssert`, so where one case
  covers several open defects the deviations are collected and reported in a single assertion
  message rather than stopping at the first.

## BrowserStack test-case ↔ test mapping (1:1 traceability)

Verify offline anytime: `node check_test_name_parity.js` (now scans the Java class's
`@Test(description)` strings; ✓ 27/27 verbatim as of 2026-07-27).

| BrowserStack ID | Automated by (method in `B10_56750_AddSectionToPerksTests`) |
|---|---|
| TC-53876..79 | `verifySectionFieldDisplayedFor<Type>PerkType` (×4) |
| TC-53880..83 | `verifySectionRequiredBlocksSaveFor<Type>PerkType` (×4) |
| TC-53884 | `verifySectionDropdownListsBilingualLabels` |
| TC-53885 | `verifySectionDropdownShowsNamesOnlyAndNeverNumericIds` |
| TC-53886 | — **not automated** (expectation retracted; B10-58196 withdrawn) |
| TC-53887 | `verifyGeneralSpendSectionIsNamedGeneralPurchases` |
| TC-53888 | `verifyAddSectionPinnedAtBottomForAllFourPerkTypes` |
| TC-53889 | `verifyAddSectionModalStructureAndRequiredMarkers` |
| TC-53890 | `verifyArabicSectionNameIsEnforcedAsRequired` |
| TC-53891 | `verifyAddSectionModalCtasAndThatCancelSavesNothing` |
| TC-53892 | `verifyAddSectionInFlightStateAndNoDoubleCreation` |
| TC-53893 | `verifySuccessfulSectionCreationClosesModalAndAutoSelects` |
| TC-53894 | `verifyDuplicateSectionNameShowsInlineErrorAndPreservesValues` |
| TC-53895 | `verifyDuplicateSectionMatchingRule` |
| TC-53896 | `verifyDismissingAddSectionModalClearsAllInputs` |
| TC-53897 | `verifyPerkIsSavedWithExactlyOneSectionAttached` |
| TC-53898 | `verifyNewSectionIsAvailableInABrandNewSession` |
| TC-53899 | `verifySectionOrderingBreadfastFirstThenAlphabetical` *(soft-fails: B10-58192)* |
| TC-53900 | `verifyExistingPerksAreBackfilledWithTheirSections` |
| TC-53901 | `verifySectionNamesAreCappedAtFiftyCharacters` |
| TC-53902 | `verifyCategoryDropdownRemainsIntactAndNeverCrossesWithSection` |
| TC-53903 | `verifySectionCreatedFromOnePerkTypeIsSelectableOnTheOthers` |

## Open bug ↔ test coverage (story subtasks)

| Story bug subtask | Covered by | State |
|---|---|---|
| No X close icon to dismiss the modal | `verifyDismissingAddSectionModalClearsAllInputs` | fails correctly. **Live DOM correction:** the two close icons DO exist but carry `close-icon--hidden` (`visibility:hidden`), so the fix is CSS, not missing markup |
| Section list not alphabetical after Breadfast | `verifySectionOrderingBreadfastFirstThenAlphabetical` | fails correctly |
| Duplicate name: no red highlight, `aria-invalid="false"` | `verifyDuplicateSectionNameShowsInlineErrorAndPreservesValues` | fails correctly |
| No required marker / `aria-required="false"` | `verifyAddSectionModalStructureAndRequiredMarkers` | fails correctly (collected with the placeholder deviation) |
| Labels inside the input box; placeholders are Perk-subheader examples | same test | placeholder half covered (EN is `e.g Ready to Eat`, AR is empty). **Label position is CSS — belongs to visual testing, not asserted here** |
| Seeded Sections missing / list contains test data (**Deferred**) | TC-53886 | not automated — expectation retracted |
| Success toast renders top-right instead of inline (**Open**) | — | **not covered**; needs a geometry assertion once the toast DOM is captured |

Also reported by the suite though not yet a subtask: after a successful create the new Section is
**not auto-selected** (AC-08) — reproduced on every run, matching the intermittency the story
recorded.

## Execution results

| Run | Result | Notes |
|---|---|---|
| 1 | 18/27 | 5 test bugs found (SPA routing, Properties backslash escaping, stale element, native-select filter, dropdown race) |
| 2 | 21/27 | those 5 fixed |
| 3 | 22/27 | locators hardened live; the close-icon false pass became a correct failure |
| 4 | 18/27 | regression caused by over-tuning the lazy-load scroll loop — reverted |

Steady state is **run 3's configuration plus the post-dialog reload fix**. A clean confirming run is
still outstanding: the framework tree is currently being edited by another session (B10-57393), so a
run there would not be trustworthy.
