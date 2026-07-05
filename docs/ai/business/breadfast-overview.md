# Breadfast — Business Overview

> Living document. Holds only what is confirmed from tickets, builds, and tested flows.
> Mark unverified items `(unconfirmed)` and expand as stories reveal more. Governance: [../release-validation.md](../release-validation.md) §5.

---

## What Breadfast is
Breadfast is an Egypt-based grocery / quick-commerce mobile app (iOS + Android) that has expanded into financial services (a wallet — "Breadfast Pay" — and the "Breadfast Card", a Visa card). The QA focus on this project is the **Pay / Card** domain plus supporting back-office (Control Room) and backend (Card Service) systems.

## Markets & localization
- Primary market: **Egypt (EG)**.
- Languages: **Arabic (ar/EG, RTL)** and **English (en/US, LTR)** — both first-class; every feature is validated in both.
- Numerals: Arabic-Indic / Extended Arabic-Indic on custom keypads in Arabic locale.

## Builds & environments
- Test/staging build under test: `com.breadfast.testing`.
- Mobile execution: BrowserStack App Automate (iPhone 14 / iOS 18; Samsung Galaxy S23 / Android 13).
- Card backend test DB: `cards_hades_testing` (MySQL, reachable only via SSH tunnel).
- Never use production credentials/endpoints in automated testing.

## Domains (→ module docs in [../modules/](../modules/))
| Domain | What it is | Doc |
|--------|-----------|-----|
| Customer App | The consumer iOS/Android app (Pay home, card application & activation, auth) | [customer-app.md](../modules/customer-app.md) |
| Card Service | Backend for card perks, cashback processing (cron), MID exclusion | [card-service.md](../modules/card-service.md) |
| Control Room | Internal back-office / admin portal with role-based permissions | [control-room.md](../modules/control-room.md) |
| Chatbot | Customer-facing chatbot `(scope unconfirmed)` | [chatbot.md](../modules/chatbot.md) |

## Key product concepts
See [products.md](products.md) (Card, Pay, perks/cashback) and [business-rules.md](business-rules.md) (OTP rules, NID uniqueness, passcode/PIN lengths, cashback anti-stacking).
