'use strict';
/**
 * Drive from a fresh session to the **Perk Details** screen (B10-56711's surface under test) and
 * probe it against the 13 ACs.
 *
 *   node to-perk-details.js <ios|android> <en|ar> [perkTitleRegex] [localPhone]
 *
 * Route: to-perks-list.js's route → tap the perk card whose title matches → Perk Details.
 *
 * Default target is **perk 17 "BF Bakery 15% Off"** — the primary fixture: an ONLINE coupon code
 * (AC6/AC7), **16 newline-separated branch lines** so AC12's See-more path is reachable in one perk,
 * a populated Usage / Cashback-processing / Expiry, and full Arabic counterparts.
 *
 * Evidence written (per <tag> = platform-locale):
 *   screenshots/<tag>-10-perk-details-top.png     first viewport
 *   screenshots/<tag>-11-perk-details-full.png    after scrolling to the end
 *   evidence/<tag>-10-perk-details.xml            accessibility tree, top
 *   evidence/<tag>-11-perk-details-end.xml        accessibility tree, scrolled to end
 *   evidence/<tag>-perk-details.json              parsed card inventory + AC probe
 *
 * IMPORTANT (why the scroll matters): AC11/AC13 assert a card is **hidden**. Per
 * docs/ai/bug-reporting.md §1.1 a negative claimed from the FIRST viewport of a scrollable
 * container proves nothing — the container must be scrolled to its end before "absent" is asserted.
 */
const fs = require('fs');
const path = require('path');
const { sleep, screenshot, getSource, tap, bsReq } = require('../../../bs_helper.js');
const session = require('./session.js');
const { inventory, centre } = require('./drive.js');
const toPerksList = require('./to-perks-list.js');

const ROOT = path.resolve(__dirname, '..', '..');
const SHOTS = path.join(ROOT, 'screenshots');
const EVID = path.join(ROOT, 'evidence');

const log = (m) => console.log(m);
const txt = (r) => (r.text || r.label || r.value || r.name || r.desc || '').trim();

/** The five card labels, EN + AR, in the order AC5 mandates. */
const CARD_LABELS = [
  { key: 'coupon', order: 1, en: /^Coupon code$/i, ar: /^كود الكوبون$/ },
  { key: 'usage', order: 2, en: /^Usage$/i, ar: /^الاستخدام$/ },
  { key: 'branches', order: 3, en: /^Branches$/i, ar: /^الفروع$/ },
  { key: 'cashback', order: 4, en: /^Cashback processing$/i, ar: /^الكاش باك$/ },
  { key: 'expiry', order: 5, en: /^Expiry$/i, ar: /^الصلاحية$/ },
];
const SEE_MORE = /^(See more|اعرض المزيد|أعرض المزيد)$/;
const SEE_LESS = /^(See less|اعرض أقل|عرض أقل)$/;
const COPIED = /^(Copied!?|تم النسخ!?)$/;
const VIEW_CTA = /^(View|عرض)$/;
const CLOSE_CTA = /^(Close|إغلاق|اغلاق)$/;

function yOf(bounds) {
  const m = /\[(\d+),(\d+)\]\[(\d+),(\d+)\]/.exec(bounds || '');
  if (m) return Number(m[2]);
  const p = String(bounds || '').split(',').map(Number);
  return p.length === 4 ? p[1] : 0;
}

/** Parse the details screen: which of the five cards are present, in what vertical order. */
function parseDetails(xml, locale) {
  const rows = inventory(xml);
  const pick = locale === 'ar' ? 'ar' : 'en';
  const cards = [];
  for (const spec of CARD_LABELS) {
    const hit = rows.find((r) => spec[pick].test(txt(r)) || spec.en.test(txt(r)));
    if (hit) cards.push({ key: spec.key, expectedOrder: spec.order, label: txt(hit), y: yOf(hit.bounds), bounds: hit.bounds });
  }
  cards.sort((a, b) => a.y - b.y);
  const actualOrder = cards.map((c) => c.key);
  const expectedOrder = CARD_LABELS.filter((s) => actualOrder.includes(s.key)).map((s) => s.key);
  return {
    nodeCount: rows.length,
    cardsPresent: actualOrder,
    cardsAbsent: CARD_LABELS.map((s) => s.key).filter((k) => !actualOrder.includes(k)),
    orderCorrect: JSON.stringify(actualOrder) === JSON.stringify(expectedOrder),
    expectedOrder,
    cards,
    controls: {
      seeMore: rows.filter((r) => SEE_MORE.test(txt(r))).map((r) => ({ t: txt(r), bounds: r.bounds })),
      seeLess: rows.filter((r) => SEE_LESS.test(txt(r))).map((r) => ({ t: txt(r), bounds: r.bounds })),
      copied: rows.filter((r) => COPIED.test(txt(r))).map((r) => ({ t: txt(r), bounds: r.bounds })),
      viewCta: rows.filter((r) => VIEW_CTA.test(txt(r))).map((r) => ({ t: txt(r), bounds: r.bounds })),
      closeCta: rows.filter((r) => CLOSE_CTA.test(txt(r))).map((r) => ({ t: txt(r), bounds: r.bounds })),
    },
    allTexts: rows.map(txt).filter(Boolean),
  };
}

