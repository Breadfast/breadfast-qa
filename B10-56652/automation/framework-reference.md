# Framework Reference — B10-56652 (reuse map)

What this story **reused** from `D:\projects` versus what it **added**, per the reuse-before-build rule
([`docs/ai/automation/reusable-components.md`](../../docs/ai/automation/reusable-components.md)).

## Reused as-is — nothing duplicated

| Framework asset | Used for |
|---|---|
| `modals/customerApp/iosNative/iosNativePayScreen/IosNativePayScreen` | **already existed and is already wired into `BaseTest` as `iosNativePayScreen`** — so the perks-section members were *added to it* rather than creating a parallel class, and **no new `ThreadLocal`/setup wiring was required** |
| `modals/BaseIosScreen` | `isElementDisplayed`, `isElementHidden`, `getTextDisplayed`, the `FluentWait` — every new method builds on these |
| `helpers/factories/dataFactories/OtpFactory` + `helpers/apiClients/GoogleChatApiClient` | login OTP. The exploration driver `explore/otp.js` is a faithful JS mirror of `findMessageForOTP` (same space id, same `"OTP For <phone> is <code>"` parse) so the two channels cannot diverge |
| `helpers/apiClients/webApiClients/CardAdminPanelPerksApiClient` | panel login + perk create; its `loginAndGetJwtToken` pattern is what `perk-window.js` reproduces |
| `modals/cardsAdminPanel/PerksPage` | perks-table reading, for the ordering oracle |
| `resources/environments/config_testing.properties` | Google Chat space/client/secret/refresh-token — **no new credential source introduced** |
| `resources/environments/cardServiceConfigs_testing.properties` | `adminUserName`/`adminPassword`, `defaultCardPasscode` (`123321`), `cardServicesAdminPanelBaseURL` |
| `resources/environments/browserStackConfigs.properties` | BrowserStack `userName`/`accessKey`, device names, Appium versions |
| `checkstyle-suppressions.xml` | the `TypeName` suppression for `B10_\d+_\w+Tests` was **already present** — no wiring needed |

## Added to the framework

| File | Change |
|---|---|
| `modals/.../IosNativePayScreen.java` | **extended** with 16 members for the Pay-home perks section (see [README](README.md) for the table). `mvn -o test-compile` → BUILD SUCCESS, 0 Checkstyle violations. |

## Deliberately NOT added (with the reason)

| Would-be asset | Why not |
|---|---|
| `B10_56652_PayHomePerksTests` in `src/test/java` | depends on five pieces of framework surface that don't exist yet (Pay-unlock helper, perks-list screen, perk-details screen, eligible-perks API method, two extra Pay helpers). Committing it would break the shared build, so it ships as `reference/*.reference`. |
| `IosNativePerkDetailsScreen` | the Perk Details screen is **sibling story B10-56711's** surface — it should be built there, not duplicated here |
| An `androidNative` Pay-screen page object | pointless today: **the Android Pay home exposes no accessibility nodes at all** ([B10-58298](https://breadfast.atlassian.net/browse/B10-58298)). Building one would mean hard-coding screen coordinates for a screen under active redesign. |

## Gaps in the framework this story surfaced

1. **`androidNative` page objects have drifted from the shipped app.** The build is **Jetpack Compose** exposing
   **`resource-id`** test tags; the existing page objects expect **`content-desc` on `android.view.View`**.
   `AndroidNativeLandingScreen`, `AndroidNativePhoneNumberScreen` and friends no longer resolve. This blocks
   *every* new Android story, not just this one.
2. **No `androidNative` Pay-screen page object exists**, even though `iosNative` has one.
3. **No Pay-unlock helper on either platform** — passcode + Pay-access OTP + save-card interstitial are
   undriven in Java, though they gate every Pay test.
4. **`CardAdminPanelPerksApiClient` has no read methods** — no perks list, no section list, no update. Those
   endpoints are now known and documented in `perk-window.js`; porting them to the Java client would let
   Java tests build their own perk fixtures.
5. **Arabic keypad handling is absent.** The Pay passcode keypad is **mirrored** in ar/EG and renders
   **Arabic-Indic numerals**; any coordinate-based Java implementation must account for it (`explore/keypad.js`
   documents the working approach — resolve keys from the live tree on iOS, mirrored coordinate map on Android).
