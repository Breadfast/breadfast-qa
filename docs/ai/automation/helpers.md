# Helper Catalog

> Every helper in [`automation/helpers/`](../../../automation/helpers/). Reuse these before writing new utility code.

---

## ApiHelper — [helpers/ApiHelper.js](../../../automation/helpers/ApiHelper.js)

Static-method wrapper around Playwright's `APIRequestContext` for the Card Admin Panel REST API. Base URL from `ConfigReader.getCardServicesAdminPanelBaseURL()`. See [api-clients.md](api-clients.md) for the full payload schema. Endpoints: `/api/v1/web/user/login`, `/api/v1/web/card/perks/create`, `/api/v1/web/card/perks/list`.

| Method | Signature | Purpose / returns |
|--------|-----------|-------------------|
| `loginAndGetToken` | `static async loginAndGetToken(request)` | POST login with admin creds; returns the JWT string. Throws on non-OK or missing token. |
| `createGeneralCashbackPerk` | `static async createGeneralCashbackPerk(request, token, excludedMerchantIds=[], cashbackValue=1, cashbackValueType='percentage', minTxAmount=1, titleEn='B10-55168 API Test')` | POST a `general-cashback` perk (auto-attaches a shared cached test image; `token=null` omits auth header). Returns the `APIResponse`. |
| `buildMerchantIds` | `static buildMerchantIds(count, offset=1)` | Build `count` distinct merchant-ID strings (`String(100000 + offset + i)`). Returns `string[]`. |
| `listPerks` | `static async listPerks(request, token)` | POST `{ skip:1, filter:{} }` to the list endpoint. Returns the `APIResponse` (`{ data: [...] }`). |

```js
const token = await ApiHelper.loginAndGetToken(request);
const ids   = ApiHelper.buildMerchantIds(200, 400);
const resp  = await ApiHelper.createGeneralCashbackPerk(request, token, ids);
expect(resp.status()).toBe(200);
```

---

## ConfigReader — [helpers/ConfigReader.js](../../../automation/helpers/ConfigReader.js)

Singleton (`module.exports = new ConfigReader()`). Loads `config/environments/cardServiceConfigs_${process.env.ENV || 'testing'}.js` in the constructor (throws if missing).

| Getter | Returns |
|--------|---------|
| `getAdminUserName()` | admin panel username |
| `getAdminPassword()` | admin panel password |
| `getCardServicesAdminPanelBaseURL()` | admin panel base URL (also the Playwright `baseURL`) |
| `getCardBackendBaseURL()` | card-backend base URL (cron host) |
| `getBfPropertiesPath()` | path to the Java `config_testing.properties` |
| `getTestMobileNumber()` | test mobile (`sender_identifier` for seeded purchases) |

```js
const config = require('../helpers/ConfigReader');
const baseURL = config.getCardServicesAdminPanelBaseURL();
```

---

## CronHelper — [helpers/CronHelper.js](../../../automation/helpers/CronHelper.js)

Triggers the card-backend cashback cron on demand (processing-flow step 3).

| Method | Signature | Purpose / returns |
|--------|-----------|-------------------|
| `triggerCashbackCron` | `static async triggerCashbackCron(request, jobType='cashback')` | `GET {cardBackendBaseURL}/test?cronJobType=cashback`. Uses the Playwright `request` fixture if passed (120s timeout), else Node `https`/`http`. Returns `{ status, body }`. |

```js
await CronHelper.triggerCashbackCron(request);  // request = Playwright APIRequestContext
```

---

## DbHelper — [helpers/DbHelper.js](../../../automation/helpers/DbHelper.js)

MySQL access to `cards_hades_testing` over an SSH tunnel (`ssh2 forwardOut` + `mysql2`), mirroring the Java `DatabaseConnectionFactory`. Connection values come from `PropertiesReader.getCardDbConfig()`. **Constructor:** `new DbHelper(propsPath)`. Module constants: `DbHelper.TYPE_PURCHASE = 25`, `DbHelper.TYPE_CASHBACK = 30`. Table is `transactions_requests` (override via `BF_TX_TABLE`). MID/MCC live **inside** the `transaction_data` JSON column (keys `"mid"`, `"mcc"`).

### Lifecycle

