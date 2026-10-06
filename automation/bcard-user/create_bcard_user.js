#!/usr/bin/env node
'use strict';

/**
 * create_bcard_user — create a BCard test user at any stage of the card lifecycle, by API.
 *
 *   account → Pending → Registered → Received → Linked → Active
 *
 *   account     a Breadfast customer account with NO card record (card status "NA")
 *   pending     + invitation code consumed + createCardUser
 *   registered  + passcode set (createPin)                       [--kyc also completes KYC]
 *   received    + KYC + a card from the pool collected at the pickup location
 *   linked      + the card linked to the user (mobile OTP login → cards/link)
 *   active      + set-pin → card PIN → cards/activate
 *
 * Card PIN (--pin-mode, or env BCARD_PIN_MODE):
 *   mock     (default) testing runs on MOCK MDP: set-pin returns a static mock page (a data: URI) whose
 *            submit never reaches card-service, so no browser is opened and activate is called straight
 *            after set-pin (verified 2026-10-06).
 *   webview  for REAL MDP: opens set-pin's webview_link in headless Chromium and enters + confirms the
 *            PIN, then activates. Locators mirror the Java SetCardPinPage ("Create PIN" / "Confirm PIN" /
 *            "Success!", keypad div[data-value]) — not yet run against real MDP, so verify on first use.
 *
 * Phone:
 *   --phone given and the account exists  → used as-is; its breadfast_id comes from the DB
 *   --phone given and no account exists   → registered with that number
 *   no --phone                            → registered with a random EG number
 * A phone that already has a card record RESUMES from its current status, so
 * `--phone X --stage active` on a Registered user only runs the remaining steps.
 *
 * Every step reads the card status back and fails loudly when it is not the expected one.
 *
 * Usage:
 *   node automation/bcard-user/create_bcard_user.js --stage active
 *   node automation/bcard-user/create_bcard_user.js --stage registered --phone 01150211684 --kyc
 *   node automation/bcard-user/create_bcard_user.js --stage pending --count 5
 *   node automation/bcard-user/create_bcard_user.js --help
 *
 * Reuses CardUserFactory for every card-service call and BreadfastUserRegistrar for the wp-json
 * registration. Config + secrets are read from the Java framework's property files (CardConfig).
 */

const fs   = require('fs');
const os   = require('os');
const path = require('path');

const cfg                    = require('../helpers/CardConfig');
const CardUserFactory        = require('../helpers/CardUserFactory');
const BreadfastUserRegistrar = require('../helpers/BreadfastUserRegistrar');
const DbHelper               = require('../helpers/DbHelper');
const { getCardDbConfig }    = require('../helpers/PropertiesReader');

const STAGES      = ['account', 'pending', 'registered', 'received', 'linked', 'active'];
const STATUS_RANK = { NA: 0, Pending: 1, Registered: 2, Received: 3, Linked: 4, Active: 5 };
const STAGE_RANK  = { account: 0, pending: 1, registered: 2, received: 3, linked: 4, active: 5 };

// The card-service name fields are Arabic-only (B10-56336); CardUserFactory.editKyc writes the same pair.
const AR_FIRST_NAME = 'بثينة';
const AR_LAST_NAME  = 'مصطفى';

const OUTPUT_FILE = path.join(__dirname, 'output', 'created-users.jsonl');

// ── CLI ──────────────────────────────────────────────────────────────────────

const HELP = `
Create a BCard test user at any card stage.

  --stage <s>         account | pending | registered | received | linked | active   (default: active)
  --phone <n>         use this number (01XXXXXXXXX, 1XXXXXXXXX, +201XXXXXXXXX). Default: random.
  --breadfast-id <id> skip the DB lookup for an existing --phone
  --national-id <id>  national id for createCardUser (default: random, Luhn-valid)
  --kyc               also complete KYC when stopping at "registered"
  --bcid <bcid>       card BCID, when resuming a Received user this script did not collect
  --pin-mode <m>      mock (default — testing is on mock MDP, no browser) | webview (real MDP)
                      also settable with env BCARD_PIN_MODE
  --card-pin <pin>    4-digit card PIN entered in the webview (default: 1111) — webview mode only
  --headed            show the browser while the card PIN is set — webview mode only
  --count <n>         create n users in parallel (random phones only)
  --json              print only the JSON result
`;

