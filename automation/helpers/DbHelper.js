'use strict';

/**
 * DbHelper — MySQL access to the card-services DB (cards_hades_testing) over an
 * SSH tunnel, mirroring the Java DatabaseConnectionFactory (JSch -L forward).
 *
 * Node equivalents:
 *   ssh2   → opens the bastion session + forwardOut() to the MySQL host
 *   mysql2 → speaks the MySQL protocol over that forwarded duplex stream
 *
 * Install once:   npm i mysql2 ssh2
 *
 * Connection values are read from the Java config_testing.properties via
 * PropertiesReader (single source of truth; no secrets duplicated here).
 *
 * NOTE ON THE TABLE: the export sample is `transactions_requests`. If the live
 * schema differs, change TABLE below. MID/MCC live INSIDE the `transaction_data`
 * JSON column (keys "mid","mcc"), not as their own columns.
 */

const fs    = require('fs');
const mysql = require('mysql2/promise');
const { Client } = require('ssh2');
const { getCardDbConfig } = require('./PropertiesReader');

const TABLE        = process.env.BF_TX_TABLE || 'transactions_requests';
const TYPE_PURCHASE = 25;   // eligible purchase
const TYPE_CASHBACK = 30;   // cashback row written by the cron

class DbHelper {
  /**
   * @param {string|object} [cfgOrPropsPath]
   *   - object: explicit { db:{host,port,user,password,database}, ssh:{required,host,port,username,password|keyPath,...} }
   *   - string/undefined: properties path passed to getCardDbConfig (default breadfast/card DB from config_testing.properties)
   */
  constructor(cfgOrPropsPath) {
    this.cfg = (cfgOrPropsPath && typeof cfgOrPropsPath === 'object')
      ? cfgOrPropsPath
      : getCardDbConfig(cfgOrPropsPath);
    this.ssh     = null;
    this.conn    = null;
  }

  // ── lifecycle ──────────────────────────────────────────────────────────────

  async connect() {
    const { db, ssh } = this.cfg;

    if (!ssh.required) {
      this.conn = await mysql.createConnection({ ...db, multipleStatements: false });
      return this;
    }

    // The bastion intermittently drops the SSH handshake ("Timed out while waiting for
    // handshake" / ECONNRESET); retry transient failures with linear backoff so a single
    // flaky connect does not fail an otherwise-good test. Tunable via BF_DB_CONNECT_RETRIES.
    const attempts = Math.max(1, Number(process.env.BF_DB_CONNECT_RETRIES || 3));
    let lastErr;
    for (let i = 1; i <= attempts; i++) {
      try {
        const stream = await this._openSshForward(ssh, db.host, db.port);
        this.conn = await mysql.createConnection({
          user: db.user,
          password: db.password,
          database: db.database,
          stream,                       // speak MySQL over the SSH-forwarded socket
          multipleStatements: false,
        });
        return this;
      } catch (err) {
        lastErr = err;
        try { if (this.ssh) this.ssh.end(); } catch (_) {}
        this.ssh = null; this.conn = null;
        if (i < attempts && DbHelper._isTransientConnErr(err)) {
          await new Promise(r => setTimeout(r, 1000 * i)); // 1s, 2s, …
          continue;
        }
        throw err;
      }
    }
    throw lastErr;
  }

  /** True for the transient tunnel/network errors that a retry can recover from. */
  static _isTransientConnErr(err) {
    return /handshake|timed out|ECONNRESET|ETIMEDOUT|ECONNREFUSED|EPIPE| EHOSTUNREACH/i
      .test(String((err && err.message) || err));
  }

  _openSshForward(ssh, dstHost, dstPort) {
    return new Promise((resolve, reject) => {
      const client = new Client();
      this.ssh = client;
      client
        .on('ready', () => {
          client.forwardOut('127.0.0.1', 0, dstHost, dstPort, (err, stream) => {
            if (err) return reject(err);
            resolve(stream);
          });
        })
        .on('error', reject)
        .connect({
          host: ssh.host,
          port: ssh.port,
          username: ssh.username,
          // password auth when provided; otherwise private-key auth
          ...(ssh.password
            ? { password: ssh.password }
            : { privateKey: fs.readFileSync(ssh.keyPath), passphrase: ssh.keyProtected ? ssh.passphrase : undefined }),
          readyTimeout: Number(process.env.BF_SSH_READY_TIMEOUT || 30000),
          keepaliveInterval: 10000,
        });
    });
  }

  async close() {
    try { if (this.conn) await this.conn.end(); } catch (_) {}
    try { if (this.ssh)  this.ssh.end(); }       catch (_) {}
    this.conn = null; this.ssh = null;
  }

  // ── raw query ────────────────────────────────────────────────────────────────

  async query(sql, params = []) {
    const [rows] = await this.conn.execute(sql, params);
    return rows;
  }

  // ── seed / adjust (step 2 of the manual flow) ───────────────────────────────

