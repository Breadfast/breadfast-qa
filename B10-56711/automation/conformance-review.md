# Framework Conformance Review — B10-56711 automation

**Gate:** Phase 4b ([`framework-conformance`](../../qa-workflow/skills/framework-conformance/SKILL.md)) ·
run 2026-07-31 · framework `D:\projects` @ `1ea0895c3`+
**Verdict:** ✅ **PASS** — after **five** corrections (§3). `mvn -o test-compile` → **BUILD SUCCESS**.

> **This review initially passed a check it should have failed.** C5 below — every Android locator using a
> strategy that resolves nothing on a Compose surface — was signed off as "locators verified against the
> running app" because the ids appeared in a page-source dump. They did; the driver still could not resolve
> them. The lesson is specific and worth keeping: **verifying a locator means issuing a find and getting an
> element back, not finding the string in an XML dump.** It was caught only because a *product* result
> (AC12 "does not expand") looked wrong enough to probe.

## 1. Assets produced

| Asset | Path | Justification against the reuse ladder |
|---|---|---|
| `AndroidNativeCardPerkDetailsScreen` | `src/main/java/modals/customerApp/androidNative/androidNativePayScreen/` | **No perk-details page object existed on either platform.** The Pay-surface family (`…PayScreen`, `…PayPasscodeScreen`, `…PayOtpScreen`, `…CardPerksListScreen`) covers everything up to the list; the details screen is new. |
| `IosNativeCardPerkDetailsScreen` | `src/main/java/modals/customerApp/iosNative/iosNativePayScreen/` | Same, mirrored. |
| `B10_56711_PerkDetailsTests` ×2 | `src/test/java/customerApp/{androidNative,iosNative}/payHome/` | Story classes, 17 `@TmsLink`-bound tests each. |
| `b10-56711-tests.xml` | framework root | Story suite, mirroring `b10-56717-tests.xml`. |
| 6 methods on `CardAdminPanelPerksApiClient` | `src/main/java/helpers/apiClients/webApiClients/` | **Extended, not duplicated.** `getPerkAttribute` / `getPerkField` / `getAuthoredBranchLineCount` + 3 fixture finders. The client already owned `listPerks` and `getPerkSubheaderEn`; these follow that shape. |
| `BaseTest` wiring | `src/test/java/base/BaseTest.java` | 2 imports, 2 ThreadLocals, 2 instantiations — identical to how `…CardPerksListScreen` is registered. |

**Nothing was reimplemented.** Reused as-is: the whole entry flow
(`handleMarketingABTestingForLandingPageIfPresent` → `selectCountryAndProceed` → `pressAuthBtn` → `login`),
`pressPayBtn`, `enableComposeAccessibilityTree`, `enterPasscode`, `enterOtpIfDisplayed`,
`dismissSaveCardInterstitialIfDisplayed`, `pressCardPerksSeeAllBtn`, `pressPerkCard`, `getPerkCardTitle`.
Per [[reuse-existing-flows]] these are **composed inline**, never wrapped in a new method.

## 2. Checklist

### A. Test class shape
| Check | Result |
|---|---|
| No private methods in the test class | ✅ **0** in both (`grep -cE 'private .* [a-z][A-Za-z]*\('` → 0/0) |
| No data constants / input literals in the test class | ✅ after correction C1 — card ids now come from `CARD_IDS_IN_MANDATED_ORDER` on the page object |
| No hardcoded perk ids | ✅ **0** (`grep -cE '"(DC\|GC\|MC\|CC)_[0-9]+"'` → 0/0) — fixtures are **discovered by shape** |
| Class-level bare `@Test` | ✅ both |
| `extends BaseTest`, page objects via ThreadLocals | ✅ both; **0** direct `androidDriver`/`iosDriver` references in the tests |
| Package matches the surface | ✅ `customerApp.{androidNative,iosNative}.payHome` — same package as the sibling Pay-surface stories |
| Class name `B10_<id>_<Feature>Tests` | ✅ `B10_56711_PerkDetailsTests`; `checkstyle-suppressions.xml` already suppresses `TypeName` for this pattern |

### B. New assets — necessity and placement
| Check | Result |
|---|---|
| New page objects extend the module base | ✅ `BaseAndroidScreen` / `BaseIosScreen` |
| No new type under `modals/` that is not a page object | ✅ both are page objects |
| No fluent builders | ✅ `grep -rlnE 'public [A-Z][A-Za-z]* with[A-Z]'` → **0** |
| Composite flows live on the page object as plain methods | ✅ `getCardIdsInOrder`, `isCardPresentAfterFullScroll`, `getBranchLines`, `scrollToEnd` |
| No method that merely wraps an implemented flow | ✅ the entry flow is inlined per test, not wrapped |

### C. Locators
| Check | Result |
|---|---|
| Verified against the running app | ✅ **Android, after correction C5.** Every id was read off the live build (`evidence/android-en-10-perk-details.xml`) — but reading an id out of a page-source dump is **not** the same as the driver being able to resolve it, and this check originally passed on that weaker evidence. Re-tested by actually issuing find requests (`explore/probe-locators.js`, 2026-08-02): all nine ids are in the source, `by:id` resolves **0/9**, `by:accessibility id` resolves **0/9**, `xpath //*[@resource-id='…']` resolves **9/9**. |
| | ⚠ **iOS — MIRRORED, NOT OBSERVED.** The iOS surface could not be captured because the card backend began returning `502`. Documented in the class header **and** in the suite XML. **A failure in the iOS class must be re-verified against a live iOS session before it is called a product defect.** |
| Preference order (app contract before text) | ✅ ids everywhere structural; text only for the localisable controls that carry no id (`See more`/`See less`, `View`, `Close`, `Copied!`), each with EN + AR constants |
| Match count checked | ✅ `findElements(...).isEmpty()` / `.get(0)` on single-instance controls; no unpinned multi-match |

