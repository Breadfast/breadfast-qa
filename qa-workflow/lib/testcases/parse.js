'use strict';

/**
 * Reader for the canonical BrowserStack test-case CSV.
 * Format spec (locked): docs/ai/browserstack-process.md §10.1–10.4.
 *   - 24 columns, exact order
 *   - ONE ROW PER STEP: the first row of a case carries every field; each continuation row carries
 *     only Steps (13) + Expected Result (14), everything else blank
 *   - RFC4180 quoting: embedded commas/newlines/doubled quotes inside quoted fields, UTF-8
 *
 * Dependency-free by design (ADR-001 §3.3) — no csv library.
 */

/** §10.1 — the exact header, in order. */
const COLUMNS = [
  'Test Case ID', 'Title', 'Folder ID', 'Folder Path', 'State', 'Owner', 'Priority',
  'Type of Test Case', 'Automation Status', 'Description', 'Preconditions', 'Template',
  'Steps', 'Expected Result', 'Issues', 'Tags', 'Status (latest)', 'Attachments',
  'Created At', 'Created By', 'Last Updated At', 'Last Updated By', 'Project Name', 'Test Case URL',
];
const C = COLUMNS.reduce((m, name, i) => (m[name] = i, m), {});
/** Columns BrowserStack owns — must be blank when importing new cases (§10.3). */
const SYSTEM_COLUMNS = ['Test Case ID', 'Status (latest)', 'Created At', 'Created By', 'Last Updated At', 'Last Updated By', 'Test Case URL'];

/** Split CSV text into rows of raw string fields. Handles quotes, doubled quotes and embedded newlines. */
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  const src = String(text).replace(/^﻿/, '');   // strip a BOM if the file came back from Excel
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; }   // escaped quote
        else inQuotes = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') { inQuotes = true; continue; }
    if (ch === ',') { row.push(field); field = ''; continue; }
    if (ch === '\r') continue;
    if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const val = (row, name) => (row[C[name]] || '').trim();

/** Tags are comma-separated inside the quoted Tags cell: `ai-created,ac:AC-1,screen:perks-list`. */
function parseTags(raw) {
  return String(raw || '').split(/[,;]/).map((t) => t.trim()).filter(Boolean);
}
/** Normalize an AC reference so `AC1`, `ac 1` and `AC-1` are the same thing. */
function normalizeAc(ref) {
  const m = /^ac[\s\-_:]*([0-9]+(?:\.[0-9]+)?)$/i.exec(String(ref).trim());
  return m ? `AC-${m[1]}` : String(ref).trim().toUpperCase();
}

/**
 * Group the rows into cases.
 * A row that carries a Title starts a new case; a row with no Title is a continuation step of the
 * case above it. A continuation row before any case is an orphan (reported, never silently dropped).
 */
function parseTestCases(text) {
  const rows = parseCsv(text).filter((r) => r.some((f) => String(f).trim() !== ''));
  if (!rows.length) return { header: [], headerOk: false, cases: [], orphanRows: [], rowCount: 0 };
  const header = rows[0].map((h) => h.trim());
  const headerOk = header.length === COLUMNS.length && COLUMNS.every((c, i) => header[i] === c);

  const cases = [];
  const orphanRows = [];
  rows.slice(1).forEach((row, idx) => {
    const line = idx + 2;                              // 1-based, header included — matches an editor
    if (val(row, 'Title')) {
      cases.push({
        line,
        tcId: val(row, 'Test Case ID'),
        title: val(row, 'Title'),
        folderId: val(row, 'Folder ID'),
        folderPath: val(row, 'Folder Path'),
        state: val(row, 'State'),
        owner: val(row, 'Owner'),
        priority: val(row, 'Priority'),
        type: val(row, 'Type of Test Case'),
        automationStatus: val(row, 'Automation Status'),
        description: val(row, 'Description'),
        preconditions: val(row, 'Preconditions'),
        template: val(row, 'Template'),
        issues: val(row, 'Issues'),
        tags: parseTags(val(row, 'Tags')),
        systemFields: SYSTEM_COLUMNS.filter((c) => val(row, c) !== ''),
        steps: [{ line, step: val(row, 'Steps'), expected: val(row, 'Expected Result') }],
      });
      return;
    }
    if (!cases.length) { orphanRows.push({ line, step: val(row, 'Steps') }); return; }
    cases[cases.length - 1].steps.push({ line, step: val(row, 'Steps'), expected: val(row, 'Expected Result') });
  });

  // Derived, tag-based traceability (§10.2 col 16 is author-owned; see browserstack-process §10.2a).
  for (const c of cases) {
    c.acs = c.tags.filter((t) => /^ac[:\-]/i.test(t)).map((t) => normalizeAc(t.replace(/^ac[:\-]/i, '')));
    c.screens = c.tags.filter((t) => /^screen[:\-]/i.test(t)).map((t) => t.replace(/^screen[:\-]/i, '').trim());
  }
  return { header, headerOk, cases, orphanRows, rowCount: rows.length - 1 };
}

/** Extract the AC ids a requirements/AC document mentions, for coverage checking. */
function extractAcs(text) {
  const found = new Set();
  const re = /\bAC[\s\-_]?([0-9]+(?:\.[0-9]+)?)\b/gi;
  let m;
  while ((m = re.exec(String(text)))) found.add(`AC-${m[1]}`);
  return [...found].sort((a, b) => Number(a.slice(3)) - Number(b.slice(3)));
}

module.exports = { COLUMNS, C, SYSTEM_COLUMNS, parseCsv, parseTestCases, parseTags, normalizeAc, extractAcs };
