'use strict';

/**
 * Send one MDP advice message through the testing payment sandbox, the same request its
 * "Advice message" dialog sends (POST /__control/mdp/advice). The sandbox forwards it to
 * card-panel-testing, where an approved advice becomes a REAL card transaction for that card's user
 * (balance, transaction list and subscription spend all move) and a real push to the user.
 *
 * Auth: a saved browser session of an @breadfast.com Google sign-in, in the gitignored
 * .auth/payment-sandbox-auth.json (create it by signing in at /auth/signin in a Playwright browser and
 * saving storageState there), or an x-simulator-token in env PAYMENT_SANDBOX_TOKEN.
 *
 * Usage:
 *   node automation/payment-sandbox/send_advice.js --card <Cards.externalId> --amount 10 [--type POS_PURCHASE] [--declined] [--dry]
 *
 * --card is the MDP card id (Cards.externalId), NOT the internal card UUID.
 * Types (Hades type it lands on): POS_PURCHASE (28) · ECOMMERCE_PURCHASE (25) · POS_CASH_OUT (27) ·
 * ATM_CASH_OUT (10) · POS_CASH_IN (26) · REFUND (24) · INSTAPAY (23) · CASH_OUT (7). P2P is not supported here.
 */
const fs = require('fs');
const path = require('path');

const BASE = process.env.PAYMENT_SANDBOX_URL || 'https://payment-sandbox-testing.breadfast.tech';
const SESSION = path.resolve(__dirname, '..', '..', '.auth', 'payment-sandbox-auth.json');

// Copied from the sandbox's MDP_ADV_PRESETS (v7.8.0): the MDP values that land on each Hades type.
const PRESETS = {
  POS_PURCHASE: { transactionType: '774', terminalType: '2', mcc: '5411', merchantId: 'MBFPOS', merchantName: 'BREADFAST POS', terminalId: 'TBFPOS', city: 'Cairo' },
  ECOMMERCE_PURCHASE: { transactionType: '774', terminalType: '8', mcc: '5999', merchantId: 'MBFONLINE', merchantName: 'BREADFAST ONLINE', terminalId: 'TBFECOM', city: 'Cairo' },
  POS_CASH_OUT: { transactionType: '700', terminalType: '2', mcc: '6010', merchantId: 'MBFPOS', merchantName: 'BREADFAST POS', terminalId: 'TBFPOS', city: 'Cairo' },
  ATM_CASH_OUT: { transactionType: '700', terminalType: '1', mcc: '6011', merchantId: 'MATM', merchantName: 'ATM CAIRO', terminalId: 'TATM01', city: 'Cairo' },
  POS_CASH_IN: { transactionType: '618', terminalType: '2', mcc: '6010', merchantId: 'MBFPOS', merchantName: 'BREADFAST POS', terminalId: 'TBFPOS', city: 'Cairo' },
  REFUND: { transactionType: '775', terminalType: '2', mcc: '5411', merchantId: 'MBFPOS', merchantName: 'BREADFAST POS', terminalId: 'TBFPOS', city: 'Cairo' },
  INSTAPAY: { transactionType: '760', terminalType: '6', mcc: '6012', merchantId: 'MSVIPES', merchantName: 'MERCHANT SVIP ES', terminalId: 'TSVIPES', city: 'Cairo' },
  CASH_OUT: { transactionType: '659', terminalType: '6', mcc: '5411', merchantId: 'MBF', merchantName: 'BREADFAST', terminalId: 'TBF', city: 'Cairo' },
};

function authHeaders() {
  if (process.env.PAYMENT_SANDBOX_TOKEN) return { 'x-simulator-token': process.env.PAYMENT_SANDBOX_TOKEN };
  if (!fs.existsSync(SESSION)) {
    throw new Error(`No sandbox auth: set PAYMENT_SANDBOX_TOKEN or sign in and save the session to ${SESSION}`);
  }
  const st = JSON.parse(fs.readFileSync(SESSION, 'utf8'));
  return { cookie: st.cookies.map((c) => `${c.name}=${c.value}`).join('; ') };
}

/** Sends one advice. Returns { status, body } exactly as the sandbox answers. */
async function sendAdvice({ cardId, amountEgp, type = 'POS_PURCHASE', declined = false }) {
  const preset = PRESETS[type];
  if (!preset) throw new Error(`Unknown type ${type}; one of ${Object.keys(PRESETS).join(', ')}`);
  if (!cardId) throw new Error('cardId (Cards.externalId) is required');
  if (!(Number(amountEgp) > 0)) throw new Error(`Invalid amount ${amountEgp}`);
  const body = {
    type, cardId: String(cardId), beneficiaryCardId: '', ...preset,
    utrnno: '', rrn: '', amountEgp: Number(amountEgp),
    responseCode: declined ? '05' : '-1', withReversal: false, delayMs: 0,
  };
  const r = await fetch(`${BASE}/__control/mdp/advice`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...authHeaders() }, body: JSON.stringify(body),
  });
  const text = await r.text();
  let parsed; try { parsed = JSON.parse(text); } catch (_) { parsed = text; }
  return { status: r.status, body: parsed };
}

module.exports = { sendAdvice, PRESETS };

if (require.main === module) {
  const a = process.argv.slice(2);
  const arg = (k) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : undefined; };
  const opts = { cardId: arg('--card'), amountEgp: arg('--amount'), type: arg('--type') || 'POS_PURCHASE', declined: a.includes('--declined') };
  if (a.includes('--dry')) { console.log('DRY', JSON.stringify(opts)); authHeaders(); console.log('auth ok'); process.exit(0); }
  sendAdvice(opts).then((r) => { console.log(r.status, JSON.stringify(r.body, null, 1)); process.exit(r.status < 300 ? 0 : 1); })
    .catch((e) => { console.error(e.message); process.exit(1); });
}
