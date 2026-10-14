'use strict';

/**
 * BreadfastUserRegistrar — registers a brand-new Breadfast customer via API, Playwright-native.
 *
 * Playwright port of the Java TestExecutionHelper.registerUsingApi (D:\projects), and a standalone
 * replacement for CardUserFactory.registerOnly():
 *   - HTTP goes through Playwright's APIRequestContext (shows up in traces, reuses the `request` fixture)
 *   - the OTP is read from the Google Chat OTP space (mobile/otp_google_chat.js) — NO DB bastion, NO Slack
 *   - registration only: no card-service record (the "non-active BCard" state)
 *
 * Flow:
 *   1. random EG mobile / name / unique email
 *   2. POST /wp-json/breadfast/v4/user/send-otp
 *   3. poll Google Chat for "Message for <phone> is Your verification code is: NNNN"
 *   4. POST /wp-json/breadfast/v4/user/verify-otp -> data.register_token (JWT)
 *   5. POST /wp-json/breadfast/v4/user/register   -> data.id (breadfast_id)   [form-urlencoded]
 *
 * Usage (inside a spec, reusing the fixture):
 *   const BreadfastUserRegistrar = require('../../../automation/helpers/BreadfastUserRegistrar');
 *   test('...', async ({ request }) => {
 *     const user = await new BreadfastUserRegistrar(request).register();
 *   });
 *
 * Usage (beforeAll / standalone script — owns its own context):
 *   const registrar = new BreadfastUserRegistrar();
 *   const user = await registrar.register();
 *   await registrar.dispose();
 *
 * Returns { phone, localPhone, searchMobile, breadfastId, email, firstName, lastName, otp, raw }.
 * URLs / country / email template come from CardConfig (Java property files). Google Chat creds come
 * from env GOOGLE_CHAT_* or config_testing.properties — see otp_google_chat.js.
 */

const { request: playwrightRequest } = require('@playwright/test');
const cfg          = require('./CardConfig');
const { fetchOtp } = require('../mobile/otp_google_chat');

const SEND_OTP   = '/wp-json/breadfast/v4/user/send-otp';
const VERIFY_OTP = '/wp-json/breadfast/v4/user/verify-otp';
const REGISTER   = '/wp-json/breadfast/v4/user/register';

// Request shape copied from the real app's traffic (HARs in B10-59340/evidence, captured 2026-09-13 on
// new-testing, iOS 2026.37.0 + Android 2026.38.0):
//   - `accept-version` is the app's CALENDAR version (2026.38.0). Semver-looking values fail:
//     absent → 422, 1.0.0–3.0.0 → 426 "please update the app", 4.0.0/5.0.0 → 422 "Something went wrong".
//   - phone is sent LOCAL (1150211684 — no +20, no leading 0) with country_code "EG".
//   - send-otp also carries a `g-recaptcha-response` token from the app. Whether testing enforces it is
//     unverified; pass `recaptchaToken` (or BF_RECAPTCHA_TOKEN) if send-otp keeps answering 422.
//   - register is form-urlencoded, not JSON.
// Bump BF_ACCEPT_VERSION when a newer app release raises the minimum (426 again = too old).
const DEFAULT_ACCEPT_VERSION = process.env.BF_ACCEPT_VERSION || '2026.38.0';
const APP_HEADERS = { accept: 'application/json', 'accept-language': 'en', 'user-agent': 'okhttp/5.0.0-alpha.2' };

// ── random test data (mirrors UserDataFactory / CardUserFactory) ────────────
const COMPANY_PREFIX = { Etisalat: '11', Vodafone: '10', Orange: '12', WE: '15' };

function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; } // inclusive

function randomEgyptianMobile() {
  const company = COMPANY_PREFIX[cfg.mobileCompany] || '11';
  return `${cfg.phonePrefix}${company}${randInt(10000000, 99999999)}`;
}

