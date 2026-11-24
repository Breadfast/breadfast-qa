# Breadfast — Business Overview (org-wide)

> Living document. Holds only what is confirmed from tickets, builds, and tested flows, and only what is
> true for **every** team. Mark unverified items `(unconfirmed)` and expand as stories reveal more.
> Governance: [../release-validation.md](../release-validation.md) §5.
> **Product-specific knowledge is not here.** Each team's business rules, flows and test accounts live in its
> domain (`qa-workflow/domains/<domain>/`) and reach a session only through its knowledge plan:
> `node qa-workflow/bin/qa-cli.js knowledge`. (Split on 2026-11-24; the org/product line follows operator
> decision D-8.)

---

## What Breadfast is
Breadfast is an Egypt-based grocery / quick-commerce mobile app (iOS + Android) that has expanded into
financial services. Several squads test different products on it; the shared QA process is in
[../QA_PROCESS.md](../QA_PROCESS.md) and CLAUDE.md.

## Markets & localization
- Primary market: **Egypt (EG)**.
- Languages: **Arabic (ar/EG, RTL)** and **English (en/US, LTR)** — both first-class; every feature is validated in both.
- Numerals: Arabic-Indic / Extended Arabic-Indic on custom keypads in Arabic locale.
- Test phone numbers are Egyptian (`+20`). Jira bug `Environment` defaults to `Egypt` (B10 bug schema).

## Builds & environments
- Test/staging build under test: `com.breadfast.testing`.
- Mobile execution: BrowserStack App Automate (iPhone 14 / iOS 18; Samsung Galaxy S23 / Android 13).
- Never use production credentials/endpoints in automated testing.

## Authentication (customer app, all teams)
- **Login OTP**: phone-number OTP. In test it arrives in the **Google Chat `#testing-otp`** space and the
  framework's `OtpFactory` reads it. `[outdated: Slack #testing-otp (C04TK0FM329) — silent since 2026-06-24, retired]`
- Arabic registration submit button label = `إنشاء حساب` (no `ال` definite article).

## Org-wide modules (→ [../modules/](../modules/))
| Module | What it is | Doc |
|--------|-----------|-----|
| Customer App | The consumer iOS/Android app (shared platforms, auth, localization) | [customer-app.md](../modules/customer-app.md) |
| Control Room | Internal back-office / admin portal with role-based permissions | [control-room.md](../modules/control-room.md) |
| Chatbot | Customer-facing chatbot `(scope unconfirmed)` | [chatbot.md](../modules/chatbot.md) |

Roles and the permission-testing principle: [user-roles.md](user-roles.md).
