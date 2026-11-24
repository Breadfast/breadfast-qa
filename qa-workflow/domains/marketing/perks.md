# Marketing — perks catalogue & display

> **Domain `marketing`** · owner `card-core` · loaded only through `qa-cli.js knowledge`, for teams that list `marketing`.
> **Provenance:** moved verbatim on 2026-11-24 from `docs/ai/business/products.md`. `[tester: card-core]`.
> Cashback *mechanics* (cron, anti-stacking, winner selection) are in the `card` domain
> ([../card/business-rules.md](../card/business-rules.md)).

## Perks
- Cards earn **cashback** via perks. Cashback is produced by a **cron job**, not a UI action.
- Perk types: **merchant**, **general/generic** (implemented in automation), plus **coupon**, **category**, and **limits** (daily/weekly/monthly/annual/max-cap) `(perk-form selectors not yet captured)`.
- Perks are grouped in **sections**; a perk can carry the **Featured** flag. The card panel manages both
  (create / duplicate / feature / homepage ordering); the Pay home perks list displays them.
  `[tester: card-core, from the B10-57764 / B10-57766 / B10-57771 runs; 2026-11-24]`
