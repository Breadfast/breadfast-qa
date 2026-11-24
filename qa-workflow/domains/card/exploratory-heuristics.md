# Card / Pay — exploratory heuristics

> **Domain `card`** · owner `card-core` · loaded only through `qa-cli.js knowledge`.
> **Provenance:** moved verbatim on 2026-11-24 from `docs/ai/exploratory-testing.md` §1–§4. `[tester: card-core]`.
> The generic charter, failure patterns and timing stay in core:
> [docs/ai/exploratory-testing.md](../../../docs/ai/exploratory-testing.md).

## Failure patterns (Card / Pay)
| Pattern | Root cause | Detection / fix |
|---------|-----------|-----------------|
| "فتح بريدفاست باي" appears | Passcode gate for sensitive flows | Expected — enter passcode |
| "Got it" modal not found | RN custom view, no a11y attrs | Coordinate tap (195, 810) |
| Activation OTP after passcode | Phone verify step | Last 4 digits of phone |

## Fragile flows
- BCID field — find by class chain; prefer `setValue` over key tapping.
- Card widget "ابدأ" — accessible element tiny (33×26); coordinate tap.
- National ID field — unique constraint; coordinate fresh NIDs with the team.
- Pickup locations close — unlabeled top-right; hardcode `(366, 75)`.

## Timing
- BCID validation: poll up to ~16s.

## Example charter row
| 0:00 | Pay home | Card widget loaded | Snapped |
