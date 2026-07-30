# Automation — B10-56652 · Pay Home — Perks Section Redesign

**Generator:** `automation-gen@1.0` · **Phase:** QA_PROCESS Phase 5 step 4 · 2026-07-28
Contract: [`docs/ai/automation/automation-generation.md`](../../docs/ai/automation/automation-generation.md) ·
framework: `D:\projects` (resolved via `automation/config/framework.js`, verified by its `pom.xml`)

---

## Headline (CORRECTED 2026-07-29): Android IS automatable — the earlier finding was a tooling error

> **The previous version of this file said "Android cannot be automated for this story, and that is a filed
> defect (B10-58298)". That was wrong on both counts,** and it is corrected here because it drove the wrong
> deliverable. B10-58298 had already been retracted and **deleted** from Jira as a false positive
> ([`../defects/defects.md`](../defects/defects.md)), so it could not justify anything; and the underlying
> claim was itself an artifact of Appium's default settings.

**The Breadfast Pay surface is Jetpack Compose, and Compose reports its nodes to UiAutomator2 as
*invisible*.** With Appium's defaults the whole Pay content area collapses to one childless
`android.view.View [0,81][1080,1953]` — which is exactly what was observed and misread as "the app exposes
nothing". Setting **`allowInvisibleElements = true`** (plus `ignoreUnimportantViews = false` for the nested
`TextView`s) exposes the full tree.

Measured live on Samsung Galaxy S23 / Android 13, en/US, 2026-07-29:

| Appium settings | Nodes in page source | Perk cards found |
|---|---|---|
| defaults | 31–35 | **0** |
| `ignoreUnimportantViews=false` only | 35 | **0** |
| **`allowInvisibleElements=true` only** | 72 | **2** |
| both (used) | **140** | **2** |

Android then exposes the *same contract iOS does*: perk cards carry **`resource-id="perk-card-<perkId>"`**
and a **`content-desc` of `"<title>, <subheader>"`**, alongside `Card perks`, `Recent transactions` and both
`See all` controls. Android's tree is in one respect **better** than iOS's: the carousel is its own
`HorizontalScrollView` sibling of the section header, so AC9 ("no trailing See all tile") is a *structural*
check there rather than the geometric one iOS needs.

**Consequence:** this story is automated **on both platforms, English only** (scope decision 2026-07-29 —
Arabic is covered manually and no AR automation is generated). The two platforms get mirrored page objects
with an identical public API, per the framework's `iosNative`/`androidNative` parity convention.

**Correction (second pass, same day):** an earlier version of this file claimed the **passcode gate** was
the one screen that stayed opaque and therefore had to be coordinate-driven. **It is not.** That claim
rested on dumps captured *before* the setting was applied. With the setting on the gate exposes 53 nodes and
every keypad digit is a clickable `android.view.ViewGroup` whose `content-desc` is the digit
(`../evidence/android-en-04-pay-gate.xml`). **Nothing on the Pay surface needs coordinates** — the whole
flow, assertions and gestures alike, is locator-driven on both platforms.

## What was delivered INTO the framework (compiling, checkstyle-clean)

### 1. `IosNativePayScreen` (extended, not duplicated)
`D:\projects\src\main\java\modals\customerApp\iosNative\iosNativePayScreen\IosNativePayScreen.java`

> **Correction 2026-07-29.** The previous version of this file claimed the class was *"already wired into
> `BaseTest` as `iosNativePayScreen`, so no new `ThreadLocal` or setup wiring was needed"*. **It was not
> wired.** The `ThreadLocal` was *declared* at `BaseTest.java:445` but **`.set(...)` was never called**, so
> `iosNativePayScreen.get()` returned `null` and every test using it would have thrown an NPE on its first
> line. The same latent NPE sat in `ShoppingRegressionTests` lines 970 and 2677. Fixed by adding the one
> missing init line — mobile-native-framework.md §7.1 is explicit that wiring is manual and mandatory.

### 2. `AndroidNativePayScreen` (new — the mirror)
`D:\projects\src\main\java\modals\customerApp\androidNative\androidNativePayScreen\AndroidNativePayScreen.java`

Same public API as the iOS screen, so the two story test classes are structurally identical. Locators use
`resource-id` for the cards and `content-desc` for the labels, per the Android conventions in
mobile-native-framework.md §2. Carries `enableComposeAccessibilityTree()`, which applies the two Appium
settings above — scoped to this screen rather than set globally in `BaseTest`, so no other Android suite's
visibility assumptions change underneath it.

### 3. `AndroidNativePayPasscodeScreen` (refactored from the untracked `AndroidPasscodeScreen` draft)
`…\androidNative\androidNativePayScreen\AndroidNativePayPasscodeScreen.java`

