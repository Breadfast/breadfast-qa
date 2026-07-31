# B10-56711 — Perk Details Screen Redesign · automation

**Surface:** Breadfast Pay → Card perks → **Perk Details** (mobile, iOS + Android)
**Generated automation lives in the Java framework** (`D:\projects`), not here — single source, never copied.
This folder holds the story-specific glue: the canonical test cases, the BrowserStack uploader, the offline
parity guard, the conformance review, the reuse map, and the exploration driver.

## Files

| File | Purpose |
|---|---|
| [`cases.js`](cases.js) | **Canonical test cases** — 23 cases / 281 steps. Single source of truth for the uploader *and* the traceability table below. |
| [`upload_browserstack.js`](upload_browserstack.js) | Uploads them via Test Management **API v2** into `PR-5` / folder `53434687`. `--dry` first. |
| [`check_test_name_parity.js`](check_test_name_parity.js) | **Offline guard** — every case name must appear verbatim as an automated test title, or be declared manual. Runs with no device and no backend. |
| [`conformance-review.md`](conformance-review.md) | Phase 4b gate. Verdict **PASS** after four self-caught corrections. |
| [`framework-reference.md`](framework-reference.md) | Reuse map: what was reused, what was added, and why. |
| [`explore/`](explore/) | Session driver used for exploration and the manual AC sweep. |

## Run commands

```bash
# offline, no environment needed
node automation/check_test_name_parity.js

# test-case upload (idempotency is NOT guaranteed — check the folder count first)
node automation/upload_browserstack.js --dry
node automation/upload_browserstack.js

# automation, from the framework root D:\projects
mvn -o test-compile                                        # static gate
mvn -o test -Dsurefire.suiteXmlFiles=b10-56711-tests.xml   # both platforms
```

> **`-DsuiteXmlFile=` (singular) is silently ignored** — the pom hard-codes nine suite entries, so that
> form runs the entire regression estate. Use **`-Dsurefire.suiteXmlFiles=`** (plural). ([[mvn-suite-override]])

```bash
# manual/exploratory sweep of the 13 ACs on one combo
cd B10-56711/automation/explore
NODE_PATH=D:/breadfast-qa/node_modules node run-acs.js android en
NODE_PATH=D:/breadfast-qa/node_modules node to-perk-details.js ios ar
```

## Framework assets

| Asset | Path in `D:\projects` |
|---|---|
| Android page object | `src/main/java/modals/customerApp/androidNative/androidNativePayScreen/AndroidNativeCardPerkDetailsScreen.java` |
| iOS page object | `src/main/java/modals/customerApp/iosNative/iosNativePayScreen/IosNativeCardPerkDetailsScreen.java` |
| Android tests | `src/test/java/customerApp/androidNative/payHome/B10_56711_PerkDetailsTests.java` |
| iOS tests | `src/test/java/customerApp/iosNative/payHome/B10_56711_PerkDetailsTests.java` |
| Suite | `b10-56711-tests.xml` |
| Oracle client (extended) | `src/main/java/helpers/apiClients/webApiClients/CardAdminPanelPerksApiClient.java` |

## Locators (read live off the Android build)

`perk-details-screen` · `perk-details-back-btn` · `coupon-code-card` · `coupon-code-copy-btn` ·
`perk-details-usage-card` · `branches-card` · `branches-toggle-btn` · `perk-details-cashback-card` ·
`perk-details-expiry-card`

⚠ **iOS ids are mirrored from Android, not yet observed** — the card backend returned `502` before an iOS
session could be captured. Confirm against a live iOS session before treating an iOS failure as a defect.

⚠ **Android requires `allowInvisibleElements: true` + `ignoreUnimportantViews: false`**, re-asserted **after**
navigation. The Pay area is Jetpack Compose and its node tree populates non-deterministically — identical
consecutive runs exposed 25 nodes then 10. ([[android-compose-invisible-nodes]])

## BrowserStack traceability

Project **PR-5 (BCard Squad)** · folder **53434687** *"Perk Details - Screen Redesign"* · 23 cases,
verified 23/23 (steps + priority).