### D. Synchronisation
| Check | Result |
|---|---|
| Uses the framework's existing explicit-wait wrappers | ✅ after correction **C3** — `wait.until(...)` throughout |
| No new waiting abstraction | ✅ after **C3**. The AC7 helper now wraps the inherited `wait`; **`Thread.sleep` count in both new page objects = 0** |
| `…IfDisplayed()` only on genuinely optional controls | ✅ used only for the conditional passcode gate and the optional save-card interstitial, both inherited |

### E. Assertions
| Check | Result |
|---|---|
| Diagnostic message on **every** assertion | ✅ after correction **C4** — assertions lacking a message: **0/0** (was 17 each) |
| No `SoftAssert` | ✅ `grep -rn "SoftAssert" src --include=*.java` → **0** across the whole framework |
| **Vacuous-pass guard** | ✅ after correction **C2** — see below |
| Assertions read back through getters, not restated literals | ✅ every expected value comes from `CardAdminPanelPerksApiClient`, never from a literal in the test |

### F. Data, config, re-runnability
| Check | Result |
|---|---|
| No hardcoded environment values / URLs / credentials / paths | ✅ account from `configs.getCardUserMobileNumber()`, passcode from `getDefaultCardPasscode()`, admin creds from `getCardAdminPanelAdminUserName/Password()` |
| Re-runnable, no mutation | ✅ **read-only** — this story mutates nothing, so there is no cleanup path to get wrong |
| Fixture data is data the product could really receive | ✅ the fixtures *are* real environment records |

## 3. Corrections I made after running this checklist against my own code

The checklist earned its place — four things were wrong on the first pass, and two of them would have
produced **false results** rather than compile errors.

| # | Problem | Why it mattered | Fix |
|---|---|---|---|
| **C1** | Card resource ids were inline `Arrays.asList("coupon-code-card", …)` **in the test class** | Violates "no data constants in the test class"; also duplicated the mapping in three places, so a rename would drift | Moved to `CARD_IDS_IN_MANDATED_ORDER` + `cardIdForLabel()` on the page object |
| **C2** | **Vacuous pass.** In the AC5 order tests `expected` is derived from `actual` via `retainAll`, so an **empty** `actual` satisfied `assertEquals(actual, expected)` | If the details screen rendered **no cards at all** — precisely the failure mode seen during exploration when a tap silently missed — the AC5 test would have reported **PASS**. This is the single most dangerous defect I introduced. | Assert **completeness first**: all five cards for a fully populated perk; ≥2 surviving cards in the hidden-card case |
| **C3** | AC7's wait was a hand-rolled `while` loop with `Thread.sleep(250)` | Violates "no new waiting abstraction"; also slower and less accurate than the inherited wait | Now `wait.until(driver -> !isCopiedConfirmationDisplayed())`, still returning elapsed ms so a timing miss reads as a measurement rather than a functional failure |
| **C4** | 17 assertions per class carried **no diagnostic message** (the inherited post-login `isPageDisplayed()` check) | A bare failure there says nothing about which of login / OTP / passcode broke | Message naming the account and the consequence |
| **C5** | **Every Android locator used `@FindBy(id = …)` / `By.id(…)`, which resolves NOTHING on this surface.** Compose exposes a `testTag` as a **bare** `resource-id` with no `package:id/` prefix, and UiAutomator2's `id` strategy does not index it. | **The entire Android suite would have failed at runtime with "no such element" — 17 tests, none of them reaching an assertion.** Worse, the same mistake in the JS runner made `clickById` fall through to a stale-bounds coordinate tap, which reported **AC12 and AC8 as FAILURES while the product was working correctly**. Two false defects, from one bad locator strategy. | All `@FindBy(id=…)`/`By.id(…)` → `//*[@resource-id='…']` XPath; same fix in the runner. Verified by re-running: AC12 then expanded 3 → 16 lines with the toggle flipping to "See less". |

## 4. Deviations accepted, with reasons

| # | Deviation | Reason |
|---|---|---|
| D1 | **iOS locators mirrored, not observed** | The card backend went to `502` mid-run. Recorded in three places rather than hidden; the alternative was to invent iOS-specific guesses, which would be worse. Must be confirmed when the environment returns. |
| D2 | **6 of 23 cases not automated** | Each is a *visual* or *out-of-app* assertion, declared with a reason in the class header and enforced by `check_test_name_parity.js` (`PARITY OK`, 17 automated / 6 declared manual). Not silent truncation. |
| D3 | **English only; AR (TC-54264) manual** | Same scope decision as B10-56652 and B10-56717 — RTL mirroring and per-locale artwork are visual comparisons. |
| D4 | `getCardIdsInOrder()` returns ids in *definition* order filtered by presence, resolved twice (before and after scroll), rather than by measured `y` | Android clips bounds to the viewport, so a `y`-sort across a scrolling container is unreliable. The test still detects a genuine reorder, because a card appearing out of sequence changes the filtered list. Geometric ordering is measurable on iOS and is left to visual testing. |

## 5. Not verified by this gate

- **No test has been executed.** This gate is static: compile, shape, locator provenance, assertion
  quality. Execution is blocked by the `502` card backend and is recorded as pending, **not** as passed.
- iOS locator resolution (D1) — and after C5 this is a sharper risk than it first looked: if the iOS build
  exposes its test ids the way Android does, `//*[@name='…']` may resolve nothing there either. The iOS
  page object must be probed the same way (`probe-locators.js`) before its results mean anything.
- Whether the Android `swipeGesture` percentages scroll the details body at a sensible rate — first real
  run will show it.
