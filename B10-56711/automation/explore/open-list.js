'use strict';
/**
 * From an ALREADY-LOGGED-IN Pay session, scroll Pay home to the Card-perks section, tap that
 * section's "See all", and land on the Perks List. Separate from to-perks-list.js so it can be
 * re-run against a live session without paying the ~3 min login cost again.
 *
 *   node open-list.js <ios|android> <en|ar>
 */
const fs = require('fs');
const path = require('path');
const { sleep, screenshot, getSource } = require('../../../bs_helper.js');
const session = require('./session.js');
const nav = require('./nav.js');

const ROOT = path.resolve(__dirname, '..', '..');
const SHOTS = path.join(ROOT, 'screenshots');
const EVID = path.join(ROOT, 'evidence');

const PERKS_HEADER = /^(Card perks|مزايا البطاقة)$/;
const SEE_ALL = /^(See all|See All|عرض الكل)$/;

const GEOM = {
  android: { screenW: 1080, screenH: 2340 },
  ios: { screenW: 390, screenH: 844 },
};

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

async function run(platform, locale) {
  const tag = `${platform}-${locale}`;
  const geom = GEOM[platform];
  const sid = session.readId(platform, locale);
  if (!sid || !(await session.alive(sid))) throw new Error(`no live session for ${tag}`);

  // 1. Bring the Card-perks section header on screen (it sits below the fold on Pay home).
  const hdr = await nav.scrollUntil(sid, (r) => PERKS_HEADER.test(r.t), { geom, maxSwipes: 12 });
  if (!hdr.row) {
    fs.writeFileSync(path.join(EVID, `${tag}-ERR-no-perks-header.xml`), hdr.xml);
    throw new Error(`Card-perks header never became visible (swipes=${hdr.swipes}, exhausted=${hdr.exhausted})`);
  }
  const hy = nav.centre(hdr.row.bounds).y;
  console.log(`  perks header "${hdr.row.t}" on screen @ y=${hy} after ${hdr.swipes} swipe(s)`);
  await shot(sid, tag, '07a-pay-home-perks-section');

  // 2. The perks-section "See all" = the on-screen "See all" nearest to (and not above) that header.
  const visible = nav.onScreen(hdr.xml);
  const candidates = visible
    .filter((r) => SEE_ALL.test(r.t))
    .map((r) => ({ r, y: nav.centre(r.bounds).y }))
    .sort((a, b) => Math.abs(a.y - hy) - Math.abs(b.y - hy));
  if (!candidates.length) {
    fs.writeFileSync(path.join(EVID, `${tag}-ERR-no-see-all.xml`), hdr.xml);
    throw new Error('no on-screen "See all" beside the perks header');
  }
  const target = candidates[0];
  console.log(`  "See all" candidates on screen: ${candidates.map((c) => c.y).join(', ')} → picking y=${target.y}`);
  const c = await nav.tapRow(sid, target.r, 'perks See all');
  console.log(`  tapped "See all" @ ${c.x},${c.y}`);
  await sleep(9000);

  // 3. Land on the Perks List.
  await shot(sid, tag, '08-perks-list-top');
  const xml = await dump(sid, tag, '08-perks-list-top');
  const rows = nav.rowsOf(xml);
  const vis = rows.filter((r) => r.real);
  const cards = rows.filter((r) => /perk-card-/.test(r.id || r.name || r.desc || ''));
  console.log(`[${tag}] rows=${rows.length} onScreen=${vis.length} perkCardNodes=${cards.length}`);
  console.log('  on-screen text:', vis.map((r) => r.t).filter(Boolean).join(' | ').slice(0, 400));
  return { sid, xml };
}

module.exports = { run, PERKS_HEADER, SEE_ALL, GEOM };

if (require.main === module) {
  const [platform = 'android', locale = 'en'] = process.argv.slice(2);
  run(platform, locale).then(() => console.log('OK')).catch((e) => { console.error('ERR', e.message); process.exit(1); });
}
