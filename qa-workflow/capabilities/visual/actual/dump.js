'use strict';

/**
 * Actual capture provider — structured dump → Conformance "actual screens"
 * (ADR-003 port `ActualCaptureProvider`). First cut: a PURE transform from an
 * already-parsed structured dump (a11y/DOM tree or Appium page source) to the
 * screen shape L5 consumes. Live capture (Playwright / BrowserStack) stays in
 * automation/**; parsing raw dumps stays in qa-platform `dump-parse`. This only
 * projects a parsed dump onto the pipeline's screen shape.
 *
 * Input dump (tolerant): { screenId, platform?, locale?, elements: [{ subject|testId|name|role, text|value }] }
 * Output screen:         { screenId, platform?, locale?, texts: [{ subject, text }], elements }
 *
 * `captureRaw` accepts RAW captured evidence ({ screenId, raw: <a11y text | Appium XML | dump JSON> })
 * and parses it via `./parse` first — the "real" reader over live capture.
 */

const { parseRawDump } = require('./parse');

function toActualScreen(dump) {
  dump = dump || {};
  const texts = [];
  for (const el of dump.elements || []) {
    if (!el) continue;
    const text = el.text != null ? el.text : el.value;
    if (text == null || text === '') continue;
    const subject = el.subject || el.testId || el.name || el.role || '';
    if (subject) texts.push({ subject, text: String(text) });
  }
  // Raw `elements` pass through for L2 (structural comparison); `texts` feed L5.
  const elements = Array.isArray(dump.elements) ? dump.elements : [];
  return { screenId: dump.screenId || '', platform: dump.platform, locale: dump.locale, texts, elements };
}

/** Parse RAW captured evidence (a11y text / Appium XML / dump JSON) → an actual screen. */
function toActualScreenFromRaw(entry) {
  entry = entry || {};
  const dump = parseRawDump(entry.raw != null ? entry.raw : '');
  const elements = dump && Array.isArray(dump.elements) ? dump.elements : [];
  return toActualScreen({ screenId: entry.screenId, platform: entry.platform, locale: entry.locale, elements });
}

const dumpActualProvider = {
  /** @param {any[]} dumps parsed structured dumps → actual screens */
  capture(dumps) {
    return (dumps || []).map(toActualScreen);
  },
  /** @param {any[]} rawEntries { screenId, raw:<a11y|xml|json> } → actual screens (parses raw first) */
  captureRaw(rawEntries) {
    return (rawEntries || []).map(toActualScreenFromRaw);
  },
};

module.exports = { dumpActualProvider, toActualScreen, toActualScreenFromRaw };
