# Framework Conformance Review — B10-57806

**Gate:** `framework-conformance` (runs before the `automation` artifact is recorded) · **Date:** 2026-07-31
**Verdict:** ✅ **PASS** — `mvn -o test-compile` exits **0** (compile + Checkstyle at `validate`)
**Generated code:** 6 files in `D:\projects` (5 new, 1 additive edit) + 1 suite XML + BaseTest wiring

> Generic "best practice" is checked **against what this framework actually does**, not against an
> external ideal — an inherited convention is not a defect.

---

## 1. Conformance checks

| # | Rule | This story | Framework baseline | Verdict |
|---|---|---|---|---|
| 1 | `mvn -o test-compile` green (compile + Checkstyle) | exit **0** | required gate | ✅ |
| 2 | Story class named `B10_<id>_<Feature>Tests`, `extends BaseTest` | `B10_57806_IdExpiryWarningTests` | precedent `B10_56717_PerksListTests` | ✅ |
| 3 | Checkstyle `TypeName` suppression for the underscore name | already present in `checkstyle-suppressions.xml` | added for a prior story | ✅ no framework change needed |
| 4 | TestNG groups include the story key | `{"regression", "B10-57806"}` | precedent | ✅ |
| 5 | `@Tags` per module convention | `customer-app-native`, `android`, `cardservice` | precedent | ✅ |
| 6 | `@TmsLink` on every automated case | **16 / 16** | required | ✅ |
| 7 | `description` = BrowserStack title **verbatim** | **16 / 16 exact, 0 mismatches** (checked programmatically against `browserstack-tms-map.json`) | required | ✅ |
| 8 | Story suite XML at framework root | `b10-57806-tests.xml` | precedent `b10-55168-tests.xml` | ✅ |
| 9 | **No private helpers in the test class** | **0** | [[java-framework-style]] | ✅ |
| 10 | Page objects own methods + data | all interaction on the 4 new screen objects | [[java-framework-style]] | ✅ |
| 11 | No fluent builders | none | [[java-framework-style]] | ✅ |
| 12 | Every assertion carries a message | **all** (shared `WARNING_NOT_RAISED` constant for the repeated precondition guard) | framework norm | ✅ |
| 13 | `Thread.sleep` | **0** in this story's code | **349** framework-wide — inherited, not copied | ✅ better than baseline |
| 14 | `SoftAssert` | 0 | **0** framework-wide — the framework does not use it | ✅ consistent |
| 15 | No hard-coded test data | **0 date literals in code**; the only date strings are provenance comments | required | ✅ |
| 16 | Config, not constants, for credentials/endpoints | `configs.get().getCardMobileLoginScheme*` | required | ✅ |
| 17 | Locators verified against the running app, never inferred | every locator taken from a live XML dump (see §3) | §9.3 | ✅ |
| 18 | Reuse-before-build | 8 existing assets reused, 4 new screens only where none existed | §4 | ✅ |

## 2. Reuse-before-build ledger

**Reused (not rebuilt):** `AndroidNativePayScreen`, `AndroidNativePayOtpScreen`, `AndroidNativeHomeScreen`,
`AndroidNativeLandingScreen`, `AndroidNativePhoneNumberScreen`, `AndroidNativeOtpVerificationScreen`,
`AndroidNativeCountriesSelectionScreen`, `androidNativeTestsExecutionHelper.login(...)`,
`testExecutionHelper.buildRandomUserObject/registerUsingApi`, `CardServiceApiClient` invitation-code trio,
`UserDataFactory.generateRandomEgyptianNationalID`.

**Notable reuse:** the card-application OTP (step 1 of 3) is **not** a new screen object — it presents the
same markers as `AndroidNativePayOtpScreen` ("Verify your mobile number", a bare `EditText`, a `Verify`
action) and takes the same code (last 4 digits of the phone), so it is reused rather than duplicated.

**Built (no existing asset — verified by searching `modals/customerApp/**` for any ID-info screen, zero hits):**

| New class | Why |
|---|---|
| `AndroidNativeCardIdInfoScreen` | step 2 of 3, the screen under test — did not exist |
| `AndroidNativeIdNearExpiryModal` | the warning sheet — new UI in this story |
| `AndroidNativeCardSetupIntroScreen` | step 3 of 3, the AC-2/AC-4 destination — needs its own marker rather than being inferred from the modal's absence |
| `AndroidNativeCardApplicationIntroScreen` | the "Apply for your card" gate — did not exist |
| `IdExpiryDateFactory` | device-clock date engine (§4) |

**Additive edits to shared classes:** `AndroidNativePayScreen` gained
`isCardApplicationApplyBtnDisplayed()` / `pressCardApplicationApplyBtn()`; `BaseTest` gained 4 ThreadLocals
and their initialisation. Both are additive — no existing behaviour changed.

