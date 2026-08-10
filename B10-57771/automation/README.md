# Automation — B10-57771 · Admin Portal: Duplicate Perk Action

Generated code lives in the **canonical Java framework** (`D:\projects`), not here.
This folder holds only the story-specific tooling and the traceability record.

## Where the code is
| Artifact | Path (in `D:\projects`) |
|---|---|
| Story test class | `src/test/java/cardService/adminPanel/B10_57771_DuplicatePerkTests.java` |
| Page object (extended) | `src/main/java/modals/cardsAdminPanel/PerksPage.java` |
| Suite | `b10-57771-tests.xml` |

## Run
```powershell
cd D:\projects
mvn test "-Dsurefire.suiteXmlFiles=b10-57771-tests.xml"
```
> `-DsuiteXmlFile=` (singular) is **ignored** by this pom and runs all nine suites. Use
> `-Dsurefire.suiteXmlFiles=`. There is no `mvn` on PATH — use IntelliJ's bundled copy at
> `C:\Program Files\JetBrains\IntelliJ IDEA Community Edition 2023.2.4\plugins\maven\lib\maven3\bin\mvn.cmd`.

## Story tooling in this folder
| Script | Purpose |
|---|---|
| `gen_browserstack_csv.js` | emits the 23-case import CSV → `../testcases/` |
| `upload_browserstack.js` | creates project/folder and uploads the cases, then **reads every case back** to verify its step count |
| `check_tmslink_parity.js` | offline gate: each `@Test(description)` equals its BrowserStack case name, and no `@TmsLink` id is reused |
| `explore/` | the live probes that produced every locator and the ground-truth read of the deployed bundle |

## BrowserStack traceability
**Project `PR-66` — "B10-57771 Duplicate Perk Action" · folder `54175826` — "Duplicate Perk Action" · 23 cases**

| Case | Title (abridged) | Automated | Java test |
|---|---|---|---|
| TC-54743 | row actions menu shows View, Duplicate, Delete in order | ✅ | `verifyRowActionsMenuShowsViewDuplicateDeleteInOrder` |
| TC-54744 | Duplicate offered in every lifecycle state | ✅ | `verifyDuplicateIsOfferedForEveryPerkLifecycleState` |
| TC-54745 | Delete enabled only for planned perks | ✅ | `verifyDeleteRemainsEnabledOnlyForPlannedPerks` |
| TC-54746 | View still opens the perk details page | ✅ | `verifyViewRowActionStillOpensThePerkDetailsPage` |
| TC-54747 | Duplicate opens the full form, creates nothing | ✅ | `verifyDuplicateOpensTheFullCreatePerkFormWithoutCreatingAPerk` |
| TC-54748 | text fields pre-filled verbatim EN + AR | ✅ | `verifyDuplicatedFormPreFillsTextFieldsVerbatimInBothLanguages` |
| TC-54749 | type, section, merchant, funding pre-filled | ✅ | `verifyDuplicatedFormPreFillsTypeSectionMerchantAndFundingType` |
| TC-54750 | all four images pre-filled | ✅ | `verifyDuplicatedFormPreFillsAllFourSourcePerkImages` |
| TC-54751 | validity date range copied | ✅ | `verifyDuplicatedFormCopiesTheSourceValidityDateRange` |
| TC-54752 | coupon code cleared + required | ✅ | `verifyCouponCodeIsClearedAndRequiredOnTheDuplicatedForm` |
| TC-54753 | type-conditional pre-fill — discount/coupon | ✅ | `verifyTypeConditionalSectionsPreFillForADiscountCouponPerk` |
| **TC-54754** | type-conditional pre-fill — merchant cashback | ⚠️ **manual** | — (reason in `framework-reference.md` §4) |
| TC-54755 | type-conditional pre-fill — general spend cashback | ✅ | `verifyTypeConditionalSectionsPreFillForAGeneralSpendCashbackPerk` |
| TC-54756 | save creates a new record with a new perk id | ✅ | `verifySavingADuplicateCreatesANewRecordWithANewPerkId` |
| TC-54757 | source perk unchanged after save | ✅ | `verifyTheSourcePerkIsUnchangedAfterItsDuplicateIsSaved` |
| TC-54758 | duplicate stored with its own image assets | ✅ | `verifyTheDuplicatedPerkIsStoredWithItsOwnImageAssets` |
| **TC-54759** | duplicate images survive source deletion | ⚠️ **manual** | — (destructive; run once with evidence) |
| TC-54760 | field parity source ↔ duplicate via the API | ✅ | `verifyTheDuplicatedPerkFieldValuesMatchTheSourceInTheApi` |
| TC-54761 | standard Add Perk validation applies | ✅ | `verifyTheDuplicatedFormAppliesTheStandardAddPerkValidation` |
| TC-54762 | leaving without saving creates no perk | ✅ | `verifyLeavingTheDuplicateFormWithoutSavingCreatesNoPerk` |
| TC-54763 | preview Cancel abandons the duplicate | ✅ | `verifyThePreviewDialogCancelAbandonsTheDuplicate` |
| TC-54764 | Add Perk from scratch unaffected | ✅ | `verifyTheAddPerkFlowIsUnaffectedAfterADuplicateIsOpened` |
| TC-54765 | perks list renders correctly after a duplicate | ✅ | `verifyThePerksListRendersCorrectlyAfterADuplicateIsCreated` |

**21 of 23 automated · 2 manual (stated, not silent).**

> **AC4 has no test case and no automated test — on purpose.** The perk model exposes no
> `featured` attribute anywhere on this surface, so there is nothing to assert. It is reported as
> **Not Verifiable** in the QA summary and raised with product, rather than being automated against
> an invented oracle or filed as a bug.

## Test data
Seeded 2026-08-09 via `POST /api/v1/web/card/perks/create`:
`DC_29` active discount-coupon · `DC_30` planned · `DC_31` expired · `GC_63` general-cashback ·
`MC_74` merchant-cashback (pre-existing). Create-API gotchas: `title_en` max ~20 chars;
`discount-coupon` needs `merchant_id`; `general-cashback` needs `subheader_en` **and**
`usage_description_en`.

**No teardown.** A saved perk can only be deleted while it is *Planned*, so the perks the suite
creates are permanent — each full run adds one row per creating test.