Moved into the Pay package and renamed to the `AndroidNative*` convention every sibling follows, and
**rewritten to be locator-driven** — `//android.view.ViewGroup[@content-desc='%s' and @clickable='true']`,
the exact mirror of `IosNativePayPasscodeScreen`. Also: the fixed **2s-per-digit `Thread.sleep`** replaced
with a wait on the gate actually dismissing (the framework readme requires 0 flakiness); the deprecated
`TouchAction`/`PointOption` imports dropped; `isPageHidden()` added; wired into `BaseTest` as
`androidNativePayPasscodeScreen`, which the draft never was.

**The coordinate keypad map is gone.** It was a workaround for a constraint that did not exist, and it was
actively harmful: the coordinates were captured on a 1080x2340 device and missed every key on the 1440x3088
Galaxy S22 Ultra the suite runs on, so the passcode was never entered and the test failed 15s later on a
wait that looked unrelated. Locators are device-independent.

### 4. `AndroidNativeHomeScreen` — added the Pay tab
`payPageBtn` (`//android.view.View[@content-desc='bottomBar_pay_btn']`) + `pressPayBtn()`. The Android home
screen had controls for Home/More/Cart/Search but none for Pay, so the tab was unreachable from Java.

### 4. `BaseTest` — 4 lines
Import, `androidNativePayScreen` ThreadLocal + init, and the missing `iosNativePayScreen` init.

Members added to both Pay screens, all derived from locators read live off the build under test:

| Member | Purpose | AC |
|---|---|---|
| `cardPerksSectionIsDisplayed()` / `cardPerksSectionIsHidden()` | section present/absent | AC1, zero-state |
| `getCardPerksSectionHeaderText()` | header copy | AC7 |
| `recentTransactionsSectionIsDisplayed()` | the co-located regression surface | AC7 |
| **`payHomeSectionHeadersAreTheSameSize()`** | compares the two headers' rendered heights — makes AC7 assertable **without** the font-size token the design never published | **AC7** |
| `cardPerksSeeAllBtnIsDisplayed()` / `getCardPerksSeeAllBtnText()` / `pressCardPerksSeeAllBtn()` | perks “See all” | AC3, AC6, AC8, AC10 |
| `recentTransactionsSeeAllBtnIsDisplayed()` / `getRecentTransactionsSeeAllBtnText()` | transactions “See all” | AC8, AC10 |
| `getPerkCardsCount()` | the 5-cap | AC3 |
| `getPerkCardIdsInOrder()` | ordered perk ids, e.g. `[CC_8, CC_6, CC_2, CC_3, CC_7]` | AC4 |
| `getPerkCardLabelsInOrder()` | ordered `"title, subheader"` labels | AC2, AC5 |
| `everyPerkCardHasTitleAndSubheader()` | both mandated text elements on every card | AC2 |
| `pressPerkCard(perkId)` / `pressFirstPerkCard()` / `pressLastPerkCard()` | card taps by identity, not index | AC5 |
| **`noTrailingSeeAllTileInCarousel()`** | iOS: geometric (no “See all” inside the carousel row). Android: structural (nothing matching inside the carousel’s `HorizontalScrollView`) | **AC9** |
| `payHomeContainsText(text)` | asserts removed copy is gone | AC1 |
| **`getAllPerkCardIdsInOrder()`** | the **full** carousel — Android swipes and accumulates because its `HorizontalScrollView` lays out lazily (only 2 of 5 cards are in the tree at a time on a 1080px device); iOS returns the laid-out set directly because XCUITest reports all cards at once, including off-screen ones at negative x. **Assert the AC3 five-cap with this, not `getPerkCardsCount()`** | **AC3, AC4** |
| `getPerkCards()` / `getFirstPerkCardElement()` | element access for the gesture helpers | nested scroll |
| `isPageDisplayed()` | “did we land on Pay home” (mobile-native §4 requires one on every screen) | — |

**Removed:** `perkCarouselIsMirroredForRtl()`. Arabic is out of automation scope (2026-07-29), and the
locale-hardcoded English selectors it depended on could never have passed on the ar/EG build anyway — the
AR accessibility names are `مزايا البطاقة` and `عرض الكل`, evidenced in
[`../evidence/ios-ar-ar-09.xml`](../evidence/ios-ar-ar-09.xml).

`mvn -o test-compile` → **BUILD SUCCESS**, **0 Checkstyle violations** (re-verified 2026-07-29).

### 5. Pay-unlock screens — no new flow method

