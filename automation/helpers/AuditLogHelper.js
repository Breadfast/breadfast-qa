'use strict';

/**
 * AuditLogHelper — reads the card-services audit log (actions_logger) to verify that the
 * "print KYC form" action is recorded, per B10-56337 AC/HLS. Wraps DbHelper over the same
 * SSH tunnel + card DB (cfg.cardDb) that CardUserFactory uses for teardown; no new secrets.
 *
 * actions_logger links to wallet_users via user_id (see CardUserFactory.destroy). Exact
 * column names for the displayed audit fields (Action Name / Action Type / Created By /
 * Creation Date / Customer mobile) are not assumed — matching is done against the row's
 * stringified values so the assertion is resilient to the live schema. Override the table
 * name with BF_AUDIT_TABLE.
 */

const cfg      = require('./CardConfig');
const DbHelper = require('./DbHelper');

const AUDIT_TABLE          = process.env.BF_AUDIT_TABLE || 'actions_logger';
const EXPECTED_ACTION_NAME = 'print KYC form';
const EXPECTED_ACTION_TYPE = 'no supervision';

function looseRe(text) {
  return new RegExp(text.trim().replace(/\s+/g, '\\s*'), 'i');
}

class AuditLogHelper {
  /** All audit-log rows for a customer (by full mobile, e.g. "+2011XXXXXXXX"), newest first. */
  async queryAuditLog(mobile) {
    const D  = cfg.cardDb.db.database;
    const db = new DbHelper(cfg.cardDb);
    await db.connect();
    try {
      return await db.query(
        `SELECT a.* FROM ${D}.${AUDIT_TABLE} a
           JOIN ${D}.wallet_users w ON a.user_id = w.id
          WHERE w.mobile_number = ?
          ORDER BY a.id DESC`,
        [mobile]
      );
    } finally {
      await db.close();
    }
  }

  /**
   * Find the "print KYC form" audit entry for a customer and report which required fields
   * it carries. Values are matched inside the row (schema-agnostic).
   * @param {string} mobile  full mobile ("+2011XXXXXXXX")
   * @returns {Promise<{found:boolean, row:object|null, rows:object[],
   *                     hasActionName:boolean, hasActionType:boolean,
   *                     hasCustomerMobile:boolean, count:number}>}
   */
  async findPrintKycAction(mobile, opts = {}) {
    const nameRe = looseRe(opts.actionName || EXPECTED_ACTION_NAME);
    const typeRe = looseRe(opts.actionType || EXPECTED_ACTION_TYPE);
    const rows   = await this.queryAuditLog(mobile);

    const matches = rows.filter(r => nameRe.test(JSON.stringify(r)));
    const row     = matches[0] || null;
    const localMobile = mobile.replace(/^\+?2/, ''); // audit may store the "2"-stripped form

    return {
      found:  !!row,
      row,
      rows,
      count:  matches.length,
      hasActionName:     !!row,
      hasActionType:     row ? typeRe.test(JSON.stringify(row)) : false,
      hasCustomerMobile: row ? (JSON.stringify(row).includes(mobile) || JSON.stringify(row).includes(localMobile)) : false,
    };
  }
}

AuditLogHelper.EXPECTED_ACTION_NAME = EXPECTED_ACTION_NAME;
AuditLogHelper.EXPECTED_ACTION_TYPE = EXPECTED_ACTION_TYPE;
module.exports = AuditLogHelper;
