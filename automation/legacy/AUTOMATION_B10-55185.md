# B10-55185 — Cashback Processing Automation

How the cashback **processing** flow is automated in this Playwright framework, and what
still needs your input. Companion to the test-case suite
(`B10-55185_Cashback_Processing_Test_Cases.xlsx`).

## What the flow is

The cron, not a UI action, produces cashback. So every test is:

```
seed/adjust a purchase  →  trigger the cron  →  verify the type-30 cashback row
   (DB, type 25,            (GET .../test?          (DB: count 0|1, card_perk_id,
    perk_processed=0)        cronJobType=cashback)   perk_processed=1)
```

## Components added

| File | Role |
|------|------|
| `helpers/PropertiesReader.js` | Reads DB + SSH settings from the Java framework's `config_testing.properties` (single source of truth — no secrets copied into this repo). |
| `helpers/DbHelper.js` | MySQL access to `cards_hades_testing` over an SSH tunnel (ssh2 `forwardOut` + mysql2), mirroring the Java `DatabaseConnectionFactory`. Seed/adjust + verify methods. |
| `helpers/CronHelper.js` | Triggers `GET {cardBackend}/test?cronJobType=cashback`. |
| `pages/PerksPage.js` | Extended: `selectPerkTypeByName`, `startMerchantCashbackPerk`, `fillMerchantPerk` (ported from your Java selectors) + stubs for coupon/category/limits. |
| `tests/cashback_processing.spec.js` | Runnable seed→cron→verify reference spec (TC_CB_003/004/005/021/023). |
| config + `ConfigReader` | Added `cardBackendBaseURL`, `bfPropertiesPath`, `testMobileNumber`. |

## One-time setup

1. `npm install`  (adds `mysql2` + `ssh2`).
2. Ensure the SSH key in `config_testing.properties` (`sshKeyPath`) exists locally and can reach the bastion. The DB is only reachable through that tunnel.
3. If your Java framework lives elsewhere, set `BF_PROPERTIES_PATH` (or edit `bfPropertiesPath` in `config/environments/cardServiceConfigs_testing.js`).
4. Open `tests/cashback_processing.spec.js` and fill the `SETUP` block:
   - `templateTxId` — a real `transactions_requests.id` (type 25) for the test mobile to clone from (e.g. `3418` from the export sample).
   - `mids` / `mccs` — values covered by the perks you created.
   - `perkIds.merchant` — the merchant perk id (to assert the winner).

## Run

```
npm run test:cashback
```

(`--workers=1` so cron runs don't interleave.) The suite auto-skips until `templateTxId` is set.

## How this enhances your current manual process

Your step 4 today checks "a type-30 row was created and matches." The automation upgrades the verification to catch the bugs this enhancement is actually about:

1. **Anti-stacking assertion** — `COUNT(type-30) for the trigger = 0 or 1`, never >1. A single "a row exists" check can't catch a stack.
2. **Winner assertion** — `card_perk_id` equals the expected fixture, proving the *right* perk won (priority + smallest-ID), not just *some* perk.
3. **`perk_processed` on every outcome** — paid, no-match, and failed all flip 0→1 (prevents infinite reprocessing).
4. **Idempotency step** — re-arm (`perk_processed=0`) and re-run the cron; assert no duplicate (original-transaction dedup). Not part of the manual flow today.
5. **Negative seeding** — declined / authorization-only / excluded-MID / no-match purchases asserted to produce *no* cashback.
6. **Isolation + determinism** — clone a fresh purchase per test with `createdAt = now` so it sits inside the active perk window, instead of hand-editing one shared row.

## Open items (carried from the test-case suite README)

- **#1 Eligibility predicate** — confirm the exact success/cleared definition (status value, `external_response_code='00'`, `externalSettlementDateTime`) so the seed sets the right columns. `DbHelper.cloneEligiblePurchase` copies a known-good template to sidestep this for now.
- **#8 Perk-form selectors** — coupon type, category type, and daily/weekly/monthly/annual/max-cap fields are **not** captured anywhere yet. `fillCouponPerk` / `fillCategoryPerk` / `setLimits` throw until you record them from the live panel. Merchant + general are done.
- **#10 Category/MCC** — confirm how a category perk references MCCs in the panel.
- **`transaction_data` column type** — `adjustPurchaseForTest` uses `JSON_SET`; if the column is plain TEXT, use `setRawTransactionData` instead.
- **Table name** — assumed `transactions_requests` (from the export). Override via `BF_TX_TABLE` if different.

## Notes

- The DB layer can't run from CI without the SSH key + network path to the bastion; it's designed to run from a developer machine that already reaches the test DB (same as the Java framework).
- Perk creation for all types via UI is the remaining build; the processing/verification core is complete and runnable once `SETUP` is filled and merchant/coupon/category/generic perks exist in the panel.
