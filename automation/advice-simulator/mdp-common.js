/**
 * Shared helpers for the advice and reversal simulators: .env loading, MDP login,
 * payload formatting and the local log of sent advices.
 */

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// .env loading - no dependencies, the file sits next to this script
// ---------------------------------------------------------------------------
const ENV_FILE = path.join(__dirname, '.env');

/**
 * Loads .env into process.env without overwriting anything already exported in
 * the shell, so `CARD_ID=x node simulate-advice-messages.js` still wins.
 */
const loadEnvFile = () => {
  if (!fs.existsSync(ENV_FILE)) {
    console.warn(`No .env found at ${ENV_FILE} - falling back to built-in defaults.\n`);
    return;
  }

  for (const rawLine of fs.readFileSync(ENV_FILE, 'utf8').split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const eq = line.indexOf('=');
    if (eq === -1) continue;

    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();

    // Strip one layer of matching quotes, so secrets with # or spaces survive
    if (
      (value.startsWith("'") && value.endsWith("'")) ||
      (value.startsWith('"') && value.endsWith('"'))
    ) {
      value = value.slice(1, -1);
    }

    if (process.env[key] === undefined) process.env[key] = value;
  }
};

loadEnvFile();

// Fallbacks, only used when the key is missing from both the shell and .env
const DEFAULTS = {
  BASE_URL: 'http://localhost:1337',
  MDP_CLIENT_ID: 'mdp-client',
  MDP_CLIENT_SECRET: '',
  MERCHANT_ID: 'MSVIPES        ',
  CARD_ID: '100004700036',
  TRANSACTION_TYPE: 'PURCHASE',
  REQUEST_COUNT: '1',
  AMOUNT_EGP: '', // empty => random 1..1000 EGP
  DELAY_MS: '300',
  RESPONSE_CODE: '-1', // -1 = approved
};

const env = (key) => (process.env[key] !== undefined && process.env[key] !== '' ? process.env[key] : DEFAULTS[key]);

const BASE_URL = env('BASE_URL');
const CLIENT_ID = env('MDP_CLIENT_ID');
const CLIENT_SECRET = env('MDP_CLIENT_SECRET');
const MERCHANT_ID = env('MERCHANT_ID');

// MDP transaction types, mirrored from src/api/enums/cards/providers/MDP/TransactionType.ts
const TRANSACTION_TYPES = {
  PURCHASE: 774,
  PRE_PURCHASE_AUTHORIZATION: 736,
  PURCHASE_COMPLETION: 737,
  DEBIT_PRESENTMENT: 659,
  CASH_WITHDRAWAL: 700,
  P2P_DEBIT: 781, // skipped by the controller on purpose
  CASH_DEPOSIT: 618,
  REFUND: 775,
  P2P_CREDIT: 785, // card is read from cardId2 for this one
  CREDIT_PRESENTMENT: 760,
  FUNDS_TRANSFER: 703,
  CARD_TO_CARD_MONEY_TRANSFER: 689,
  BALANCE_INQUIRY: 702,
  CARD_ACTIVATION: 644,
  ACCOUNT_VERIFICATION_REQUEST: 796,
  CARD_STATUS_CHANGE: 672,
  PIN_COUNTERS_RESET: 748,
  FORCED_PIN_CHANGE: 603,
  CARD_VALIDATION: 782,
};

/** Resolves a type name or raw code to { transactionType, typeName }. */
const resolveTransactionType = (rawType) => {
  const typeKey = String(rawType).toUpperCase();
  const transactionType = TRANSACTION_TYPES[typeKey] ?? Number(rawType);

  if (!Number.isFinite(transactionType)) {
    throw new Error(
      `Unknown transaction type "${rawType}". Use a code or one of: ${Object.keys(TRANSACTION_TYPES).join(', ')}`
    );
  }

  const typeName = Object.keys(TRANSACTION_TYPES).find((k) => TRANSACTION_TYPES[k] === transactionType);
  return { transactionType, typeName: typeName || `CODE_${transactionType}` };
};

