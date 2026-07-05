# Breadfast — Business Rules

> Living document. Confirmed, reusable business rules. These drive test oracles and edge cases.
> Story-specific values belong in memory, not here.

---

## Authentication & security
- **Login OTP**: phone-number OTP. In test, delivered to Slack `#testing-otp` (`C04TK0FM329`).
- **Card application OTP (step 1/3)** = **last 4 digits of the test phone number**. Universal across accounts/platforms.
- **Card activation OTP** (phone verify after "Start") = **last 4 digits of the test phone number** — same rule.
- **Passcode = 6 digits**; gates sensitive Pay/card flows ("فتح بريدفاست باي").
- **PIN = 4 digits**; the card PIN, set during activation.

## Identity
- **National ID (NID)** has a **uniqueness constraint** — each NID can be used by only one account. Use fresh NIDs per account / coordinate with the team. NID entry includes an expiry; format observed DDMMYYYY `(verify per build)`.
- Arabic registration submit button label = `إنشاء حساب` (no `ال` definite article).

## Card lifecycle states
- Application states drive the Pay-home stepper: Application → Pick up → Activation (each Active / Complete / Inactive).
- **Activation requires backend status `registered → received`** before it can be tested.
- BCID = 12-digit code entered during activation (1/2).

## Cashback / perks (Card Service) — confirmed from B10-55185
Cashback is produced by a **cron**, not the UI: `seed/adjust purchase (type-25) → trigger cron → verify type-30 cashback row`.
- **Anti-stacking**: for a given trigger, `COUNT(type-30) = 0 or 1` — never >1.
- **Winner selection**: when multiple perks could apply, the winner is decided by **priority, then smallest perk id**; the cashback row's `card_perk_id` must equal the expected winner.
- **`perk_processed` flag** flips `0 → 1` on every outcome (paid, no-match, failed) to prevent infinite reprocessing.
- **Idempotency**: re-arming (`perk_processed = 0`) and re-running the cron must NOT create a duplicate (original-transaction dedup).
- **Negative cases** produce NO cashback: declined / authorization-only / excluded-MID / no-match purchases.
- **MID exclusion**: certain merchant IDs are excluded from cashback (subject of the MID-exclusion specs).
- Eligibility predicate (exact success/cleared definition — status value, `external_response_code='00'`, settlement datetime) is **not fully confirmed**; automation sidesteps it by cloning a known-good template purchase. `(open item)`

## Invitation codes
Card application requires a valid invitation code (per-account / per-story).

---
Cross-references: app behavior [../modules/customer-app.md](../modules/customer-app.md); backend [../modules/card-service.md](../modules/card-service.md); automation of these rules [../automation/helpers.md](../automation/helpers.md).
