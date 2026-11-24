# Card — business rules & product

> **Domain `card`** · owner `card-core` · loaded only through `qa-cli.js knowledge`, for teams that list `card`
> (or a story with an approved `qa-cli.js cross-domain card`).
> **Provenance:** moved verbatim on 2026-11-24 from `docs/ai/business/{business-rules,products,user-roles,breadfast-overview}.md`.
> Every fact below is `[tester: card-core]` (confirmed by the card squad's runs) unless tagged otherwise.
> Pay-side rules shared with Card (passcode, dual-authentication OTP, shared test account) live in the
> `payment` domain, which `card-core` also loads.

## Breadfast Card (Visa)
A Visa card applied for and activated in-app. Marketing copy: "Breadfast Card is out! Spend, save, and manage your money." Brand color **#AA0082** (pink/magenta) for active states.

**Lifecycle (3-step application + 2-step activation):**
1. **Application** (3 steps): Verify mobile (OTP, 1/3) → ID info (name, NID, expiry, 2/3) → Complete setup / Create passcode (3/3) → Congratulations.
2. **Pick up** — choose a pickup location (map).
3. **Activation** (2 steps): Activate card / BCID entry (1/2) → Set PIN (2/2) → Success → card active (balance shown on the card).

## Authentication & security (card flows)
- **Card application OTP (step 1/3)** = **last 4 digits of the test phone number**. Universal across accounts/platforms.
- **Card activation OTP** (phone verify after "Start") = **last 4 digits of the test phone number** — same rule.
- **PIN = 4 digits**; the card PIN, set during activation (entered in a WebView).

## Identity
- **National ID (NID)** has a **uniqueness constraint** — each NID can be used by only one account. Use fresh NIDs per account / coordinate with the team. NID entry includes an expiry; format observed DDMMYYYY `(verify per build)`. Generated NIDs must also be Luhn-valid.

## Card lifecycle states
- Application states drive the Pay-home stepper: Application → Pick up → Activation (each Active / Complete / Inactive).
- **Activation requires backend status `registered → received`** before it can be tested. The Backend/Admin role performs that change; coordinate it before activation-flow runs.
- BCID = 12-digit code entered during activation (1/2).

## Cashback / perks (Card Service) — confirmed from B10-55185
Cashback is produced by a **cron**, not the UI: `seed/adjust purchase (type-25) → trigger cron → verify type-30 cashback row`.
- **Anti-stacking**: for a given trigger, `COUNT(type-30) = 0 or 1` — never >1.
- **Winner selection**: when multiple perks could apply, the winner is decided by **priority, then smallest perk id**; the cashback row's `card_perk_id` must equal the expected winner.
- **`perk_processed` flag** flips `0 → 1` on every outcome (paid, no-match, failed) to prevent infinite reprocessing.
- **Idempotency**: re-arming (`perk_processed = 0`) and re-running the cron must NOT create a duplicate (original-transaction dedup).
- **Negative cases** produce NO cashback: declined / authorization-only / excluded-MID / no-match purchases.
- **MID exclusion**: certain merchant IDs are excluded from cashback (subject of the MID-exclusion specs).
- Eligibility predicate (exact success/cleared definition — status value, `external_response_code='00'`, settlement datetime) is **not fully confirmed** `[unknown]`; automation sidesteps it by cloning a known-good template purchase. `(open item)`
- Cashback rows are type-30 transactions; eligible purchases are type-25.

## Invitation codes
Card application is gated by an **invitation code** (e.g. `F1045B`, `VQB39I`). Codes are per-account / per-story; source: story ticket or `invitationcodes.csv`.

## Card backend test data
- Card backend test DB: `cards_hades_testing` (MySQL, reachable only via SSH tunnel). Credentials: `cardDb*` in `credentials.local.js` — never a literal in the repo.

---
Cross-references: backend [card-service.md](card-service.md); app flows [mobile-flows.md](mobile-flows.md); perk catalogue [../marketing/perks.md](../marketing/perks.md); Pay rules [../payment/business-rules.md](../payment/business-rules.md).
