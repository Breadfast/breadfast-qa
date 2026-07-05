'use strict';

/**
 * KycRecordHelper — reads the persisted customer record (wallet_users) from the card-services
 * DB to verify B10-56337 persistence ACs at the source of truth (never inferred from a
 * request-sent + 200): KYC File Number generation/reuse, Store Location + branch code saved
 * only at Popup 2 Confirm, and Date of Collection saved only at collection.
 *
 * Wraps DbHelper over the same SSH tunnel + card DB (cfg.cardDb) as CardUserFactory teardown;
 * no new secrets. Column names for these fields are not hard-assumed — they are located by
 * pattern against the wallet_users row so the read is resilient to the live schema. Use
 * getWalletUserRow() to inspect the raw row when a pattern needs tightening.
 */

const cfg      = require('./CardConfig');
const DbHelper = require('./DbHelper');

class KycRecordHelper {
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

  /** First value whose column name matches `re`, or null. */
  static _pick(row, re) {
    if (!row) return null;
    const key = Object.keys(row).find(k => re.test(k));
    return key ? row[key] : null;
  }

  /** Persisted KYC File Number for the customer (null/empty until first Print action). */
  async getKycFileNumber(mobile) {
    return KycRecordHelper._pick(await this.getWalletUserRow(mobile), /kyc.*file.*num|kyc_file_number|kycfilenumber/i);
  }

  /** Persisted Store Location + branch code (saved only at Popup 2 Confirm). */
  async getSavedStoreAndBranch(mobile) {
    const row = await this.getWalletUserRow(mobile);
    return {
      store:      KycRecordHelper._pick(row, /store|pickup.*location|branch.*name/i),
      branchCode: KycRecordHelper._pick(row, /branch.*code|branch_id|branchcode/i),
      raw: row,
    };
  }

  /** Persisted Date of Collection (saved only after collection is confirmed). */
  async getSavedDateOfCollection(mobile) {
    return KycRecordHelper._pick(await this.getWalletUserRow(mobile), /collect.*date|date.*collect|collection_date|received.*at|received_date/i);
  }
}

module.exports = KycRecordHelper;
