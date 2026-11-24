# Card — mobile flows (customer app)

> **Domain `card`** · surface `mobile` · owner `card-core` · loaded only through `qa-cli.js knowledge`.
> **Provenance:** moved verbatim on 2026-11-24 from `docs/ai/modules/customer-app.md` and the CLAUDE.md quick
> reference (rows the operator classified Card-only under D-8). `[tester: card-core]`.
> Pay-home journey and the Pay coordinate taps: [../payment/mobile-flows.md](../payment/mobile-flows.md).

## Card journeys (iOS and Android, EN and AR)
1. **Card application** (3 steps) — Verify mobile (OTP 1/3) → ID info (name/NID/expiry 2/3) → Complete setup / Create passcode (3/3) → Congratulations.
2. **Pick up** — choose pickup location (map).
3. **Card activation** (2 steps) — BCID entry (1/2) → Set PIN (2/2) → Success → card active.

## Key screens & expected copy
Highlights: Pay Home "Breadfast Card is out!"; Card App Intro "Apply for your card"; OTP "Verify your mobile number" (1/3); ID "Enter your ID information" (2/3); Passcode intro "Complete card setup" (3/3); BCID "Activate your card" (1/2); PIN "Set a PIN" (2/2). PIN = 4 dots, passcode = 6 dots.
(The full per-screen copy table this section used to link, `figma_full_flow_reference.md`, was never committed to this repo — take copy from the story's Figma.)

## Interaction quirks
| Item | Value / rule |
|---|---|
| Card application OTP (1/3) | last 4 digits of the test phone (01012350020 → 0020); enter with `typeDigitsW3C(PHONE.slice(-4))` |
| Card activation OTP (phone verify after "Start") | last 4 digits of the test phone — same rule; `typeDigitsW3C` |
| Activation "Got it" modal | coordinate tap **(195, 810)** — no a11y label (RN view) |
| Activation "Start" | XPath `//*[@label='Start']` + clickEl (~315, 580) |
| BCID validation | server-side; poll up to ~16s |
| WebView PIN step | often fails in BrowserStack — environment limitation, not a bug |

## Dependencies
- Card Service backend (perks, cashback, card status) — [card-service.md](card-service.md).
- Backend status change `registered → received` is a precondition for activation testing.

## Regression considerations
Any change to the card flow triggers the card regression playbook ([regression-playbooks.md](regression-playbooks.md)).
