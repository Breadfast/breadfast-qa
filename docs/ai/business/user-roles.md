# Breadfast — User Roles

> Living document. Confirmed roles and permission concepts. Expand as stories reveal more.

---

## Customer (app user)
End user of the Customer App. Authenticates via phone-number OTP; secures the session/account with a 6-digit passcode and the card with a 4-digit PIN. Applies for and activates the Breadfast Card. Test accounts (mobile QA):

| Combo | Test phone | Notes |
|-------|-----------|-------|
| iOS EN | 01012350020 | Card app OTP `0020` |
| iOS AR | 01112350011 | Card app OTP `0011` |
| Android EN | 01212350012 | |
| Android AR | 01512350013 | |
| (shared) | 01203365955 | passcode `123321`, card app OTP `5955` |

Credentials are point-in-time — verify against memory before relying on them.

## Control Room roles (internal / back-office)
The Control Room is permission-gated. Roles confirmed from tickets include **Analyst** and **Senior Marketeer** (B10-5303 concerned an Analyst/Senior Marketeer having print-invoice access they should NOT have — i.e. role-based permission enforcement is in scope). Other roles `(unconfirmed)`. See [../modules/control-room.md](../modules/control-room.md).

Permission testing principle: verify each role sees **only** the actions/screens its permission set allows — both that allowed actions work and that disallowed actions are absent/blocked.

## Backend / Admin
Performs backend state changes required for testing (e.g. card status `registered → received` before activation can be tested). Coordinate these changes before activation-flow runs.
