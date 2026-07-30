# Automation — Framework Reference · B10-56717 Perks List

Generator `automation-gen@1.0` · 2026-07-29
Contract: [`docs/ai/automation/automation-generation.md`](../../docs/ai/automation/automation-generation.md) ·
framework `D:\projects` (resolved via `automation/config/framework.js`, verified by its `pom.xml`).
Mobile story ⇒ **Appium native** (`androidNative` / `iosNative`) — unchanged by the 2026-07-27
web→Selenium decision.

## 1. Status — updated 2026-07-29 (automation generated; NOT yet green)

Branch `2026/sprintQ3.3/B10-56717-perks-list-screen-redesign` created in **both** repos;
`qa-cli.js branch-check` passes.

| Deliverable | State |
|---|---|
| **Working exploration harness** (JS, this folder) | ✅ delivered — produced every result in the execution report on all four combos |
| **Locator contract for both platforms** | ✅ measured and **corrected** (§3) — the first version of this doc understated it |
| **Page objects** `AndroidNativeCardPerksListScreen` / `IosNativeCardPerksListScreen` | ✅ **in the framework**, extended with 4 methods this story needed |
| **`CardAdminPanelPerksApiClient` read side** (the dashboard oracle) | ✅ **added** — `getSectionIdsWithActivePerksInExpectedOrder`, `getActivePerkIdsAssignedToASection`, `getPerkSubheaderEn` |
| **`BaseTest` wiring** | ✅ import + `ThreadLocal` **+ `.set(...)`** — all three (the missing `.set` is what left a latent NPE on B10-56652) |
| **`B10_56717_PerksListTests`** × 2 platforms, 9 `@TmsLink` tests each | ✅ **written**; `mvn test-compile` green, **0 checkstyle violations**, **18/18 titles match BrowserStack verbatim** |
| **Story suite** `b10-56717-tests.xml` | ✅ added |
| **A green run** | ❌ **NOT achieved** — see §1.1 |

### 1.0 Framework defects found while trying to get a green run (all pre-existing, none in this story's code)

The generated code compiled on the first attempt. Getting a mobile test to reach its **first assertion**
took four independent framework defects — worth recording because they block every mobile suite, not just
this one.

| # | Defect | Fix | Blast radius |
|---|---|---|---|
| **F-1** | `GoogleChatApiClient.findMessageForOTP` required `matches.length() > 1` for method `login` and then read index 0 regardless. With exactly **one** fresh OTP in the space — the cold-start case — it polled 30 s and returned `null`, so login failed before any assertion. The list is already `orderBy=createTime desc`, so the guard implemented no freshness logic; the `default` branch had always used the correct `!isEmpty()`. | ✅ changed to `!matches.isEmpty()` — **monotonic**: >1 behaves identically, exactly-1 stops returning null | **Every login-OTP test in the estate.** Each retry adds a message, so attempt 2+ can pass where attempt 1 cannot → looks like flakiness |
| **F-2** | `mvn test -DsuiteXmlFile=<story>.xml` does **not** run that suite. `suiteXmlFile` (singular) is not a surefire property and is silently ignored; `pom.xml` hard-codes **nine** `<suiteXmlFile>` entries, so the invocation runs the whole regression estate in parallel. A "single test" run spent ten minutes creating stress-test orders and swept up B10-56652's 9 tests and B10-57393's 21. | ✅ use **`-Dsurefire.suiteXmlFiles=`** (plural); corrected in both stories' READMEs and both suite XMLs | Any story-suite invocation |
| **F-3** | The Pay **passcode gate is conditional** — it appears on a new device/session or after a timeout, not when Pay is already unlocked — but the tests called `enterPasscode()` unconditionally and died on `content-desc='1'` after 15 s. The framework already models this correctly for the Pay OTP (`enterOtpIfDisplayed`). | ✅ all 18 call sites in this story guarded with `isPageDisplayed()` | Any Pay test on an already-unlocked session |
| **F-4** | The app **will not launch on Samsung Galaxy S23 / Android 13** through the framework: `Activity name '.com.breadfast.main.MainActivity' … doesn't exist or cannot be launched`. It launches fine on the configured S22 Ultra / Android 12, and fine on the S23 via a raw Appium session that sets no `appActivity`. | ⚠ documented, not fixed — `appActivity` handling needs review | Any native run pinned to a newer device |

**Method note, honestly stated:** F-4 and two other dead ends (a blocking promo, the Compose setting) were
*guesses*, each disproved by a ~7-minute BrowserStack run. The habit that would have avoided all three:
capture the tree at the failure point **first**, then form one hypothesis. That is now baked in —
`AndroidNativePayScreen.getOnScreenIdentifiersForDiagnostics()` puts the live tree into the assertion
message, so the first failure carries its own evidence.