async function shot(sid, tag, label) {
  fs.mkdirSync(SHOTS, { recursive: true });
  const f = path.join(SHOTS, `${tag}-${label}.png`);
  await screenshot(sid, f);
  return f;
}
async function dump(sid, tag, label) {
  fs.mkdirSync(EVID, { recursive: true });
  const xml = await getSource(sid);
  fs.writeFileSync(path.join(EVID, `${tag}-${label}.xml`), xml);
  return xml;
}

/**
 * Swipe up once in the card region.
 * Coordinates are DEVICE-scale, not logical: iOS reports 375x812 points, Android reports
 * 1080x2340 pixels. Using the iOS numbers on Android moved only ~200px per swipe, so a card at
 * y=7402 could not be reached within any sane iteration budget.
 */
async function swipeUp(sid, platform) {
  const from = platform === 'ios' ? { x: 195, y: 640 } : { x: 540, y: 1750 };
  const to = platform === 'ios' ? { x: 195, y: 200 } : { x: 540, y: 550 };
  if (platform === 'ios') {
    await bsReq('POST', `/wd/hub/session/${sid}/execute/sync`, {
      script: 'mobile: dragFromToForDuration',
      args: [{ duration: 0.6, fromX: from.x, fromY: from.y, toX: to.x, toY: to.y }],
    });
  } else {
    await bsReq('POST', `/wd/hub/session/${sid}/actions`, {
      actions: [{
        type: 'pointer', id: 'finger1', parameters: { pointerType: 'touch' },
        actions: [
          { type: 'pointerMove', duration: 0, x: from.x, y: from.y },
          { type: 'pointerDown', button: 0 }, { type: 'pause', duration: 300 },
          { type: 'pointerMove', duration: 600, x: to.x, y: to.y },
          { type: 'pointerUp', button: 0 },
        ],
      }],
    });
  }
  await sleep(1500);
}

/** This story's operator-supplied test account (+201188369495, card Active, passcode 123321). */
const PHONE = '1188369495';

