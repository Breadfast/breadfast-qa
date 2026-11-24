# Card — test data provisioning (reference implementation)

> **Domain `card`** · owner `card-core` · loaded only through `qa-cli.js knowledge`.
> **Provenance:** moved verbatim on 2026-11-24 from `docs/ai/testing-process.md` §7. `[tester: card-core]`.
> The org-wide standard (provision per run, tear down, never hard-code, never invent) stays in core:
> [docs/ai/testing-process.md](../../../docs/ai/testing-process.md) §7.
> Card DB credentials: `cardDb*` in `credentials.local.js` (no literal fallback since 2026-11-24 — see
> `automation/config/README.md`). The `BF_CARD_SSH_*`/`BF_CARD_DB_*` env names below still work as aliases.


**Standard (2026-06-22): create test data per-run via API, delete it from the DB after.** No static
sheet. This ports the canonical Java framework's idea (`cardService/adminPanel/CardAdminPanelTests`
+ `TestExecutionHelper.registerUsingApi` + `CardServiceApiClient`) into the Playwright/JS layer.

Shared helper `automation/helpers/CardUserFactory.js`:
- `await factory.provision()` → registers a brand-new card user up to status **Registered** and returns
  `{ phone, searchMobile, breadfastId, nationalId, email, firstName, lastName, localPhone }`.
  Flow: `send-otp` → read OTP from `breadfast_testing.bf_phone_otp_verification` (DB) → `verify-otp`
  → `register` (breadfast_id) → card-service scheme token → **invitation gate** (generate → export → consume;
  testing is invite-only, else createCardUser 400s "Access is by invitation only") → `createCardUser`
  (Pending; **Arabic** names required) → `createPin` (Registered).
  Two DB connections are used: **OTP read** on the breadfast host (PropertiesReader → `config_testing.properties`),
  **teardown** on the live card host configured in `CardConfig.cardDb` (the Java config's card DB host is stale;
  env-overridable via `BF_CARD_SSH_*`/`BF_CARD_DB_*`). `DbHelper` supports password SSH + an explicit config object.
  Verify teardown with `factory.existsViaApi(searchMobile)` (authoritative — uses the allWallets API, not the DB).
  A freshly provisioned user is Registered with **no KYC details** — ideal for gate/edit tests.
- `await factory.destroy(phone)` → deletes the user from `cards_hades_testing` (actions_logger,
  wallet_user_sessions, cards, external_user_balances, wallet_users by `mobile_number`). Idempotent.
- `CardUserFactory.randomPackageNumber()` → random 6-digit collect package (retry on the rare
  `/received` 400 "already assigned" collision).
- `searchMobile` (= phone without the `+2` prefix, e.g. `011…`) is what the admin-panel search box expects.

Supporting helpers: `EncryptionHelper.js` (RSA-OAEP-SHA256 for the encrypted card endpoints, reads the
Java `cardServiceEncryptionPublicKey.pub`), `CardConfig.js` (URLs/scheme creds/passcode/NID-expiry read
live from the Java `.properties` — **no secrets duplicated** into this repo), `DbHelper.js` (MySQL over SSH).

Spec pattern:
- **Non-destructive suites** (edit/validation, gate checks): `beforeAll` → `provision()` once; `afterAll` → `destroy()`.
- **Destructive flow** (full collection → Received, PDF reprint): provision a dedicated user inside the
  test, run, and `destroy()` in `finally` (so a failure still cleans up).

Rules:
- **Never hard-code phone/package/customer values, and never depend on pre-existing records.** Provision fresh.
- **Always tear down** what you provisioned (DB delete) — leave the env clean. Use `finally` for destructive flows.
- Reaching **Received** for the current build uses the UI (`EditCustomerPage.fillAllValid` + `CollectDialogPage`)
  because the legacy Java `editCustomerDetails` API predates B10-56336's new KYC fields and won't satisfy the
  new completeness gate.

> **DEPRECATED:** the static `D:/BreadfastQA/test_data_inventory.csv` + `TestDataInventory.js`
> (Available/Consumed/Reserved ledger) are superseded by the above and no longer used by the KYC specs.
> Kept temporarily for reference; remove once dynamic provisioning is verified against a healthy env.
> If a flow genuinely cannot be provisioned via API, fall back to requesting data from the user — never invent it.