| Method | Signature | Purpose |
|--------|-----------|---------|
| `connect` | `async connect()` | Opens SSH forward (if `ssh.required`) + MySQL connection. Returns `this` (chainable). |
| `close` | `async close()` | Closes the MySQL connection and SSH client (best-effort). |
| `query` | `async query(sql, params=[])` | Runs a parameterized query; returns the rows array. |

### Seed / adjust (processing-flow step 2)

| Method | Signature | Purpose / returns |
|--------|-----------|-------------------|
| `findLatestPurchaseForMobile` | `async findLatestPurchaseForMobile(mobile)` | Most recent type-25 row for a `sender_identifier`. Returns the row or `null`. |
| `adjustPurchaseForTest` | `async adjustPurchaseForTest(id, { mid, mcc, amount, createdAt })` | Mutates an existing purchase: sets `transaction_data.mid`/`.mcc` via **`JSON_SET`**, optional `amount`/`createdAt`, resets `perk_processed=0`. Returns the updated row. **If `transaction_data` is plain TEXT (not JSON), use `setRawTransactionData` instead** (open item in [AUTOMATION_B10-55185.md](../../../automation/legacy/AUTOMATION_B10-55185.md)). |
| `setRawTransactionData` | `async setRawTransactionData(id, jsonString)` | Overwrites the whole `transaction_data` blob — use when the column is TEXT, not JSON. |
| `cloneEligiblePurchase` | `async cloneEligiblePurchase(templateId, overrides={}, jsonFields={})` | Copies a known-good type-25 row (minus PK), applies column `overrides` and `transaction_data` `{mid,mcc}` overrides, forces `transaction_type=25`/`perk_processed=0`, INSERTs. Returns the new `insertId`. Sidesteps the unconfirmed eligibility predicate (open item #1). |
| `resetPerkProcessed` | `async resetPerkProcessed(id)` | Sets `perk_processed=0` (re-arm for an idempotency re-run). |

### Verify (processing-flow step 4)

| Method | Signature | Purpose / returns |
|--------|-----------|-------------------|
| `getRow` | `async getRow(id)` | Full row by id, or `null`. |
| `getPerkProcessed` | `async getPerkProcessed(id)` | `perk_processed` as a Number, or `null`. |
| `getCashbackRows` | `async getCashbackRows(triggerId)` | All type-30 rows for an originating purchase (`id, amount, status, card_perk_id, trigger_transaction_id, perk_processed`). |
| `countCashback` | `async countCashback(triggerId)` | Count of type-30 rows for a purchase — the **anti-stacking** assertion (expect 0 or 1). Returns a Number. |

```js
const db = await new DbHelper(config.getBfPropertiesPath()).connect();
const txId = await db.cloneEligiblePurchase(SETUP.templateTxId, { amount: 250, createdAt: nowSql() }, { mid: '1', mcc: '5814' });
await CronHelper.triggerCashbackCron(request);
expect(await db.countCashback(txId)).toBe(1);
expect(await db.getPerkProcessed(txId)).toBe(1);
await db.close();
```

---

## PropertiesReader — [helpers/PropertiesReader.js](../../../automation/helpers/PropertiesReader.js)

Reads the external Java framework's `config_testing.properties` so DB+SSH secrets are never copied into this repo. Default path `D:\projects\resources\environments\config_testing.properties`; override with `BF_PROPERTIES_PATH`. Parses `key=value` lines (skips blanks/`#`), caches by path.

| Export | Signature | Purpose / returns |
|--------|-----------|-------------------|
| `load` | `load(propsPath=DEFAULT_PATH)` | Reads + parses the properties file into a flat object (cached). Throws if the file is missing. |
| `getCardDbConfig` | `getCardDbConfig(propsPath)` | Returns `{ db:{host,port,user,password,database}, ssh:{required,host,port,username,keyPath,keyProtected,passphrase} }` for the hades DB. `sshPort=0` → 22; `database` defaults to `mysqlCardServicesDatabaseName` then `mysqlDatabaseName`. |
| `DEFAULT_PATH` | constant | The resolved default properties path. |

```js
const { getCardDbConfig } = require('./PropertiesReader');
const { db, ssh } = getCardDbConfig(); // consumed by DbHelper
```
