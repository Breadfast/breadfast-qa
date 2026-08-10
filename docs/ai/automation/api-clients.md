# API Client Catalog

> The REST clients that talk to the Card Admin Panel backend. Reuse these for any perk/auth API automation.

## ApiHelper — [helpers/ApiHelper.js](../../../automation/helpers/ApiHelper.js)

Thin static wrapper around Playwright's `APIRequestContext`. No extra HTTP dependency needed in tests — pass the `request` fixture.

### Base URL & auth

- **Base URL:** `ConfigReader.getCardServicesAdminPanelBaseURL()` → `https://card-panel-testing.breadfast.tech` (from [cardServiceConfigs_testing.js](../../../automation/config/environments/cardServiceConfigs_testing.js)).
- **Auth:** JWT bearer. `loginAndGetToken()` POSTs admin creds to `/api/v1/web/user/login` and returns `body.token`. Subsequent calls send `Authorization: Bearer <token>`. Passing `token=null` to `createGeneralCashbackPerk` omits the header (used for the 401 test).

### Endpoints exercised

| Endpoint | Method | Via |
|----------|--------|-----|
| `/api/v1/web/user/login` | POST | `loginAndGetToken(request)` |
| `/api/v1/web/card/perks/create` | POST | `createGeneralCashbackPerk(...)` |
| `/api/v1/web/card/perks/list` | POST (`{skip:1, filter:{}}`) | `listPerks(request, token)` |

### `createGeneralCashbackPerk` payload (confirmed from live API 2026-06-09)

```jsonc
POST /api/v1/web/card/perks/create
{
  "type": "general-cashback",            // hyphenated, top-level
  "title_en": "...", "title_ar": "...",
  "description_en": "...", "description_ar": "...",
  "start_date": "2026-06-09 20:00:00",
  "end_date":   "2026-12-31 23:59:59",
  "logo":    { "base64": "data:image/jpeg;base64,...", "ext": "jpeg", "name": "test.jpeg", "size": N },
  "logo_ar": { ... same ... },
  "perk_attributes": {
    "cover_photo":    { base64, ext, name, size },
    "cover_photo_ar": { base64, ext, name, size },
    "cashback_value":              1,
    "cashback_value_type":         "percentage" | "fixed",
    "minimum_transaction_amount":  1,
    "excluded_merchants_ids":      ["100001", "100002"],   // STRINGS, not ints
    "excluded_categories_ids":     []
  }
}
```

The image object is built once by an internal `getSharedImageObj(request)` that GETs an existing test image (`/media/bcard-testing-card-perks/logo/en/9b652e2b-...jpeg`) and caches it, so parallel tests share one fetch (no real upload needed). `buildMerchantIds(count, offset)` generates the synthetic ID strings used for boundary tests.

Method signatures and a usage example are in [helpers.md](helpers.md#apihelper--helpersapihelperjs).

### API observations encoded in the suite ([mid_exclusion_api.spec.js](../../../automation/legacy/tests/mid_exclusion_api.spec.js))

- Accepts up to **200** excluded merchant IDs (200 OK); **201** → 4xx validation error.
- `null` `excluded_merchants_ids` → treated as empty (200 OK).
- No server-side guard on `cashback_value=0`, `cashback_value=101` (percentage), or `minimum_transaction_amount=0` — all accepted (documented, not bugs in B10-55168 scope).
- Auth enforced: missing token → 401; invalid token → 401.

---

## create_perks_api.js (standalone runner) — [create_perks_api.js](../../../automation/legacy/create_perks_api.js)

Not a Playwright spec — a `node` script (`node create_perks_api.js`). Creates its own `APIRequestContext` via `request.newContext()`, logs in, then creates three `general-cashback` perks across the MID-exclusion boundary (199 / 200 / 201 MIDs) and prints AS-EXPECTED / UNEXPECTED verdicts. Uses the same `ApiHelper.createGeneralCashbackPerk` + `buildMerchantIds` as the specs — good template for ad-hoc data seeding via the API.

---

## Implemented vs stubbed perk types

| Perk type | API client | Status |
|-----------|-----------|--------|
| **General spend cashback** | `ApiHelper.createGeneralCashbackPerk` | ✅ Done (UI + API) |
| **Merchant cashback** | UI only ([PerksPage.fillMerchantPerk](../../../automation/pages/PerksPage.js)) | ⚠️ Partial — branch MIDs wired; cashback-value/limit fields not yet. No dedicated API client. |
| **Coupon** | — | ❌ Not captured (PerksPage `fillCouponPerk` throws). |
| **Category cashback (MCC)** | — | ❌ Not captured (PerksPage `fillCategoryPerk` throws). |
| **Limits / caps** (daily/weekly/monthly/annual/max) | — | ❌ Not captured (PerksPage `setLimits` throws). |

There is currently **no API helper** for merchant/coupon/category perk creation — only the general-cashback `create` endpoint is wrapped. See open items #8/#10 in [AUTOMATION_B10-55185.md](../../../automation/legacy/AUTOMATION_B10-55185.md).
