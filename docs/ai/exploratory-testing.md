# Exploratory Testing — Charters, Heuristics & Failure Patterns

> Standing heuristics learned across sessions, plus the exploratory-notes template.
> Used during the discovery/exploration phase of web and mobile stories.

---

## 1. Exploratory Charter & Notes Template

```markdown
# Exploratory Session Notes — [Date]
Charter: Explore [feature area] looking for [type of issues]
Locale: Arabic / English   Duration: [X min]   Device: iPhone 14 / iOS 18 (or Samsung S23 / Android 13)

## Observations
| Time | Screen | Observation | Action |
|------|--------|-------------|--------|
| 0:00 | Pay home | Card widget loaded | Snapped |

## Issues Found
[anomalies]

## Areas Needing More Coverage
[under-explored areas]
```

For **web** stories: if no URL is provided, ask for it. Explore navigation, existing behavior, user journeys, dependencies, data flow, error handling. Use the existing Playwright framework page objects/helpers to understand structure ([automation/page-objects.md](automation/page-objects.md), [automation/helpers.md](automation/helpers.md)).

---

## 2. Common Failure Patterns (detection table)

| Pattern | Root cause | Detection / fix |
|---------|-----------|-----------------|
| Tap doesn't register | Wrong element type (Key vs Button) | Dump all buttons; try multiple types |
| Coordinates off-screen | Element in scroll view | Check y; scroll to reveal |
| Arabic text not shown | Wrong locale caps | Verify `appium:language`/`appium:locale` top-level |
| Back navigation stuck | Multi-tab modal | Find unlabeled close (32×32 near edge) |
| Field value not in XML | `label` shows placeholder; value in `value` attr | Don't re-enter; verify next screen |
| Loading spinner persists | API in progress | Poll 8× @ 2000ms before timeout |
| Passcode digits ignored | Custom numpad uses Arabic-Indic | Map ASCII→Arabic-Indic (both ranges) |
| "فتح بريدفاست باي" appears | Passcode gate for sensitive flows | Expected — enter passcode |
| Login OTP partial entry | `tapDigitArabic` taps filled boxes on repeated digits | Use `typeDigitsW3C` |
| AR registration not submitted | Looks for `إنشاء الحساب` | Actual label `إنشاء حساب` (no ال) |
| "Got it" modal not found | RN custom view, no a11y attrs | Coordinate tap (195, 810) |
| Activation OTP after passcode | Phone verify step | Last 4 digits of phone |
| **Count assertion off by 1–2** (lines, cards, rows) | Reader bounded by a container rect that doesn't bound its content | **Dump the on-screen strings + the oracle and diff them — do NOT adjust the boundary and re-run.** Count by matching authored values, not geometry. [mobile-native-framework.md](automation/mobile-native-framework.md) §2.1 |
| Element "missing" after an expand/scroll | Bounds returned **inverted** or in content space once content grows | Scroll the control into view before asserting; distrust any rect whose bottom < top |
| Container reports **zero children** | Compose flattens the tree — content is a *sibling*, not a descendant | Read by position or by value, never by tree descent |

---

## 3. Fragile Flows
- Passcode entry on Arabic numpad — requires Unicode mapping; ASCII search always fails.
- BCID field — find by class chain; prefer `setValue` over key tapping.
- Card widget "ابدأ" — accessible element tiny (33×26); coordinate tap.
- National ID field — unique constraint; coordinate fresh NIDs with the team.
- Pickup locations close — unlabeled top-right; hardcode `(366, 75)`.

---

## 4. Timing
- Tap-triggered navigation: `sleep(2000–3000ms)`.
- Form submit: `sleep(4000–5000ms)` (slow tunnel).
- BCID validation: poll up to ~16s.
- Session start: `sleep(8000–12000ms)`.

---

## 5. Visual Regression Patterns
- Step indicator stuck (1/3 when 2/3 expected) → transition hasn't fired.
- Arabic label left-aligned where right-aligned expected → RTL layout bug.
- Placeholder persisting in `label` attr → normal iOS; real value in `value`.
- Duplicate labels in source → visible + off-screen scroll content; don't count occurrences.

---

## 6. Mobile Interaction Pitfalls
- Scroll views hide elements below the fold — real coords in XML but not tappable until scrolled.
- iPhone 14 tab bar at y≈762–820; tap y=855 is safe.
- Horizontal card widget — swipe to reveal later slides.
- iOS edge-swipe back works for nav stacks, not modal sheets / custom tab controllers.
- **Pay screen — ALWAYS coordinate taps, never label/accessibility-id** (composite elements unreliable). See coords table in [browserstack-process.md](browserstack-process.md) §4.1.

---

## 7. Android-Specific Quirks
Slower startup (8–10s) · element types `android.widget.*` · system back = keycode 4 · custom Arabic numpad may render differently (dump elements first) · RTL mirroring differs slightly · dismiss keyboard via `hide_keyboard`/keycode 4 · Arabic font metrics differ (not bugs) · gesture-nav edge swipe may conflict with app swipes (use keycode 4 instead).
