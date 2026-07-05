'use strict';

/**
 * Reusable smoke check for dynamic card-user provisioning (replaces test_data_inventory.csv).
 * Provisions a fresh user to "Registered", verifies the DB row, then tears it down.
 *
 * Run from the runnable workspace (where mysql2/ssh2 are installed):
 *   cd D:\Playwright\b55168_pom && node ../../BreadfastQA/automation/provision_check.js
 * or copy alongside the helpers. Requires the testing card backend to be UP
 * (it returned 502/503 "overload" on 2026-06-22 — retry when healthy).
 */

const CardUserFactory = require('./helpers/CardUserFactory');
const DbHelper        = require('./helpers/DbHelper');
const cfg             = require('./helpers/CardConfig');

(async () => {
  const f = new CardUserFactory();
  let user;
  try {
    console.log('Provisioning a fresh card user to Registered...');
    user = await f.provision();
    console.log('PROVISIONED:', JSON.stringify(user));

    const db = new DbHelper(cfg.cardDb); await db.connect();
    const rows = await db.query(
      `SELECT id, mobile_number, status FROM ${cfg.cardDb.db.database}.wallet_users WHERE mobile_number = ?`,
      [user.phone]
    );
    console.log('DB wallet_users row:', JSON.stringify(rows[0] || null));
    await db.close();

    console.log('Tearing down...');
    const res = await f.destroy(user.phone);
    console.log('DESTROY affectedRows =', res && res.affectedRows);

    // Authoritative check: is the user still visible via the API the admin panel uses?
    const stillThere = await f.existsViaApi(user.searchMobile);
    console.log('exists via API after destroy =', stillThere ? JSON.stringify(stillThere) : 'NO');
    console.log(!stillThere ? 'CHECKPOINT PASSED' : 'CHECKPOINT FAILED (user still exists)');
  } catch (e) {
    console.log('CHECKPOINT FAILED:', e.message);
    if (user) { try { await f.destroy(user.phone); console.log('cleaned up after failure'); } catch {} }
    process.exitCode = 1;
  }
})();
