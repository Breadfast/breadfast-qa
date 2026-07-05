'use strict';

/**
 * KycPdfContentValidator — B10-56337 KYC A4 PDF content assertions.
 *
 * Extends the pdf-parse pattern proven in b55168_pom/tests/kyc_pdf_content.spec.js to the full
 * B10-56337 scope: field-mapping coverage, conditional "Other Nationalities" rendering, empty
 * Customer/Employee signatures, Date-of-Collection = generation date, Employee Name/Number from
 * login, and the added-AC line-wrap rule (long free text wraps to 2–3 rows, ≤50 chars per line,
 * no character truncation).
 *
 * All assertions use @playwright/test's expect so failures surface in the Playwright report.
 * Text is NFKC-normalised (Arabic RTL shaping) before matching, mirroring the working spec.
 */

const { expect } = require('@playwright/test');
const { PDFParse } = require('pdf-parse');

// Field labels verified present on the live KYC form (kyc_pdf_content.spec.js, 2026-06-22).
const REQUIRED_FIELD_LABELS = [
  'Full Name', 'other nationalities', 'Gender', 'Address', 'Nationality',
  'National Identification Number', 'ADIB', 'Occupation', 'Place Of Birth',
  'Issued By', 'Issued On', 'Expiry Date', 'Mobile Number', 'Birthdate',
  'KYC File Number', 'Employee',
];

// Additional B10-56337 mapping labels (checked softly — copy may differ slightly on the template).
const MAPPING_LABELS = ['Branch', 'Collection', 'Signature'];

class KycPdfContentValidator {
  /** Parse a PDF buffer into { text, norm, compact, lines }. */
  static async extract(buffer) {
    const parser = new PDFParse({ data: buffer });
    let text = '';
    try { const res = await parser.getText(); text = (res && res.text) || ''; }
    finally { try { await parser.destroy(); } catch { /* ignore */ } }
    const norm    = text.normalize('NFKC');
    const compact = norm.replace(/\s+/g, '');
    const lines   = norm.split(/\r?\n/).map(l => l.trim());
    return { text, norm, compact, lines };
  }

  /** Hard structural checks on the print_kyc response (status/content-type/magic bytes/size). */
  static assertStructural(result) {
    expect(result.status, `print_kyc should return 200. message="${result.message}"`).toBe(200);
    expect(result.contentType, 'response should be a PDF').toMatch(/application\/pdf/i);
    expect(result.body, 'PDF bytes captured').toBeTruthy();
    expect(result.body.length, 'PDF is non-trivial').toBeGreaterThan(10_000);
    expect(result.body.slice(0, 5).toString('latin1'), 'PDF magic header').toBe('%PDF-');
  }

  /** Assert every required field label is present on the form. */
  static assertRequiredLabels(norm, labels = REQUIRED_FIELD_LABELS) {
    for (const label of labels) {
      expect(norm, `KYC form must contain the field "${label}"`).toContain(label);
    }
  }

  /** Soft-assert the additional mapping labels; returns a coverage map for the report. */
  static reportMappingLabels(norm, labels = MAPPING_LABELS) {
    const coverage = {};
    for (const label of labels) {
      coverage[label] = norm.includes(label) ? 'FOUND' : 'missing';
      expect.soft(norm, `KYC form should contain the mapping label "${label}"`).toContain(label);
    }
    return coverage;
  }

  /** Assert a data value is present in the PDF (whitespace-insensitive). soft=true records only. */
  static assertValue(compact, name, value, { soft = false } = {}) {
    if (value == null || value === '') return 'n/a';
    const needle = String(value).replace(/\s+/g, '');
    const present = compact.includes(needle);
    if (soft) expect.soft(compact, `PDF should contain ${name} = "${value}"`).toContain(needle);
    else expect(compact, `PDF should contain ${name} = "${value}"`).toContain(needle);
    return present ? 'FOUND' : 'missing';
  }

