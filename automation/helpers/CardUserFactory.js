'use strict';

/**
 * CardUserFactory — dynamically provisions a Breadfast card user up to status "Registered"
 * via API (no static test-data sheet), and tears it down from the DB afterwards.
 *
 * Node port of the Java flow in cardService/adminPanel/CardAdminPanelTests + TestExecutionHelper
 * (registerUsingApi) + CardServiceApiClient. Replaces the deprecated test_data_inventory.csv.
 *
 * provision():
 *   1. generate a random EG mobile / national id / email / name
 *   2. POST /wp-json/breadfast/v4/user/send-otp
 *   3. read the OTP from breadfast_testing.bf_phone_otp_verification (DB, retry)
 *   4. POST /verify-otp -> register_token
 *   5. POST /register -> breadfast_id (data.id) + auth token
 *   6. card-service scheme login -> token
 *   7. createCardUser (encrypted)        -> status Pending
 *   8. setPasscode / createPin (encrypted) -> status Registered
 *   -> returns { phone, breadfastId, nationalId, email, firstName, lastName }
 *
 * destroy(phone): DELETE from actions_logger, wallet_user_sessions, wallet_users (by mobile_number)
 *   in cards_hades_testing — exactly the Java cleanup. (cards/external_user_balances only exist
 *   once a card is collected/linked; harmless to attempt, so we delete them too.)
 *
 * Secrets/URLs come from CardConfig (Java property files). DB access reuses DbHelper (SSH tunnel).
 */

const https = require('https');
const { URL } = require('url');
const cfg            = require('./CardConfig');
const { encryptData } = require('./EncryptionHelper');
const DbHelper       = require('./DbHelper');

const SEND_OTP   = '/wp-json/breadfast/v4/user/send-otp';
const VERIFY_OTP = '/wp-json/breadfast/v4/user/verify-otp';
const REGISTER   = '/wp-json/breadfast/v4/user/register';

// createCardUser name fields — Arabic, mirroring the Java framework (the card-service name
// fields are Arabic-only since B10-56336, so ASCII would 400). register() uses the random
// ASCII names; only the card-user record carries these.
const AR_FIRST_NAME = 'بثينة';
const AR_LAST_NAME  = 'مصطفى';

const SCHEME_LOGIN     = '/api/v1/web/user/login';
// Exclusive-launch invitation gate (must run before createCardUser): generate → export → consume.
const GEN_BATCH        = '/api/v1/web/invitation-codes/generate';
const EXPORT_CODE      = '/api/v1/web/invitation-codes/export';
const CONSUME_CODE     = '/api/v1/web/invitation-codes/consume';
const CREATE_CARD_USER = '/api/v1/web/wallet_users/createCardUser';
const ALL_WALLETS      = '/api/v1/web/wallet_users/allWallets';
const RECEIVED         = '/api/v1/web/wallet_users/received';   // collect (Registered → Received)
const CARDS_POOL       = '/api/v1/web/cards/pool';              // source of a valid, available package
const CREATE_PIN       = '/api/v2/mobile/wallet_users/createPin';
const CARD_STATUS      = '/api/v2/web/cards/status';
const UPDATE_CUSTOMER  = '/api/v1/web/wallet_users/update';        // KYC via API (editCustomerDetails)
const LOGIN_PASSCODE   = '/api/v2/mobile/wallet_users/login';       // -> user token (encrypted body)
const LINK_CARD        = '/api/v2/mobile/cards/link';               // Received -> Linked
const SET_CARD_PIN     = '/api/v1/mobile/cards/set-pin';            // -> webview_link to set card PIN
const ACTIVATE_CARD    = '/api/v1/mobile/cards/activate';           // Linked -> Active

// ── small HTTP(S) JSON client (works standalone in a Node script and in Playwright workers) ──
function postJson(fullUrl, bodyObj, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(fullUrl);
    const payload = Buffer.from(JSON.stringify(bodyObj), 'utf8');
    const req = https.request(
      {
        method: 'POST',
        hostname: u.hostname,
        port: u.port || 443,
        path: u.pathname + u.search,
        headers: { 'Content-Type': 'application/json', 'Content-Length': payload.length, ...headers },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json = null;
          try { json = JSON.parse(text); } catch { /* non-JSON */ }
          resolve({ status: res.statusCode, json, text });
        });
      }
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── random test data (mirrors UserDataFactory) ──────────────────────────────
const COMPANY_PREFIX = { Etisalat: '11', Vodafone: '10', Orange: '12', WE: '15' };

