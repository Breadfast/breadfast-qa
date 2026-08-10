'use strict';

/**
 * B10-57764 — write the BrowserStack TC-xxxx ids back into testcases.csv.
 *
 * The map must exist BEFORE automation: `automation-gen` binds each Java test to its case with
 * @TmsLink("TC-xxxx"), so an unmapped CSV means the suite cannot report results back to TMS.
 *
 * Writes the id into the "Test Case ID" column of each case's FIRST row (step rows stay blank).
 * Idempotent: re-running sets the same values.
 *
 * Usage: node write_tc_ids.js
 */

const fs = require('fs');
const path = require('path');
const { parseCsv, COLUMNS } = require('../../qa-workflow/lib/testcases/parse.js');

const CSV = path.join(__dirname, '..', 'testcases', 'testcases.csv');
const MAP = path.join(__dirname, 'tc-map.json');

const map = new Map(JSON.parse(fs.readFileSync(MAP, 'utf8')).filter((m) => m.id).map((m) => [m.title.trim(), m.id]));
const rows = parseCsv(fs.readFileSync(CSV, 'utf8')).filter((r) => r.length && r.some((f) => f !== ''));

const iId = COLUMNS.indexOf('Test Case ID');
const iTitle = COLUMNS.indexOf('Title');

let set = 0, missing = [];
for (let i = 1; i < rows.length; i++) {
  const title = String(rows[i][iTitle] || '').trim();
  if (!title) continue;                       // continuation (step) row
  const id = map.get(title);
  if (!id) { missing.push(title); continue; }
  rows[i][iId] = id;
  set++;
}

const esc = (v) => {
  const s = String(v == null ? '' : v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
fs.writeFileSync(CSV, rows.map((r) => r.map(esc).join(',')).join('\n') + '\n', 'utf8');

console.log(`wrote ${set} TC ids into ${CSV}`);
if (missing.length) console.log('NO ID FOR:\n  ' + missing.join('\n  '));

// read back and prove it
const check = parseCsv(fs.readFileSync(CSV, 'utf8'));
const ids = check.slice(1).filter((r) => String(r[iTitle] || '').trim()).map((r) => r[iId]);
console.log(`verified: ${ids.filter(Boolean).length}/${ids.length} case rows carry an id`);
console.log('ids:', ids.join(' '));
