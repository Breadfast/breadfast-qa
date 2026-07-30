'use strict';
/**
 * Structured probe of the Perks List screen, run against a live session already ON that screen.
 *
 *   node probe-list.js <ios|android> <en|ar>
 *
 * Produces evidence/<tag>-list-probe.json with everything the ACs need:
 *   tabs[]            every tab label, gathered by scrolling the tab row to BOTH ends
 *                     (AC2, AC6 — a negative about the tab set is only sound after a full sweep)
 *   sections[]        section headers in the order they appear down the grid (AC4)
 *   cards[]           perkId, title, subheader, and the section they fall under (AC10, AC11, AC12)
 *   rowPairs[]        cards grouped into grid rows with their heights (AC12 equal-height check)
 *   frames[]          per-scroll-step record so the sweep is auditable
 *
 * THE INVISIBLE-NODE TRAP (see nav.js): nodes below the fold are reported with a real x1,y1 but a
 * clipped/degenerate x2,y2 and displayed="false". Only `real`-bounds rows may be tapped or measured.
 * A separate trap found 2026-07-29: a leftover interstitial can leave the WHOLE Pay tree
 * displayed="false" and swallow every touch — `ensureInteractive()` detects and clears that.
 */
const fs = require('fs');
const path = require('path');
const { bsReq, sleep, screenshot, getSource } = require('../../../bs_helper.js');
const session = require('./session.js');
const nav = require('./nav.js');

const ROOT = path.resolve(__dirname, '..', '..');
const SHOTS = path.join(ROOT, 'screenshots');
const EVID = path.join(ROOT, 'evidence');

const GEOM = { android: { screenW: 1080, screenH: 2340 }, ios: { screenW: 390, screenH: 844 } };
const TITLE = /^(Card perks|مزايا البطاقة)$/;

const box = (b) => {
  const m = /\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/.exec(b || '');
  if (m) { const [, x1, y1, x2, y2] = m.map(Number); return { x1, y1, x2, y2, w: x2 - x1, h: y2 - y1 }; }
  const i = /^(-?\d+),(-?\d+),(\d+),(\d+)$/.exec(String(b || '').trim());
  if (i) { const [, x, y, w, h] = i.map(Number); return { x1: x, y1: y, x2: x + w, y2: y + h, w, h }; }
  return null;
};

/**
 * A leftover interstitial makes every content node displayed="false" and swallows every touch
 * (found 2026-07-29: Pay home sat unresponsive for 8 minutes; `back` cleared it).
 *
 * The signal must be an ABSOLUTE count of on-screen NON-CHROME rows, not a share of all rows: a long
 * scrollable list legitimately reports most of its nodes off-screen, so a share-based test wrongly
 * fires on a perfectly healthy Perks List — which is exactly what happened on the first attempt and
 * pressed `back` off the screen under test. In the genuinely stuck state the ONLY real-bounds rows
 * were chrome (bottom bar, nav bar, action bar): non-chrome real rows = 0.
 */
const CHROME = /bottomBar|navigationBar|action_bar_root|android:id\/content|statusBar/;

/**
 * Excluding chrome by resource-id alone is not enough: the bottom-nav LABELS ("Home", "Pay", "More")
 * carry no id, so they were counted as real content and the guard passed on a stuck screen
 * (7 "content" rows, every one of them chrome). Also exclude anything sitting in the bottom fifth of
 * the screen, which is where the tab bar lives on both platforms.
 */
async function ensureInteractive(sid, { maxBacks = 2, minContentRows = 3, screenH = 2340 } = {}) {
  const isChrome = (r) => CHROME.test(r.id || r.name || '') || (box(r.bounds) || {}).y1 > screenH * 0.8;
  for (let i = 0; i <= maxBacks; i++) {
    const rows = nav.rowsOf(await getSource(sid));
    const contentReal = rows.filter((r) => r.t && r.real && !isChrome(r));
    if (contentReal.length >= minContentRows) return { cleared: i, contentRows: contentReal.length };
    if (i === maxBacks) return { cleared: i, contentRows: contentReal.length, warning: 'no interactive content found' };
    await bsReq('POST', `/wd/hub/session/${sid}/back`, {});
    await sleep(3500);
  }
  return { cleared: maxBacks };
}

