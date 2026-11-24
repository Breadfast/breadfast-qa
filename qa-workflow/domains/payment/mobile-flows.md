# Payment — mobile flows (Pay home)

> **Domain `payment`** · surface `mobile` · owner `card-core` · loaded only through `qa-cli.js knowledge`.
> **Provenance:** moved verbatim on 2026-11-24 from `docs/ai/modules/customer-app.md`,
> `docs/ai/browserstack-process.md` and the CLAUDE.md quick reference. The "Get started" tap is shared by
> Card and Payment (operator decision D-8, 2026-11-24). `[tester: card-core]`.

## Pay home
Wallet Balance, card widget ("Breadfast Card is out!" / "Get started" / "ابدأ الآن"), application/activation
stepper, Card Perks list.

**All Pay-screen interactions use coordinate taps**, never labels:

| Item | Value / rule |
|---|---|
| Pay "Get started" tap | coordinate tap **(195, 540)** — never label-based |
| Pay dual-authentication gate | OTP = last 4 digits of the test phone (see [business-rules.md](business-rules.md)). Segmented field: real key events only (Android keycodes) — a bulk `element/value` lands one digit and auto-submits an incomplete code |
| FAQ X close | (355, 57) |

Coordinates are for the 390×844 device. Tab bar (org-wide): Pay tab (273, 819) · Home tab (39, 819).

## Regression considerations
Any change to Pay home triggers the Pay regression playbook in the `card` domain
([../card/regression-playbooks.md](../card/regression-playbooks.md)) — Card and Pay share it.
