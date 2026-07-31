# Framework reference — B10-56711 reuse map

**Framework:** `D:\projects` (resolved via `automation/config/framework.js`) · **Mobile → Appium native**
Companion to [`conformance-review.md`](conformance-review.md). Answers one question: *for every capability
this story needed, was it already in the framework, and if not, why not?*

## 1. Reused unchanged — the reuse ladder's top rung

| Capability | Existing asset | Notes |
|---|---|---|
| App entry (A/B → country → auth → login) | `androidNative/iosNativeTestsExecutionHelper.handleMarketingABTestingForLandingPageIfPresent` + `.login(...)` | **Composed inline in every test**, never wrapped ([[reuse-existing-flows]]) |
| Reaching Pay | `…NativeHomeScreen.pressPayBtn()` | |
| Compose accessibility tree (Android) | `…NativePayScreen.enableComposeAccessibilityTree()` | Must run **before** the passcode/OTP gates — those are Compose surfaces too |
| Pay passcode gate | `…NativePayPasscodeScreen.enterPasscode(configs.getDefaultCardPasscode())` | Conditional; guarded with `isPageDisplayed()` |
| Pay-access OTP | `…NativePayOtpScreen.enterOtpIfDisplayed(last4)` | |
| Save-card interstitial | `…NativePayScreen.dismissSaveCardInterstitialIfDisplayed()` | |
| Pay home → Perks List | `…NativePayScreen.pressCardPerksSeeAllBtn()` | |
| Perks List | `…NativeCardPerksListScreen` — `isPageDisplayed`, `pressPerkCard`, `getPerkCardTitle`, `getPerkCardIdsInOrder` | **The entry point for this whole story**, delivered by B10-56717 |
| Login OTP | `helpers/apiClients/GoogleChatApiClient` | |
| Perk data control plane | `CardAdminPanelPerksApiClient.listPerks`, `getActivePerkIdsAssignedToASection`, `getPerkSubheaderEn` | |
| Test config | `models/Configs` — `getCardUserMobileNumber`, `getDefaultCardPasscode`, `getCardAdminPanelAdminUserName/Password` | |
| Checkstyle | `checkstyle-suppressions.xml` already suppresses `TypeName` for `B10_\d+_\w+Tests` | No wiring needed |

## 2. Added — and why nothing existing would do

| New asset | Why it could not be reused |
|---|---|
| `Android/IosNativeCardPerkDetailsScreen` | **No perk-details page object existed on either platform.** The Pay family stops at the list; every locator on this screen (`perk-details-*`, `coupon-code-*`, `branches-*`) is new. Searched `modals/customerApp/**` for `perk`, `detail`, `coupon`, `branches` before writing. |
| `getPerkAttribute` / `getPerkField` | The client had only `getPerkSubheaderEn` — one hardcoded field. This story reads six (`usage_description`, `branches_description`, `cashback_processing_description`, `short_duration_description`, `coupon_code`, `coupon_type`) × 2 locales. Generalising beat adding twelve near-identical getters. |
| `getAuthoredBranchLineCount` | AC12's expected value **is** a line count, and the newline-splitting rule (operator-confirmed) belongs next to the data, not in a test. |
| `findActivePerkWithCouponType` / `…WithMoreThanThreeBranchLines` / `…WithoutAttribute` | Fixture **discovery by shape**. Without these the tests would name `DC_17`/`DC_16`/`GC_56` and break the moment anyone edited those perks. |
| `b10-56711-tests.xml` | One suite per story, as `b10-56717-tests.xml`. |

**Not added, deliberately:** no new model type, no new helper class, no new wait abstraction, no fluent
builder, no new base class. Nothing under `modals/` that is not a page object.

## 3. Locator provenance

| Platform | Provenance |
|---|---|
| **Android** | ✅ Read live off the build under test — `evidence/android-en-10-perk-details.xml`, captured 2026-07-30 on Samsung Galaxy S23 / Android 13 with the Compose settings enabled. Nine ids, all structural. |
| **iOS** | ⚠ **Mirrored from Android onto `name`, not observed.** The card backend began returning `502` before an iOS session could be captured. Mirroring is reasonable rather than a guess because the list screen's `perk-card-<perkId>` contract held **identically** across both platforms — but it is unverified, is flagged in the class header, the suite XML and the README, and **must be confirmed before an iOS failure is called a product defect.** |

## 4. Known traps carried forward

| Trap | Source |
|---|---|
| Compose node tree populates **non-deterministically**; `allowInvisibleElements` must be **re-asserted after navigation**, not only at session creation (25 nodes → 10 across identical runs) | measured this story · [[android-compose-invisible-nodes]] |
| Perk-card bounds are in **scrollable content space**, not the viewport — a card can report `y=7402` on a 2340 px screen. Scroll into view and re-read before tapping. | measured this story · [[pay-appium-compose-traps]] |
| `-DsuiteXmlFile=` (singular) is ignored and runs all nine suites; use `-Dsurefire.suiteXmlFiles=` | [[mvn-suite-override]] |
| The Pay-access OTP is **really sent** — deriving last-4 is wrong on some accounts | [[pay-access-otp-is-sent]] |
| Test classes hold **no private helpers**; page objects own methods and data | [[java-framework-style]] |
| A blind Android coordinate fallback for the save-card interstitial hits the **bottom-bar Pay tab** on Pay home and re-locks the app | measured this story |

## 5. Open items for the first real run

1. **Confirm the iOS ids** against a live iOS session (§3).
2. Check the Android `swipeGesture` percentages scroll the details body at a sensible rate.
3. Confirm `coupon-code-copy-btn`'s `content-desc` carries the code on iOS too (`label`/`value` fallback is coded).
4. AC7: record the measured "Copied!" duration; AC7 specifies ~3000 ms.