## 3. Locator provenance

Every locator came from a live XML dump captured during exploration on **Samsung Galaxy S23 / Android 13**,
2026-07-30/31, in **both** locales — never inferred. Evidence in `B10-57806/evidence/`:
`expl-06-apply.xml`, `expl-08-step2of3.xml`, `expl-10-after-submit-INWINDOW.xml`, `expl-15-step3of3.xml`,
`android-ar-04-intro.xml`, `android-ar-05-step2of3.xml`, `android-ar-07-warning-sheet.xml`.

**Two locator facts that would otherwise bite:**
- **Several `content-desc` test ids are localized** — `Apply`/`قدّم الطلب`, `Next`/`التالي`,
  `Submit`/`إرسال`, `Continue`/`متابعة`, `Go back`/`الرجوع`. Every locator matches both spellings;
  keying off the English string alone silently breaks the Arabic run.
- **The four ID inputs carry no `content-desc`** and are addressed positionally. The Compose tree exposes
  them only as an ordered run of bare `EditText` nodes, and the labels are siblings rather than parents, so
  a label-relative XPath cannot reach them.

## 4. Dates are derived, never written down

`IdExpiryDateFactory` reads **`getDeviceTime()`** and builds every case from it, so the suite returns the
same verdicts on any calendar day. Rationale: the check under test is client-side, so the handset's "today"
is the only one that counts, and BrowserStack devices routinely sit in another timezone from the runner.

`LocalDate.plusMonths(2)` supplies month-end clamping for free (31 Jul → 30 Sep).
`isMonthEndClampObservable()` reports the days on which that clamp is *distinguishable* from naive overflow.

`enterExpiryDate()` **re-reads the field after typing** and waits for the rendered `dd / MM / yyyy` value
rather than trusting `sendKeys`. This is not defensive padding: `clear()` is a silent no-op on these inputs
on some builds, so a bare write can concatenate onto the previous value — that produced two false findings
during exploration before it was caught.

## 5. ⚠️ Pre-existing breakage repaired — belongs to B10-56711, not to this story

The story branch was cut from `2026/sprintQ3.3/B10-56711-perk-details-screen-redesign` (the Pay-native
screens this story reuses exist only there, not on `main`). That branch carries commit `1ea0895c3`, in which
**`B10_56711_PerkDetailsTests` (iOS) calls `IosNativeHomeScreen.pressPayBtn()`, a method that does not
exist** — 6 call sites, so `test-compile` fails.

It was invisible until now only because incremental compilation had not rebuilt that class; touching
`BaseTest` forced a full rebuild and exposed it.

**Repair applied:** added `pressPayBtn()` to `IosNativeHomeScreen`, mirroring the existing
`pressHomeBtn()`/`pressMoreBtn()`. The `payBtn` locator (`PayUnSelectedState`) **already existed** — only
the accessor was missing — and that id was independently confirmed live on iPhone 14 / iOS 18 during this
story's exploration. The change is additive and minimal.

> **This is flagged, not absorbed.** It is B10-56711's defect; it is repaired here solely to obtain a
> compiling tree, and the owner of B10-56711 should confirm the accessor matches their intent. Per §9.1
> (working-tree discipline) another story's code is not fixed silently — hence this section.

## 6. Coverage — 16 of 20 cases automated

| Not automated | Reason |
|---|---|
| **TC-54276** (TC12, expired ID) | No AC and no Figma frame define an expected result. Executed manually and **reported** to product; an assertion here would be asserting a QA assumption |
| **TC-54282** (TC18, iOS/Android parity) | A comparison **across two platform runs**, not a single-platform assertion. Derived by diffing this class's results against the iOS mirror's |
| **TC-54283** (TC19, design conformance) | Visual comparison against Figma `7544:791` / `7544:855` — Phase 6, not a functional assertion |
| **TC-54284** (TC20, full end-to-end) | Also exercises passcode creation, which belongs to the card-activation suite; covered there rather than duplicated |

Plus one **non-TmsLinked** method, `verifyBoundaryDateIsReportedNotAsserted()`: it records the behaviour at
exactly `today + 2 calendar months` as an Allure attachment and **always passes**. AC-1/AC-4 do not define
the boundary and a clarification-gate answer is not a spec (`CLAUDE.md` §8.1), so failing there would fail
against an assumption. It becomes a hard assertion the moment product amends the AC.

## 7. Not yet done

- **The suite has never been executed** — the card-service backend is returning **502** (see
  `execution-reports/exploratory-notes.md` §6c). Compile-green is not run-green, and no result in this
  review should be read as a passing test.
- **No iOS mirror class yet.** Android was built first because its interaction layer is proven; iOS input
  needs the framework's `setValue` path rather than the raw W3C calls that failed during exploration.