/** Parses --flag value / --flag=value pairs into an object. */
const parseFlags = () => {
  const args = process.argv.slice(2);
  const flags = {};
  for (let i = 0; i < args.length; i += 1) {
    const [flag, inlineValue] = args[i].split('=');
    if (!flag.startsWith('--')) continue;
    // A bare flag followed by another flag (or nothing) is a boolean switch, e.g. --last
    if (inlineValue !== undefined) flags[flag.slice(2)] = inlineValue;
    else if (args[i + 1] === undefined || args[i + 1].startsWith('--')) flags[flag.slice(2)] = true;
    else flags[flag.slice(2)] = args[++i];
  }
  return flags;
};

const pad = (value, length) => String(value).padStart(length, '0');

const randomDigits = (length) =>
  Array.from({ length }, () => Math.floor(Math.random() * 10)).join('');

/** MDP amounts are minor units in a 12 char zero padded string. */
const toMdpAmount = (piastres) => pad(piastres, 12);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const buildTimestamps = (now) => {
  const yyyy = now.getFullYear();
  const yy = pad(yyyy % 100, 2);
  const MM = pad(now.getMonth() + 1, 2);
  const dd = pad(now.getDate(), 2);
  const HH = pad(now.getHours(), 2);
  const mm = pad(now.getMinutes(), 2);
  const ss = pad(now.getSeconds(), 2);

  return {
    cardAcceptorLocalDateTime: `${yy}${MM}${dd}${HH}${mm}${ss}`, // YYMMDDhhmmss
    acquirerTransmissionDateTime: `${MM}${dd}${HH}${mm}${ss}`, // MMDDhhmmss
    onlineSystemDateTime: `${yyyy}${MM}${dd}${HH}${mm}${ss}`, // YYYYMMDDhhmmss
    settlementDate: `${yy}${MM}${dd}`, // YYMMDD
  };
};

const login = async () => {
  if (!CLIENT_SECRET) {
    throw new Error(`MDP_CLIENT_SECRET is not set - add it to ${ENV_FILE}`);
  }

  const res = await fetch(`${BASE_URL}/api/v1/mdp/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type: 'client_credentials',
    }),
  });

  const body = await res.json().catch(() => ({}));

  if (!res.ok || !body.access_token) {
    throw new Error(`Login failed (${res.status}): ${JSON.stringify(body)}`);
  }

  return body.access_token;
};

/** POSTs a payload to an MDP endpoint path, e.g. '/api/v1/mdp/reversal'. */
const postMdp = async (token, endpoint, payload) => {
  const res = await fetch(`${BASE_URL}${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  return { status: res.status, body: await res.json().catch(() => ({})) };
};

// ---------------------------------------------------------------------------
// Sent-advice log - lets the reversal script reuse an advice's utrnno/rrn/amount
// ---------------------------------------------------------------------------
const ADVICE_LOG_FILE = path.join(__dirname, 'sent-advices.json');

const readAdviceLog = () => {
  if (!fs.existsSync(ADVICE_LOG_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(ADVICE_LOG_FILE, 'utf8'));
  } catch (err) {
    console.warn(`Could not parse ${ADVICE_LOG_FILE}, ignoring it: ${err.message}`);
    return [];
  }
};

/** Stores the full payload of an accepted advice, tagged with the env it went to. */
const appendAdviceLog = (payload) => {
  const log = readAdviceLog();
  log.push({ baseUrl: BASE_URL, sentAt: new Date().toISOString(), payload });
  fs.writeFileSync(ADVICE_LOG_FILE, `${JSON.stringify(log, null, 2)}\n`);
};

module.exports = {
  ENV_FILE,
  ADVICE_LOG_FILE,
  BASE_URL,
  MERCHANT_ID,
  TRANSACTION_TYPES,
  env,
  resolveTransactionType,
  parseFlags,
  pad,
  randomDigits,
  toMdpAmount,
  sleep,
  buildTimestamps,
  login,
  postMdp,
  readAdviceLog,
  appendAdviceLog,
};
