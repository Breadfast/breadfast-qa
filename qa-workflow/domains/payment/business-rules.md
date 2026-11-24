# Payment — business rules & product (Breadfast Pay)

> **Domain `payment`** · owner `card-core` (until a Payment squad takes ownership) · loaded only through
> `qa-cli.js knowledge`, for teams that list `payment`.
> **Provenance:** moved verbatim on 2026-11-24 from `docs/ai/business/{business-rules,products}.md` and the
> CLAUDE.md quick reference. Facts are `[tester: card-core]` unless tagged otherwise. Operator decision D-8
> (2026-11-24): the Pay dual-authentication OTP, the Pay "Get started" tap, and the passcode/PIN + shared
> test account apply to **both Card and Payment** — they live here once, and `card-core` loads this domain.

## Breadfast Pay (wallet)
- In-app wallet with a balance ("Wallet Balance" / "رصيد المحفظة"). Sample test balance: EGP 300.
- Entry point: **Pay** tab in the bottom navigation (Home, Search, Cart, Pay, More / الرئيسية, البحث, السلة, باي, المزيد).
- Pay home hosts the card widget and the application/activation stepper.

## Authentication & security
- **Passcode = 6 digits**; gates sensitive Pay/card flows ("فتح بريدفاست باي").
- **PIN = 4 digits** (the card PIN — see the `card` domain).
- **Pay dual-authentication OTP = the last 4 digits of the test phone.** The framework does the same
  (`enterOtpIfDisplayed(phone.substring(phone.length() - 4))`). **Nothing is sent to the OTP space for this
  gate**, so reading Google Chat for it hangs, and a wide lookback returns the LOGIN OTP from earlier in the
  same run.

Test accounts: [test-accounts.md](test-accounts.md). Mobile interaction quirks (coordinate taps): [mobile-flows.md](mobile-flows.md).