  /** Assert each Arabic value (nationality, occupation, …) is rendered without garbling. */
  static assertArabicValues(norm, map, { soft = true } = {}) {
    const coverage = {};
    for (const [name, value] of Object.entries(map)) {
      const present = norm.includes(value);
      coverage[name] = present ? 'FOUND' : 'missing';
      if (soft) expect.soft(norm, `PDF should contain Arabic ${name} = "${value}"`).toContain(value);
      else expect(norm, `PDF should contain Arabic ${name} = "${value}"`).toContain(value);
    }
    return coverage;
  }

  /**
   * Conditional "Other Nationalities" rule (AC): the detail value is rendered ONLY when the flag
   * is Yes; when No the detail must NOT appear on the form.
   * @param {string} norm       normalised PDF text
   * @param {'Yes'|'No'} flag   the customer's has_other_nationalities value
   * @param {string} value      the other-nationalities detail value seeded when flag=Yes
   */
  static assertOtherNationalitiesConditional(norm, flag, value) {
    if (flag === 'Yes') {
      expect(norm, `Other Nationalities "${value}" must render when the flag is Yes`).toContain(value);
    } else if (value) {
      expect(norm, `Other Nationalities value "${value}" must be blank when the flag is No`).not.toContain(value);
    }
  }

  /** Assert the Customer's Signature and Employee Signature lines carry no value (kept empty). */
  static assertSignaturesEmpty(lines) {
    const sigLines = lines.filter(l => /signature/i.test(l));
    for (const l of sigLines) {
      const after = l.replace(/.*signature'?s?\s*:?/i, '').trim();
      expect(after, `Signature line should have no value: "${l}"`).toBe('');
    }
  }

  /** Date of Collection = generation date. Accepts dd/mm/yyyy, dd-mm-yyyy, yyyy-mm-dd of `date`. */
  static assertDateOfCollectionIs(norm, date = new Date()) {
    const compact = norm.replace(/\s+/g, '');
    const dd = String(date.getDate()).padStart(2, '0');
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const yyyy = String(date.getFullYear());
    const variants = [`${dd}/${mm}/${yyyy}`, `${dd}-${mm}-${yyyy}`, `${yyyy}-${mm}-${dd}`, `${yyyy}/${mm}/${dd}`];
    const found = variants.some(v => compact.includes(v.replace(/\s+/g, '')));
    expect(found, `Date of Collection should be the generation date (one of ${variants.join(', ')})`).toBe(true);
    return variants.find(v => compact.includes(v.replace(/\s+/g, ''))) || null;
  }

  /**
   * Added-AC line-wrap rule: an overflowing free-text value wraps to 2–3 rows, ≤50 chars per line,
   * with NO character truncation (the full seeded string is recoverable across the wrapped lines).
   * @param {string[]} lines   normalised PDF lines
   * @param {string} seeded    the long value seeded into the customer record
   */
  static assertLineWrap(lines, seeded, { maxPerLine = 50, maxRows = 3 } = {}) {
    const compactSeed = seeded.replace(/\s+/g, '');
    const compactAll  = lines.join('').replace(/\s+/g, '');
    // (A) no character truncation — the whole seeded string is present across the wrapped lines
    expect(compactAll, 'wrapped value must not be truncated (full string recoverable)').toContain(compactSeed);

    // (B) the wrap rows: lines whose compact form is a fragment of the seeded value
    const wrapRows = lines.filter(l => {
      const c = l.replace(/\s+/g, '');
      return c.length > 0 && compactSeed.includes(c);
    });
    expect(wrapRows.length, `wrapped value should span 2–${maxRows} rows, got ${wrapRows.length}`).toBeGreaterThanOrEqual(2);
    expect(wrapRows.length, `wrapped value should span 2–${maxRows} rows, got ${wrapRows.length}`).toBeLessThanOrEqual(maxRows);
    for (const l of wrapRows) {
      expect(l.length, `each wrapped line must be ≤${maxPerLine} chars: "${l}" (${l.length})`).toBeLessThanOrEqual(maxPerLine);
    }
    return wrapRows;
  }
}

KycPdfContentValidator.REQUIRED_FIELD_LABELS = REQUIRED_FIELD_LABELS;
KycPdfContentValidator.MAPPING_LABELS = MAPPING_LABELS;
module.exports = KycPdfContentValidator;
