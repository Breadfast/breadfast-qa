# B10-57393 — Automation

> **The generated Selenium automation lives in the Java framework, not here.** This folder holds the
> story-specific tooling: the reuse map ([framework-reference.md](framework-reference.md)), the
> test-case source of truth, the BrowserStack uploader, the parity check, and the execution probes
> used to gather evidence. Contract: [automation-generation.md](../../docs/ai/automation/automation-generation.md) §8.
>
> **It also holds a second, parallel Playwright suite** in [`tests/`](tests/) covering the same
> approved case set. That is deliberate and specific to this story: it exists to answer
> "Selenium or Playwright?" with measurements rather than opinion, and to reach the one case Selenium
> structurally cannot (TC-53972, which needs the save request forced to fail). The head-to-head
> result and the tooling recommendation are in
> [`../execution-reports/stack-comparison.md`](../execution-reports/stack-comparison.md).
> **Dual-maintaining both suites is not the standing pattern** — see that report §7.

## Where the code is

| Artifact | Path (in `D:\projects`) | Status |
|---|---|---|
| Story test class | `src/test/java/cardService/adminPanel/B10_57393_AppPreviewModalTests.java` | **new** — 20 tests |
| Modal page object | `src/main/java/modals/cardsAdminPanel/AppPreviewModal.java` | **new** |
| Create-perk form completion | `src/main/java/modals/cardsAdminPanel/PerksPage.java` | **extended** (see reuse map) |
| Page-object wiring | `src/test/java/base/BaseTest.java` | **extended** — `webCardPanelAppPreviewModal` |
| Story suite | `b10-57393-tests.xml` | **new** |

| | |
|---|---|
| Framework branch | **`2026/sprintQ3.3/B10-57393-mobile-app-preview-for-perk-creation`** (the convention the git hooks enforce: `<year>/sprintQ<n>.<n>/<name>`; never on `main`) |
| Compile gate | `mvn test-compile` → **BUILD SUCCESS** (exit 0), JDK 25 |
| Title parity | `node check_test_name_parity.js` → **PARITY OK**, 20/22 automated |

## Run commands

```bash
cd D:\projects
git checkout 2026/sprintQ3.3/B10-57393-mobile-app-preview-for-perk-creation

# whole story suite
mvn test -DsuiteXmlFile=b10-57393-tests.xml

# one test
mvn test -Dtest=B10_57393_AppPreviewModalTests#verifyTilePreviewShowsOnlyOwnCategoryAndTile

# by group
mvn test -Dgroups=B10-57393
```

> Maven is not on `PATH` in this environment; it resolves from the wrapper dist at
> `C:\Users\Breadfast\.m2\wrapper\dists\apache-maven-3.6.3-bin\…\bin\mvn.cmd`, and the project
> targets **release 25**, so `JAVA_HOME` must point at `C:\Program Files\Java\jdk-25.0.3`
> (jdk-20 fails with `invalid target release: 25`).

## BrowserStack traceability

