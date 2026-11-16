/**
 * Simulates MDP authorization advice messages against a running app.
 *
 * Usage:
 *   node simulate-advice-messages.js
 *   node simulate-advice-messages.js --card 100002166102 --type PURCHASE --count 5
 *
 * Run from inside this folder. Settings are read from .env (copy .env.example to .env first).
 * CLI flags override the .env file, which overrides the fallbacks below.
 * Every request gets a fresh utrnno/rrn/stan and current timestamps, so each one
 * lands as a new transaction. Accepted advices are recorded in sent-advices.json so
 * simulate-reversal.js can reverse them. Requires Node 18+ (global fetch).
 *
 * See README.md in this folder.
 */

const {
  BASE_URL,
  MERCHANT_ID,
  TRANSACTION_TYPES,
  env,
  resolveTransactionType,
  parseFlags,
  randomDigits,
  toMdpAmount,
  sleep,
  buildTimestamps,
  login,
  postMdp,
  appendAdviceLog,
} = require('./mdp-common');

/**
 * Parses --date as DD/MM/YYYY or YYYY-MM-DD. The current time of day is kept, so
 * several advices on the same back-dated day still get distinct timestamps.
 */
const parseDate = (raw) => {
  const match = String(raw).match(/^(\d{2})\/(\d{2})\/(\d{4})$/) || String(raw).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw new Error(`Invalid --date "${raw}", expected DD/MM/YYYY or YYYY-MM-DD`);

  const [year, month, day] = match[1].length === 4
    ? [match[1], match[2], match[3]]
    : [match[3], match[2], match[1]];
  const now = new Date();
  const date = new Date(Number(year), Number(month) - 1, Number(day), now.getHours(), now.getMinutes(), now.getSeconds());
  if (date.getDate() !== Number(day) || date.getMonth() !== Number(month) - 1) {
    throw new Error(`Invalid --date "${raw}", no such day`);
  }
  return date;
};

/**
 * --type P2P is not a single MDP code: a card-to-card transfer reaches us as two advices,
 * P2P_DEBIT on the sender and P2P_CREDIT for the receiver, sharing the same rrn/stan.
 */
const P2P_LEGS = [TRANSACTION_TYPES.P2P_DEBIT, TRANSACTION_TYPES.P2P_CREDIT];

/** CLI flags (--card/--to/--type/--count/--amount/--delay/--date) override .env, which overrides DEFAULTS. */
const parseArgs = () => {
  const flags = parseFlags();

  const cardId = flags.card || env('CARD_ID');
  const rawType = flags.type || env('TRANSACTION_TYPE');
  const count = Number(flags.count || env('REQUEST_COUNT'));
  const amountEgp = flags.amount !== undefined ? flags.amount : process.env.AMOUNT_EGP;
  const delayMs = Number(flags.delay || env('DELAY_MS'));
  const responseCode = flags.responseCode || env('RESPONSE_CODE');
  const transactionDate = flags.date ? parseDate(flags.date) : null;
  const receiverCardId = flags.to || env('RECEIVER_CARD_ID');

  const isP2p = String(rawType).toUpperCase() === 'P2P';
  const { transactionType, typeName } = isP2p
    ? { transactionType: null, typeName: 'P2P' }
    : resolveTransactionType(rawType);
  const legs = isP2p ? P2P_LEGS : [transactionType];

  if (isP2p && !receiverCardId) {
    throw new Error('A P2P transfer needs the receiver card id: pass --to <cardId> or set RECEIVER_CARD_ID in .env');
  }

  if (!Number.isInteger(count) || count < 1) {
    throw new Error(`Invalid request count "${count}", expected a positive integer`);
  }

  return {
    cardId: String(cardId),
    receiverCardId: receiverCardId ? String(receiverCardId) : null,
    transactionType,
    typeName,
    legs,
    count,
    amountEgp: amountEgp == null || amountEgp === '' ? null : Number(amountEgp),
    delayMs,
    responseCode: String(responseCode),
    transactionDate,
  };
};

/** Random amount between 1.00 and 1000.00 EGP, returned in piastres. */
const randomAmountInPiastres = () => 100 + Math.floor(Math.random() * (100000 - 100 + 1));

/** Values shared by every leg of one request (both halves of a P2P carry the same ones). */
const buildRequestShared = (options) => {
  const piastres = options.amountEgp != null
    ? Math.round(options.amountEgp * 100)
    : randomAmountInPiastres();

  return {
    times: buildTimestamps(options.transactionDate || new Date()),
    amount: toMdpAmount(piastres),
    retrievalReferenceNumber: `00${randomDigits(10)}`,
    stan: randomDigits(6),
  };
};