function parseArgs(argv) {
  const a = { stage: 'active', count: 1, kyc: false, json: false, headed: false,
              cardPin: '1111', pinMode: (process.env.BCARD_PIN_MODE || 'mock').toLowerCase() };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${k} needs a value`);
      return v;
    };
    switch (k) {
      case '--stage':        a.stage = next().toLowerCase(); break;
      case '--phone':        a.phone = next(); break;
      case '--breadfast-id': a.breadfastId = next(); break;
      case '--national-id':  a.nationalId = next(); break;
      case '--count':        a.count = Number(next()); break;
      case '--kyc':          a.kyc = true; break;
      case '--bcid':         a.bcid = next(); break;
      case '--pin-mode':     a.pinMode = next().toLowerCase(); break;
      case '--card-pin':     a.cardPin = next(); break;
      case '--headed':       a.headed = true; break;
      case '--json':         a.json = true; break;
      case '-h': case '--help': a.help = true; break;
      default: throw new Error(`unknown option ${k}`);
    }
  }
  if (!STAGES.includes(a.stage)) throw new Error(`--stage must be one of ${STAGES.join(', ')}`);
  if (!['mock', 'webview'].includes(a.pinMode)) throw new Error('--pin-mode must be mock or webview');
  if (!/^\d{4}$/.test(a.cardPin)) throw new Error('--card-pin must be 4 digits');
  if (!(a.count >= 1)) throw new Error('--count must be >= 1');
  if (a.phone && a.count > 1) throw new Error('--count cannot be combined with --phone');
  if (a.phone) a.phone = normalizePhone(a.phone);
  return a;
}

/** Any common EG spelling → +201XXXXXXXXX. */
function normalizePhone(raw) {
  const d = String(raw).replace(/\D/g, '');
  const local = d.startsWith('20') && d.length === 12 ? d.slice(2)
    : d.startsWith('0') && d.length === 11 ? d.slice(1)
    : d;
  if (!/^1\d{9}$/.test(local)) throw new Error(`"${raw}" is not an EG mobile number`);
  return '+20' + local;
}

// ── shared session: ONE scheme token and ONE DB connection per process ───────

class Session {
  constructor({ log }) {
    this.log = log;
    this.factory = new CardUserFactory();
    // The card-panel /user/login throttles a burst of logins ("maximum attempts"); every factory
    // helper logs in again, so memoize the token for the whole run.
    const login = this.factory._getCardServiceToken.bind(this.factory);
    let token = null;
    this.factory._getCardServiceToken = () => (token ||= login().catch((e) => { token = null; throw e; }));
    this._db = null;
  }

  token() { return this.factory._getCardServiceToken(); }

  db() {
    this._db ||= (async () => {
      const dbCfg = getCardDbConfig();
      if (dbCfg.ssh.required && !dbCfg.ssh.keyPath && !dbCfg.ssh.password) {
        dbCfg.ssh.keyPath = path.join(os.homedir(), '.ssh', 'id_rsa');
      }
      const db = new DbHelper(dbCfg);
      await db.connect();
      return db;
    })();
    return this._db;
  }

  async close() {
    if (this._db) await (await this._db).close().catch(() => {});
  }
}

// ── steps ────────────────────────────────────────────────────────────────────

/** The Breadfast account behind `phone`, or null. Read from the WordPress user tables. */
async function findAccount(session, phone) {
  const db = await session.db();
  const rows = await db.query(
    `SELECT u.ID AS id, u.user_email AS email,
            (SELECT meta_value FROM breadfast_testing.bf_usermeta WHERE user_id = u.ID AND meta_key = 'first_name' LIMIT 1) AS firstName,
            (SELECT meta_value FROM breadfast_testing.bf_usermeta WHERE user_id = u.ID AND meta_key = 'last_name'  LIMIT 1) AS lastName
       FROM breadfast_testing.bf_usermeta m
       JOIN breadfast_testing.bf_users u ON u.ID = m.user_id
      WHERE m.meta_key = 'billing_phone' AND m.meta_value = ?
      ORDER BY u.ID DESC LIMIT 1`,
    [phone]
  );
  return rows[0] ? { ...rows[0], breadfastId: String(rows[0].id) } : null;
}

async function registerAccount(session, phone) {
  const registrar = new BreadfastUserRegistrar(undefined, { log: session.log });
  try {
    return await registrar.register(phone ? { phone } : {});
  } catch (e) {
    if (/HTTP (422|426)/.test(e.message)) {
      e.message += '\n  → wp-json registration is refused from outside the app (send-otp needs the app\'s reCAPTCHA'
        + ' token). Register the number in the app once, then re-run with --phone <that number>.';
    }
    throw e;
  } finally {
    await registrar.dispose();
  }
}

/** Invitation gate (generate → export → consume), then createCardUser → Pending. */
async function toPending(session, u) {
  const f = session.factory;
  const token = await session.token();
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {     // export/consume occasionally race
    try {
      const batchId = await f._generateInvitationBatch(token);
      const code = await f._exportInvitationCode(batchId, token);
      await f._consumeInvitationCode(u.phone, u.breadfastId, code, token);
      lastErr = null;
      break;
    } catch (e) {
      // An account that entered an invitation code in the app but never applied is past the gate already.
      if (/already used an invitation code/i.test(e.message)) { lastErr = null; break; }
      lastErr = e;
    }
  }
  if (lastErr) throw lastErr;
  await f._postEncrypted('/api/v1/web/wallet_users/createCardUser', {
    mobile_number: u.phone, breadfast_id: u.breadfastId, email: u.email,
    first_name: AR_FIRST_NAME, remaining_name: AR_LAST_NAME,
    national_id: u.nationalId, national_id_expiry_date: cfg.nationalIdExpiry,
  }, token);
}

/** createPin (the Pay passcode) → Registered. */
async function toRegistered(session, u) {
  await session.factory._postEncrypted('/api/v2/mobile/wallet_users/createPin', {
    breadfast_id: u.breadfastId, mpin: cfg.passcode, device_info: { device_id: `qa-${Date.now()}` },
  }, null);
}

async function completeKyc(session, u) {
  await session.factory.editKyc(u.searchMobile, u.nationalId, await session.token());
  u.kyc = true;
}

/** KYC + a pool card collected at the pickup location → Received. */
async function toReceived(session, u) {
  const f = session.factory;
  const token = await session.token();
  if (!u.kyc) await completeKyc(session, u);
  const { packageNumber, bcid } = await f.claimCardFromPool(token);
  const col = await f.collectViaApi(u.searchMobile, packageNumber);
  if (col.status !== 200) throw new Error(`collect failed: HTTP ${col.status} ${col.message}`);
  Object.assign(u, { packageNumber, bcid });
}

async function userToken(session, u) {
  u._userToken ||= await session.factory.loginViaOtp(u.phone, u.breadfastId);
  return u._userToken;
}

/** Mobile OTP login → cards/link → Linked. */
async function toLinked(session, u) {
  if (!u.bcid) Object.assign(u, await collectedCard(session, u));   // resuming a user collected earlier
  await session.factory.linkCardApi(await userToken(session, u), u.bcid);
}

/**
 * The BCID of a card a user collected in an earlier run. No card-service endpoint maps a package
 * number to its BCID, and the user report only carries `card.bcid` once the card is linked — so for a
 * Received user it comes from --bcid or from this script's own output log, where every collect lands.
 */
async function collectedCard(session, u) {
  if (u.bcidArg) return { bcid: u.bcidArg };
  const logged = readOutput().reverse().find((r) => r.phone === u.phone && r.bcid);
  if (logged) return { bcid: logged.bcid, packageNumber: logged.packageNumber };
  const f = session.factory;
  const token = await session.token();
  const userId = await f.lookupWalletUserId(u.searchMobile, token);
  const res = await fetch(cfg.cardServicesBaseURL + '/api/v1/web/wallet_users/userreport', {
    method: 'POST', headers: { 'content-type': 'application/json', Authorization: token }, body: JSON.stringify({ userId }),
  });
  const report = await res.json().catch(() => ({}));
  if (report.card && report.card.bcid) return { bcid: String(report.card.bcid), packageNumber: report.packageNumber && String(report.packageNumber) };
  throw new Error(`${u.phone} is Received but its BCID is unknown (package ${report.packageNumber || '?'}) — pass --bcid <bcid>`);
}

function readOutput() {
  try {
    return fs.readFileSync(OUTPUT_FILE, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  } catch { return []; }
}

/** set-pin → (real MDP only) card PIN in the webview → cards/activate → Active. */
async function toActive(session, u, { pinMode, cardPin, headed }) {
  const token = await userToken(session, u);
  const link = await session.factory.setPinApi(token);
  if (pinMode === 'webview') {
    if (!link) throw new Error('set-pin returned no webview_link');
    if (link.includes('data%3Atext%2Fhtml')) {
      session.log('  ! set-pin returned the MOCK MDP page — the PIN entered there is not stored (use --pin-mode mock)');
    }
    await setCardPinInWebview(link, cardPin, { headed });
    u.cardPin = cardPin;
  }
  await session.factory.activateApi(token);
}

/** Enter + confirm the card PIN in the set-pin webview (mirrors the Java SetCardPinPage). */
async function setCardPinInWebview(link, pin, { headed }) {
  const { chromium } = require('@playwright/test');
  const browser = await chromium.launch({ headless: !headed });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto(link, { waitUntil: 'domcontentloaded' });
    for (const header of ['Create PIN', 'Confirm PIN']) {
      await page.locator(`b:text-is("${header}")`).waitFor({ timeout: 20000 });
      for (let i = 0; i < pin.length; i++) {
        await page.locator(`div[data-value="${pin[i]}"]`).click();
        await page.locator('span.pin-placeholder.setted').nth(i).waitFor({ timeout: 5000 });
      }
    }
    await page.locator('b:text-is("Success!")').waitFor({ timeout: 20000 });
  } catch (e) {
    throw new Error(`card-PIN webview: ${e.message.split('\n')[0]} (page: ${link.slice(0, 80)}…)`);
  } finally {
    await browser.close();
  }
}

// ── one user ─────────────────────────────────────────────────────────────────

async function createUser(session, args) {
  const timings = {};
  const timed = async (name, fn) => {
    const t = Date.now();
    session.log(`  · ${name}…`);
    const r = await fn();
    timings[name] = Date.now() - t;
    return r;
  };
  const f = session.factory;
  const target = STAGE_RANK[args.stage];
  session.token().catch(() => {});    // warm the scheme login while the account is looked up

  // 1. the Breadfast account
  let u;
  const existing = args.phone && (args.breadfastId
    ? { breadfastId: String(args.breadfastId) }
    : await timed('account lookup', () => findAccount(session, args.phone)));
  if (existing) {
    u = { phone: args.phone, breadfastId: existing.breadfastId, email: existing.email,
          firstName: existing.firstName, lastName: existing.lastName, createdAccount: false };
  } else {
    const r = await timed('register account', () => registerAccount(session, args.phone));
    u = { phone: r.phone, breadfastId: r.breadfastId, email: r.email,
          firstName: r.firstName, lastName: r.lastName, createdAccount: true };
  }
  u.bcidArg      = args.bcid;
  u.localPhone   = u.phone.replace('+20', '');
  u.searchMobile = u.phone.replace('+2', '');
  u.email      ||= cfg.testEmail.replace('@', `_${Date.now()}_${u.localPhone}@`);

  // 2. where the card record stands now (a passed-in phone may already be part-way)
  const wallet = await timed('card status', () => f.existsViaApi(u.searchMobile));
  let status = wallet ? wallet.status : 'NA';
  u.nationalId = (wallet && wallet.national_id) || args.nationalId || CardUserFactory.nationalIdForDob(randomAdultDob());
  if (STATUS_RANK[status] === undefined) throw new Error(`${u.phone} has card status "${status}", which this script cannot advance`);
  if (STATUS_RANK[status] >= target) session.log(`  ${u.phone} is already ${status} — nothing to do`);
  else if (STATUS_RANK[status] > 0) session.log(`  ${u.phone} is already ${status} — resuming from there`);

  const steps = [
    ['Pending',    () => toPending(session, u)],
    ['Registered', () => toRegistered(session, u)],
    ['Received',   () => toReceived(session, u)],
    ['Linked',     () => toLinked(session, u)],
    ['Active',     () => toActive(session, u, args)],
  ];
  for (const [want, run] of steps) {
    if (STATUS_RANK[want] > target) break;
    if (STATUS_RANK[status] >= STATUS_RANK[want]) continue;
    await timed(`→ ${want}`, run);
    status = await f._getCardStatus(u.breadfastId, await session.token());
    if (status !== want) throw new Error(`${u.phone}: expected card status "${want}", got "${status}"`);
  }
  if (args.kyc && STATUS_RANK[status] === STATUS_RANK.Registered && !u.kyc) {
    await timed('KYC', () => completeKyc(session, u));
  }

  delete u._userToken;
  delete u.bcidArg;
  return {
    ...u,
    cardStatus: status,
    passcode: STATUS_RANK[status] >= STATUS_RANK.Registered ? cfg.passcode : undefined,
    payOtp: u.phone.slice(-4),            // the Pay dual-auth / card OTP on testing = last 4 digits
    createdAt: new Date().toISOString(),
    timingsMs: timings,
  };
}

function randomAdultDob() {
  const now = new Date();
  const from = Date.UTC(1975, 0, 1);
  const to = Date.UTC(now.getUTCFullYear() - 21, now.getUTCMonth(), now.getUTCDate());
  return new Date(from + Math.random() * (to - from));
}

// ── main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { console.log(HELP); return; }

  const log = args.json ? () => {} : (m) => console.log(m);
  const session = new Session({ log });
  const started = Date.now();
  const results = [];
  try {
    const jobs = Array.from({ length: args.count }, (_, i) => async () => {
      const t = Date.now();
      try {
        const user = await createUser(session, args);
        log(`✔ ${user.phone} → ${user.cardStatus} in ${((Date.now() - t) / 1000).toFixed(1)}s`);
        return user;
      } catch (e) {
        log(`✘ user ${i + 1}: ${e.message}`);
        return { error: e.message };
      }
    });
    results.push(...await runLimited(jobs, 4));
  } finally {
    await session.close();
  }

  const ok = results.filter((r) => !r.error);
  if (ok.length) {
    fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
    fs.appendFileSync(OUTPUT_FILE, ok.map((r) => JSON.stringify(r)).join('\n') + '\n');
  }

  if (args.json) {
    console.log(JSON.stringify(args.count === 1 ? results[0] : results, null, 2));
  } else {
    for (const r of ok) printUser(r);
    log(`\n${ok.length}/${results.length} created in ${((Date.now() - started) / 1000).toFixed(1)}s`
      + (ok.length ? ` — appended to ${path.relative(process.cwd(), OUTPUT_FILE)}` : ''));
  }
  if (ok.length !== results.length) process.exitCode = 1;
}

function printUser(u) {
  const rows = [
    ['phone', `${u.phone}   (search: ${u.searchMobile}, local: ${u.localPhone})`],
    ['breadfast id', u.breadfastId],
    ['card status', u.cardStatus],
    ['national id', u.cardStatus === 'NA' ? undefined : u.nationalId],
    ['Pay passcode', u.passcode],
    ['Pay OTP', u.payOtp],
    ['package / BCID', u.bcid && `${u.packageNumber || '?'} / ${u.bcid}`],
    ['card PIN', u.cardPin],
    ['email', u.email],
  ];
  console.log('');
  for (const [k, v] of rows) if (v) console.log(`  ${k.padEnd(15)} ${v}`);
}

/** Run async thunks with at most `limit` in flight, preserving order. */
async function runLimited(thunks, limit) {
  const out = new Array(thunks.length);
  let next = 0;
  const worker = async () => { while (next < thunks.length) { const i = next++; out[i] = await thunks[i](); } };
  await Promise.all(Array.from({ length: Math.min(limit, thunks.length) }, worker));
  return out;
}

module.exports = { createUser, normalizePhone, Session, STAGES };

if (require.main === module) {
  main().catch((e) => { console.error('FAIL: ' + e.message); process.exit(1); });
}