Project **PR-5 "BCard Squad"** · folder **53134541** "Mobile App Preview for Perk Creation in Admin Portal"
(under `53115562` Card Core_Sprint3.3) · [open folder](https://test-management.browserstack.com/projects/2407303/folder/53134541/test-cases)

| Case | Title | Automated by | Result |
|---|---|---|---|
| TC-53953 | Preview & save opens the App preview modal | `verifyPreviewAndSaveOpensAppPreviewModal` | ✅ Pass |
| TC-53954 | Modal renders tile view + detail screen | `verifyModalRendersTileViewAndDetailScreen` | ✅ Pass |
| TC-53955 | Device frame measures 375 x 812 | `verifyDeviceFrameMeasures375By812` | ❌ **Fail — DEF-2** |
| TC-53956 | Scrolling reveals remaining detail content | `verifyScrollingInsideDeviceFrameRevealsRemainingContent` | ✅ Pass |
| TC-53957 | Section header expands/collapses | `verifySectionHeaderExpandsAndCollapses` | ❌ **Fail — DEF-1** |
| TC-53958 | Tile shows only own category + tile | `verifyTilePreviewShowsOnlyOwnCategoryAndTile` | ✅ Pass |
| TC-53959 | Arabic preview renders Arabic + RTL | `verifyArabicPreviewLanguageRendersArabicRtl` | ✅ Pass |
| TC-53960 | English preview restores English + LTR | `verifyEnglishPreviewLanguageRestoresEnglishLtr` | ✅ Pass |
| TC-53961 | Modal opens with English pre-selected | `verifyModalOpensWithEnglishPreSelected` | ✅ Pass |
| TC-53962 | Save creates the perk and it is listed | `verifySaveCreatesThePerkAndItAppearsInTheList` | ✅ Pass |
| TC-53963 | Cancel closes without saving | `verifyCancelClosesModalWithoutSaving` | ✅ Pass |
| TC-53964 | Invalid form blocks the preview | `verifyInvalidFormBlocksThePreview` | ✅ Pass |
| TC-53965 | Every entered field renders in place | `verifyEveryEnteredFieldRendersInThePreview` | ✅ Pass |
| TC-53966 | Coupon code section + chip (Discount/coupon) | `verifyCouponCodeSectionRendersForDiscountCouponPerk` | ✅ Pass |
| TC-53967 | Cover image + logo render in both views | `verifyCoverImageAndLogoRenderInBothViews` | ✅ Pass |
| TC-53968 | X-icon close restores the page cleanly | `verifyClosingWithXIconRestoresThePageCleanly` | ✅ Pass |
| TC-53969 | Preview reflects form values at open time | `verifyPreviewReflectsFormValuesAtOpenTime` | ✅ Pass |
| TC-53970 | Max-length content doesn't break the preview | `verifyMaxLengthContentDoesNotBreakThePreview` | ✅ Pass |
| TC-53971 | Empty optional sections omitted | `verifyEmptyOptionalSectionsAreOmitted` | ✅ Pass |
| TC-53972 | Failed save keeps modal open + shows error | **not automated** | ⚠️ **Fail (manual) — DEF-3** |
| TC-53973 | Create-perk form + publish not regressed | `verifyCreatePerkFormAndPublishFlowAreNotRegressed` | ✅ Pass |
| TC-53974 | Visual fidelity vs Figma (EN + AR) | **not automated** | ⚠️ Pass with VIS-1 |

**Why two cases aren't automated**
- **TC-53972** needs the perk-creation request forced to fail. Selenium/BrowserStack here has no
  request-interception hook, so it is covered manually via the Playwright probe
  (`preview_modal_edge.js --savefail`, which fulfils the route with a `500`).
- **TC-53974** is a comparison against exported Figma baselines, i.e. a design judgement, not a DOM
  assertion. Covered by [`visual-findings.md`](../execution-reports/visual-findings.md).

The two failing automated tests are **intentional** — their assertions target the AC, so they fail
until DEF-1 / DEF-2 are fixed. They are marked `[DEFECT-EXPECTED]` in the source.

## The parallel Playwright suite

| Artifact | Path | Notes |
|---|---|---|
| Core spec (20 cases) | [`tests/app_preview_modal.spec.js`](tests/app_preview_modal.spec.js) | one `test()` per case, title = BrowserStack name verbatim |
| Save-failure spec (TC-53972) | [`tests/app_preview_save_failure.spec.js`](tests/app_preview_save_failure.spec.js) | own file because it is the case Selenium cannot automate — `page.route` fulfils the perk POST with a `500` |
| Runner | [`playwright.config.js`](playwright.config.js) | `retries: 1` to match the framework's `RetryAnalyzer`; screenshot on every test, video + trace on failure |
| Page objects | `../../automation/pages/{PerksPage,AppPreviewModal,LoginPage}.js` | shared across stories; single in-repo copy, no mirror (2026-08-10) |
| Stack comparison | [`compare_stacks.js`](compare_stacks.js) | joins TestNG XML and the Playwright JSON on the case NAME; `--md` for the table |

```bash
# from the repo root (D:\breadfast-qa)
npx playwright test --config=B10-57393/automation/playwright.config.js
npx playwright test --config=B10-57393/automation/playwright.config.js -g "device frame"
node B10-57393/automation/compare_stacks.js --md
```

Coverage: **21/22** (Selenium 20/22). Neither automates TC-53974 — visual fidelity is a Phase 5
design judgement, not a DOM assertion.

## Story tooling in this folder

| File | Purpose |
|---|---|
| `gen_browserstack_csv.js` | **Test-case source of truth** — 22 cases / 164 steps. `--csv` emits the BrowserStack CSV; feeds the uploader so CSV and upload can't drift. |
| `upload_browserstack.js` | Uploads to PR-5/53134541 via Test Management **API v2**. `--dry`, `--verify`. Writes `browserstack_case_map.json`. |
| `browserstack_case_map.json` | id ↔ title map (TC-53953…TC-53974) — the `@TmsLink` binding source. |
| `check_test_name_parity.js` | Offline guard: every `@Test(description)` must equal its BrowserStack title verbatim. Run before any suite. |
| `preview_modal_probe.js` | Execution harness — login → fill → open modal, then all AC1–AC7 probes + screenshots. |
| `preview_modal_edge.js` | Edge/negative probes: `--empty --long --xclose --reopen --savefail --coupon`. |

```bash
node gen_browserstack_csv.js --csv > ../testcases/B10-57393_browserstack_testcases.csv
node upload_browserstack.js --verify
node check_test_name_parity.js
node preview_modal_probe.js            # add --save or --cancel
node preview_modal_edge.js --coupon
```

## BrowserStack API traps re-confirmed on this story
- Cases are **created** at `POST /projects/{p}/folders/{id}/test-cases` but **listed** at
  `GET /projects/{p}/test-cases?folder_id={id}` — a GET on the create path returns
  `404 "You have stumbled on an invalid endpoint"`. This is why the first `--verify` reported 0 cases.
- Steps must go in **`test_case_steps`**; a `steps` payload returns `200` and drops them silently.
  The POST response does **not** echo step counts, so `--verify` re-reads the folder: all 22 cases
  came back with the exact step counts the generator produced.