const buildPayload = (options, transactionType, shared) => {
  const { times, amount } = shared;

  // P2P advices carry the receiver in cardId2. For P2P credit the backend resolves the
  // card from cardId2, so without --to it falls back to crediting the --card itself.
  const isP2p = transactionType === TRANSACTION_TYPES.P2P_DEBIT || transactionType === TRANSACTION_TYPES.P2P_CREDIT;
  const isP2pCredit = transactionType === TRANSACTION_TYPES.P2P_CREDIT;
  const cardId2 = isP2p ? options.receiverCardId || (isP2pCredit ? options.cardId : null) : null;

  return {
    adviceMessageMTI: '0120',
    originalTransactionMTI: null,
    cardId: options.cardId,
    cardNumber: options.cardId,
    expiryDate: '2912',
    terminalType: 2,
    transactionType,
    transactionAmount: amount,
    accountAmount: amount,
    cardholderBillingAmount: '000000000000',
    transactionCurrencyCode: '818',
    accountCurrencyCode: '818',
    cardholderBillingCurrencyCode: '818',
    accountConversionRate: '61000000',
    cardholderBillingConversionRate: null,
    acquirerFeeAmount: '0',
    issuerFeeAmount: '0',
    responseCode: options.responseCode,
    respCodeDescription: options.responseCode === '-1' ? 'Approve Transaction' : 'Declined Transaction',
    availableBalance: '{"currency":818,"sign":"D","amount":"000000075696"}',
    // Trimmed of leading zeros this becomes the transaction external_id, so it has to be new
    // per advice (each P2P leg too) or it updates the previous transaction instead of creating one.
    utrnno: `00${randomDigits(10)}`,
    retrievalReferenceNumber: shared.retrievalReferenceNumber,
    stan: shared.stan,
    authorizationCode: '123456',
    cardAcceptorTerminalId: 'TSVIPES ',
    cardAcceptorMerchantId: MERCHANT_ID,
    cardAcceptorNameAndLocation: 'Breadfast>Cairo               >EG',
    acquirerCountry: '818',
    merchantTypeMCC: '5411',
    issuerInstitutionMDPId: '7912',
    acquirerInstitutionMDPId: '1001',
    acquiringInstitutionSchemeId: '81810010001',
    ...times,
    settlementType: '1',
    sourceAccountNumber: '79123388914',
    destinationAccountNumber: null,
    posDataCode: '8112ZZZZZ344',
    cardId2,
    maskedCardNumber: null,
  };
};

const sendAdvice = (token, payload) => postMdp(token, '/api/v1/mdp/authorization-advice', payload);

const main = async () => {
  const options = parseArgs();

  console.log(
    `Simulating ${options.count} advice message(s) -> ${BASE_URL}\n` +
    `card=${options.cardId}${options.receiverCardId ? ` -> ${options.receiverCardId}` : ''} ` +
    `type=${options.typeName}(${options.legs.join('+')}) ` +
    `amount=${options.amountEgp != null ? `${options.amountEgp} EGP` : 'random'} responseCode=${options.responseCode}` +
    `${options.transactionDate ? ` date=${options.transactionDate.toDateString()}` : ''}\n`
  );

  const token = await login();
  console.log('Authenticated\n');

  const total = options.count * options.legs.length;
  let succeeded = 0;
  for (let i = 1; i <= options.count; i += 1) {
    const shared = buildRequestShared(options);
    for (const transactionType of options.legs) {
      const payload = buildPayload(options, transactionType, shared);
      const label = `[${i}/${options.count}]${options.legs.length > 1 ? ` ${transactionType}` : ''}`;
      try {
        const { status, body } = await sendAdvice(token, payload);
        const ok = status === 200;
        if (ok) {
          succeeded += 1;
          appendAdviceLog(payload);
        }
        console.log(
          `${label} ${ok ? 'OK ' : 'FAIL'} status=${status} ` +
          `utrnno=${payload.utrnno} rrn=${payload.retrievalReferenceNumber} ` +
          `card=${payload.cardId} cardId2=${payload.cardId2} ` +
          `amount=${Number(payload.accountAmount) / 100} EGP ` +
          `at=${payload.onlineSystemDateTime} resp=${JSON.stringify(body)}`
        );
      } catch (err) {
        console.error(`${label} FAIL utrnno=${payload.utrnno}: ${err.message}`);
      }
    }

    if (i < options.count && options.delayMs > 0) await sleep(options.delayMs);
  }

  console.log(`\nDone: ${succeeded}/${total} advices accepted`);
  if (succeeded < total) process.exitCode = 1;
};

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
