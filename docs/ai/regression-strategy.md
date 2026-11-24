# Regression Strategy & Execution Playbooks

> Impact analysis, regression scoping, and the standing BrowserStack playbooks.

---

## 1. Impact Analysis (run per story — STEP 4 of the story process)

Produce four lists:

- **Impacted Areas** — modules, screens, APIs, databases, applications directly changed.
- **Regression Areas** — adjacent flows that could break (auth, navigation, and the key journeys of your product; your domain's regression playbooks name them).
- **Smoke Coverage** — the minimum launch/nav checks to re-run.
- **Automation Impact** — existing specs/page-objects/helpers that need updating, and new automation opportunities.

Cross-reference module docs in [modules/](modules/) and the framework catalog in [automation/reusable-components.md](automation/reusable-components.md).

---

## 2. Smoke Test Playbook (every in-scope combination)

```
1 Start session (correct platform + locale caps)
2 Wait for load (iOS 5000ms / Android 8000ms)
3 Snap home; verify bottom tab bar
   EN: Home, Search, Cart, Pay, More
   AR: الرئيسية, البحث, السلة, باي, المزيد
4 Open the tab the story lives in; verify its landing screen in the session language (your domain's
  regression playbooks give the exact landing-screen check)
5 Snap that screen
6 PASS if all labels present in correct language on correct platform
7 Compare iOS vs Android — layout must be functionally equivalent
```

---

## 3. Product regression playbooks

Flow playbooks (which screens, which order, which screenshots, pass criteria) are **product knowledge**: they
live in each team's domain (`qa-workflow/domains/<domain>/regression-playbooks.md`) and reach a session
through its knowledge plan (`node qa-workflow/bin/qa-cli.js knowledge`). Every playbook states a **TRIGGER**
(what change runs it), a **SCOPE** (smoke → full flows per in-scope combo → step indicators → back navigation
→ error states → iOS/Android parity), a **DURATION** and the **REPORT** it produces.

---


## 4. Hotfix Validation Playbook

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

## 5. New Feature Validation Playbook

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
