# Payment / Card — shared mobile test accounts

> **Domain `payment`** · owner `card-core` · shared by Card and Payment (operator decision D-8, 2026-11-24).
> **Provenance:** moved verbatim on 2026-11-24 from `docs/ai/business/user-roles.md` and the CLAUDE.md quick
> reference. `[tester: card-core]`. **No passwords or tokens belong here** — only test phone numbers and the
> test-environment passcode convention, which the apps require to be typed.

Customer (app user) test accounts for mobile QA:

| Combo | Test phone | Notes |
|-------|-----------|-------|
| iOS EN | 01012350020 | Card app OTP `0020` |
| iOS AR | 01112350011 | Card app OTP `0011` |
| Android EN | 01212350012 | |
| Android AR | 01512350013 | |
| (shared) | 01203365955 | passcode `123321`, card app OTP `5955` |

- Passcode = 6 digits; PIN = 4 digits.
- Credentials are point-in-time — verify against the current environment before relying on them.
- A new card user at any lifecycle stage: `npm run bcard-user` (see `automation/bcard-user/`).