The story tests use the **framework's existing entry flow inline**, exactly as every other native test class
does. No `openPayHomeForActiveCardHolder`-style wrapper was added, and neither execution helper was modified
(operator direction 2026-07-29 — *"always use the existing flow rather than creating a new flow or new
method"*). Each test reads:

```java
//existing framework flow, verbatim
countriesSelectionScreen.selectCountryAndProceed(testCountryCode)
testsExecutionHelper.handleMarketingABTestingForLandingPageIfPresent(..., "auth")
landingScreen.pressAuthBtn()
testsExecutionHelper.login(...)
Assert.assertTrue(homeScreen.isPageDisplayed())

//then the Pay-specific steps, through page objects
homeScreen.pressPayBtn()            // iOS: pressPayTabBtn()
payPasscodeScreen.enterPasscode(configs.getDefaultCardPasscode())
payOtpScreen.enterOtpIfDisplayed(<last 4 digits of the account number>)   // conditional, see below
payScreen.dismissSaveCardInterstitialIfDisplayed()
```

**The Pay-access OTP gate is conditional.** Breadfast Pay only challenges for that code **when the device
id has changed**. On a device the account has already been trusted on, the passcode leads straight to Pay
home and the screen never appears — so `enterOtpIfDisplayed(...)` is used, never an unconditional
`enterOtp(...)`, which would hang and fail. Every BrowserStack session is a new device so the gate does show
in CI; a re-used local device is where it does not. Same pattern as the interstitial and the promo popup,
both of which are already conditional dismissals.

`registerUsingApi` is deliberately **not** called: a freshly registered account has no Breadfast Card and the
Pay tab never unlocks. Instead the existing card-holder number is put on the test user —
`defaultTestData.getRandomTestUser().setLocalPhoneNumber(configs.getCardUserMobileNumber().replace("+20",""))`
— and the standard `login(...)` runs unchanged. The Pay-access OTP is **derived, not fetched**: it is the
last 4 digits of that same number.

New page objects the Pay steps need, all wired into `BaseTest`:

| Screen | Platform | How it is driven |
|---|---|---|
| `IosNativePayPasscodeScreen` | iOS | locators — each keypad digit is an `XCUIElementTypeOther` named for the digit |
| `AndroidNativePayPasscodeScreen` | Android | coordinates — the gate is 9 nodes even with the settings on |
| `IosNativePayOtpScreen` / `AndroidNativePayOtpScreen` | both | W3C key actions into the focused field (Flutter merges this screen into one semantics node, so there is no field to address) |
| `IosNativeCardPerksListScreen` / `AndroidNativeCardPerksListScreen` | both | `perks-tabs`, `perks-tab-<id>`, `perks-sections`, `perk-card-<id>` |

**The two perks-list screens share the app's internal ids across platforms** — identical names, exposed as
`name` on iOS and `resource-id` on Android. Captured live: `evidence/ios-en-full-list.xml` (29 cards) and
`evidence/android-en-full-perks-list.xml` (19 cards laid out, 4 section tabs). Android's list body is a lazy
vertical `ScrollView`, so `getAllPerkCardIdsInOrder()` scrolls and accumulates there too.

### 6. Story test classes — landed, one per platform

| | |
|---|---|
| `src/test/java/customerApp/iosNative/payHome/B10_56652_PayHomePerksTests.java` | 9 tests |
| `src/test/java/customerApp/androidNative/payHome/B10_56652_PayHomePerksTests.java` | 9 tests, exact mirror |
| `b10-56652-tests.xml` | story suite, both platforms |
| `mobileng.xml` | both classes registered (mobile-native §7.2) |

All 18 test titles match a BrowserStack case name **verbatim** — verified programmatically against
`gen_browserstack_csv.js`, the same source the CSV and the upload are generated from.

The `reference/` copy of the old draft class is now superseded and can be deleted.

## Test-data tooling delivered (used in the real run)

| Script | What it does |
|---|---|
| [`perk-window.js`](perk-window.js) | **Reversible** eligible-perk-count control for the AC3/AC4 boundary states, via `POST /perks/section/update {is_active}` — with a ledger, a predicted-carousel calculator that **discriminates competing ordering rules**, and a `restore` that **verifies** itself. Encodes the hard-won fact that perk `end_date` expiry is **one-way** and `start_date` edits are **silently ignored** (**[B10-58302](https://breadfast.atlassian.net/browse/B10-58302)**). |
| [`gen_browserstack_csv.js`](gen_browserstack_csv.js) | single source of truth for the **20** cases (TC-54055/54056 were deleted as invalid) — feeds both the CSV and the upload so they cannot drift |
| [`upload_browserstack.js`](upload_browserstack.js) | v2 upload + **verification** against whatever the generator emits. Encodes the write-side traps *and* the newly-found read-side ones (no per-case detail endpoint; `title`/`steps` on read vs `name`/`test_case_steps` on write). |
| [`explore/`](explore/) | the live drivers: `session.js` (long-lived sessions per platform×locale, **top-level** `appium:language`/`locale`), `otp.js` (Google Chat OTP, mirroring `GoogleChatApiClient`), `keypad.js` (**locale-aware** — the Arabic passcode keypad is **mirrored** and uses Arabic-Indic numerals), `drive.js` (dual-dialect inventory/tap/type), `to-pay-home.js` (end-to-end route to Pay home on either platform/locale) |

## Correction: the "framework drift" finding was another false alarm

> The previous version of this file said the framework's `androidNative` page objects expect `content-desc`
> and **"no longer match the build"**, calling it a blocker for *every* future Android story. **That is
> wrong**, and it had the same root cause as the "Android exposes nothing" claim — page-source dumps taken
> without `allowInvisibleElements`.

Re-captured with the setting on, the login screens expose **exactly** the `content-desc` values the existing
page objects target: `phoneNumberInputScreen_header`, `phoneNumber_countryCode`, `phoneNumber_txtField`,
`next_btn`, `back_btn`, `otpScreen_subHeader_txt`, `otp_textField`, `verify_btn`
(`evidence/android-en-02-after-phone-tap.xml`, `evidence/android-en-05-otp-screen.xml`). So
`AndroidNativePhoneNumberScreen` and `AndroidNativeOtpVerificationScreen` are correct, the existing
`androidNativeTestsExecutionHelper.login()` is reused unchanged, and **no framework re-base task is needed.**

## Run commands

```
cd D:\projects
mvn -o test -Dsurefire.suiteXmlFiles=b10-56652-tests.xml                    # both platforms
mvn -o test -Dtest=B10_56652_PayHomePerksTests                    # single class
mvn -o test -Dsurefire.suiteXmlFiles=b10-56652-tests.xml -Dgroups=B10-56652 # story group only
```

> **`-DsuiteXmlFile=` (singular) does NOT work.** It is not a surefire property and is silently ignored;
> the pom hard-codes **nine** `<suiteXmlFile>` entries, so that form runs the **entire regression estate**
> (testng · sanity · stress · fintech · supplychain · fleet · referrals · mobile · pricing) in parallel
> instead of this story's suite. Found 2026-07-29 on B10-56717, when a "single test" invocation spent ten
> minutes creating stress-test orders and swept up B10-56652's and B10-57393's suites as collateral.
> The real override is **`-Dsurefire.suiteXmlFiles=`** (plural).

**Precondition:** `cardUserMobileNumber` in `resources/environments/cardServiceConfigs_testing.properties`
must be an account with an **active** Breadfast Card, and `defaultCardPasscode` its passcode. The unlock
helper asserts it reached Pay home and names that account in the failure message if it did not. Note the
value there (`+201064507660`) is **not** the number this story's exploration used (`+201189586349`); the
passcode matches, but if the run stops at the Pay gate, point the property at a known-good card holder.

## BrowserStack traceability

Test titles are the **exact** BrowserStack case names, so results map by name and `@TmsLink` posts them onto
the case. Verify offline with `node B10-56750/automation/check_test_name_parity.js` before a run.

| `@TmsLink` | Test method (identical on both platforms) | Covers |
|---|---|---|
| TC-54035 | `verifyLongPerksSubtitleIsNoLongerDisplayed` | AC1 subtitle removed |
| TC-54036 | `verifyEveryPerkCardShowsTitleAndSubheader` | AC2 card content |
| TC-54038 | `verifyCarouselIsCappedAtFivePerks` | AC3 cap + See all |
| TC-54039 | `verifyCarouselIsThePrefixOfTheFullPerksList` | AC4 ordering |
| TC-54045 | `verifyNoTrailingSeeAllTileInTheCarousel` | AC9 |
| TC-54047 | `verifySeeAllOpensTheFullPerksListAndBackReturnsToPayHome` | AC6 |
| TC-54049 | `verifyTransactionsHeaderMatchesPerksHeaderAndSectionIsIntact` | AC7 + regression |
| TC-54050 | `verifySeeAllReadsSentenceCaseInBothSections` | AC8/AC10 |
| TC-54054 | `verifyNestedScrollGesturesDoNotInterfere` | nested scroll |

**9 of 20 cases automated, x2 platforms = 18 tests.** Not automated, with reasons:

| Case | Why not |
|---|---|
| TC-54037 | needs a category-name oracle that does not exist |
| TC-54040–54044 | need the eligible-perk count driven to a boundary (spill, <5, =5, 0). That mutates **shared** test data, so it runs manually inside a recorded window restored afterwards ([`perk-window.js`](perk-window.js)) |
| TC-54046 | Perk Details page object is **owned by sibling story B10-56711** — build it there, don't duplicate |
| TC-54048 | needs `getEligiblePerkIdsInMobileOrder` on `CardAdminPanelPerksApiClient` (create/login only today). The rule is known and already implemented in `perk-window.js`: active + in an active section + has `display_order` |
| TC-54051 | **Arabic — out of automation scope** (2026-07-29). Validated manually |
| TC-54052/54053 | long-text and degraded-network legs need data seeding and network shaping |
