# Breadfast — Products

> Living document. Confirmed product concepts in the Pay/Card domain. Expand as stories reveal more.

---

## Breadfast Pay (wallet)
- In-app wallet with a balance ("Wallet Balance" / "رصيد المحفظة"). Sample test balance: EGP 300.
- Entry point: **Pay** tab in the bottom navigation (Home, Search, Cart, Pay, More / الرئيسية, البحث, السلة, باي, المزيد).
- Pay home hosts the card widget and the application/activation stepper.

## Breadfast Card (Visa)
A Visa card applied for and activated in-app. Marketing copy: "Breadfast Card is out! Spend, save, and manage your money." Brand color **#AA0082** (pink/magenta) for active states.

**Lifecycle (3-step application + 2-step activation):**
1. **Application** (3 steps): Verify mobile (OTP, 1/3) → ID info (name, NID, expiry, 2/3) → Complete setup / Create passcode (3/3) → Congratulations.
2. **Pick up** — choose a pickup location (map).
3. **Activation** (2 steps): Activate card / BCID entry (1/2) → Set PIN (2/2) → Success → card active (balance shown on the card).

**Security:**
- **Passcode = 6 digits** (Pay/account security gate "فتح بريدفاست باي").
- **PIN = 4 digits** (card PIN, set during activation; entered in a WebView).

## Perks & Cashback (Card Service)
- Cards earn **cashback** via perks. Cashback is produced by a **cron job**, not a UI action.
- Perk types: **merchant**, **general/generic** (implemented in automation), plus **coupon**, **category**, and **limits** (daily/weekly/monthly/annual/max-cap) `(perk-form selectors not yet captured)`.
- Cashback rows are type-30 transactions; eligible purchases are type-25. See cashback rules in [business-rules.md](business-rules.md) and the backend in [../modules/card-service.md](../modules/card-service.md).

## Invitation codes
Card application is gated by an **invitation code** (e.g. `F1045B`, `VQB39I`). Codes are per-account / per-story; source: story ticket or `invitationcodes.csv`.