async function run(platform, locale, titleRe = 'DC_17', phone = PHONE) {
  const tag = `${platform}-${locale}`;
  const listed = await toPerksList.run(platform, locale, phone);
  const sid = listed.sid;
  const re = new RegExp(titleRe, 'i');

  log(`[${tag}] on Perks List — looking for a perk card matching /${titleRe}/i`);

  // Resolve against PERK-CARD nodes only, never any node whose text happens to match. A plain
  // text search picked the SECTION header "Bakery & Desserts" ahead of the perk "BF Bakery 15% Off"
  // and opened the wrong screen. Perk cards carry a `perk-card-<ID>` name/id, so scope to those and
  // prefer an exact title match over a substring one.
  const perkCards = (rowsAll) => rowsAll.filter((r) => /perk-card-/.test(r.name || r.id || r.desc || ''));
  const pickCard = (rowsAll) => {
    const cards = perkCards(rowsAll);
    const idHit = cards.find((r) => re.test((r.name || r.id || r.desc || '').replace(/^.*perk-card-/, '')));
    const exact = cards.find((r) => txt(r).replace(/&amp;/g, '&').trim().toLowerCase() === titleRe.trim().toLowerCase());
    return idHit || exact || cards.find((r) => re.test(txt(r)));
  };

  let all = inventory(await getSource(sid));
  let card = pickCard(all);

  // The target may be below the fold; scroll until it appears (bounded).
  for (let i = 0; !card && i < 10; i++) {
    await swipeUp(sid, platform);
    all = inventory(await getSource(sid));
    card = pickCard(all);
  }
  if (!card) {
    await dump(sid, tag, 'ERR-perk-card-not-found');
    throw new Error(`no perk card matching /${titleRe}/i on the Perks List`);
  }

  // Being in the accessibility tree is NOT the same as being on screen: perk-card bounds are reported
  // in the SCROLLABLE CONTENT space, so a card far down the list reports y≈7402 on a 2340px device.
  // Tapping that coordinate hits nothing and the run silently stays on the list. Scroll the target
  // into the viewport and re-read its bounds before tapping. ([[pay-appium-compose-traps]])
  const VIEW_TOP = 300, VIEW_BOTTOM = 2000;
  const cardId = (card.name || card.id || card.desc || '');
  let c = centre(card.bounds);
  for (let i = 0; i < 40 && (c.y < VIEW_TOP || c.y > VIEW_BOTTOM); i++) {
    await swipeUp(sid, platform);
    const fresh = inventory(await getSource(sid)).find((r) => (r.name || r.id || r.desc || '') === cardId);
    if (!fresh) break;
    card = fresh;
    c = centre(card.bounds);
  }
  if (c.y < VIEW_TOP || c.y > VIEW_BOTTOM) {
    await dump(sid, tag, 'ERR-card-offscreen');
    throw new Error(`perk card "${txt(card)}" never scrolled into the viewport (y=${c.y})`);
  }
  await tap(sid, c.x, c.y);
  log(`  tapped perk card "${txt(card)}" @ ${c.x},${c.y} (scrolled into view)`);
  await sleep(7000);

  await shot(sid, tag, '10-perk-details-top');
  const xmlTop = await dump(sid, tag, '10-perk-details');
  const top = parseDetails(xmlTop, locale);

  // Scroll to the end BEFORE asserting any card is absent (bug-reporting.md §1.1).
  let xmlEnd = xmlTop, prev = '';
  for (let i = 0; i < 6 && xmlEnd !== prev; i++) { prev = xmlEnd; await swipeUp(sid, platform); xmlEnd = await getSource(sid); }
  fs.writeFileSync(path.join(EVID, `${tag}-11-perk-details-end.xml`), xmlEnd);
  await shot(sid, tag, '11-perk-details-full');
  const end = parseDetails(xmlEnd, locale);

  // Union of both viewports is the authoritative presence set.
  const union = [...new Set([...top.cardsPresent, ...end.cardsPresent])];
  const unionOrderExpected = CARD_LABELS.filter((s) => union.includes(s.key)).map((s) => s.key);

  const out = {
    sid, tag, platform, locale, capturedAt: new Date().toISOString(),
    perkTapped: txt(card),
    top, end,
    presenceUnion: union,
    absentAfterFullScroll: CARD_LABELS.map((s) => s.key).filter((k) => !union.includes(k)),
    orderCorrectOverUnion: JSON.stringify(union.filter((k) => unionOrderExpected.includes(k))) === JSON.stringify(unionOrderExpected),
  };
  fs.writeFileSync(path.join(EVID, `${tag}-perk-details.json`), JSON.stringify(out, null, 2));

  log(`[${tag}] PERK DETAILS reached for "${out.perkTapped}"`);
  log(`   nodes(top)=${top.nodeCount}  cards(top)=[${top.cardsPresent.join(', ')}]`);
  log(`   after full scroll: present=[${union.join(', ')}]  absent=[${out.absentAfterFullScroll.join(', ') || 'none'}]`);
  log(`   AC5 order over surviving cards: ${out.orderCorrectOverUnion ? 'CORRECT' : 'WRONG'} (expected ${unionOrderExpected.join(' > ')})`);
  log(`   controls: seeMore=${end.controls.seeMore.length} seeLess=${end.controls.seeLess.length} view=${end.controls.viewCta.length} copied=${end.controls.copied.length}`);
  return out;
}

module.exports = { run, parseDetails, swipeUp, CARD_LABELS, SEE_MORE, SEE_LESS, COPIED, VIEW_CTA, CLOSE_CTA };

if (require.main === module) {
  const [platform = 'android', locale = 'en', title, phone = PHONE] = process.argv.slice(2);
  run(platform, locale, title, phone)
    .then(() => console.log('OK'))
    .catch((e) => { console.error('ERR', e.message); process.exit(1); });
}
