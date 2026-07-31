# Automation — B10-57806 (ID Expiry Warning at BCard Sign-Up)

**Generated code lives in the Java framework (`D:\projects`), never copied here** — single source.
This folder holds the story-specific reuse map, run instructions, traceability, and the probe/uploader tools.

**Status:** ✅ **compiles** (`mvn -o test-compile` exit 0, Checkstyle included) · ⛔ **never executed** —
the card-service backend is returning 502 (see [`../execution-reports/exploratory-notes.md`](../execution-reports/exploratory-notes.md) §6c).
Compile-green is **not** run-green.

---

## Run

```bash
# From the framework root, D:\projects
# NOTE: -DsuiteXmlFile= is IGNORED by this pom (nine suites are hard-wired) and runs everything.
#       -Dsurefire.suiteXmlFiles= is the override that actually works.
mvn test -Dsurefire.suiteXmlFiles=b10-57806-tests.xml

# A single case
mvn test -Dsurefire.suiteXmlFiles=b10-57806-tests.xml -Dtest=B10_57806_IdExpiryWarningTests#verifyContinueOnTheWarningModalProceedsToStepThreeOfThree
```

**Locale** is a capability, not a parameter: the same class covers English and Arabic. TC-54275 reads the
session language and asserts the copy for that locale, so run the suite twice (en/US, ar/EG) for full AC-5
coverage.

## Preconditions

