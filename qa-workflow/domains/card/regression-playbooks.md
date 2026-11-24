# Card / Pay — regression playbooks

> **Domain `card`** · owner `card-core` · loaded only through `qa-cli.js knowledge`. Pay-home steps are shared
> with the `payment` domain (operator decision D-8).
> **Provenance:** moved verbatim on 2026-11-24 from `docs/ai/regression-strategy.md` §2–§5. `[tester: card-core]`.
> The generic method (impact analysis, hotfix, new-feature playbooks) stays in core:
> [docs/ai/regression-strategy.md](../../../docs/ai/regression-strategy.md).

## Regression areas typical for Card/Pay stories
Auth, Pay home, card widget, navigation.

## Pay smoke step (add to the core smoke playbook)
```
4 Tap Pay tab; verify Pay home ("Wallet Balance" / "رصيد المحفظة")
5 Snap Pay home
```

---

## 1. Card Application Flow Playbook (all 4 combinations)

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

## 2. Card Activation Flow Playbook

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

## 3. Regression Testing Playbook

```
TRIGGER: any change touching card flow, Pay home, or authentication.
SCOPE: smoke (4 combos) → full card application iOS EN/AR + Android EN/AR →
       verify step indicators → verify back nav from each screen →
       error states (wrong OTP, duplicate NID, passcode mismatch) →
       iOS vs Android parity check.
DURATION: ~3–4h full four-combo; ~90min single-platform.
REPORT: regenerate test_report_[STORY_ID].html with all 4 columns + Figma refs.
```

