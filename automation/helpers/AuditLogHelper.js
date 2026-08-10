'use strict';

/**
 * AuditLogHelper — reads the card-services audit log (actions_logger) to verify that the
 * "Print KYC Form" action is recorded, per B10-56337. Wraps DbHelper over the same SSH tunnel
 * + card DB (cfg.cardDb) that CardUserFactory uses for teardown; no new secrets.
 *
 * Schema (verified 2026-07-09 against cards_hades_testing) — actions_logger has NO user_id
 * column. The customer link lives inside the JSON `created_object` longtext, e.g.
 *   { "walletUserId": "01f9…" }
 * and the action name is stored in `action_type` (value: "Print Kyc Form"). The row also
 * carries `made_by`/`creator_type`/`creator_id` (who performed it) and `createdAt`.
 *
 * The audit-log UI additionally shows an "Action Type" of "no supervision" and the customer's
 * mobile number, but neither is a column on actions_logger — they are UI presentations derived
 * from the action definition and the wallet_users join. This helper therefore verifies what is
 * genuinely persisted: the entry exists, is linked to the right customer (walletUserId), was
 * made by an agent, and has a creation date. Override the table with BF_AUDIT_TABLE.
 */

const cfg      = require('./CardConfig');
const DbHelper = require('./DbHelper');

const AUDIT_TABLE          = process.env.BF_AUDIT_TABLE || 'actions_logger';
const EXPECTED_ACTION_NAME = 'Print Kyc Form';   // actual `action_type` value
const EXPECTED_ACTION_TYPE = 'no supervision';   // UI-layer classification (not stored here)

function looseRe(text) {
  return new RegExp(text.trim().replace(/\s+/g, '\\s*'), 'i');
}

class AuditLogHelper {
  /** Resolve the wallet_users.id for a full mobile ("+2011XXXXXXXX"), or null. */
  async _walletUserId(mobile) {
    const D  = cfg.cardDb.db.database;
    const db = new DbHelper(cfg.cardDb);
    await db.connect();
    try {
      const rows = await db.query(`SELECT id FROM ${D}.wallet_users WHERE mobile_number = ? LIMIT 1`, [mobile]);
      return rows[0] ? rows[0].id : null;
    } finally {
      await db.close();
    }
  }

  /**
   * actions_logger rows referencing a customer (by full mobile), newest first. The link is the
   * `walletUserId` embedded in the JSON `created_object`, so we resolve the id from the mobile
   * then match it inside that column (LIKE is robust for a longtext holding JSON; callers verify
   * the parsed value). Returns [] if the customer or wallet id can't be resolved.
   */
  async queryAuditLog(mobile) {
    const uid = await this._walletUserId(mobile);
    if (!uid) return [];
    const D  = cfg.cardDb.db.database;
    const db = new DbHelper(cfg.cardDb);
    await db.connect();
    try {
      const rows = await db.query(
        `SELECT * FROM ${D}.${AUDIT_TABLE}
          WHERE created_object LIKE ?
          ORDER BY id DESC
          LIMIT 200`,
        [`%${uid}%`]
      );
      // keep only rows whose parsed created_object.walletUserId actually equals uid
      return rows.filter(r => AuditLogHelper._walletUserIdOf(r) === uid);
    } finally {
      await db.close();
    }
  }

  /** Parse the walletUserId out of a row's created_object JSON (null if absent/unparseable). */
  static _walletUserIdOf(row) {
    try { return JSON.parse(row.created_object || '{}').walletUserId || null; }
    catch { return null; }
  }

  /**
   * Find the "Print KYC Form" audit entry for a customer and report the fields it persists.
   * @param {string} mobile  full mobile ("+2011XXXXXXXX")
   * @returns {Promise<{found:boolean, row:object|null, rows:object[], count:number,
   *                     actionName:string|null, createdBy:string|null, createdAt:*,
   *                     customerWalletUserId:string|null, matchesCustomer:boolean,
   *                     hasCreatedBy:boolean, hasCreationDate:boolean}>}
   */
  async findPrintKycAction(mobile, opts = {}) {
    const nameRe = looseRe(opts.actionName || EXPECTED_ACTION_NAME);
    const rows   = await this.queryAuditLog(mobile);

    const matches = rows.filter(r => nameRe.test(String(r.action_type || '')));
    const row     = matches[0] || null;

    return {
      found:  !!row,
      row,
      rows,
      count:  matches.length,
      actionName:           row ? row.action_type : null,
      createdBy:            row ? (row.made_by || row.creator_type || row.creator_id || null) : null,
      createdAt:            row ? row.createdAt : null,
      customerWalletUserId: row ? AuditLogHelper._walletUserIdOf(row) : null,
      // queryAuditLog already restricts to this customer's walletUserId, so a match is linked.
      matchesCustomer:      !!row,
      hasCreatedBy:         row ? !!(row.made_by || row.creator_id) : false,
      hasCreationDate:      row ? !!row.createdAt : false,
    };
  }
}

AuditLogHelper.EXPECTED_ACTION_NAME = EXPECTED_ACTION_NAME;
AuditLogHelper.EXPECTED_ACTION_TYPE = EXPECTED_ACTION_TYPE;
module.exports = AuditLogHelper;
