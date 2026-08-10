'use strict';

/**
 * B10-55185 — Cashback Perks Processing  (seed → run cron → verify type-30 row)
 *
 * This suite validates the PROCESSING flow, not perk creation. It assumes the
 * perks below already exist in the test panel (create them once via the POM /
 * UI, then record their ids + match MIDs/MCCs here).
 *
 * Flow per test (mirrors the manual steps):
 *   1. Clone an eligible purchase (type 25) for the test mobile, with the
 *      scenario's mid/mcc inside transaction_data and perk_processed = 0.
 *   2. Trigger the cron:  GET {cardBackend}/test?cronJobType=cashback
 *   3. Assert the type-30 cashback row(s): count (0 or 1), winning card_perk_id,
 *      and that perk_processed flipped to 1.
 *
 * Prereqs:  npm i mysql2 ssh2   and a reachable SSH key (config_testing.properties).
 * Run:      npm run test:cashback
 */

const { test, expect } = require('@playwright/test');
const config    = require('../../helpers/ConfigReader');
const DbHelper   = require('../../helpers/DbHelper');
const CronHelper = require('../../helpers/CronHelper');

// ─── SETUP: fill these from your test environment before running ────────────────
const SETUP = {
  // An existing good type-25 purchase row for the test mobile, used as a clone
  // template so NOT-NULL columns are satisfied. (e.g. 3418 from the sample export)
  templateTxId: null,            // ← REQUIRED: set to a real transactions_requests.id

  // Match keys (values that go into transaction_data.mid / .mcc)
  mids: {
    merchant: '1',               // MID covered by an active Merchant cashback perk
    coupon:   '9',               // MID configured on an active Coupon perk
    generic:  '7',               // MID with no specific perk (generic eligible, not excluded)
    none:     '999999',          // MID matched by nothing
  },
  mccs: {
    category:    '5814',         // MCC covered by an active Category cashback perk
    nonMatching: '0000',
  },

  // Expected winning perk ids (card_perk_id on the type-30 row). Optional but recommended.
  perkIds: {
    merchant: null,              // ← id of the Merchant cashback perk on mids.merchant
  },
};

const mobile = config.getTestMobileNumber();
let db;

function nowSql() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

/** Clone the template purchase with scenario mid/mcc; returns the new purchase id. */
async function seedPurchase({ mid, mcc, amount = 250 }) {
  return db.cloneEligiblePurchase(
    SETUP.templateTxId,
    { amount, createdAt: nowSql() },
    { mid, mcc }
  );
}

test.beforeAll(async () => {
  test.skip(!SETUP.templateTxId, 'Set SETUP.templateTxId (a real type-25 row id) to enable the DB-backed suite.');
  db = await new DbHelper(config.getBfPropertiesPath()).connect();
});

test.afterAll(async () => { if (db) await db.close(); });

// ── TC_CB_005 — no stacking: merchant wins, exactly one cashback ───────────────
test('[TC_CB_005] merchant+category+generic all match → exactly ONE cashback (merchant)', async ({ request }) => {
  const txId = await seedPurchase({ mid: SETUP.mids.merchant, mcc: SETUP.mccs.category });

  await CronHelper.triggerCashbackCron(request);

  expect(await db.countCashback(txId), 'must not stack — exactly one cashback').toBe(1);
  expect(await db.getPerkProcessed(txId), 'purchase must be marked processed').toBe(1);
  if (SETUP.perkIds.merchant) {
    const [cb] = await db.getCashbackRows(txId);
    expect(String(cb.card_perk_id), 'merchant perk must be the winner').toBe(String(SETUP.perkIds.merchant));
  }
});

// ── TC_CB_004 — coupon hard stop: no cashback at all ───────────────────────────
test('[TC_CB_004] coupon-merchant purchase → no cashback (hard stop), still marked processed', async ({ request }) => {
  const txId = await seedPurchase({ mid: SETUP.mids.coupon, mcc: SETUP.mccs.nonMatching });

  await CronHelper.triggerCashbackCron(request);

  expect(await db.countCashback(txId), 'coupon match must create NO cashback').toBe(0);
  expect(await db.getPerkProcessed(txId)).toBe(1);
});

// ── TC_CB_003 — generic applied when nothing more specific matches ──────────────
test('[TC_CB_003] generic-eligible purchase → one generic cashback', async ({ request }) => {
  const txId = await seedPurchase({ mid: SETUP.mids.generic, mcc: SETUP.mccs.nonMatching });

  await CronHelper.triggerCashbackCron(request);

  expect(await db.countCashback(txId)).toBe(1);
  expect(await db.getPerkProcessed(txId)).toBe(1);
});

// ── TC_CB_021 — no-match: zero cashback but flag still flips to 1 ───────────────
test('[TC_CB_021] no matching perk → no cashback, perk_processed flips to 1', async ({ request }) => {
  const txId = await seedPurchase({ mid: SETUP.mids.none, mcc: SETUP.mccs.nonMatching });

  await CronHelper.triggerCashbackCron(request);

  expect(await db.countCashback(txId)).toBe(0);
  expect(await db.getPerkProcessed(txId), 'no-match must still be marked processed').toBe(1);
});

// ── TC_CB_023 — idempotency: re-running the cron creates no duplicate ───────────
test('[TC_CB_023] running the cron twice creates no duplicate cashback', async ({ request }) => {
  const txId = await seedPurchase({ mid: SETUP.mids.merchant, mcc: SETUP.mccs.category });

  await CronHelper.triggerCashbackCron(request);
  const afterFirst = await db.countCashback(txId);
  expect(afterFirst).toBe(1);

  // Re-arm and run again — must NOT create a second cashback (original-tx dedup)
  await db.resetPerkProcessed(txId);
  await CronHelper.triggerCashbackCron(request);

  expect(await db.countCashback(txId), 'second run must be a no-op').toBe(1);
});