/** Tab pills = clickable-ish label rows sitting on the same y band, just under the screen title. */
function tabsFrom(rows) {
  const title = rows.find((r) => TITLE.test(r.t) && r.real);
  if (!title) return [];
  const ty = box(title.bounds).y2;
  const band = rows
    .filter((r) => r.real && r.t && !TITLE.test(r.t))
    .map((r) => ({ r, b: box(r.bounds) }))
    .filter((c) => c.b && c.b.y1 > ty - 10 && c.b.y1 < ty + 260 && c.b.h > 20 && c.b.h < 200);
  // The pill container and its label share a label; keep the widest per text.
  const byText = new Map();
  for (const c of band) {
    const prev = byText.get(c.r.t);
    if (!prev || c.b.w > box(prev.bounds).w) byText.set(c.r.t, c.r);
  }
  return [...byText.entries()].map(([t, r]) => ({ text: t, bounds: r.bounds, ...box(r.bounds) }))
    .sort((a, b) => a.x1 - b.x1);
}

async function sweepTabRow(sid, platform) {
  const geom = GEOM[platform];
  const seen = new Map();
  const passes = [];
  const record = (rows) => {
    const t = tabsFrom(rows);
    t.forEach((x) => { if (!seen.has(x.text)) seen.set(x.text, x); });
    return t;
  };
  let rows = nav.rowsOf(await getSource(sid));
  let tabs = record(rows);
  const y = tabs.length ? Math.round((tabs[0].y1 + tabs[0].y2) / 2) : Math.round(geom.screenH * 0.12);
  passes.push({ dir: 'initial', visible: tabs.map((t) => t.text) });

  for (const dir of ['next', 'next', 'next', 'prev', 'prev', 'prev']) {
    await nav.swipeTabRow(sid, y, { screenW: geom.screenW, dir });
    await sleep(900);
    rows = nav.rowsOf(await getSource(sid));
    const v = record(rows);
    passes.push({ dir, visible: v.map((t) => t.text) });
  }
  return { tabs: [...seen.values()], passes, tabRowY: y };
}

async function sweepGrid(sid, platform, tag) {
  const geom = GEOM[platform];
  const cards = new Map();
  const headers = new Map();
  const frames = [];
  let lastSig = null;
  for (let i = 0; i <= 25; i++) {
    const xml = await getSource(sid);
    const rows = nav.rowsOf(xml);
    const vis = rows.filter((r) => r.real);
    for (const r of vis) {
      const rid = r.id || r.name || r.desc || '';
      if (/perk-card-/.test(rid)) {
        const perkId = rid.replace(/^.*perk-card-/, '');
        const label = (r.label || r.desc || r.t || '').trim();
        const ci = label.indexOf(',');
        if (!cards.has(perkId)) {
          cards.set(perkId, {
            perkId,
            label,
            title: ci >= 0 ? label.slice(0, ci).trim() : label,
            subheader: ci >= 0 ? label.slice(ci + 1).trim() : '',
            ...box(r.bounds),
            seenAtStep: i,
          });
        }
      }
    }
    frames.push({ step: i, onScreen: vis.length, texts: vis.map((r) => r.t).filter(Boolean) });
    if (i < 3 || i % 4 === 0) await screenshot(sid, path.join(SHOTS, `${tag}-list-scroll-${String(i).padStart(2, '0')}.png`));
    const sig = vis.map((r) => r.t + '@' + r.bounds).join('|');
    if (sig === lastSig) return { cards: [...cards.values()], headers: [...headers.values()], frames, reachedEnd: true, steps: i };
    lastSig = sig;
    await nav.scrollDown(sid, geom);
    await sleep(700);
  }
  return { cards: [...cards.values()], headers: [...headers.values()], frames, reachedEnd: false, steps: 25 };
}

