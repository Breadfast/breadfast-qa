# Automation — B10-56717 · Perks List Screen Redesign

Generator `automation-gen@1.0` · 2026-07-29. Reuse map, locator contract and the deferral rationale are
in [`framework-reference.md`](framework-reference.md). This file is **how to run things**.

## Run commands

```bash
# --- test cases -------------------------------------------------------------
cd D:\breadfast-qa\B10-56717\automation
node cases.js                       # 18 cases, 194 steps — print the inventory
node upload_browserstack.js --dry   # inspect the API v2 payload
node upload_browserstack.js         # live upload to PR-5 / folder 53347724 + verify

# --- drive a combo end to end ----------------------------------------------
cd explore
node session.js open  android en    # create (or reuse) the session
node to-pay-home.js  android en     # login -> Pay home  (~3 min: OTP + passcode + Pay OTP)
node goto-list.js    android en     # Pay home -> Perks List (idempotent)
node probe-list.js   android en     # tabs + cards + row pairs -> evidence/<tag>-list-probe.json
node test-interactions.js android en# AC5 (scroll-not-filter) + AC13 (card -> details)
node session.js close android en

# combos: {android|ios} x {en|ar}

# --- run the generated Java suite -----------------------------------------
cd D:\projects
mvn -o test -Dsurefire.suiteXmlFiles=b10-56717-tests.xml              # both platforms
mvn -o test -Dsurefire.suiteXmlFiles=b10-56717-android-only.xml       # Android, one test (bring-up)

# --- AC7 dashboard round trip (mutates data — restore is mandatory) --------
cd ..
node ac7-round-trip.js state        # current sections-with-active-perks
node ac7-round-trip.js prep         # snapshot + create probe section + move one perk
#   ... relaunch the app, re-open the Perks List, sweep the tab row ...
node ac7-round-trip.js restore      # put it back and DIFF against perks-baseline.json
```

**`restore` is not optional.** It writes `evidence/restore-verification.json`; the run is only clean
when `diffVsBaseline` is `0`. It was, on this run.

## BrowserStack traceability

Project **PR-5** ("BCard Squad", numeric `2407303`) · folder **53347724** ("Perks List - Screen
Redesign") · **18/18 cases uploaded, 194/194 steps verified, priorities correct, no nested folder.**
<https://test-management.browserstack.com/projects/2407303/folder/53347724/test-cases>

| Case | TMS | Automatable | Case | TMS | Automatable |
|---|---|---|---|---|---|
| TC01 | `TC-54081` | ✅ | TC10 | `TC-54090` | visual |
| TC02 | `TC-54082` | ✅ | TC11 | `TC-54091` | ✅ |
| TC03 | `TC-54083` | visual | TC12 | `TC-54092` | visual (measured) |
| TC04 | `TC-54084` | ✅ | TC13 | `TC-54093` | ✅ |
| TC05 | `TC-54085` | visual | TC14 | `TC-54094` | visual (RTL) |
| TC06 | `TC-54086` | ✅ | TC15 | `TC-54095` | visual (RTL) |
| TC07 | `TC-54087` | cross-surface | TC16 | `TC-54096` | visual |
| TC08 | `TC-54088` | ✅ | TC17 | `TC-54097` | ✅ |
| TC09 | `TC-54089` | visual | TC18 | `TC-54098` | ✅ |

Every automated test's title must be the **exact** BrowserStack case name, verbatim, so results map by
name (`CLAUDE.md` §8). Verify offline with `check_test_name_parity.js` before running a suite.

## Environment

| Item | Value |
|---|---|
| iOS build | `bs://30248a9811450c98323ef9860d13a287231109ac` — iPhone 14 / iOS 18 / XCUITest |
| Android build | `bs://12bf2be529be6c73bc0dff9d208d139a3aaacebf` — Samsung Galaxy S23 / Android 13 / UiAutomator2 |
| App id | `com.breadfast.testing` |
| Account | `01064507660` · passcode `123321` · Pay OTP = last 4 digits (`7660`) |
| Login OTP | Google Chat space `AAQASQDvAnA` (`explore/otp.js`) — **not** Slack for this environment |
| Admin panel | `https://card-panel-testing.breadfast.tech` · `agent` / `Admin@123456789` |
| Arabic caps | `appium:language: ar`, `appium:locale: EG` — **top level**, never inside `bstack:options` |

## Gotchas that will cost you an hour if you skip them

0. **`-DsuiteXmlFile=` (singular) does NOT work — it silently runs EVERYTHING.** It is not a surefire
   property, and `pom.xml` hard-codes **nine** `<suiteXmlFile>` entries, so that form executes the whole
   regression estate (testng · sanity · stress · fintech · supplychain · fleet · referrals · mobile ·
   pricing) in parallel instead of your suite. Found 2026-07-29, when a "single test" invocation spent ten
   minutes creating stress-test orders and swept up B10-56652's and B10-57393's suites as collateral —
   which is also the likely explanation for B10-56652's recorded "5 of 9 failures". The real override is
   **`-Dsurefire.suiteXmlFiles=`** (plural). Corrected in both stories' docs and suite XMLs.

1. **Android needs `allowInvisibleElements=true` + `ignoreUnimportantViews=false`** (set automatically by
   `session.js`) or the Pay surface reports one childless `android.view.View`. The cost: off-screen nodes
   come back with **junk `x2,y2`** — never tap without `nav.hasRealBounds()`.
2. **A leftover "Save card for a faster checkout" sheet swallows every touch** and is invisible in a
   screenshot. `probe.ensureInteractive()` presses `back` to clear it. Symptom: gestures return success
   while nothing on screen ever changes.
3. **`to-pay-home.js` can overshoot into the card-application/FAQ screen** on both platforms when its
   blind "Not now" tap misses. Dismiss with the **X**: Android `(1010, 145)`; iOS `(17, 55)` in EN and
   `(373, 55)` in AR (mirrored).
4. **Measure card geometry on iOS, not Android** — Android clips `bounds` to the viewport, iOS reports
   true frames (`171 × 198` pt here).
5. **Sweep the tab row to both ends** before saying a category is absent. `new section` was missing from
   the first dump purely because it sat off-screen.
6. Sessions expire quietly. `session.js id <platform> <locale>` prints liveness; a dead session makes
   `getSource` return an object instead of XML.
