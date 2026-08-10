'use strict';

/**
 * KycRecordHelper — reads the persisted collection record from the card-services DB to verify
 * B10-56337 persistence ACs at the source of truth (never inferred from request-sent + 200):
 * KYC File Number generation/reuse, Store Location + branch code, and Date of Collection.
 *
 * Schema (verified 2026-07-09 against cards_hades_testing):
 *   cards_pickup_package (keyed by wallet_user_id → wallet_users.id)
 *     - kyc_file_number     : set at the first Print (Popup 1 "Print Form & Continue")
 *     - pickup_location_id  : the selected store; also written at Print (→ card_locations.id)
 *     - package_number      : set only at collection Confirm (Popup 2)
 *     - createdAt           : row creation = Print time
 *     - updatedAt           : bumped at collection Confirm (when package_number is assigned)
 *   card_locations: id, title_en/title_ar (store name), branch_code
 *
 * The KYC File Number is NOT on wallet_users — it lives on cards_pickup_package. (An earlier
 * version of this helper queried wallet_users and always read null; corrected 2026-07-09.)
 * Wraps DbHelper over the same SSH tunnel + card DB (cfg.cardDb) as CardUserFactory teardown.
 */

const cfg      = require('./CardConfig');
const DbHelper = require('./DbHelper');

class KycRecordHelper {
  /**
   * Latest cards_pickup_package row for a customer (by full mobile "+2011XXXXXXXX"), joined to
   * card_locations for the store name + branch code, or null if the customer has no package yet.
   */
  async getPickupPackageRow(mobile) {
    const D  = cfg.cardDb.db.database;
    const db = new DbHelper(cfg.cardDb);
    await db.connect();
    try {
      const rows = await db.query(
        `SELECT p.kyc_file_number, p.pickup_location_id, p.package_number,
                p.createdAt, p.updatedAt,
                l.title_en AS store_en, l.title_ar AS store_ar, l.branch_code AS branch_code
           FROM ${D}.cards_pickup_package p
           JOIN ${D}.wallet_users w ON w.id = p.wallet_user_id
           LEFT JOIN ${D}.card_locations l ON l.id = p.pickup_location_id
          WHERE w.mobile_number = ?
          ORDER BY p.createdAt DESC
          LIMIT 1`,
        [mobile]
      );
      return rows[0] || null;
    } finally {
      await db.close();
    }
  }

  /** Raw wallet_users row for a customer (by full mobile "+2011XXXXXXXX"), or null. */
  async getWalletUserRow(mobile) {
    const D  = cfg.cardDb.db.database;
    const db = new DbHelper(cfg.cardDb);
    await db.connect();
    try {
      const rows = await db.query(`SELECT * FROM ${D}.wallet_users WHERE mobile_number = ? LIMIT 1`, [mobile]);
      return rows[0] || null;
    } finally {
      await db.close();
    }
  }

  /** Persisted KYC File Number for the customer (null until the first Print action). */
  async getKycFileNumber(mobile) {
    const row = await this.getPickupPackageRow(mobile);
    return (row && row.kyc_file_number) || null;
  }

  /** Persisted Store Location (name) + branch code from the selected pickup location. */
  async getSavedStoreAndBranch(mobile) {
    const row = await this.getPickupPackageRow(mobile);
    return {
      store:      row ? (row.store_en || row.store_ar || (row.pickup_location_id != null ? String(row.pickup_location_id) : null)) : null,
      branchCode: row ? (row.branch_code || null) : null,
      raw: row,
    };
  }

  /**
   * Persisted Date of Collection — set only once collection is confirmed (package_number
   * assigned in Popup 2). Before that the package row may exist from Print but is not yet
   * "collected", so this returns null. Uses updatedAt (bumped at Confirm) as the timestamp.
   */
  async getSavedDateOfCollection(mobile) {
    const row = await this.getPickupPackageRow(mobile);
    return row && row.package_number ? (row.updatedAt || null) : null;
  }
}

module.exports = KycRecordHelper;
