'use strict';
/**
 * Get a live, logged-in session onto the Perks List from wherever it currently is.
 * Idempotent: if already on the list it returns immediately.
 *
 *   node goto-list.js <ios|android> <en|ar>
 *
 * Route: clear any blocking interstitial → make sure we are on the Pay tab → scroll Pay home until
 * the Card-perks section header is genuinely on screen → tap the "See all" beside that header.
 */
const fs = require('fs');
const path = require('path');
const { bsReq, sleep, screenshot, getSource } = require('../../../bs_helper.js');
const session = require('./session.js');
const nav = require('./nav.js');
const probe = require('./probe-list.js');

const ROOT = path.resolve(__dirname, '..', '..');
const SHOTS = path.join(ROOT, 'screenshots');

const LIST_TITLE = /^(Card perks|مزايا البطاقة)$/;
const PERKS_HEADER = /^(Card perks|مزايا البطاقة)$/;
const SEE_ALL = /^(See all|See All|عرض الكل)$/;
const GEOM = { android: { screenW: 1080, screenH: 2340 }, ios: { screenW: 390, screenH: 844 } };

/**
 * "Card perks" / "مزايا البطاقة" appears on BOTH screens — as the list's title and as Pay home's
 * section header — so the title alone cannot tell them apart.
 *
 * The bottom-tab-bar test is Android-only (`bottomBar_pay_btn` does not exist on iOS, where the Pay
 * tab is matched by label), and using it silently classified iOS Pay home as "list". Use a
 * platform-neutral discriminator instead: **the wallet-balance block exists only on Pay home.**
 */
const WALLET = /^(Wallet balance|رصيد المحفظة|Add to balance|إضافة إلى الرصيد)$/;

function whereAmI(rows) {
  const hasWallet = rows.some((r) => WALLET.test(r.t) && r.real);
  const hasTitle = rows.some((r) => LIST_TITLE.test(r.t) && r.real);
  if (hasWallet) return 'pay-home';
  if (hasTitle) return 'list';
  return 'unknown';
}

async function run(platform, locale) {
  const tag = `${platform}-${locale}`;
  const geom = GEOM[platform];
  const sid = session.readId(platform, locale);
  if (!sid || !(await session.alive(sid))) throw new Error(`no live session for ${tag}`);

  const cleared = await probe.ensureInteractive(sid);
  let rows = nav.rowsOf(await getSource(sid));
  let at = whereAmI(rows);
  console.log(`  at=${at} interactive=${JSON.stringify(cleared)}`);
  if (at === 'list') return { sid, already: true };

  if (at === 'unknown') {
    const payTab = rows.find((r) => /bottomBar_pay_btn/.test(r.id || r.name || '') && r.real);
    if (payTab) { await nav.tapRow(sid, payTab, 'Pay tab'); await sleep(6000); }
    rows = nav.rowsOf(await getSource(sid));
  }

  // Scroll Pay home until the Card-perks header is in the SAFE ZONE.
  //
  // "On screen" is not enough: the bottom tab bar overlays roughly the last 90 px, and a row reported
  // inside the screen but under that overlay is not tappable — on iOS the header landed at y=775 of
  // 844 and the tap hit the "More" tab instead of "See all". So require the row to sit above
  // screenH - 110 before tapping, scrolling further if it does not.
  const safeMaxY = geom.screenH - 110;
  const inSafeZone = (r) => PERKS_HEADER.test(r.t) && nav.centre(r.bounds) && nav.centre(r.bounds).y < safeMaxY;

  let hdr = await nav.scrollUntil(sid, inSafeZone, { geom, maxSwipes: 10 });
  if (!hdr.row) {
    // It may be on screen but under the overlay — nudge once more and retry.
    await nav.scrollDown(sid, geom); await sleep(1200);
    hdr = await nav.scrollUntil(sid, inSafeZone, { geom, maxSwipes: 3 });
  }
  if (!hdr.row) throw new Error(`Card-perks header never reached the safe zone (swipes=${hdr.swipes}, exhausted=${hdr.exhausted})`);
  const hy = nav.centre(hdr.row.bounds).y;

  const visible = nav.onScreen(hdr.xml).filter((r) => {
    const c = nav.centre(r.bounds);
    return c && c.y < safeMaxY;
  });
  const seeAll = visible
    .filter((r) => SEE_ALL.test(r.t))
    .map((r) => ({ r, y: nav.centre(r.bounds).y }))
    .sort((a, b) => Math.abs(a.y - hy) - Math.abs(b.y - hy))[0];
  if (!seeAll) throw new Error('no on-screen "See all" beside the perks header');

  const c = await nav.tapRow(sid, seeAll.r, 'perks See all');
  console.log(`  perks header y=${hy}, tapped "See all" @ ${c.x},${c.y}`);
  await sleep(9000);

  rows = nav.rowsOf(await getSource(sid));
  at = whereAmI(rows);
  await screenshot(sid, path.join(SHOTS, `${tag}-goto-list-result.png`));
  if (at !== 'list') throw new Error(`tap did not land on the Perks List (at=${at})`);
  return { sid, already: false };
}

module.exports = { run, whereAmI };

if (require.main === module) {
  const [platform = 'android', locale = 'en'] = process.argv.slice(2);
  run(platform, locale).then((r) => console.log('OK', JSON.stringify(r))).catch((e) => { console.error('ERR', e.message); process.exit(1); });
}
