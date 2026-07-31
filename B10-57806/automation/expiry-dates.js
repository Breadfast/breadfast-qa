'use strict';
/**
 * B10-57806 — date engine for the "ID expiry warning" scenarios.
 *
 * EVERY expiry date is derived from the DEVICE's current date at run time. Nothing is hard-coded, so the
 * suite gives the same verdicts on any calendar day (clarifications.md §3.1, impact.md AR-1). A literal
 * date would rot within weeks and start passing or failing by calendar accident.
 *
 * Rule under test (measured on the build 2026-07-30, Android):
 *     warn  <=>  expiry < today + 2 calendar months        (calendar months, EXCLUSIVE, month-end clamped)
 * The ACs do not define the boundary, so `boundaryExact` is reported, never asserted — see `expect` below.
 */

/** Add n calendar months, clamping to the last day of the target month (31 Jul + 2 => 30 Sep). */
function addCalendarMonths(date, n) {
  const y = date.getFullYear();
  const m = date.getMonth() + n;
  const d = date.getDate();
  const lastDayOfTarget = new Date(y, m + 1, 0).getDate();
  return new Date(y, m, Math.min(d, lastDayOfTarget));
}

const addDays = (date, n) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + n);

/** `DDMMYYYY` — the 8 digits typed into the numeric keypad. */
const toDigits = (d) =>
  String(d.getDate()).padStart(2, '0') +
  String(d.getMonth() + 1).padStart(2, '0') +
  String(d.getFullYear());

/** `DD / MM / YYYY` — how the field renders it, for assertions against the UI. */
const toDisplay = (d) =>
  `${String(d.getDate()).padStart(2, '0')} / ${String(d.getMonth() + 1).padStart(2, '0')} / ${d.getFullYear()}`;

const toIso = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * Read the DEVICE clock (not this machine's). BrowserStack devices can sit in another timezone, and the
 * check under test is client-side, so the device's "today" is the only one that matters.
 * Falls back to the local date if the endpoint is unavailable — the caller is told which was used.
 */
async function deviceToday(bsReq, sid) {
  try {
    const r = await bsReq('GET', `/wd/hub/session/${sid}/appium/device/system_time`);
    const raw = r && (r.value || r.val);
    if (raw) {
      const parsed = new Date(String(raw));
      if (!isNaN(parsed)) {
        return { date: new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate()), source: 'device', raw: String(raw) };
      }
    }
  } catch (_) { /* fall through */ }
  const n = new Date();
  return { date: new Date(n.getFullYear(), n.getMonth(), n.getDate()), source: 'local-fallback', raw: n.toISOString() };
}

/**
 * The scenario set, all relative to `today`.
 *  expect: 'warn'      -> sheet MUST appear
 *          'nowarn'    -> sheet must NOT appear; flow advances to 3/3
 *          'disputed'  -> the exact boundary. ACs are silent; A-01 says inclusive (warn), the build is
 *                         exclusive (no warn). REPORT the observation, never fail the run on it.
 *          'unspecified' -> no AC and no design frame (expired ID). Report only.
 */
function buildCases(today) {
  const threshold = addCalendarMonths(today, 2);      // inclusive-vs-exclusive pivot
  const cases = [
    { key: 'wellInside',     date: addCalendarMonths(today, 1),   expect: 'warn',        acs: ['AC-1'],  why: 'comfortably inside the 2-month window' },
    { key: 'boundaryMinus1', date: addDays(threshold, -1),        expect: 'warn',        acs: ['AC-1'],  why: 'one day inside the boundary' },
    { key: 'boundaryExact',  date: threshold,                     expect: 'disputed',    acs: ['AC-1', 'AC-4'], why: 'exactly today + 2 calendar months (clamped) — A-01 says warn, build says no warn' },
    { key: 'boundaryPlus1',  date: addDays(threshold, 1),         expect: 'nowarn',      acs: ['AC-4'],  why: 'first day outside the window' },
    { key: 'farFuture',      date: addCalendarMonths(today, 24),  expect: 'nowarn',      acs: ['AC-4'],  why: 'two years out — the majority path' },
    { key: 'expiresToday',   date: today,                         expect: 'warn',        acs: [],        why: 'A-02 edge: expires today is not yet expired' },
    { key: 'alreadyExpired', date: addCalendarMonths(today, -1),  expect: 'unspecified', acs: [],        why: 'no AC and no Figma frame — report only, never file' },
  ];
  return cases.map((c) => ({
    ...c,
    digits: toDigits(c.date),
    display: toDisplay(c.date),
    iso: toIso(c.date),
  }));
}

/** Month-end clamp is only observable when today's day-of-month exceeds the target month's length. */
function clampIsObservable(today) {
  const naive = new Date(today.getFullYear(), today.getMonth() + 2, today.getDate());
  const clamped = addCalendarMonths(today, 2);
  return {
    observable: naive.getMonth() !== clamped.getMonth(),
    clampedThresholdIso: toIso(clamped),
    naiveOverflowIso: toIso(naive),
  };
}

module.exports = { addCalendarMonths, addDays, toDigits, toDisplay, toIso, deviceToday, buildCases, clampIsObservable };

if (require.main === module) {
  const today = new Date();
  const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  console.log('today (local) = ' + toIso(t0));
  const clamp = clampIsObservable(t0);
  console.log('threshold     = ' + clamp.clampedThresholdIso + '   (naive overflow would be ' + clamp.naiveOverflowIso + ')');
  console.log('month-end clamp observable today? ' + clamp.observable);
  console.log('');
  for (const c of buildCases(t0)) {
    console.log(`  ${c.key.padEnd(15)} ${c.display.padEnd(16)} digits=${c.digits}  expect=${c.expect.padEnd(11)} ${c.why}`);
  }
}
