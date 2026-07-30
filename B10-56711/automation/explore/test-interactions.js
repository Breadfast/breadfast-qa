'use strict';
/**
 * AC5 (tab tap scrolls to the category, other categories stay in the list) and
 * AC13 (card tap opens Perk Details for that exact perk), run against a live session on the list.
 *
 *   node test-interactions.js <ios|android> <en|ar>
 *
 * AC5 is the ambiguity the design resolved (clarifications C-1): tapping must SCROLL, not FILTER.
 * The filter-vs-scroll distinction is proven by scrolling BACK UP after the tap — under a filter the
 * earlier categories would be gone; under a scroll they are still there.
 */
const fs = require('fs');
const path = require('path');
const { bsReq, sleep, screenshot, getSource } = require('../../../bs_helper.js');
const session = require('./session.js');
const nav = require('./nav.js');
const probe = require('./probe-list.js');

const ROOT = path.resolve(__dirname, '..', '..');
const SHOTS = path.join(ROOT, 'screenshots');
const EVID = path.join(ROOT, 'evidence');
const GEOM = { android: { screenW: 1080, screenH: 2340 }, ios: { screenW: 390, screenH: 844 } };
const TITLE = /^(Card perks|مزايا البطاقة)$/;

async function rows(sid) { return nav.rowsOf(await getSource(sid)); }
const onScreenTexts = (rs) => rs.filter((r) => r.real).map((r) => r.t).filter(Boolean);

async function toTop(sid, platform) {
  const geom = GEOM[platform];
  for (let i = 0; i < 12; i++) {
    const before = onScreenTexts(await rows(sid)).join('|');
    await nav.scrollUp(sid, geom);
    await sleep(700);
    const after = onScreenTexts(await rows(sid)).join('|');
    if (before === after) return i;
  }
  return 12;
}

/** Section headers are the big left-aligned labels that duplicate a tab's text but sit below the row. */
function sectionHeadersOnScreen(rs, tabRowBottom) {
  return rs
    .filter((r) => r.real && r.t && !TITLE.test(r.t))
    .map((r) => ({ t: r.t, b: probe.box(r.bounds) }))
    .filter((c) => c.b && c.b.y1 > tabRowBottom + 10)
    .sort((a, b) => a.b.y1 - b.b.y1);
}

async function run(platform, locale) {
  const tag = `${platform}-${locale}`;
  const geom = GEOM[platform];
  const sid = session.readId(platform, locale);
  if (!sid || !(await session.alive(sid))) throw new Error(`no live session for ${tag}`);
  const out = { tag, sid, capturedAt: new Date().toISOString(), ac5: {}, ac13: {} };

  // ---------- AC5 ----------
  await toTop(sid, platform);
  let rs = await rows(sid);
  let tabs = probe.tabsFrom(rs);
  out.ac5.tabsAtTop = tabs.map((t) => t.text);
  const tabRowBottom = tabs.length ? Math.max(...tabs.map((t) => t.y2)) : 0;
  out.ac5.headersBeforeTap = sectionHeadersOnScreen(rs, tabRowBottom).slice(0, 4).map((h) => h.t);
  await screenshot(sid, path.join(SHOTS, `${tag}-ac5-00-top.png`));

  // Pick a tab that is NOT the first one and is on screen.
  const target = tabs.find((t, i) => i > 0);
  if (!target) throw new Error('need at least 2 tabs on screen for AC5');
  out.ac5.tappedTab = target.text;
  await nav.tapXY(sid, Math.round((target.x1 + target.x2) / 2), Math.round((target.y1 + target.y2) / 2));
  await sleep(3500);
  await screenshot(sid, path.join(SHOTS, `${tag}-ac5-01-after-tab-tap.png`));

  rs = await rows(sid);
  tabs = probe.tabsFrom(rs);
  out.ac5.activeTabAfterTap = null; // active state is visual only — recorded from the screenshot
  out.ac5.headersAfterTap = sectionHeadersOnScreen(rs, tabRowBottom).slice(0, 4).map((h) => h.t);
  out.ac5.textsAfterTap = onScreenTexts(rs).slice(0, 30);
  const hdr = sectionHeadersOnScreen(rs, tabRowBottom).find((h) => h.t === target.text);
  out.ac5.targetHeaderOnScreen = !!hdr;
  out.ac5.targetHeaderY = hdr ? hdr.b.y1 : null;

  // Filter-vs-scroll: after the tap, can the EARLIER categories still be reached by scrolling up?
  await nav.scrollUp(sid, geom); await sleep(900);
  await nav.scrollUp(sid, geom); await sleep(900);
  rs = await rows(sid);
  out.ac5.textsAfterScrollBackUp = onScreenTexts(rs).slice(0, 30);
  out.ac5.firstCategoryStillReachable = out.ac5.textsAfterScrollBackUp.some((t) => t === out.ac5.tabsAtTop[0]);
  await screenshot(sid, path.join(SHOTS, `${tag}-ac5-02-scrolled-back-up.png`));

  // ---------- AC13 ----------
  await toTop(sid, platform);
  rs = await rows(sid);
  const card = rs.find((r) => /perk-card-/.test(r.id || r.name || r.desc || '') && r.real);
  if (!card) throw new Error('no on-screen perk card for AC13');
  const perkId = (card.id || card.name || card.desc || '').replace(/^.*perk-card-/, '');
  const label = (card.label || card.desc || card.t || '').trim();
  out.ac13.tappedPerkId = perkId;
  out.ac13.tappedLabel = label;
  await nav.tapRow(sid, card, 'perk card');
  await sleep(9000);
  await screenshot(sid, path.join(SHOTS, `${tag}-ac13-00-perk-details.png`));
  rs = await rows(sid);
  out.ac13.detailsTexts = onScreenTexts(rs).slice(0, 30);
  const expectedTitle = label.split(',')[0].trim();
  out.ac13.titleFoundOnDetails = out.ac13.detailsTexts.some((t) => t === expectedTitle);
  out.ac13.stillOnList = rs.some((r) => TITLE.test(r.t) && r.real) && !out.ac13.titleFoundOnDetails;

  // back to the list
  await bsReq('POST', `/wd/hub/session/${sid}/back`, {});
  await sleep(6000);
  rs = await rows(sid);
  out.ac13.backReturnsToList = rs.some((r) => TITLE.test(r.t) && r.real);
  out.ac13.textsAfterBack = onScreenTexts(rs).slice(0, 20);
  await screenshot(sid, path.join(SHOTS, `${tag}-ac13-01-after-back.png`));

  fs.mkdirSync(EVID, { recursive: true });
  fs.writeFileSync(path.join(EVID, `${tag}-interactions.json`), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
  return out;
}

module.exports = { run };

if (require.main === module) {
  const [platform = 'android', locale = 'en'] = process.argv.slice(2);
  run(platform, locale).then(() => console.log('OK')).catch((e) => { console.error('ERR', e.message); process.exit(1); });
}
