'use strict';

/**
 * ⚠️ DEPRECATED (2026-06-22) — superseded by dynamic provisioning (CardUserFactory).
 * Test data is now created per-run via API (register → Registered) and deleted from the DB
 * afterwards; no static sheet. Kept temporarily for reference; remove once the dynamic path
 * is verified end-to-end against a healthy testing env. The KYC specs no longer import this.
 *
 * TestDataInventory — single source of truth for consumable QA test data.
 *
 * Backs the shared ledger at D:\BreadfastQA\test_data_inventory.csv (columns:
 *   Phone Number, Package Number, Status, Story ID, Usage Date)
 * and lets specs AUTO-ALLOCATE a fresh, unused phone / package on every run instead
 * of hard-coding constants that go stale after one collection.
 *
 * Rows are one of two kinds:
 *   • phone row   — Phone Number set, Package Number empty
 *   • package row — Package Number set, Phone Number empty
 *
 * Transactional usage (so a dry run / failure never burns data):
 *   const inv   = require('.../TestDataInventory');
 *   const phone = inv.claimPhone();      // reserves the first Available phone (in-memory only)
 *   const pkg   = inv.claimPackage();    // reserves the first Available package
 *   ... run the destructive flow ...
 *   inv.consume([phone, pkg], 'B10-56336');   // ONLY on success → writes Status=Consumed + Story ID + today
 *   // on failure: do nothing (or inv.release(phone)) — the rows stay Available.
 *
 * If nothing is free, claim* throws a clear "inventory exhausted — request more data"
 * error (matches the standing Test-Data-Management standard).
 *
 * NOTE: the CSV only tracks OUR consumption, not live server state. A phone marked
 * Available must ALSO actually be Registered + KYC-incomplete on the server; the caller
 * is responsible for skip-with-reason if the server state doesn't match.
 */

const fs   = require('fs');
const path = require('path');

const DEFAULT_PATH =
  process.env.TEST_DATA_INVENTORY ||
  'D:\\BreadfastQA\\test_data_inventory.csv';

const HEADER = 'Phone Number,Package Number,Status,Story ID,Usage Date';

/** Local YYYY-MM-DD (matches "today" in the user's timezone, unlike toISOString/UTC). */
function today() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

class TestDataInventory {
  constructor(csvPath = DEFAULT_PATH) {
    this.csvPath = csvPath;
    /** values reserved this run but not yet committed (avoid handing out twice) */
    this._pending = new Set();
  }

  // ── CSV io ────────────────────────────────────────────────────────────────

  _read() {
    if (!fs.existsSync(this.csvPath)) {
      throw new Error(`TestDataInventory: ledger not found at "${this.csvPath}".`);
    }
    const lines = fs.readFileSync(this.csvPath, 'utf8').split(/\r?\n/);
    const rows = [];
    for (let i = 1; i < lines.length; i++) {           // skip header
      const line = lines[i];
      if (!line.trim()) continue;
      const [phone = '', pkg = '', status = '', story = '', date = ''] = line.split(',');
      rows.push({
        phone:  phone.trim(),
        pkg:    pkg.trim(),
        status: status.trim(),
        story:  story.trim(),
        date:   date.trim(),
      });
    }
    return rows;
  }

  _write(rows) {
    const body = rows
      .map(r => [r.phone, r.pkg, r.status, r.story, r.date].join(','))
      .join('\n');
    fs.writeFileSync(this.csvPath, `${HEADER}\n${body}\n`, 'utf8');
  }

  // ── claim (reserve, in-memory only) ─────────────────────────────────────────

  _claim(kind) {
    const rows = this._read();
    const isPhone = kind === 'phone';
    const hit = rows.find(r =>
      r.status.toLowerCase() === 'available' &&
      (isPhone ? r.phone && !r.pkg : r.pkg && !r.phone) &&
      !this._pending.has(isPhone ? r.phone : r.pkg)
    );
    if (!hit) {
      throw new Error(
        `TestDataInventory: no Available ${kind} left in "${this.csvPath}". ` +
        `Request more test data before re-running.`
      );
    }
    const value = isPhone ? hit.phone : hit.pkg;
    this._pending.add(value);
    return value;
  }

  /** First Available registered-status phone (not yet committed). */
  claimPhone()   { return this._claim('phone'); }

  /** First Available package number (not yet committed). */
  claimPackage() { return this._claim('package'); }

  // ── consume (commit to disk) ─────────────────────────────────────────────────

  /**
   * Mark one or more claimed values as Consumed by `storyId` (today's date).
   * Call this ONLY after the destructive flow succeeds.
   * @param {string|string[]} values
   */
  consume(values, storyId, dateStr = today()) {
    const set = new Set([].concat(values).filter(Boolean));
    if (!set.size) return;
    const rows = this._read();
    let changed = 0;
    for (const r of rows) {
      if (set.has(r.phone) || set.has(r.pkg)) {
        r.status = 'Consumed';
        r.story  = storyId || r.story;
        r.date   = dateStr;
        changed++;
      }
    }
    if (changed) this._write(rows);
    for (const v of set) this._pending.delete(v);
    return changed;
  }

  /** Drop a reservation without writing (e.g. the test bailed before using it). */
  release(values) {
    for (const v of [].concat(values).filter(Boolean)) this._pending.delete(v);
  }
}

module.exports = new TestDataInventory();
module.exports.TestDataInventory = TestDataInventory; // class export for custom paths/tests
