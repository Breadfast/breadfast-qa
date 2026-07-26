# B10-56729 — Acceptance Criteria Coverage Matrix

Story: **Admin Portal Create Perk — Form Enhancements** · Platform: Web (Card Admin Panel) · Locales: EN + AR
Automation: Playwright (`b55168_pom`), shared `automation/pages/PerksPage.js` · Live runs: **2026-07-14** (baseline),
**2026-07-20** (re-verification — see below) · Chromium
Result legend: ✅ pass · ❌ fail (product defect) · ⚠️ partial / manual-assist

## Re-verification — 2026-07-20
Re-ran the full 27-test suite live (3 consecutive runs incl. one after a transient DNS blip cleared —
deterministic, not flaky). **AC3/AC7/AC9/AC11 (DEF-1, the old char-cap failures) are now CONFIRMED FALSE
POSITIVES and PASS**: the caps ARE enforced, but via an inline "Maximum length should be N characters."
validation error + invalid state, not by truncating input at the DOM level — the original assertions
checked the wrong enforcement mechanism. Fixed in `PerksPage.checkMaxLengthValidation()` + the 4 specs;
see "Fixed this run" below.

**New finding — DEF-3 (High/P1):** AC15 and AC17 now FAIL for a different, confirmed-live reason: the
"Funding" section does not render for ANY perk type (General, Category, Merchant cashback, Discount/
Coupon), contradicting Figma (`Discount/coupon benefit - Filled.png` explicitly shows it). This
contradicts the 2026-07-14 baseline below, which recorded Funding as present on Merchant cashback and
Discount/Coupon — see `defects/defects.md` DEF-3 for the full analysis and the regression-vs-stale-result
open question for dev. **This is a product defect; the automation assertion was NOT weakened.**
Current totals: **27 automated tests · 25 passed · 2 failed (both DEF-3).**

| AC | Requirement | Automated test(s) | Visual validation source | Result |
|----|-------------|-------------------|--------------------------|--------|
| AC1 | Page title "Create perk" (sentence case) | `labels_and_title` › AC1 | Figma `Header` / all Create frames | ✅ |
| AC2 | Section headings & labels sentence case | `labels_and_title` › AC2 (headings present) | Figma per-type forms | ✅ *(see note 1 — case inconsistency risk)* |
| AC3 | Perk title cap **20** (EN + AR) | `labels_and_title` › TC3 EN, TC4 AR | Figma "(20 characters max.)" | ✅ *(2026-07-20: DEF-1 was a false positive — cap enforced via validation error, not truncation; see note 4)* |
| AC4 | Perk icon changed in sidebar | `image_specs_and_icon` › AC4 (nav+icon present) | — no Figma sidebar frame | ⚠️ presence ✅ / glyph = manual |
| AC5 | Logo & cover photo specs/ratios enforced | `image_specs_and_icon` › AC5 (reject wrong, accept 1080×1080) | Figma upload modals (1080²/500KB, 240×180/40KB) | ✅ *(see note 2 — ratio contradiction)* |
| AC6 | Required "Section" dropdown, all perk types | `basic_details_section` › AC6 ×4 types + options | Figma `Add section drop down`, Section dropdown | ✅ |
| AC7 | Perk subheader EN/AR (30): always for General, only for Breadfast merchant on coupon/merchant | `basic_details_section` › TC9 shown-for-General ✅ ; TC10 cap-30 ✅ | Figma `Breadfast as a merchant`, `General Cash Back` | ⚠️ visibility ✅ / cap ✅ *(note 4)* / auto-fill = deferred (note 3) |
| AC8 | Logo labels "Logo EN/AR" (was "Logo/Image") | `labels_and_title` › AC8 (+ old naming absent) | Figma upload sections | ✅ |
| AC9 | Required "Usage" section, Short usage description EN/AR (200) | `new_sections` › TC12 present ✅ ; TC12 char-cap ✅ | Figma all-type forms | ✅ *(note 4)* |
| AC10 | Optional "Branches" for Merchant cashback & Discount/coupon | `new_sections` › TC13 shown-for-coupon ✅ , not-for-General ✅ | Figma `Merchant cashback`, coupon frames | ✅ |
| AC11 | Optional "Cashback processing" (45) for cashback types | `new_sections` › TC14 present ✅ ; TC14 char-cap ✅ | Figma forms | ✅ *(note 4)* |
| AC12 | "Usage Frequency"/"other" removed | `restructuring_and_coupon` › TC15 | Figma current forms (absent) | ✅ |
| AC13 | "Cash Back Limit" → "Cashback limit" | `restructuring_and_coupon` › TC16 (+ old absent) | Figma Cashback limit | ✅ *(see note 1)* |
| AC14 | "Other" → "Exclusions" (General Spend Cashback) | `restructuring_and_coupon` › TC17 | Figma `General Cash Back` | ✅ |
| AC15 | "Funding Type" inline → "Funding" section header | `restructuring_and_coupon` › TC18 (+ funding select) | Figma merchant/coupon Funding | ❌ **DEF-3** (2026-07-20: Funding section absent for every perk type) |
| AC16 | Coupon type (Online/Physical) appears on coupon-code entry | `restructuring_and_coupon` › TC19 (hidden→shown, both options, select) | Figma `coupon benefit - Filled` | ✅ |
| AC17 | Section order for cashback types (Discount/Coupon) | `restructuring_and_coupon` › TC20 (Basic details + h4 sequence) | Figma coupon form stack | ❌ **DEF-3** (order stops at Duration, no Funding) |
| AC18 | Preview shows all new sections/fields | `preview` › TC21 (title, subheader, usage rendered) | Figma `Preview` / `App preview` | ✅ *(General cashback; merchant/category auto-fill variants = deferred, note 3)* |
| Comment override | Auto-filled subheader (merchant/category name) shown on Preview | — | Figma (not visibly rendered) | ⚠️ deferred (note 3) |