### 1.1 What the first real runs actually did — and why it is not green

The Android suite **executed end-to-end against the operator's build**
(`appium:app: bs://12bf2be529be6c73bc0dff…`, session `d8f6445fd9fe6959…`, ~6 min): driver created, the
framework's entry flow ran, login succeeded, Pay opened. It then **failed on the Pay-home precondition
assertion**, before reaching any Perks-List assertion.

**The failure message was itself wrong.** It read *"check that this account still has an active Breadfast
Card"*, but `POST /wallet_users/allWallets` confirms **both** candidate accounts are `Active`:
`+201131528282` (the framework's configured `cardUserMobileNumber`) and `01064507660`. So the diagnosis
in that message was unfounded and has been corrected in the code.

**MEASURED CAUSE (2026-07-29, confirmed on both retry attempts).** With the live tree printed into the
assertion message, the screen at the failure point is unambiguous:

```
desc=How many cards can I apply for???!!   desc=What is BCard   desc=breadfast question 1 ?
desc=View all   desc=Enter invitation code   desc=Join the waitlist   desc=Scroll down
```

That is the **card-application / FAQ funnel**, not Pay home. For an account with a wallet but **no
provisioned Breadfast Card**, tapping Pay lands in the application funnel.

**iOS handles this; Android does not.** `IosNativePayScreen` has
`closeIntroducingBreadfastCardPopupIfDisplayed()` and the iOS test calls it right after
`pressPayTabBtn()`. `AndroidNativePayScreen` has **no equivalent**, even though its own class doc says it
is *"the mirror of `IosNativePayScreen`, same public API so the story tests are…"*. A real parity gap that
blocks **every** Android Pay test on an account in this state — B10-56652's suite included.

**The fix, and the one wrinkle:** add the Android mirror method and call it after `pressPayBtn()`. The
digest shows **no labelled close control** (no `close`/X anywhere in the tree), so the dismissal has to be
a **coordinate tap** — which is exactly what `mobile-native-framework.md` §2 prescribes for Pay surfaces
and what `AndroidPasscodeScreen` already does. The working coordinate from this story's JS harness is
`(1010, 145)` on a 1080×2340 device.

**Second, independent prerequisite:** `cardUserMobileNumber` should point at an account that actually has
a **provisioned card**. Both accounts checked (`+201131528282`, `+201064507660`) have `Active` wallets but
land in the application funnel, so no amount of page-object work will reach Pay home with them.

*Process note: this took three wrong guesses (device size, then this same funnel dismissed too early, then
the Compose setting) before the tree was simply printed. The lesson is in §1.0.*

**iOS cannot run from this machine at all**, for two separate reasons:
1. `resources/environments/browserStackConfigs.properties` → **`bStackIosCustomerAppNativeApp` is empty**
   (Android's is already the operator's exact build id). With it blank the BrowserStack payload carries
   `buildName: null` and is rejected: *"property '#/firstMatch/0/bstack:options/buildName' of type
   NilClass"*.
2. It then falls back to a **local** Appium session, which needs `xcrun` — macOS only.

**One shared-config caveat:** a native run needs `config_testing.properties → targetApp=customerAppNative`
(the file ships `customerAppReactNative`, and `Configs` offers no `-D` override). It was switched for the
run and **reverted immediately afterwards** — `git diff` on that file is clean.

## 2. Reuse-before-build survey

Checked against [`reusable-components.md`](../../docs/ai/automation/reusable-components.md) and
[`java-framework.md`](../../docs/ai/automation/java-framework.md).

| Asset | Verdict |
|---|---|
| `modals/customerApp/iosNative/iosNativePayScreen/IosNativePayScreen.java` | **reuse** — route to Pay home (iOS) |
| `modals/customerApp/androidNative/AndroidNativePayScreen.java` | **reuse** — created by B10-56652, mirrors the iOS API |
| `modals/customerApp/androidNative/AndroidPasscodeScreen.java` | **reuse** — the Pay unlock gate (coordinate-driven, as `mobile-native-framework.md` §2 prescribes) |
| `helpers/apiClients/GoogleChatApiClient.findMessageForOTP` | **reuse** — login OTP channel |
| `helpers/apiClients/webApiClients/CardAdminPanelPerksApiClient.java` | **reuse + extend** — needs `perks/section/list`, `perks/section/create`, `perks/section/update` and `perks/update` (endpoint shapes in §4) |
| `modals/cardsAdminPanel/PerksPage.java` | **reuse** — admin-side data prep |
| **Perks-List screen object (either platform)** | **BUILD** — does not exist |
| **Perk-card / tab-row component objects** | **BUILD** — do not exist |

## 3. Locator contract — measured live on all four combos

This is the reusable payoff of the run: both platforms expose the same test hooks, so the two page
objects can share one public API (the `iosNative`/`androidNative` parity convention).

> **Corrected 2026-07-29.** The first version of this table said the tab row was exposed on **iOS only**
> and had to be derived on Android from a y-band under the title. **That was wrong.** It came from the
> exploration script's heuristic, written before the run had actually reached the Perks List, and never
> revisited once the real ids were available. The captured Android dump
> (`evidence/android-en-09-perks-list.xml`) contains **`perks-tabs`, `perks-tab-1/2/60/61`,
> `perks-sections` and `perks-section-1/2/60/61`** — a fully id-addressable screen on both platforms.
>
> **This matters beyond tidiness:** the tab ids are the **section ids the dashboard holds**, so the tab set
> can be asserted against the admin API by id — no string matching, no dependence on the device locale.
> That is a materially stronger oracle for AC4/AC6/AC7 than the label text used in the manual pass.

| Element | Android (`resource-id`) | iOS (`name`) | Notes |
|---|---|---|---|
| Screen title | text `Card perks` / `مزايا البطاقة` | same | Also Pay home's section header — **do not** use it alone to tell the two screens apart (see §6) |
| Tab row container | **`perks-tabs`** | **`perks-tabs`** | Present on **both** platforms |
| **Tab pill** | **`perks-tab-<sectionId>`** | same | The id **is the dashboard's section id** → assert the tab set by id, locale-independently |
| Sections container | **`perks-sections`** | same | |
| **Section header** | **`perks-section-<sectionId>`** | same | Scope header lookups under `perks-sections` so a header is never confused with the same-named tab above it |
| Tab active state | — | — | **Visual only** (filled vs outlined pill); not in the tree, so AC3 stays a visual check |
| **Perk card** | **`perk-card-<perkId>`** | **`perk-card-<perkId>`** | e.g. `perk-card-CC_2`; `perkId` matches the admin API's `id` |
| Card accessibility label | `content-desc` = **`"<title>, <subheader>"`** | `label` = same | Single source for AC10 + AC11 assertions; an empty subheader yields a trailing comma |
| Card frame | `bounds` | `x,y,width,height` | **iOS reports true frames (171 × 198 pt); Android's are clipped by the viewport** — measure AC12 on iOS |

### Android-only settings (mandatory)
```java
// Breadfast Pay is Jetpack Compose and reports its nodes to UiAutomator2 as INVISIBLE.
// Without these the whole Pay content area collapses to one childless android.view.View.
driver.setSetting("allowInvisibleElements", true);
driver.setSetting("ignoreUnimportantViews", false);
```
**But** they come with a trap: off-screen nodes are then returned with a **real `x1,y1` and a
degenerate `x2,y2`** (`bounds="[48,2502][0,81]"`, `displayed="false"`). Any page object must reject
those before tapping — see `explore/nav.js → hasRealBounds()`.

## 4. Admin API endpoints used for data prep (verified live)

| Purpose | Endpoint (POST, base `https://card-panel-testing.breadfast.tech`) | Body |
|---|---|---|
| Login | `/api/v1/web/user/login` | `{username, password}` → 683-char JWT |
| List sections | `/api/v1/web/card/perks/section/list` | `{limit}` |
| Create section | `/api/v1/web/card/perks/section/create` | `{name_en, name_ar}` |
| Update section | `/api/v1/web/card/perks/section/update` | `{id, is_active}` |
| List perks | `/api/v1/web/card/perks/list` | `{limit}` |
| Update perk | `/api/v1/web/card/perks/update` | `{id, section_id, …}` |
| Customer-facing perks | `/api/v1/web/card/perks/listFiltered` | `{}` |

## 5. Why the Java class is deferred, and what remains

> **Corrected 2026-07-29.** The first version of this section justified the deferral on quality grounds
> ("writing page objects before the locator contract was measured would have baked in latent bugs").
> That sequencing argument is true but it is **not** the reason, and presenting it as one was
> self-serving. The honest reason is below. Root-cause analysis: `CLAUDE.md` §5.

**Reason: a prioritisation call, not a technical blocker.** Discovering the locator contract and the four
Appium/Compose traps genuinely had to come first, and it consumed real time. But by the end of execution
that contract *was* measured — and at that point I spent the remaining capacity on the test cases, the
BrowserStack import and the reports instead of on the Java code, then invoked `CLAUDE.md` §5's
*"(or deferred with reason)"* clause without asking the operator. Two process failures made that
possible and have since been fixed:

- **The phases were run out of order.** `automation-gen` is phase 4 and execution is phase 5; running
  execution first left automation competing with the write-ups for the tail of the run. Recording
  `execution` is now **blocked** while `automation` is missing or `partial` (`PHASE_DEPS` in `qa-cli.js`).
- **No story branch was ever created.** Both repos stayed on `2026/sprintQ3.3/B10-56652-…`. The
  framework's git hooks validate the branch **name on push** only, so they could not catch it.
  `qa-cli.js branch-check` now asserts both repos at Step 0.

The deferral is now **recorded and named** in `qa-state.json`
(`defer … --by "Ahmed Essam (operator)"`), which is the only route past the new gates.

**Remaining work — fully specified, no discovery left:**
1. `modals/customerApp/androidNative/AndroidNativePerksListScreen.java` and
   `modals/customerApp/iosNative/IosNativePerksListScreen.java` — identical public API:
   `openFromPayHome()`, `tabLabels()` (sweeping the row to both ends), `cards()` →
   `List<PerkCard>{perkId,title,subheader,frame}`, `tapTab(String)`, `tapCard(String perkId)`,
   `sectionHeadersInOrder()`. Locators from §3; page objects own the locators **and** the data
   (`java-framework-style`: test classes hold no private helpers).
2. `B10_56717_PerksListTests` — one `@Test` per automatable case, `description` = the **exact**
   BrowserStack case title, `@TmsLink` from the map below.
3. Story suite XML + `mvn test-compile` green before recording.
4. Wire the two new `ThreadLocal`s in `BaseTest` and **call `.set(...)`** — the exact omission that
   left a latent NPE on B10-56652.

**`@TmsLink` map for the automatable set** (full map in `../evidence/tms-map.json`):

| Test | `@TmsLink` | BrowserStack title (must match verbatim) |
|---|---|---|
| `perksListOpensWithTabRowAboveGrid` | `TC-54081` | TC01 title |
| `firstTabSelectedAndAllCategoriesStacked` | `TC-54082` | TC02 title |
| `tappingTabScrollsToCategoryWithoutFiltering` | `TC-54084` | TC04 title |
| `emptyCategoryHiddenFromTabRow` | `TC-54086` | TC06 title |
| `everyCardRendersCoverImage` | `TC-54088` | TC08 title |
| `subheaderMatchesSourcePerPerkType` | `TC-54091` | TC11 title |
| `cardTapOpensItsPerkDetails` | `TC-54093` | TC13 title |
| `payHomeCarouselUnaffected` | `TC-54097` | TC17 title |
| `fullListScrollsWithoutBlankOrDuplicateCards` | `TC-54098` | TC18 title |

Not automatable (visual/manual): TC03, TC05, TC07, TC09, TC10, TC12, TC14, TC15 — see
`testcases/testcases.md`.

## 6. Traps this run paid for — bake these into the page objects

1. **Compose invisibility settings are mandatory but poison the bounds** (§3). Reject degenerate bounds.
2. **"On screen" ≠ tappable.** The bottom tab bar overlays the last ~90 px; a row inside the screen but
   under the overlay is not tappable. On iOS the perks header landed at y=775 of 844 and the tap hit the
   **"More" tab** instead of "See all". Require a safe zone (`y < screenH − 110`).
3. **`Card perks` is on BOTH screens** — the list's title and Pay home's section header. Telling them
   apart by the Android-only `bottomBar_pay_btn` silently classified iOS Pay home as "list". Use a
   platform-neutral discriminator: **the wallet-balance block exists only on Pay home.**
4. **A leftover interstitial can make the whole tree `displayed="false"` and swallow every touch.**
   `back` clears it. Detect it by an **absolute count of on-screen non-chrome rows**, not a share — and
   exclude the bottom fifth of the screen, because the nav labels ("Home", "Pay", "More") carry no
   resource-id and otherwise count as content.
5. **Never conclude from one dump.** Off-screen nodes and a horizontally scrolled tab row both make
   present things look absent. The tab row must be swept to both ends before any claim about the tab set.

## 7. Files in this folder

| File | Purpose |
|---|---|
| `cases.js` | the 18 test cases — single source for the docs and the upload |
| `upload_browserstack.js` | Test Management API v2 upload + post-create verification |
| `ac7-round-trip.js` | AC7 dashboard→app round trip with snapshot / mutate / restore / **verify** |
| `explore/session.js` | BrowserStack session lifecycle per (platform, locale) |
| `explore/to-pay-home.js` | login → Pay home (adapted from B10-56652) |
| `explore/goto-list.js` | Pay home → Perks List, safe-zone aware, idempotent |
| `explore/probe-list.js` | structured probe: tabs, cards, row pairs, interactivity guard |
| `explore/test-interactions.js` | AC5 (scroll-not-filter) and AC13 (card → details) |
| `explore/nav.js` | scroll/swipe/tap primitives + the bounds-sanity rules |
| `explore/drive.js`, `keypad.js`, `otp.js` | copied unchanged from B10-56652 |
