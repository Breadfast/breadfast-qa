'use strict';

const config = require('./ConfigReader');
const https  = require('https');
const http   = require('http');

const LOGIN_ENDPOINT       = '/api/v1/web/user/login';
const CREATE_PERK_ENDPOINT = '/api/v1/web/card/perks/create';
const LIST_PERKS_ENDPOINT  = '/api/v1/web/card/perks/list';

// Existing test-environment image used for all API test perks.
// Avoids needing real image uploads; the server accepts re-use of existing media files.
const TEST_IMG_URL  = '/media/bcard-testing-card-perks/logo/en/9b652e2b-1515-4178-9062-79776b5c5350.jpeg';

/**
 * Fetch a URL and return a Buffer.
 * Works in Node.js (no browser fetch available in Playwright worker threads).
 */
function fetchBuffer(fullUrl) {
  return new Promise((resolve, reject) => {
    const lib = fullUrl.startsWith('https') ? https : http;
    lib.get(fullUrl, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

/**
 * Build the image object the create endpoint expects:
 * { base64: 'data:image/jpeg;base64,...', ext: 'jpeg', name: 'test.jpeg', size: N }
 *
 * Images are fetched once and cached on the class so parallel tests share one fetch.
 */
let _cachedImg = null;
async function getSharedImageObj(request) {
  if (_cachedImg) return _cachedImg;

  const baseUrl = config.getCardServicesAdminPanelBaseURL();
  // Use Playwright APIRequestContext so no extra Node deps are needed
  const resp = await request.get(baseUrl + TEST_IMG_URL);
  const body = await resp.body(); // Buffer
  const b64  = 'data:image/jpeg;base64,' + body.toString('base64');
  _cachedImg = { base64: b64, ext: 'jpeg', name: 'test.jpeg', size: body.length };
  return _cachedImg;
}

/**
 * ApiHelper — thin wrapper around Playwright's APIRequestContext.
 *
 * Correct payload format confirmed from live API (2026-06-09):
 *   POST /api/v1/web/card/perks/create
 *   {
 *     "type": "general-cashback",          // hyphen-separated, top-level
 *     "title_en": "...", "title_ar": "...",
 *     "description_en": "...", "description_ar": "...",
 *     "start_date": "YYYY-MM-DD HH:mm:ss",
 *     "end_date":   "YYYY-MM-DD HH:mm:ss",
 *     "logo":    { "base64": "data:image/jpeg;base64,...", "ext": "jpeg", "name": "x.jpeg", "size": N },
 *     "logo_ar": { ... same ... },
 *     "perk_attributes": {
 *       "cover_photo":    { base64, ext, name, size },
 *       "cover_photo_ar": { base64, ext, name, size },
 *       "cashback_value":              1,
 *       "cashback_value_type":         "percentage" | "fixed",
 *       "minimum_transaction_amount":  1,
 *       "excluded_merchants_ids":      ["id1", "id2"],   // strings, not integers
 *       "excluded_categories_ids":     []
 *     }
 *   }
 */
class ApiHelper {
  /**
   * Login to the Card Admin Panel and return the JWT token.
   * @param {import('@playwright/test').APIRequestContext} request
   * @returns {Promise<string>} JWT token
   */
  static async loginAndGetToken(request) {
    const response = await request.post(
      config.getCardServicesAdminPanelBaseURL() + LOGIN_ENDPOINT,
      {
        headers: { 'Content-Type': 'application/json' },
        data: {
          username: config.getAdminUserName(),
          password: config.getAdminPassword(),
        },
      }
    );

    if (!response.ok()) {
      throw new Error(
        `Admin login failed: HTTP ${response.status()} — ${await response.text()}`
      );
    }

    const body = await response.json();
    if (!body.token) {
      throw new Error(`Admin login succeeded but no token in response: ${JSON.stringify(body)}`);
    }
    return body.token;
  }

  /**
   * POST /api/v1/web/card/perks/create — general-cashback perk.
   *
   * @param {import('@playwright/test').APIRequestContext} request
   * @param {string|null}  token                Bearer JWT (null = omit auth header)
   * @param {string[]|null} excludedMerchantIds  Merchant ID strings (null = empty array)
   * @param {number}       cashbackValue
   * @param {string}       cashbackValueType     'percentage' | 'fixed'
   * @param {number}       minTxAmount
   * @returns {Promise<import('@playwright/test').APIResponse>}
   */
  static async createGeneralCashbackPerk(
    request,
    token,
    excludedMerchantIds = [],
    cashbackValue = 1,
    cashbackValueType = 'percentage',
    minTxAmount = 1,
    titleEn = 'B10-55168 API Test'
  ) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const img = await getSharedImageObj(request);

    return request.post(
      config.getCardServicesAdminPanelBaseURL() + CREATE_PERK_ENDPOINT,
      {
        headers,
        data: {
          type:           'general-cashback',
          title_en:       titleEn,
          title_ar:       'اختبار API',
          description_en: 'Automated test perk — B10-55168',
          description_ar: 'اختبار تلقائي',
          start_date:     '2026-06-09 20:00:00',
          end_date:       '2026-12-31 23:59:59',
          logo:           img,
          logo_ar:        img,
          perk_attributes: {
            cover_photo:                img,
            cover_photo_ar:             img,
            cashback_value:             cashbackValue,
            cashback_value_type:        cashbackValueType,
            minimum_transaction_amount: minTxAmount,
            excluded_merchants_ids:     excludedMerchantIds ?? [],
            excluded_categories_ids:    [],
          },
        },
      }
    );
  }

  /**
   * Build an array of N distinct merchant ID strings.
   * @param {number} count
   * @param {number} [offset=1]
   * @returns {string[]}
   */
  static buildMerchantIds(count, offset = 1) {
    return Array.from({ length: count }, (_, i) => String(100000 + offset + i));
  }

  /**
   * Short (<=20 char) unique fixture title encoding status + type so the created
   * perk is findable in the table and self-describing (e.g. AutoPLDC123456).
   * Kept short because the create form enforces a 20-char title cap (B10-56729).
   * @param {string} type   'discount-coupon'|'merchant-cashback'|'category-cashback'|'general-cashback'
   * @param {string} status 'planned'|'active'|'expired'
   */
  static _fixtureTitle(type, status) {
    const t = { 'discount-coupon': 'DC', 'merchant-cashback': 'MC', 'category-cashback': 'CC', 'general-cashback': 'GC' }[type] || 'GP';
    const s = { planned: 'PL', active: 'AC', expired: 'EX' }[status] || 'XX';
    return `Auto${s}${t}${String(Date.now()).slice(-6)}`;
  }

  /**
   * Build start/end dates that place a perk in the requested lifecycle status,
   * driven purely by date (Planned = starts in the future, Active = started &
   * not yet ended, Expired = already ended). Format matches the create endpoint
   * ("YYYY-MM-DD HH:mm:ss").
   * @param {string} status 'planned'|'active'|'expired'
   * @returns {{start_date:string, end_date:string}}
   */
  static _dateRange(status) {
    const DAY = 24 * 60 * 60 * 1000;
    const now = Date.now();
    const fmt = (ms) => {
      const d = new Date(ms);
      const p = (n) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
    };
    if (status === 'planned') return { start_date: fmt(now + 7 * DAY),  end_date: fmt(now + 60 * DAY) };
    if (status === 'expired') return { start_date: fmt(now - 60 * DAY), end_date: fmt(now - 7 * DAY) };
    return { start_date: fmt(now - 7 * DAY), end_date: fmt(now + 60 * DAY) }; // active
  }

  /**
   * Status/type-aware fixture factory (B10-56759). Generalizes
   * createGeneralCashbackPerk so a spec can CREATE the exact Planned/Active/
   * Expired × (discount-coupon | merchant-cashback | category-cashback |
   * general-cashback) perk it needs instead of skipping when the environment
   * lacks one (per tester feedback). Lifecycle status is driven by date
   * (_dateRange). Returns the created perk's title (always) and id (when the
   * response exposes one) so the caller can locate the row in the table.
   *
   * Type-specific perk_attributes (merchant ids / category code / coupon
   * code+type) are UNCONFIRMED against the live create API (authored during the
   * card-panel backend outage); pass explicit values or `attributes` overrides
   * when the live payload shape is known. Throws on a non-2xx response so a bad
   * fixture surfaces loudly rather than a later confusing UI failure.
   *
   * @param {import('@playwright/test').APIRequestContext} request
   * @param {string|null} token
   * @param {object} opts
   * @param {string}  opts.type
   * @param {string}  opts.status
   * @param {string}  [opts.titleEn]
   * @param {string}  [opts.titleAr]
   * @param {string[]}[opts.merchantIds]
   * @param {string}  [opts.categoryCode]
   * @param {string}  [opts.couponCode]
   * @param {string}  [opts.couponType]     'online'|'physical'
   * @param {number}  [opts.cashbackValue]
   * @param {string}  [opts.cashbackValueType]
   * @param {number}  [opts.minTxAmount]
   * @param {object}  [opts.attributes]     extra perk_attributes merged last
   * @returns {Promise<{ok:boolean, httpStatus:number, id:(string|number|null), title:string, type:string, status:string, body:string}>}
   */
  static async createPerk(request, token, {
    type = 'general-cashback',
    status = 'active',
    titleEn,
    titleAr = 'اختبار تلقائي',
    merchantIds = null,
    categoryCode = null,
    couponCode = null,
    couponType = 'online',
    cashbackValue = 1,
    cashbackValueType = 'percentage',
    minTxAmount = 1,
    attributes = {},
  } = {}) {
    const dates = ApiHelper._dateRange(status);
    const title = titleEn || ApiHelper._fixtureTitle(type, status);
    const img   = await getSharedImageObj(request);

    const perkAttributes = {
      cover_photo:                img,
      cover_photo_ar:             img,
      cashback_value:             cashbackValue,
      cashback_value_type:        cashbackValueType,
      minimum_transaction_amount: minTxAmount,
      excluded_merchants_ids:     [],
      excluded_categories_ids:    [],
    };
    if (merchantIds)  perkAttributes.merchant_ids = merchantIds;
    if (categoryCode) perkAttributes.category_code = categoryCode;
    if (couponCode) {
      perkAttributes.coupon_code = couponCode;
      perkAttributes.coupon_type = couponType;
    }
    Object.assign(perkAttributes, attributes);

    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const resp = await request.post(
      config.getCardServicesAdminPanelBaseURL() + CREATE_PERK_ENDPOINT,
      {
        headers,
        data: {
          type,
          title_en:       title,
          title_ar:       titleAr,
          description_en: 'Automated fixture — B10-56759',
          description_ar: 'اختبار تلقائي',
          start_date:     dates.start_date,
          end_date:       dates.end_date,
          logo:           img,
          logo_ar:        img,
          perk_attributes: perkAttributes,
        },
      }
    );

    const httpStatus = resp.status();
    let body = '';
    try { body = await resp.text(); } catch { /* ignore */ }
    if (!resp.ok()) {
      throw new Error(`createPerk(${type}/${status}) failed: HTTP ${httpStatus} — ${body}`);
    }
    let id = null;
    try {
      const j = JSON.parse(body);
      id = (j && (j.id || (j.data && j.data.id))) || null;
    } catch { /* body not JSON */ }

    return { ok: resp.ok(), httpStatus, id, title, type, status, body };
  }

  /**
   * POST /api/v1/web/card/perks/list — fetch the perks list.
   * Endpoint confirmed from live network inspection (2026-06-11):
   *   POST /api/v1/web/card/perks/list  body: {"skip":1,"filter":{}}
   *   Response: { data: [{ id, type, title_en, title_ar, perk_attributes: { cashback_value_type, excluded_merchants_ids } }] }
   *
   * @param {import('@playwright/test').APIRequestContext} request
   * @param {string} token  Bearer JWT
   * @returns {Promise<import('@playwright/test').APIResponse>}
   */
  static async listPerks(request, token) {
    return request.post(
      config.getCardServicesAdminPanelBaseURL() + LIST_PERKS_ENDPOINT,
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        data: { skip: 1, filter: {} },
      }
    );
  }
}

module.exports = ApiHelper;