## Execution totals (live 2026-07-14)
- **26 automated tests · 22 passed · 4 failed.** All 4 failures = the single product defect **DEF-1** (client-side
  character-limit not enforced on title/subheader/usage/cashback-processing). No test-infrastructure failures remain.
- Evidence: `automation/playwright-report/` (screenshot on every test; video/trace on failures).

## Notes
1. **Sentence-case (AC2/AC13)** — the automated heading checks are case-insensitive, so they confirm the heading
   *exists* but do not fail on Title-Case leakage. Figma analysis flagged that the General-cashback screen still shows
   Title Case ("Fixed Amount", "Cashback Limit", "Funding Type"). Flagged to stakeholders; a case-sensitive assertion
   can be added once the intended casing per screen is confirmed.
2. **AC5 ratio contradiction** — cover upload modal says 1:1 (1080×1080) while the rejection banner says 3:2. The AC5
   test is robust to either (asserts a non-conforming image is rejected with a spec/ratio message, and a conforming
   1080×1080 image is accepted). The contradiction itself is a design issue to confirm (see defects.md).
3. **Deferred (needs merchant/category picker live capture + confirmed Breadfast-by-name rule):** AC7 auto-fill for
   non-Breadfast merchant (→ merchant name) and Category cashback (→ category name), the conditional *hide* of the
   subheader for non-Breadfast coupon/merchant perks, and the corresponding auto-filled subheader variants on the AC18
   Preview. Blocked on capturing the merchant/category selector DOM and the Phase-1 auto-tag-by-name rule (Jira comment
   123128 confirms Phase 1 = auto-detect by name). `fillCategoryPerk`/`setLimits` remain stubs for the same reason.
4. **DEF-1 retraction (2026-07-20):** the 2026-07-14 baseline recorded AC3/AC7(cap)/AC9/AC11 as failing because the
   original assertions checked whether the field truncated input at 20/30/200/45 chars. Live re-inspection showed the
   app instead accepts the extra characters and shows an inline "Maximum length should be N characters." validation
   error (blocking save) — a different but equally valid enforcement mechanism. The automation was asserting the wrong
   mechanism, not that no enforcement existed. Fixed via `PerksPage.checkMaxLengthValidation()`; all 4 now pass. DEF-1
   is retracted as a defect (no ticket was filed for it beyond the investigatory B10-57782 — recommend closing/
   reclassifying that ticket as "cannot reproduce / test error" once confirmed).