function randomName(len = 6) {
  const a = 'abcdefghijklmnopqrstuvwxyz';
  let s = '';
  for (let i = 0; i < len; i++) s += a[randInt(0, 25)];
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function uniqueEmail(localPhone) {
  const ts = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
  return cfg.testEmail.replace('@', `_${ts}_${randInt(0, 999999)}_${localPhone}@`);
}

class BreadfastUserRegistrar {
  /**
   * @param {import('@playwright/test').APIRequestContext} [request] Playwright `request` fixture.
   *        Omit it to let the registrar create (and later dispose) its own context.
   * @param {{ otpTimeoutMs?: number, otpLookbackMs?: number, acceptVersion?: string,
   *           recaptchaToken?: string, extraHeaders?: Record<string,string>, log?: Function }} [options]
   */
  constructor(request, {
    otpTimeoutMs = 90000, otpLookbackMs = 30000,
    acceptVersion = DEFAULT_ACCEPT_VERSION, recaptchaToken = process.env.BF_RECAPTCHA_TOKEN,
    extraHeaders = {}, log = console.log,
  } = {}) {
    this._request = request || null;
    this._ownsContext = !request;
    this.headers = { ...APP_HEADERS, 'accept-version': acceptVersion, ...extraHeaders };
    this.recaptchaToken = recaptchaToken;
    this.otpTimeoutMs = otpTimeoutMs;
    this.otpLookbackMs = otpLookbackMs;
    this.log = log;
  }

  /**
   * Register a new Breadfast user. Retries with a fresh phone when the backend rejects the
   * random number or it is already taken.
   * @param {{ phone?: string, firstName?: string, lastName?: string, email?: string, refCode?: string }} [overrides]
   */
  async register(overrides = {}, maxAttempts = 3) {
    let lastErr;
    for (let i = 1; i <= maxAttempts; i++) {
      try { return await this._registerOnce(overrides); }
      catch (e) {
        lastErr = e;
        // Only phone-specific rejections are worth a new number; 422/426/429 gate errors fail every phone.
        const retryable = !overrides.phone && /invalid phone|already (exists|registered)/i.test(e.message);
        if (!retryable || i === maxAttempts) throw e;
        this.log(`[register] ${e.message} — retrying with a new number (${i}/${maxAttempts})`);
      }
    }
    throw lastErr;
  }

  /** Dispose the internally created request context (no-op when a fixture was injected). */
  async dispose() {
    if (this._ownsContext && this._request) await this._request.dispose();
    this._request = null;
  }

  // ── internals ──────────────────────────────────────────────────────────────

  async _registerOnce(overrides) {
    const phone      = overrides.phone || randomEgyptianMobile();   // +2011XXXXXXXX — Google Chat's format
    const localPhone = phone.replace(cfg.phonePrefix, '');           // 11XXXXXXXX   — the API's format
    const firstName  = overrides.firstName || randomName();
    const lastName   = overrides.lastName || randomName();
    const email      = overrides.email || uniqueEmail(localPhone);
    const country    = cfg.countryCode;

    // Only accept OTP messages sent after this request, so a stale code for a reused phone is ignored.
    const otpNotBefore = Date.now() - this.otpLookbackMs;

    const sendBody = { phone: localPhone, country_code: country };
    if (this.recaptchaToken) sendBody['g-recaptcha-response'] = this.recaptchaToken;
    const send = await this._post(SEND_OTP, { data: sendBody });
    if (!send.ok) throw new Error(`send-otp failed for ${phone}: ${send.describe()}`);

    const otp = await this._readOtpFromGoogleChat(phone, otpNotBefore);

    const verify = await this._post(VERIFY_OTP, { data: { otp, phone: localPhone, country_code: country } });
    const registerToken = verify.json?.data?.register_token ?? verify.json?.register_token;
    if (!verify.ok || !registerToken) throw new Error(`verify-otp returned no register_token for ${phone}: ${verify.describe()}`);

    const reg = await this._post(REGISTER, {
      form: { first_name: firstName, last_name: lastName, email, ref_code: overrides.refCode || '', register_token: registerToken },
    });
    const id = reg.json?.data?.id ?? reg.json?.data?.user?.id ?? reg.json?.id;
    if (!reg.ok || id == null) throw new Error(`register returned no user id for ${phone}: ${reg.describe()}`);
    const breadfastId = String(id);

    this.log(`[register] created ${phone} -> breadfast_id ${breadfastId}`);
    return {
      phone, localPhone, searchMobile: phone.replace('+2', ''),
      breadfastId, email, firstName, lastName, otp, raw: reg.json,
    };
  }

  async _readOtpFromGoogleChat(phone, notBefore) {
    this.log(`[register] waiting for OTP for ${phone} in the Google Chat OTP space…`);
    const hit = await fetchOtp(phone, { timeoutMs: this.otpTimeoutMs, notBefore });
    if (!hit?.otp) throw new Error(`no OTP for ${phone} in Google Chat within ${this.otpTimeoutMs} ms`);
    return String(hit.otp); // verify-otp 422s if handed the { otp, createTime, text } object
  }

  async _ctx() {
    if (!this._request) this._request = await playwrightRequest.newContext();
    return this._request;
  }

  /** POST with the app headers. `body` is Playwright's { data } (JSON) or { form } (urlencoded). */
  async _post(endpoint, body) {
    const ctx = await this._ctx();
    const res = await ctx.post(cfg.mobileBaseURL + endpoint, { ...body, headers: this.headers });
    const status = res.status();
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* empty or non-JSON */ }
    // Success = 2xx HTTP and, when the body carries its own `status`, a 2xx there too.
    const ok = status >= 200 && status < 300 && !(json?.status >= 300);
    const hint = status === 426 ? ' (accept-version too old — bump BF_ACCEPT_VERSION)'
      : status === 429 ? ' (rate-limited per IP — wait 15–30 min before retrying)' : '';
    return { status, json, text, ok, describe: () => `HTTP ${status} ${text.slice(0, 300)}${hint}` };
  }
}

module.exports = BreadfastUserRegistrar;

// `node automation/helpers/BreadfastUserRegistrar.js` — register one user and print it.
if (require.main === module) {
  (async () => {
    const registrar = new BreadfastUserRegistrar();
    try {
      const { raw, ...user } = await registrar.register();
      console.log(JSON.stringify(user, null, 2));
    } finally {
      await registrar.dispose();
    }
  })().catch((e) => { console.error('FAIL: ' + e.message); process.exit(1); });
}