  /**
   * Find the most recent eligible purchase (type 25) for a test mobile — the row
   * you then "adjust" for a scenario. Mirrors the manual workflow.
   * @param {string} mobile  sender_identifier, e.g. '+201155558882'
   */
  async findLatestPurchaseForMobile(mobile) {
    const rows = await this.query(
      `SELECT id, amount, status, transaction_data, perk_processed, createdAt
         FROM ${TABLE}
        WHERE transaction_type = ? AND sender_identifier = ?
        ORDER BY id DESC LIMIT 1`,
      [TYPE_PURCHASE, mobile]
    );
    return rows[0] || null;
  }

  /**
   * Adjust an existing purchase so it matches the perk under test:
   * set mid/mcc inside transaction_data, optionally amount + createdAt (so it
   * falls inside the perk validity window), and reset perk_processed to 0.
   *
   * Uses JSON_SET — confirm `transaction_data` is a JSON/compatible column.
   * If it is plain TEXT, use setRawTransactionData() instead.
   *
   * @param {number} id
   * @param {{mid?:string, mcc?:string, amount?:number, createdAt?:string}} o
   */
  async adjustPurchaseForTest(id, o = {}) {
    const sets = ['perk_processed = 0'];
    const args = [];
    if (o.mid !== undefined) { sets.push(`transaction_data = JSON_SET(transaction_data, '$.mid', ?)`); args.push(String(o.mid)); }
    if (o.mcc !== undefined) { sets.push(`transaction_data = JSON_SET(transaction_data, '$.mcc', ?)`); args.push(String(o.mcc)); }
    if (o.amount    !== undefined) { sets.push('amount = ?');    args.push(o.amount); }
    if (o.createdAt !== undefined) { sets.push('createdAt = ?'); args.push(o.createdAt); }
    args.push(id);
    await this.query(`UPDATE ${TABLE} SET ${sets.join(', ')} WHERE id = ?`, args);
    return this.getRow(id);
  }

  /** Overwrite the whole transaction_data blob (use when the column is TEXT, not JSON). */
  async setRawTransactionData(id, jsonString) {
    await this.query(`UPDATE ${TABLE} SET transaction_data = ? WHERE id = ?`, [jsonString, id]);
  }

  /**
   * Clone an eligible purchase row and override fields — for cases that need a
   * fresh transaction rather than mutating an existing one. Copies every column
   * except the PK so NOT-NULL constraints are satisfied by the template.
   * @param {number} templateId  an existing good type-25 row to copy
   * @param {object} overrides   column → value (e.g. { amount: 250 })
   * @param {{mid?:string,mcc?:string}} jsonFields  transaction_data overrides
   */
  async cloneEligiblePurchase(templateId, overrides = {}, jsonFields = {}) {
    const [tmpl] = await this.query(`SELECT * FROM ${TABLE} WHERE id = ?`, [templateId]);
    if (!tmpl) throw new Error(`cloneEligiblePurchase: template id ${templateId} not found`);
    delete tmpl.id;
    Object.assign(tmpl, { transaction_type: TYPE_PURCHASE, perk_processed: 0 }, overrides);

    if (jsonFields.mid !== undefined || jsonFields.mcc !== undefined) {
      let td = {};
      try { td = JSON.parse(tmpl.transaction_data || '{}'); } catch (_) {}
      if (jsonFields.mid !== undefined) td.mid = String(jsonFields.mid);
      if (jsonFields.mcc !== undefined) td.mcc = String(jsonFields.mcc);
      tmpl.transaction_data = JSON.stringify(td);
    }

    const cols = Object.keys(tmpl);
    const sql  = `INSERT INTO ${TABLE} (${cols.map(c => `\`${c}\``).join(',')}) ` +
                 `VALUES (${cols.map(() => '?').join(',')})`;
    const res  = await this.query(sql, cols.map(c => tmpl[c]));
    return res.insertId;
  }

  async resetPerkProcessed(id) {
    await this.query(`UPDATE ${TABLE} SET perk_processed = 0 WHERE id = ?`, [id]);
  }

  // ── verify (step 4 of the manual flow) ──────────────────────────────────────

  async getRow(id) {
    const rows = await this.query(`SELECT * FROM ${TABLE} WHERE id = ?`, [id]);
    return rows[0] || null;
  }

  async getPerkProcessed(id) {
    const rows = await this.query(`SELECT perk_processed FROM ${TABLE} WHERE id = ?`, [id]);
    return rows[0] ? Number(rows[0].perk_processed) : null;
  }

  /** All cashback rows (type 30) generated for a given originating purchase. */
  async getCashbackRows(triggerId) {
    return this.query(
      `SELECT id, amount, status, card_perk_id, trigger_transaction_id, perk_processed
         FROM ${TABLE}
        WHERE transaction_type = ? AND trigger_transaction_id = ?`,
      [TYPE_CASHBACK, triggerId]
    );
  }

  /** How many cashback rows exist for a purchase — the core anti-stacking assertion. */
  async countCashback(triggerId) {
    const rows = await this.query(
      `SELECT COUNT(*) AS n FROM ${TABLE}
        WHERE transaction_type = ? AND trigger_transaction_id = ?`,
      [TYPE_CASHBACK, triggerId]
    );
    return Number(rows[0].n);
  }
}

DbHelper.TYPE_PURCHASE = TYPE_PURCHASE;
DbHelper.TYPE_CASHBACK = TYPE_CASHBACK;
module.exports = DbHelper;
