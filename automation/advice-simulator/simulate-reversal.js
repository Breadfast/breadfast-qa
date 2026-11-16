/**
 * Simulates an MDP reversal (MTI 0420) of an advice message sent earlier.
 *
 * Usage:
 *   node simulate-reversal.js                       # reverse the last advice sent to BASE_URL
 *   node simulate-reversal.js --utrnno 001234567890 # reverse a specific logged advice
 *   node simulate-reversal.js --utrnno 001234567890 --amount 20   # partial reversal
 *
 *   # an advice that isn't in sent-advices.json (e.g. sent from Postman):
 *   node simulate-reversal.js --utrnno 319925 --rrn 508403 --amount 77.80 --card 100002114740 --type REFUND
 *
 * The reversal reuses the original advice's utrnno, retrievalReferenceNumber and stan, so
 * the backend matches it to the same transaction. Settings come from .env like the
 * advice simulator. Requires Node 18+ (global fetch).
 *
 * See README.md in this folder.
 */

const {
  ADVICE_LOG_FILE,
  BASE_URL,
  MERCHANT_ID,
  TRANSACTION_TYPES,
  env,
  resolveTransactionType,
  parseFlags,
  randomDigits,
  toMdpAmount,
  buildTimestamps,
  login,
  postMdp,
  readAdviceLog,
} = require('./mdp-common');

/** MDP pads utrnno/rrn with leading zeros, so compare them without those. */
const sameRef = (a, b) => String(a).replace(/^0+/, '') === String(b).replace(/^0+/, '');

/** Finds the advice to reverse: by --utrnno if given, otherwise the last one sent to BASE_URL. */
const findOriginalAdvice = (utrnno) => {
  const sentHere = readAdviceLog().filter((entry) => entry.baseUrl === BASE_URL);
  if (utrnno) return sentHere.reverse().find((entry) => sameRef(entry.payload.utrnno, utrnno))?.payload;
  return sentHere[sentHere.length - 1]?.payload;
};

/** Builds a minimal original advice from flags, for advices this simulator didn't send. */
const originalFromFlags = (flags) => {
  const missing = ['rrn', 'amount'].filter((key) => flags[key] === undefined);
  if (missing.length) {
    throw new Error(
      `utrnno ${flags.utrnno} is not in ${ADVICE_LOG_FILE} for ${BASE_URL}. ` +
      `Pass ${missing.map((key) => `--${key}`).join(' and ')} (plus --card/--type if they differ from .env).`
    );
  }

  const cardId = String(flags.card || env('CARD_ID'));
  const { transactionType } = resolveTransactionType(flags.type || env('TRANSACTION_TYPE'));
  const amount = toMdpAmount(Math.round(Number(flags.amount) * 100));

  return {
    cardId,
    cardNumber: cardId,
    transactionType,
    transactionAmount: amount,
    accountAmount: amount,
    utrnno: String(flags.utrnno),
    retrievalReferenceNumber: String(flags.rrn),
    stan: flags.stan ? String(flags.stan) : randomDigits(6),
    cardAcceptorMerchantId: MERCHANT_ID,
    cardId2: transactionType === TRANSACTION_TYPES.P2P_CREDIT ? cardId : null,
  };
};

const buildReversalPayload = (original, flags) => {
  // Full reversal by default; --amount on a logged advice makes it a partial one.
  const reversedAmount = flags.amount !== undefined
    ? toMdpAmount(Math.round(Number(flags.amount) * 100))
    : original.accountAmount;
  const responseCode = String(flags.responseCode || env('RESPONSE_CODE'));

  return {
    adviceMessageMTI: '0420',
    originalTransactionMTI: null,
    cardId: original.cardId,
    cardNumber: original.cardNumber,
    expiryDate: '2912',
    terminalType: 2,
    transactionType: original.transactionType,
    transactionAmount: reversedAmount,
    accountAmount: reversedAmount,
    cardholderBillingAmount: '000000000000',
    transactionCurrencyCode: '818',
    accountCurrencyCode: '818',
    cardholderBillingCurrencyCode: '818',
    accountConversionRate: '61000000',
    cardholderBillingConversionRate: null,
    acquirerFeeAmount: '0',
    issuerFeeAmount: '0',
    responseCode,
    respCodeDescription: responseCode === '-1' ? 'Approve Transaction' : 'Declined Transaction',
    availableBalance: '{"currency":818,"sign":"D","amount":"000000075696"}',
    // Same references as the original advice - this is how the reversal finds its transaction
    utrnno: original.utrnno,
    retrievalReferenceNumber: original.retrievalReferenceNumber,
    stan: original.stan,
    authorizationCode: null,
    cardAcceptorTerminalId: 'TSVIPES ',
    cardAcceptorMerchantId: original.cardAcceptorMerchantId || MERCHANT_ID,
    cardAcceptorNameAndLocation: 'Breadfast>Cairo               >EG',
    acquirerCountry: '818',
    merchantTypeMCC: '5411',
    issuerInstitutionMDPId: '7912',
    acquirerInstitutionMDPId: '1001',
    acquiringInstitutionSchemeId: '81810010001',
    ...buildTimestamps(new Date()),
    settlementType: '1',
    sourceAccountNumber: '79123388914',
    destinationAccountNumber: null,
    posDataCode: '8112ZZZZZ344',
    cardId2: original.cardId2 ?? null,
    maskedCardNumber: null,
  };
};

const main = async () => {
  const flags = parseFlags();
  const utrnno = flags.utrnno && flags.utrnno !== true ? String(flags.utrnno) : null;

  let original = findOriginalAdvice(utrnno);
  if (!original) {
    if (!utrnno) {
      throw new Error(
        `No advice sent to ${BASE_URL} found in ${ADVICE_LOG_FILE}. ` +
        'Run simulate-advice-messages.js first, or pass --utrnno/--rrn/--amount.'
      );
    }
    original = originalFromFlags(flags);
  }

  const payload = buildReversalPayload(original, flags);
  const isPartial = payload.accountAmount !== original.accountAmount;

  console.log(
    `Reversing advice -> ${BASE_URL}\n` +
    `card=${payload.cardId} type=${payload.transactionType} utrnno=${payload.utrnno} ` +
    `rrn=${payload.retrievalReferenceNumber} stan=${payload.stan}\n` +
    `amount=${Number(payload.accountAmount) / 100} EGP` +
    `${isPartial ? ` (partial, original ${Number(original.accountAmount) / 100} EGP)` : ''} ` +
    `responseCode=${payload.responseCode}\n`
  );

  const token = await login();
  console.log('Authenticated\n');

  const { status, body } = await postMdp(token, '/api/v1/mdp/reversal', payload);
  const ok = status === 200;
  console.log(`${ok ? 'OK ' : 'FAIL'} status=${status} at=${payload.onlineSystemDateTime} resp=${JSON.stringify(body)}`);
  if (!ok) process.exitCode = 1;
};

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
