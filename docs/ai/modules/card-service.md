# Module — Card Service (backend)

> Backend for Breadfast Card perks, cashback processing, and exclusions.
> Living document — primary source is the B10-55185 automation work.

## Purpose
Server-side processing for the Breadfast Card: perk definitions, cashback calculation (cron-driven), MID exclusion, and card lifecycle status. Tested via the Playwright framework in [b55168_pom/](../../b55168_pom/) with DB + cron + API helpers.

## Core flow — cashback processing (cron, not UI)
```
seed/adjust purchase (type-25, perk_processed=0)
  → trigger cron  GET {cardBackend}/test?cronJobType=cashback
  → verify type-30 cashback row (count 0|1, card_perk_id, perk_processed=1)
```
Business rules (anti-stacking, winner = priority + smallest id, perk_processed flip, idempotency, negative cases, MID exclusion) are in [../business/business-rules.md](../business/business-rules.md).

## Data dependencies
- DB `cards_hades_testing` (MySQL) — reachable **only via SSH tunnel** (ssh2 `forwardOut` + mysql2). Not runnable in CI without the SSH key + bastion path.
- Tables: `transactions_requests` (purchases; type-25 eligible, type-30 cashback) — table name is an assumption, override via `BF_TX_TABLE`.
- `transaction_data` column: `JSON_SET` used for adjustments; if plain TEXT, use `setRawTransactionData`.
- Config/secrets read from the external Java framework's `config_testing.properties` (single source of truth) via PropertiesReader.

## APIs
- Card backend base URL: `cardBackendBaseURL` (config).
- Cron trigger endpoint: `GET /test?cronJobType=cashback` ([CronHelper.js](../../b55168_pom/helpers/CronHelper.js)).
- Perk creation via API: [create_perks_api.js](../../b55168_pom/create_perks_api.js) + ApiHelper — merchant + general implemented; coupon/category/limits not yet captured.

## Testing considerations
- Run cashback specs with `--workers=1` so cron runs don't interleave.
- Upgrade "a row exists" oracle to: anti-stacking count, winner assertion, perk_processed on every outcome, idempotency re-run, negative seeding.
- Clone a fresh purchase per test (`createdAt = now`) for isolation/determinism.

## Regression considerations
Changes to perk priority, eligibility predicate, or MID exclusion → re-run cashback + MID-exclusion suites and re-verify winner/anti-stacking.

## Known issues / open items
- Eligibility predicate not fully confirmed (status value / `external_response_code='00'` / settlement datetime) — automation clones a known-good template to sidestep.
- Coupon/category/limits perk-form selectors uncaptured (stub methods throw).
- Bug **B10-56609** — stale 206-MID list re-submitted after correction (see [record_bug_b10_56609.js](../../b55168_pom/record_bug_b10_56609.js)).

## Automation entry points
[../automation/playwright-framework.md](../automation/playwright-framework.md), [../automation/helpers.md](../automation/helpers.md) (DbHelper/CronHelper/ApiHelper), [../automation/api-clients.md](../automation/api-clients.md), [../automation/page-objects.md](../automation/page-objects.md) (PerksPage).

## Java framework assets (`D:\projects`)

See [../automation/java-framework.md](../automation/java-framework.md) for the full catalog.

**Page objects (modals)** — `src/main/java/modals/cardsAdminPanel/`: `CardAdminPanelLoginPage`, `CardPanelDashboard`, `PerksPage`, `MerchantPerkCreatePage`, `GeneralCashbackPerkPage`, `SearchCardsUsers`, `ViewCardUsersDetails`, `EditCustomerDetailsPage`, `SetCardPinPage`, `update`.

**API clients**
- `helpers/apiClients/mobileApiClients/CardServiceApiClient` — token, card status, wallet user id, set passcode/PIN, link/activate/replace card, balance, transaction history, invitation-code batch (generate/export/consume), transfers (`checkSender`/`receiverDetails`/`completeTransaction`), card pool, `changeCardStatus`, `collectCard`.
- `helpers/apiClients/webApiClients/CardAdminPanelPerksApiClient` — `loginAndGetJwtToken` + create general-cashback perk variants (with MIDs / mid-count / no exclusions / invalid token / no auth).

**Models** — `CardService`, `CardServiceWalletUserReport` (+`…CardDetails`, `…UserDetails`). Encryption via `helpers/EncryptionHelper` (`cardServiceEncryptionPublicKey.pub`).

**Config** — `resources/environments/cardServiceConfigs_testing.properties` (card user/admin creds, BCID, national id, contract/product numbers, passcodes, pickup location — secrets redacted in framework doc).

**Test suites** — `src/test/java/cardService/`: `adminPanel/CardAdminPanelTests`, `adminPanel/MidExclusionCapacityTests`, `api/CardApiTests`, `api/CardActivationTests`, `api/GeneralCashbackPerkApiTests`. Suite: `fintechng.xml`. Data factory: `factories/dataFactories/fintechDataFactories/CustomerInfoSheetDataFactory`.
