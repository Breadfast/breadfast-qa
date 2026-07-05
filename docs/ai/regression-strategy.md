# Regression Strategy & Execution Playbooks

> Impact analysis, regression scoping, and the standing BrowserStack playbooks.

---

## 1. Impact Analysis (run per story — STEP 4 of the story process)

Produce four lists:

- **Impacted Areas** — modules, screens, APIs, databases, applications directly changed.
- **Regression Areas** — adjacent flows that could break (auth, Pay home, card widget, navigation).
- **Smoke Coverage** — the minimum launch/nav checks to re-run.
- **Automation Impact** — existing specs/page-objects/helpers that need updating, and new automation opportunities.

Cross-reference module docs in [modules/](modules/) and the framework catalog in [automation/reusable-components.md](automation/reusable-components.md).

---

## 2. Smoke Test Playbook (all 4 combinations)

```
1 Start session (correct platform + locale caps)
2 Wait for load (iOS 5000ms / Android 8000ms)
3 Snap home; verify bottom tab bar
   EN: Home, Search, Cart, Pay, More
   AR: الرئيسية, البحث, السلة, باي, المزيد
4 Tap Pay tab; verify Pay home ("Wallet Balance" / "رصيد المحفظة")
5 Snap Pay home
6 PASS if all labels present in correct language on correct platform
7 Compare iOS vs Android — layout must be functionally equivalent
```

---

## 3. Card Application Flow Playbook (all 4 combinations)

```
1  Pay tab → 2 tap card widget at (195,540) → 3 swipe through perks carousel
4  Enter invitation code → 5 apply → OTP screen (1/3)
6  OTP = last 4 digits of phone → 7 ID screen (2/3): name(s)+NID+expiry
8  Submit (إرسال / Submit) → 9 Passcode intro (3/3) → Next (التالي / Next)
10 Create passcode (Arabic-Indic numpad on AR) → 11 confirm → 12 Congratulations (مبروك! / Congratulations!)
```
Required screenshots: Pay home, perks carousel, invitation code, OTP 1/3, ID 2/3 (+ filled), passcode create 3/3, confirm, Congratulations, Pay home with stepper.
Pass: correct language labels, 1/3→2/3→3/3 in sequence, Congratulations appears.
Android notes: `android.widget.Button`/`EditText`; dump accessible elements for the custom passcode keypad.

---

## 4. Card Activation Flow Playbook

```
PRECONDITIONS: application complete; backend status registered→received; BCID available
1 Pay home — Activate step active → 2 tap "ابدأ"/Start in widget
3 Passcode verify "فتح بريدفاست باي" → enter 6-digit passcode
4 (phone OTP verify if prompted = last 4 digits of phone)
5 BCID screen "تفعيل بطاقتك" (1/2) → enter 12-digit BCID → التالي → "قيد التقدم" loading
6 PIN intro "إعداد PIN" (2/2) → Next → PIN WebView (may fail in BrowserStack — env limitation)
```
Pass: 1/2 + 2/2 indicators confirmed, BCID validated, PIN intro visible. PIN = 4 digits; passcode = 6 digits.

---

## 5. Regression Testing Playbook

```
TRIGGER: any change touching card flow, Pay home, or authentication.
SCOPE: smoke (4 combos) → full card application iOS EN/AR + Android EN/AR →
       verify step indicators → verify back nav from each screen →
       error states (wrong OTP, duplicate NID, passcode mismatch) →
       iOS vs Android parity check.
DURATION: ~3–4h full four-combo; ~90min single-platform.
REPORT: regenerate test_report_[STORY_ID].html with all 4 columns + Figma refs.
```

---

## 6. Hotfix Validation Playbook

```
TRIGGER: emergency fix on testing env.
1 Reproduce original bug on affected platform(s)
2 Verify fix applied → 3 re-test the specific flow
4 If platform-specific, test both platforms for cross-platform regression
5 Smoke adjacent flows
6 One-language OK for hotfix; both if the fix touches localized strings
DURATION: 20–40 min per affected platform.
```

---

## 7. New Feature Validation Playbook

```
1 Read PRD + extract AC (and STORY COMMENTS — they may override AC)
2 Fetch Figma EN + AR frames per screen (store figma_en_*/figma_ar_*); mark NO FIGMA REF where absent
3 Build test cases from AC (positive + negative)
4 iOS EN baseline (compare vs Figma EN) → 5 iOS AR (vs AR) →
6 Android EN (vs EN/Android frame) → 7 Android AR (vs AR/Android frame)
8 Content parity check iOS vs Android
9 Generate HTML report (4 columns + Figma refs)
10 Report findings; highlight Figma mismatches specifically
```
Sign-off checklist lives in [release-validation.md](release-validation.md).