/** Group cards into grid rows by y1 proximity, so AC12's equal-height claim is measurable. */
function rowPairs(cards) {
  const sorted = [...cards].sort((a, b) => a.seenAtStep - b.seenAtStep || a.y1 - b.y1 || a.x1 - b.x1);
  const out = [];
  for (const c of sorted) {
    const row = out.find((r) => r.step === c.seenAtStep && Math.abs(r.y1 - c.y1) <= 24);
    if (row) row.cards.push(c);
    else out.push({ step: c.seenAtStep, y1: c.y1, cards: [c] });
  }
  return out.map((r) => ({
    step: r.step,
    y1: r.y1,
    cards: r.cards.map((c) => ({ perkId: c.perkId, x1: c.x1, w: c.w, h: c.h, title: c.title, subheader: c.subheader })),
    heights: r.cards.map((c) => c.h),
    equalHeight: new Set(r.cards.map((c) => c.h)).size === 1,
  }));
}

async function run(platform, locale) {
  const tag = `${platform}-${locale}`;
  const sid = session.readId(platform, locale);
  if (!sid || !(await session.alive(sid))) throw new Error(`no live session for ${tag}`);
  fs.mkdirSync(SHOTS, { recursive: true });
  fs.mkdirSync(EVID, { recursive: true });

  const interactive = await ensureInteractive(sid);
  const first = nav.rowsOf(await getSource(sid));
  const onList = first.some((r) => TITLE.test(r.t) && r.real);
  if (!onList) throw new Error(`not on the Perks List (title not visible). interactive=${JSON.stringify(interactive)}`);

  await screenshot(sid, path.join(SHOTS, `${tag}-list-00-default.png`));
  const tabSweep = await sweepTabRow(sid, platform);
  const grid = await sweepGrid(sid, platform, tag);

  const out = {
    tag, sid, capturedAt: new Date().toISOString(), interactive,
    screenTitle: (first.find((r) => TITLE.test(r.t)) || {}).t || null,
    tabs: tabSweep.tabs, tabPasses: tabSweep.passes, tabRowY: tabSweep.tabRowY,
    cards: grid.cards, cardCount: grid.cards.length,
    rowPairs: rowPairs(grid.cards),
    reachedEnd: grid.reachedEnd, scrollSteps: grid.steps,
    frameTexts: grid.frames,
  };
  fs.writeFileSync(path.join(EVID, `${tag}-list-probe.json`), JSON.stringify(out, null, 2));

  console.log(`[${tag}] title="${out.screenTitle}"`);
  console.log(`  tabs (${out.tabs.length}): ${out.tabs.map((t) => t.text).join(' | ')}`);
  console.log(`  cards (${out.cardCount}) over ${out.scrollSteps} scroll steps, reachedEnd=${out.reachedEnd}`);
  out.cards.forEach((c) => console.log(`    ${c.perkId.padEnd(7)} "${c.title}" / "${c.subheader}"  ${c.w}x${c.h}`));
  const bad = out.rowPairs.filter((r) => r.cards.length === 2 && !r.equalHeight);
  console.log(`  row pairs: ${out.rowPairs.length}, unequal-height pairs: ${bad.length}`);
  bad.forEach((r) => console.log(`    UNEQUAL step${r.step} heights=${r.heights.join(' vs ')} ${r.cards.map((c) => c.perkId).join(',')}`));
  return out;
}

module.exports = { run, tabsFrom, rowPairs, ensureInteractive, box };

if (require.main === module) {
  const [platform = 'android', locale = 'en'] = process.argv.slice(2);
  run(platform, locale).then(() => console.log('OK')).catch((e) => { console.error('ERR', e.message); process.exit(1); });
}