| Case | BrowserStack | AC | HLS | Pri | Automated | Test method |
|---|---|---|---|---|---|---|
| TC-01 | TC-54242 | — | 1 | High | ✅ | `verifyPerkDetailsOpensForTheExactPerkTapped` |
| TC-02 | TC-54243 | AC1 | 2 | Med | ❌ visual | *absence of a second background border — Figma-vs-build* |
| TC-03 | TC-54244 | AC2 | 3 | Med | ❌ visual | *logo circularity + overlap are geometric* |
| TC-04 | TC-54245 | AC3 | 4 | Med | ❌ visual | *title/tagline vertical position; Android clips bounds* |
| TC-05 | TC-54246 | AC3 | 4 | Med | ❌ visual | *absent-tagline layout collapse* |
| TC-06 | TC-54247 | AC4 | 5 | High | ✅ | `verifyDetailsSectionIsComposedOfDistinctLabelledCards` |
| TC-07 | TC-54248 | AC5 | 6 | High | ✅ | `verifyDetailCardsAppearInTheMandatedOrder` |
| TC-08 | TC-54249 | AC5 | 7 | High | ✅ | `verifyMandatedOrderIsPreservedWhenAConditionalCardIsHidden` |
| TC-09 | TC-54250 | AC6 | 8 | High | ❌ manual | *clipboard needs a paste target outside the app* |
| TC-10 | TC-54251 | AC7 | 9 | High | ✅ | `verifyCopiedConfirmationShowsForThreeSecondsThenTheCodeReturns` |
| TC-11 | TC-54252 | AC8 | 10 | High | ✅ | `verifyPhysicalCouponCodeIsHiddenBehindAViewCtaThatOpensABottomSheet` |
| TC-12 | TC-54253 | AC8 | 11 | High | ✅ | `verifyBottomSheetCloseReturnsToPerkDetailsUnchanged` |
| TC-13 | TC-54254 | AC9 | 12 | Med | ✅ | `verifyUsageCardDisplaysTheDashboardUsageDescription` |
| TC-14 | TC-54255 | AC10 | 13 | Med | ✅ | `verifyExpiryCardDisplaysTheValidityDescriptionVerbatim` |
| TC-15 | TC-54256 | AC10 | 14 | Med | ✅ | `verifyPerkWithNoValidityDescriptionShowsNoExpiryValue` |
| TC-16 | TC-54257 | AC11 | 15 | Med | ✅ | `verifyBranchesCardIsDisplayedWhenBranchesAreConfigured` |
| TC-17 | TC-54258 | AC11 | 16 | Med | ✅ | `verifyBranchesCardIsHiddenWhenNoBranchesAreConfigured` |
| TC-18 | TC-54259 | AC12 | 17 | High | ✅ | `verifyBranchesTruncateToThreeLinesWithSeeMoreThatExpands` |
| TC-19 | TC-54260 | AC12 | 17 | High | ✅ | `verifySeeLessCollapsesTheBranchesSectionBackToThreeLines` |
| TC-20 | TC-54261 | AC12 | 18 | Med | ✅ | `verifyPerkWithExactlyThreeBranchLinesHasNoSeeMoreControl` |
| TC-21 | TC-54262 | AC13 | 19 | Med | ✅ | `verifyCashbackProcessingCardIsDisplayedWhenConfigured` |
| TC-22 | TC-54263 | AC13 | 19 | Med | ✅ | `verifyCashbackProcessingCardIsHiddenWhenNotConfigured` |
| TC-23 | TC-54264 | AC1–13 | 20 | High | ❌ manual | *ar/EG RTL mirroring + per-locale artwork* |

**17 automated · 6 declared manual · 0 undeclared gaps** (`check_test_name_parity.js` → `PARITY OK`).

## Fixtures — discovered by shape, never named

The tests never name a perk. `CardAdminPanelPerksApiClient` finds one by the shape the AC needs, so the
suite survives someone editing any individual perk:

| Need | Finder |
|---|---|
| online coupon code | `findActivePerkWithCouponType(jwt, "online")` |
| physical coupon code | `findActivePerkWithCouponType(jwt, "physical")` |
| > 3 branch lines | `findActivePerkWithMoreThanThreeBranchLines(jwt, "en")` |
| exactly 3 branch lines | `getAuthoredBranchLineCount(...) == 3` over the active set |
| card must be hidden | `findActivePerkWithoutAttribute(jwt, "<field>_en")` |

The environment's current fixtures (2026-07-30 snapshot, [`../evidence/perks-baseline.json`](../evidence/perks-baseline.json)):
**DC_17** online + 16 branch lines · **DC_16** physical + 2 lines · **GC_56** no branches ·
**DC_8** exactly 3 lines, no cashback, no expiry.

## Status

| Item | State |
|---|---|
| Test cases | ✅ 23, uploaded and verified |
| Page objects + test classes | ✅ generated, `mvn -o test-compile` **BUILD SUCCESS** |
| Conformance gate | ✅ **PASS** (4 corrections, see the review) |
| Name parity | ✅ **PARITY OK** |
| **Execution** | ⛔ **not run** — the testing card backend returns `502` (`card-panel-testing.breadfast.tech`, sustained across 4 probes; the app's Pay tab shows *"Something went wrong"*). Awaiting environment restore. |