function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; } // inclusive

function randomEgyptianMobile() {
  const company = COMPANY_PREFIX[cfg.mobileCompany] || String(randInt(0, 2));
  // prefix (+20) + company (11) + 8 digits (10000000-99999999)
  return `${cfg.phonePrefix}${company}${randInt(10000000, 99999999)}`;
}

function luhnCheckDigit(number) {
  let sum = 0, alternate = false;
  for (let i = number.length - 1; i >= 0; i--) {
    let n = Number(number[i]);
    if (alternate) { n *= 2; if (n > 9) n -= 9; }
    sum += n; alternate = !alternate;
  }
  return (10 - (sum % 10)) % 10;
}

function randomEgyptianNationalId() {
  const century = randInt(0, 1) === 0 ? 2 : 3;            // 2 = 1900s, 3 = 2000s
  const startYear = century === 2 ? 1900 : 2000;
  const start = Date.UTC(startYear, 0, 1);
  const end   = Date.UTC(new Date().getUTCFullYear() - 18, new Date().getUTCMonth(), new Date().getUTCDate());
  const birth = new Date(start + Math.floor(Math.random() * (end - start)));
  const yy = String(birth.getUTCFullYear() % 100).padStart(2, '0');
  const mm = String(birth.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(birth.getUTCDate()).padStart(2, '0');
  const gov    = String(randInt(1, 29)).padStart(2, '0');
  const serial = String(randInt(1000, 9999)).padStart(4, '0');
  const base = `${century}${yy}${mm}${dd}${gov}${serial}`;
  return base + luhnCheckDigit(base);
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

class CardUserFactory {
  /**
   * Provision a brand-new card user up to status "Registered". Retries with a fresh phone when
   * the invitation consume rejects the random number ("Invalid phone number" — registration
   * accepts it but the invitation service validates EG ranges more strictly).
   * @returns {Promise<{phone:string, searchMobile:string, breadfastId:string, nationalId:string, email:string, firstName:string, lastName:string, localPhone:string}>}
   */
  async provision(opts = {}) {
    let lastErr;
    for (let i = 1; i <= 4; i++) {
      try { return await this._provisionOnce(opts); }
      catch (e) {
        lastErr = e;
        if (/Invalid phone number/i.test(e.message)) { console.warn(`[provision] invalid phone, retrying with a new number (${i}/4)`); continue; }
        throw e;
      }
    }
    throw lastErr;
  }

  /**
   * Register a breadfast user only (send-otp -> verify -> register), NO card record.
   * This is the "Non-active BCard" state: a logged-in user who has never created a BCard.
   * Returns { phone, searchMobile, breadfastId, email, firstName, lastName, localPhone }.
   */
  async registerOnly() {
    const phone      = randomEgyptianMobile();
    const localPhone = phone.replace(cfg.phonePrefix, '');
    const firstName  = randomName();
    const lastName   = randomName();
    const email      = uniqueEmail(localPhone);

    const send = await postJson(cfg.mobileBaseURL + SEND_OTP, { phone, country_code: cfg.countryCode });
    if (!(send.json && send.json.status === 200)) throw new Error(`send-otp failed for ${phone}: HTTP ${send.status} ${send.text}`);
    const otp = await this._readOtpFromDb(phone);
    if (!otp) throw new Error(`Could not read OTP for ${phone}`);
    const verify = await postJson(cfg.mobileBaseURL + VERIFY_OTP, { phone, country_code: cfg.countryCode, otp });
    const registerToken = verify.json?.data?.register_token;
    if (!registerToken) throw new Error(`verify-otp no register_token for ${phone}: ${verify.text}`);
    const reg = await postJson(cfg.mobileBaseURL + REGISTER, { first_name: firstName, last_name: lastName, email, ref_code: '', register_token: registerToken });
    const breadfastId = reg.json?.data?.id != null ? String(reg.json.data.id) : null;
    if (!breadfastId) throw new Error(`register no data.id for ${phone}: ${reg.text}`);
    return { phone, searchMobile: phone.replace('+2', ''), breadfastId, email, firstName, lastName, localPhone };
  }

  /**
   * Build a valid EG national id (Luhn-checked) that encodes a specific date of birth.
   * Used by B10-55294 to provision a card user whose national-id-derived DOB sits exactly on
   * the 15-year min-age boundary, so an edited birthdate can match the id and isolate the
   * min-age rule. Mirrors the digit layout of randomEgyptianNationalId.
   * @param {Date} dob
   */
  static nationalIdForDob(dob) {
    const year    = dob.getFullYear();
    const century = year >= 2000 ? '3' : '2';
    const yy      = String(year % 100).padStart(2, '0');
    const mm      = String(dob.getMonth() + 1).padStart(2, '0');
    const dd      = String(dob.getDate()).padStart(2, '0');
    const gov     = String(randInt(1, 29)).padStart(2, '0');
    const serial  = String(randInt(1000, 9999)).padStart(4, '0');
    const base    = `${century}${yy}${mm}${dd}${gov}${serial}`;
    return base + luhnCheckDigit(base);
  }

  async _provisionOnce(opts = {}) {
    const phone      = randomEgyptianMobile();
    const localPhone = phone.replace(cfg.phonePrefix, '');
    const nationalId = opts.nationalId || randomEgyptianNationalId();
    const firstName  = randomName();
    const lastName   = randomName();
    const email      = uniqueEmail(localPhone);

    // 2. send OTP
    const send = await postJson(cfg.mobileBaseURL + SEND_OTP, { phone, country_code: cfg.countryCode });
    if (!(send.json && send.json.status === 200)) {
      throw new Error(`send-otp failed for ${phone}: HTTP ${send.status} ${send.text}`);
    }

    // 3. read OTP from DB (retry, mirrors OtpFactory)
    const otp = await this._readOtpFromDb(phone);
    if (!otp) throw new Error(`Could not read OTP for ${phone} from bf_phone_otp_verification`);

    // 4. verify OTP -> register_token
    const verify = await postJson(cfg.mobileBaseURL + VERIFY_OTP, { phone, country_code: cfg.countryCode, otp });
    const registerToken = verify.json?.data?.register_token;
    if (!registerToken) {
      throw new Error(`verify-otp did not return register_token for ${phone}: HTTP ${verify.status} ${verify.text}`);
    }

    // 5. register -> breadfast_id
    const reg = await postJson(cfg.mobileBaseURL + REGISTER, {
      first_name: firstName, last_name: lastName, email, ref_code: '', register_token: registerToken,
    });
    const breadfastId = reg.json?.data?.id != null ? String(reg.json.data.id) : null;
    if (!breadfastId) throw new Error(`register did not return data.id for ${phone}: HTTP ${reg.status} ${reg.text}`);

    // 6. card-service scheme token
    const cardToken = await this._getCardServiceToken();

    // 6b. exclusive-launch invitation gate (generate → export → consume), mirroring
    //     BCardTestsExecutionHelper — without it createCardUser 400s "Access is by invitation only".
    //     Occasionally flaky (export/consume races), so retry the whole gate.
    let invErr = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const batchId = await this._generateInvitationBatch(cardToken);
        const invitationCode = await this._exportInvitationCode(batchId, cardToken);
        await this._consumeInvitationCode(phone, breadfastId, invitationCode, cardToken);
        invErr = null;
        break;
      } catch (e) {
        invErr = e;
        await sleep(1500);
      }
    }
    if (invErr) throw invErr;

    // 7. createCardUser -> Pending (Arabic names, mirroring the Java framework)
    await this._postEncrypted(CREATE_CARD_USER, {
      mobile_number: phone, breadfast_id: breadfastId, email,
      first_name: AR_FIRST_NAME, remaining_name: AR_LAST_NAME,
      national_id: nationalId, national_id_expiry_date: cfg.nationalIdExpiry,
    }, cardToken);
    const pending = await this._getCardStatus(breadfastId, cardToken);
    if (pending !== 'Pending') throw new Error(`expected Pending after createCardUser, got "${pending}" (${phone})`);

    // 8. setPasscode / createPin -> Registered
    await this._postEncrypted(CREATE_PIN, {
      breadfast_id: breadfastId, mpin: cfg.passcode, device_info: { device_id: `qa-${Date.now()}` },
    }, null); // createPin sends no Authorization header (matches Java)
    const registered = await this._getCardStatus(breadfastId, cardToken);
    if (registered !== 'Registered') throw new Error(`expected Registered after setPasscode, got "${registered}" (${phone})`);

    // searchMobile = what the admin-panel search box expects (the "+2"-stripped form, e.g. 011XXXXXXXX)
    const searchMobile = phone.replace('+2', '');
    return { phone, searchMobile, breadfastId, nationalId, email, firstName, lastName, localPhone };
  }

  /**
   * A random 6-digit package number for the collect flow. Collection enforces uniqueness
   * (/received 400 "...already assigned..."), so callers should retry with a fresh one on
   * collision. Random over 900k values makes a collision rare.
   */
  static randomPackageNumber() {
    return String(randInt(100000, 999999));
  }

  /**
   * Get a VALID, available collect package number from the cards-pool API (mirrors the Java
   * getCardsPool). /received rejects arbitrary or raw-pool-table numbers with "Invalid Package
   * Number" — only a card returned by this endpoint is collectable.
   */
  async claimPackageFromPool() {
    const token = await this._getCardServiceToken();
    const r = await postJson(
      cfg.cardServicesBaseURL + CARDS_POOL,
      { cardsCount: 1, contractNumber: cfg.contractNumber, typeId: cfg.typeId, productNumber: cfg.productNumber },
      { Authorization: token }
    );
    const pkg = r.json?.data?.[0]?.packageNumber;
    if (!pkg) throw new Error(`getCardsPool returned no package: HTTP ${r.status} ${r.text}`);
    return String(pkg);
  }

  /**
   * Delete the provisioned user from the card-services DB (by mobile_number). Idempotent.
   * @param {string} phone  e.g. "+2011XXXXXXXX"
   */
  async destroy(phone) {
    const db = new DbHelper(cfg.cardDb);   // live card DB (separate host from the OTP DB)
    await db.connect();
    try {
      const D = cfg.cardDb.db.database;     // cards_hades_testing
      const sub = `(SELECT id FROM ${D}.wallet_users WHERE mobile_number = ?)`;
      // child rows first (FK-safe order), then the user
      await db.query(`DELETE FROM ${D}.actions_logger        WHERE user_id        IN ${sub}`, [phone]).catch(() => {});
      await db.query(`DELETE FROM ${D}.wallet_user_sessions   WHERE wallet_user_id IN ${sub}`, [phone]).catch(() => {});
      await db.query(`DELETE FROM ${D}.cards                  WHERE walletUserId   IN ${sub}`, [phone]).catch(() => {});
      await db.query(`DELETE FROM ${D}.external_user_balances WHERE user_id        IN ${sub}`, [phone]).catch(() => {});
      await db.query(`DELETE FROM ${D}.cards_pickup_package   WHERE wallet_user_id IN ${sub}`, [phone]).catch(() => {}); // free the package back to the pool
      const res = await db.query(`DELETE FROM ${D}.wallet_users WHERE mobile_number = ?`, [phone]);
      if (!res || !res.affectedRows) {
        console.warn(`[teardown] WARNING: deleted 0 wallet_users rows for ${phone} — user may be orphaned (check card DB host/creds).`);
      }
      return res;
    } finally {
      await db.close();
    }
  }

  /**
   * Collect the card via the /received API (Registered → Received), mirroring the Java
   * framework's collectCard. KYC must already be complete (the spec fills it via the UI first).
   * Looks up the wallet_users UUID via allWallets. Returns {status, message}.
   */
  async collectViaApi(searchMobile, packageNumber) {
    const token = await this._getCardServiceToken();
    const look = await postJson(
      cfg.cardServicesBaseURL + ALL_WALLETS,
      { mobile_number: searchMobile, bcid: '', last_4: '', national_id: '' },
      { Authorization: token }
    );
    const walletUserId = look.json?.data?.[0]?.id;
    if (!walletUserId) throw new Error(`collectViaApi: wallet user not found for ${searchMobile}`);
    const r = await postJson(
      cfg.cardServicesBaseURL + RECEIVED,
      { walletUserId, packageNumber, pickupLocationId: String(cfg.pickupLocationId) },
      { Authorization: token }
    );
    return { status: r.status, message: (r.json && r.json.message) || r.text || '', walletUserId };
  }

  /** Authoritative existence check via the same API the admin panel uses (not the DB). */
  async existsViaApi(searchMobile) {
    const token = await this._getCardServiceToken();
    const r = await postJson(
      cfg.cardServicesBaseURL + ALL_WALLETS,
      { mobile_number: searchMobile, bcid: '', last_4: '', national_id: '' },
      { Authorization: token }
    );
    const data = r.json && r.json.data;
    return Array.isArray(data) && data.length > 0 ? data[0] : null;
  }

  /** Look up the card-services wallet_users UUID for a phone (admin search form). */
  async lookupWalletUserId(searchMobile, token) {
    token = token || await this._getCardServiceToken();
    const r = await postJson(
      cfg.cardServicesBaseURL + ALL_WALLETS,
      { mobile_number: searchMobile, bcid: '', last_4: '', national_id: '' },
      { Authorization: token }
    );
    return r.json?.data?.[0]?.id || null;
  }

  /** Complete KYC via the update API (mirrors Java editCustomerDetails) — required before collect. */
  async editKyc(searchMobile, nationalId, token) {
    token = token || await this._getCardServiceToken();
    const walletUserId = await this.lookupWalletUserId(searchMobile, token);
    if (!walletUserId) throw new Error(`editKyc: wallet user not found for ${searchMobile}`);
    // B10-56336 extended KYC: occupation/address/issuing_authority/nationality/place-of-birth are
    // now mandatory + Arabic-only; has_other_nationalities + is_adib_customer mandatory; issuing_date
    // must be in the past. Server validates one field at a time — send the full Arabic set.
    // EG national id encodes DOB: [0]=century(2->19xx,3->20xx) [1:3]=YY [3:5]=MM [5:7]=DD.
    // The update API cross-checks birthdate against it, so derive birthdate (DD-MM-YYYY) from the id.
    const cc = nationalId[0] === '3' ? '20' : '19';
    const birthdate = `${nationalId.slice(5, 7)}-${nationalId.slice(3, 5)}-${cc}${nationalId.slice(1, 3)}`;
    const body = {
      userId: walletUserId,
      fname: AR_FIRST_NAME, lname: AR_LAST_NAME,
      birthdate, gender: 'female',
      address: 'شارع التحرير ١٢', city: 'القاهرة',
      nationality: 'مصري', national_id: nationalId, expiry_date: cfg.nationalIdExpiry,
      issuing_authority: 'القاهرة', issuing_date: '01-01-2015',
      has_other_nationalities: 'No', is_adib_customer: 'No',
      occupation: 'طبيب',
    };
    const r = await postJson(cfg.cardServicesBaseURL + UPDATE_CUSTOMER, body, { Authorization: token });
    if (r.status !== 200) throw new Error(`update(KYC) failed: HTTP ${r.status} ${r.text}`);
    return { walletUserId, message: r.json?.message };
  }

  /** Claim a valid, available card from the pool — returns BOTH packageNumber and bcid (cardToken). */
  async claimCardFromPool(token) {
    token = token || await this._getCardServiceToken();
    const r = await postJson(
      cfg.cardServicesBaseURL + CARDS_POOL,
      { cardsCount: 1, contractNumber: cfg.contractNumber, typeId: cfg.typeId, productNumber: cfg.productNumber },
      { Authorization: token }
    );
    const d = r.json?.data?.[0];
    if (!d || !d.packageNumber) throw new Error(`getCardsPool returned no package: HTTP ${r.status} ${r.text}`);
    return { packageNumber: String(d.packageNumber), bcid: String(d.cardToken) };
  }

  /** Mobile passcode login -> user token (for link/set-pin/activate). Encrypted body, mirrors Java. */
  async loginByPasscode(breadfastId) {
    const body = { breadfast_id: breadfastId, mpin: cfg.passcode, scheme_id: 1, device_info: { device_id: `qa-${Date.now()}` } };
    const data = encryptData(JSON.stringify(body), cfg.pubKeyPath);
    const r = await postJson(cfg.cardServicesBaseURL + LOGIN_PASSCODE, { data }, {});
    const token = r.json?.token;
    if (!token) throw new Error(`loginByPasscode failed: HTTP ${r.status} ${r.text}`);
    return token;
  }

  /**
   * Get the mobile USER token via the OTP login (the device-binding flow that supersedes the
   * plain passcode login). In testing the OTP = last 4 digits of the phone. Encrypted body,
   * card-panel host. This is the working token source for link/set-pin/activate.
   *   POST /api/v1/mobile/wallet_users/login/otp  {mobile_number, scheme_id, otp, device_info}
   * @param {string} phone  e.g. "+2011XXXXXXXX"
   */
  async loginViaOtp(phone, breadfastId, deviceId = '1') {
    const otp = phone.slice(-4);
    // 1) passcode login. If the device is already trusted it returns {message:login_success, token}.
    //    If it's a new device it returns {otpRequired:true} + sends an OTP (a fresh verification row).
    if (breadfastId) {
      const trig = encryptData(JSON.stringify({ breadfast_id: breadfastId, mpin: cfg.passcode, scheme_id: 1, device_info: { device_id: deviceId } }), cfg.pubKeyPath);
      const tr = await postJson(cfg.cardServicesBaseURL + LOGIN_PASSCODE, { data: trig }, {});
      if (tr.json?.token) return tr.json.token;   // device trusted -> token directly
    }
    // 2) otpRequired path: exchange the deterministic OTP (last 4 of phone) for the user token
    //    (encrypted body, card-panel host). Must run while the verification row is fresh.
    const data = encryptData(JSON.stringify({ mobile_number: phone, scheme_id: 1, otp, device_info: { device_id: deviceId } }), cfg.pubKeyPath);
    const r = await postJson(cfg.cardServicesBaseURL + '/api/v1/mobile/wallet_users/login/otp', { data }, {});
    const token = r.json?.token;
    if (!token) throw new Error(`loginViaOtp failed: HTTP ${r.status} ${r.text}`);
    return token;
  }

  /** API fallback: Received -> Linked. Plaintext {bcid}, Authorization = user token. */
  async linkCardApi(userToken, bcid) {
    const r = await postJson(cfg.cardServicesBaseURL + LINK_CARD, { bcid }, { Authorization: userToken });
    if (r.status !== 200) throw new Error(`link failed: HTTP ${r.status} ${r.text}`);
    return r.json?.message;
  }

  /** API fallback: request set-pin webview link (must drive it to set card PIN before activate). */
  async setPinApi(userToken) {
    const r = await postJson(cfg.cardServicesBaseURL + SET_CARD_PIN, {}, { Authorization: userToken });
    if (r.status !== 200) throw new Error(`set-pin failed: HTTP ${r.status} ${r.text}`);
    return r.json?.data?.webview_link;
  }

  /** API fallback: Linked -> Active (card PIN must already be set via the webview). */
  async activateApi(userToken) {
    const r = await postJson(cfg.cardServicesBaseURL + ACTIVATE_CARD, {}, { Authorization: userToken });
    if (r.status !== 200) throw new Error(`activate failed: HTTP ${r.status} ${r.text}`);
    return r.json?.message;
  }

  /** Public card-status read by breadfast id. */
  async status(breadfastId) {
    return this._getCardStatus(breadfastId, await this._getCardServiceToken());
  }

  /**
   * Provision a fresh user all the way to "Received" via API (no UI):
   * provision()->Registered -> editKyc -> claimCardFromPool -> collectViaApi -> Received.
   * Returns the provision object plus {packageNumber, bcid, status:'Received'}.
   */
  async provisionToReceived() {
    const u = await this.provision();
    const token = await this._getCardServiceToken();
    await this.editKyc(u.searchMobile, u.nationalId, token);
    const { packageNumber, bcid } = await this.claimCardFromPool(token);
    const col = await this.collectViaApi(u.searchMobile, packageNumber);
    if (col.status !== 200) throw new Error(`collect failed: HTTP ${col.status} ${col.message}`);
    const st = await this._getCardStatus(u.breadfastId, token);
    return { ...u, packageNumber, bcid, status: st };
  }

  // ── internals ──────────────────────────────────────────────────────────────

  async _readOtpFromDb(phone, maxRetries = 6) {
    const db = new DbHelper();
    await db.connect();
    try {
      for (let i = 1; i <= maxRetries; i++) {
        const rows = await db.query(
          'SELECT otp FROM breadfast_testing.bf_phone_otp_verification WHERE phone = ? ORDER BY id DESC LIMIT 1',
          [phone]
        );
        const otp = rows[0] && rows[0].otp != null ? String(rows[0].otp).trim() : '';
        if (otp) return otp;
        await sleep(2000);
      }
      return null;
    } finally {
      await db.close();
    }
  }

  async _getCardServiceToken() {
    const r = await postJson(
      cfg.cardServicesBaseURL + SCHEME_LOGIN,
      { username: cfg.schemeUser, password: cfg.schemePass },
      { 'x-ref-token': cfg.whitelistToken }
    );
    const token = r.json?.token;
    if (!token) throw new Error(`card-service scheme login failed: HTTP ${r.status} ${r.text}`);
    return token;
  }

  async _generateInvitationBatch(authToken) {
    const r = await postJson(cfg.cardServicesBaseURL + GEN_BATCH, { numberOfCodes: 1 }, { Authorization: authToken });
    const id = r.json?.data?.id;
    if (r.status !== 200 || id == null) throw new Error(`generate invitation batch failed: HTTP ${r.status} ${r.text}`);
    return String(id);
  }

  async _exportInvitationCode(batchId, authToken) {
    const r = await postJson(cfg.cardServicesBaseURL + EXPORT_CODE, { batchId: Number(batchId) }, { Authorization: authToken });
    if (r.status !== 200) throw new Error(`export invitation code failed: HTTP ${r.status} ${r.text}`);
    // Response is CSV; the code is the first cell of the last non-empty (data) row (mirrors Java).
    const rows = (r.text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const last = rows[rows.length - 1] || '';
    const code = (last.split(',')[0] || '').replace(/^"|"$/g, '').trim();
    if (!code) throw new Error(`export invitation code: could not parse code from CSV: ${r.text}`);
    return code;
  }

  async _consumeInvitationCode(phone, breadfastId, invitationCode, authToken) {
    const r = await postJson(
      cfg.cardServicesBaseURL + CONSUME_CODE,
      { mobileNumber: phone, invitationCode, breadfastId },
      { Authorization: authToken }
    );
    if (r.status !== 200) throw new Error(`consume invitation code failed: HTTP ${r.status} ${r.text}`);
    return r.json;
  }

  async _postEncrypted(endpoint, bodyObj, authToken) {
    const headers = {};
    if (authToken) headers['Authorization'] = authToken; // raw token, not "Bearer" (matches Java)
    const data = encryptData(JSON.stringify(bodyObj), cfg.pubKeyPath);
    const r = await postJson(cfg.cardServicesBaseURL + endpoint, { data }, headers);
    if (r.status !== 200) throw new Error(`${endpoint} failed: HTTP ${r.status} ${r.text}`);
    return r.json;
  }

  async _getCardStatus(breadfastId, authToken) {
    const data = encryptData(JSON.stringify({ breadfast_id: breadfastId }), cfg.pubKeyPath);
    const r = await postJson(cfg.cardServicesBaseURL + CARD_STATUS, { data }, { Authorization: authToken });
    if (r.status !== 200) throw new Error(`cards/status failed: HTTP ${r.status} ${r.text}`);
    return r.json?.data?.status ?? null;
  }
}

module.exports = CardUserFactory;
