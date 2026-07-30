'use strict';
/**
 * Scroll + on-screen-node helpers for the Perks List exploration.
 *
 * WHY THIS EXISTS — the invisible-node trap (measured 2026-07-29, Samsung Galaxy S23 / Android 13):
 * `allowInvisibleElements=true` is required to see the Compose tree at all, but it also exposes nodes
 * that are OFF-SCREEN, and UiAutomator2 reports those with **degenerate bounds** — literally
 * `bounds="[48,2502][0,81]"` with `displayed="false"`. Feeding that to `centre()` yields a nonsense
 * tap target (the first Perks-List attempt tapped 454,1235 and hit the card promo instead of
 * "See all"). So: a node is only tappable when it is BOTH `displayed="true"` AND has sane bounds
 * (x2 > x1 and y2 > y1). Everything here funnels through `onScreen()`.
 *
 * The same trap is the reason a negative can never be claimed from one dump: an absent label may
 * simply be below the fold. Scroll to the end, then conclude (bug-reporting.md §1.1).
 */
const { bsReq, sleep, getSource } = require('../../../bs_helper.js');
const { inventory, centre } = require('./drive.js');

const txt = (r) => (r.text || r.label || r.value || r.name || r.desc || '').trim();

/** Sane, on-screen bounds only. Android dialect "[x1,y1][x2,y2]"; iOS dialect "x,y,w,h". */
function hasRealBounds(bounds) {
  const a = /\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/.exec(bounds || '');
  if (a) { const [, x1, y1, x2, y2] = a.map(Number); return x2 > x1 && y2 > y1; }
  const i = /^(-?\d+),(-?\d+),(\d+),(\d+)$/.exec(String(bounds || '').trim());
  if (i) { const [, , , w, h] = i.map(Number); return w > 0 && h > 0; }
  return false;
}

/** All rows from a dump, annotated with whether they are genuinely tappable. */
function rowsOf(xml) {
  return inventory(xml).map((r) => ({ ...r, t: txt(r), real: hasRealBounds(r.bounds) }));
}

/** Only rows that are on screen AND have usable bounds. */
function onScreen(xml) {
  return rowsOf(xml).filter((r) => r.real);
}

async function dumpRows(sid) { return rowsOf(await getSource(sid)); }

async function swipe(sid, x1, y1, x2, y2, durationMs = 700) {
  await bsReq('POST', `/wd/hub/session/${sid}/actions`, {
    actions: [{
      type: 'pointer', id: 'finger1', parameters: { pointerType: 'touch' },
      actions: [
        { type: 'pointerMove', duration: 0, x: x1, y: y1 },
        { type: 'pointerDown', button: 0 },
        { type: 'pause', duration: 150 },
        { type: 'pointerMove', duration: durationMs, x: x2, y: y2 },
        { type: 'pointerUp', button: 0 },
      ],
    }],
  });
  await sleep(1200);
}

/** Scroll the page content UP (finger moves up → later content appears). */
async function scrollDown(sid, { screenW = 1080, screenH = 2340, fraction = 0.55 } = {}) {
  const x = Math.round(screenW / 2);
  const y1 = Math.round(screenH * 0.75);
  const y2 = Math.round(screenH * (0.75 - fraction));
  await swipe(sid, x, y1, x, y2);
}

async function scrollUp(sid, { screenW = 1080, screenH = 2340, fraction = 0.55 } = {}) {
  const x = Math.round(screenW / 2);
  const y1 = Math.round(screenH * 0.25);
  const y2 = Math.round(screenH * (0.25 + fraction));
  await swipe(sid, x, y1, x, y2);
}

/** Swipe the tab row horizontally. `dir` = 'next' walks toward later tabs in reading order. */
async function swipeTabRow(sid, y, { screenW = 1080, dir = 'next', rtl = false } = {}) {
  const forward = rtl ? dir !== 'next' : dir === 'next';
  const from = forward ? Math.round(screenW * 0.85) : Math.round(screenW * 0.15);
  const to = forward ? Math.round(screenW * 0.15) : Math.round(screenW * 0.85);
  await swipe(sid, from, y, to, y, 600);
}

/**
 * Scroll until `pred` matches an ON-SCREEN row, or the content stops moving.
 * Returns { row, xml, swipes, exhausted }.
 */
async function scrollUntil(sid, pred, { maxSwipes = 14, geom = {}, direction = 'down' } = {}) {
  let lastSig = null;
  for (let i = 0; i <= maxSwipes; i++) {
    const xml = await getSource(sid);
    const visible = onScreen(xml);
    const hit = visible.find(pred);
    if (hit) return { row: hit, xml, swipes: i, exhausted: false };
    const sig = visible.map((r) => r.t + '@' + r.bounds).join('|');
    if (sig === lastSig) return { row: null, xml, swipes: i, exhausted: true };
    lastSig = sig;
    if (direction === 'down') await scrollDown(sid, geom); else await scrollUp(sid, geom);
  }
  const xml = await getSource(sid);
  return { row: null, xml, swipes: maxSwipes, exhausted: false };
}

/**
 * Scroll to the very end, accumulating every on-screen row seen along the way.
 * This is the ONLY sound basis for a negative claim about list contents (AC6, AC8).
 */
async function scrollToEnd(sid, { maxSwipes = 30, geom = {} } = {}) {
  const seen = new Map();
  const frames = [];
  let lastSig = null;
  for (let i = 0; i <= maxSwipes; i++) {
    const xml = await getSource(sid);
    const visible = onScreen(xml);
    frames.push({ i, count: visible.length });
    for (const r of visible) {
      const key = (r.id || r.name || '') + '\u0000' + r.t;
      if (!seen.has(key)) seen.set(key, r);
    }
    const sig = visible.map((r) => r.t + '@' + r.bounds).join('|');
    if (sig === lastSig) return { rows: [...seen.values()], frames, swipes: i, reachedEnd: true };
    lastSig = sig;
    await scrollDown(sid, geom);
  }
  return { rows: [...seen.values()], frames, swipes: maxSwipes, reachedEnd: false };
}

async function tapXY(sid, x, y) {
  await bsReq('POST', `/wd/hub/session/${sid}/actions`, {
    actions: [{
      type: 'pointer', id: 'finger1', parameters: { pointerType: 'touch' },
      actions: [
        { type: 'pointerMove', duration: 0, x, y },
        { type: 'pointerDown', button: 0 },
        { type: 'pause', duration: 120 },
        { type: 'pointerUp', button: 0 },
      ],
    }],
  });
}

/** Tap a row only if it is genuinely on screen — refuses degenerate bounds rather than mis-tapping. */
async function tapRow(sid, row, what = 'row') {
  if (!row) throw new Error(`tapRow: no row for ${what}`);
  if (!hasRealBounds(row.bounds)) throw new Error(`tapRow: ${what} has degenerate bounds ${row.bounds} (off-screen) — scroll it into view first`);
  const c = centre(row.bounds);
  await tapXY(sid, c.x, c.y);
  return c;
}

module.exports = {
  txt, hasRealBounds, rowsOf, onScreen, dumpRows,
  swipe, scrollDown, scrollUp, swipeTabRow, scrollUntil, scrollToEnd, tapXY, tapRow, centre,
};