| # | Requirement | How it is satisfied |
|---|---|---|
| 1 | A fresh account per test that has consumed a BCard invitation code and has **not** applied | `@BeforeMethod` mints one: `registerUsingApi` → card-service token → generate/export/**consume** invitation code, then **stops**. `createCardUser` is deliberately never called — it submits the ID + expiry over the API and is exactly what flips the card to `Pending`, so calling it would skip the screen under test |
| 2 | A Luhn-valid, **unused** National ID | `UserDataFactory.generateRandomEgyptianNationalID` (per account). Reusing a consumed id makes Submit bounce silently back to step 2 of 3 — indistinguishable from a broken Continue button |
| 3 | Login OTP | fetched programmatically by the framework's `OtpFactory` (Google Chat) — no manual step |
| 4 | Card-application OTP (step 1 of 3) | derived: the **last 4 digits** of the account's phone number |
| 5 | card-service reachable | ⛔ currently **502** — every test's `@BeforeMethod` will fail fast with "Pay home is not offering Apply" until it returns |

## Traceability — BrowserStack ↔ automation

16 of 20 cases automated. Titles are the BrowserStack case names **verbatim** and were checked
programmatically against [`browserstack-tms-map.json`](browserstack-tms-map.json): **0 mismatches**.
All methods live in `customerApp.androidNative.cardSignUp.B10_57806_IdExpiryWarningTests`.

| Case | TMS id | BrowserStack title | Test method | Automated? | Reason if not |
|---|---|---|---|---|---|
| TC01 | [TC-54265](https://test-management.browserstack.com/projects/2407303/folder/53445037/test-cases) | Warning modal is shown for a National ID expiring within 2 months | `#verifyWarningModalIsShownForAnIdExpiringWithinTwoMonths` | ✅ yes | — |
| TC02 | [TC-54266](https://test-management.browserstack.com/projects/2407303/folder/53445037/test-cases) | Warning modal is shown one day inside the 2-month boundary | `#verifyWarningModalIsShownOneDayInsideTheBoundary` | ✅ yes | — |
| TC03 | [TC-54267](https://test-management.browserstack.com/projects/2407303/folder/53445037/test-cases) | No warning is shown one day outside the 2-month boundary | `#verifyNoWarningIsShownOneDayOutsideTheBoundary` | ✅ yes | — |
| TC04 | [TC-54268](https://test-management.browserstack.com/projects/2407303/folder/53445037/test-cases) | No warning is shown for a far future National ID expiry date | `#verifyNoWarningIsShownForAFarFutureExpiryDate` | ✅ yes | — |
| TC05 | [TC-54269](https://test-management.browserstack.com/projects/2407303/folder/53445037/test-cases) | Continue on the warning modal proceeds to step 3 of 3 | `#verifyContinueOnTheWarningModalProceedsToStepThreeOfThree` | ✅ yes | — |
| TC06 | [TC-54270](https://test-management.browserstack.com/projects/2407303/folder/53445037/test-cases) | Go back on the warning modal returns to the ID information step with the entered data preserved | `#verifyGoBackReturnsToTheIdInformationStepWithDataPreserved` | ✅ yes | — |
| TC07 | [TC-54271](https://test-management.browserstack.com/projects/2407303/folder/53445037/test-cases) | Swiping the warning modal down returns to the ID information step | `#verifySwipingTheWarningModalDownReturnsToTheIdInformationStep` | ✅ yes | — |
| TC08 | [TC-54272](https://test-management.browserstack.com/projects/2407303/folder/53445037/test-cases) | Tapping outside the warning modal returns to the ID information step | `#verifyTappingOutsideTheWarningModalReturnsToTheIdInformationStep` | ✅ yes | — |
| TC09 | [TC-54273](https://test-management.browserstack.com/projects/2407303/folder/53445037/test-cases) | Android hardware back on the warning modal does not advance the flow | `#verifyAndroidHardwareBackOnTheWarningModalDoesNotAdvanceTheFlow` | ✅ yes | — |
| TC10 | [TC-54274](https://test-management.browserstack.com/projects/2407303/folder/53445037/test-cases) | No card application is created when the warning modal is dismissed | `#verifyNoCardApplicationIsCreatedWhenTheWarningModalIsDismissed` | ✅ yes | — |
| TC11 | [TC-54275](https://test-management.browserstack.com/projects/2407303/folder/53445037/test-cases) | Warning modal is displayed in Arabic with localized button labels | `#verifyWarningModalIsDisplayedInArabicWithLocalizedButtonLabels` | ✅ yes | — |
| TC12 | TC-54276 | Behaviour when the entered National ID expiry date is already in the past | — | ❌ no | No AC and no Figma frame define an expected result — executed manually and reported to product. |
| TC13 | [TC-54277](https://test-management.browserstack.com/projects/2407303/folder/53445037/test-cases) | Warning modal is shown when the National ID expires on the current date | `#verifyWarningModalIsShownWhenTheIdExpiresOnTheCurrentDate` | ✅ yes | — |
| TC14 | [TC-54278](https://test-management.browserstack.com/projects/2407303/folder/53445037/test-cases) | Warning modal is shown again when Submit is tapped a second time with an unchanged date | `#verifyWarningModalIsShownAgainOnASecondSubmitWithAnUnchangedDate` | ✅ yes | — |
| TC15 | [TC-54279](https://test-management.browserstack.com/projects/2407303/folder/53445037/test-cases) | Changing the expiry date to outside the window after dismissing the modal proceeds without a warning | `#verifyChangingTheDateToOutsideTheWindowProceedsWithoutAWarning` | ✅ yes | — |
| TC16 | [TC-54280](https://test-management.browserstack.com/projects/2407303/folder/53445037/test-cases) | Entered ID data is preserved when the warning modal opens while the keypad is displayed | `#verifyEnteredDataIsPreservedWhenTheModalOpensOverTheKeypad` | ✅ yes | — |
| TC17 | [TC-54281](https://test-management.browserstack.com/projects/2407303/folder/53445037/test-cases) | Progress indicator remains 2/3 while the warning modal is shown | `#verifyProgressIndicatorRemainsOnStepTwoWhileTheWarningIsShown` | ✅ yes | — |
| TC18 | TC-54282 | iOS and Android show the same warning decision for the same expiry date | — | ❌ no | A comparison across two platform runs, not a single-platform assertion — derived by diffing Android vs iOS results. |
| TC19 | TC-54283 | Warning modal matches the approved design in English and Arabic | — | ❌ no | Visual comparison against Figma 7544:791 / 7544:855 — covered in Phase 6. |
| TC20 | TC-54284 | BCard application completes end to end after the warning modal is accepted | — | ❌ no | Also exercises passcode creation, which belongs to the card-activation suite. |

Plus one deliberately **non-TmsLinked** method — `#verifyBoundaryDateIsReportedNotAsserted` — which records
the behaviour at exactly `today + 2 calendar months` as an Allure attachment and **always passes**. AC-1 and
AC-4 do not define the boundary, and a clarification-gate answer is not a spec (`CLAUDE.md` §8.1), so
failing there would fail against an assumption. It becomes a hard assertion once product amends the AC.

## Tools in this folder

| File | Purpose |
|---|---|
| [`expiry-dates.js`](expiry-dates.js) | Node mirror of the date engine — run it standalone to see today's cases and whether the month-end clamp is observable |
| [`run-expiry-probe.js`](run-expiry-probe.js) | Exploratory probe runner (raw Appium) used to establish behaviour before the Java suite existed |
| [`otp-google-chat.js`](otp-google-chat.js) | Node port of `GoogleChatApiClient.findMessageForOTP` |
| [`national-id.js`](national-id.js) | Luhn-valid Egyptian National ID generator |
| [`testcases.js`](testcases.js) | **Canonical case data** — the single source for the markdown, the upload and the titles |
| [`upload_browserstack.js`](upload_browserstack.js) | TM API v2 uploader + verifier (`--dry`, `--verify`) |
| [`browserstack-tms-map.json`](browserstack-tms-map.json) | TC → TMS id map used for `@TmsLink` binding and parity checking |
| [`conformance-review.md`](conformance-review.md) | The framework-conformance gate result |
| [`framework-reference.md`](framework-reference.md) | Reuse map: what was reused, what was built, and why |
