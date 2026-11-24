# Breadfast — User Roles (org-wide)

> Living document. Confirmed roles and permission concepts. Expand as stories reveal more.
> Product test accounts (phones, passcodes) are domain knowledge, not here — they reach a session through its
> knowledge plan (`node qa-workflow/bin/qa-cli.js knowledge`).

---

## Customer (app user)
End user of the Customer App. Authenticates via phone-number OTP and secures the session/account with a
6-digit passcode.

## Control Room roles (internal / back-office)
The Control Room is permission-gated. Roles confirmed from tickets include **Analyst** and **Senior Marketeer** (B10-5303 concerned an Analyst/Senior Marketeer having print-invoice access they should NOT have — i.e. role-based permission enforcement is in scope). Other roles `(unconfirmed)`. See [../modules/control-room.md](../modules/control-room.md).

Permission testing principle: verify each role sees **only** the actions/screens its permission set allows — both that allowed actions work and that disallowed actions are absent/blocked.

## Backend / Admin
Performs backend state changes required for testing (e.g. moving an entity into the status a story needs).
Coordinate these changes before the dependent runs; ask for them in the Phase 0 prerequisite batch.
