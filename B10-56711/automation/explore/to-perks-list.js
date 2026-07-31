'use strict';
/**
 * Drive from a fresh session all the way to the **Perks List** screen (the surface under test),
 * capturing evidence at every step.
 *
 *   node to-perks-list.js <ios|android> <en|ar> [localPhone]
 *
 * Route: to-pay-home.js's route → the "See all" control in the **Card perks** section → Perks List.
 *
 * There are TWO "See all" controls on Pay home (Recent transactions and Card perks). They are told
 * apart by vertical position relative to the perks section header — never by index, which flips when
 * a section is empty. In AR the labels are localised ("عرض الكل") and the header is "مزايا البطاقة".
 *
 * Evidence written:
 *   screenshots/<tag>-08-perks-list-top.png        first viewport of the list
 *   evidence/<tag>-08-perks-list-top.xml           its accessibility tree
 *   evidence/<tag>-perks-list.json                 parsed tabs + cards + section headers
 */
const fs = require('fs');
const path = require('path');
const { sleep, screenshot, getSource, tap, bsReq } = require('../../../bs_helper.js');
const session = require('./session.js');
const { inventory, centre } = require('./drive.js');
const toPayHome = require('./to-pay-home.js');

const ROOT = path.resolve(__dirname, '..', '..');
const SHOTS = path.join(ROOT, 'screenshots');
const EVID = path.join(ROOT, 'evidence');

const log = (m) => console.log(m);
const txt = (r) => (r.text || r.label || r.value || r.name || r.desc || '').trim();

// "Card perks" section header, EN + AR. The screen title of the list itself is the same string.
const PERKS_HEADER = /^(Card perks|مزايا البطاقة)$/;
const SEE_ALL = /^(See all|See All|عرض الكل)$/;

async function rows(sid) { return inventory(await getSource(sid)); }

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

/** The "See all" that belongs to the perks section: the first one at or below the perks header. */
function perksSeeAll(all) {
  const header = all.find((r) => PERKS_HEADER.test(txt(r)) && r.bounds);
  const candidates = all.filter((r) => SEE_ALL.test(txt(r)) && r.bounds);
  if (!candidates.length) return null;
  if (!header) return candidates[candidates.length - 1];
  const hy = centre(header.bounds).y;
  const below = candidates
    .map((r) => ({ r, y: centre(r.bounds).y }))
    .filter((c) => c.y >= hy - 40)
    .sort((a, b) => a.y - b.y);
  return below.length ? below[0].r : candidates[candidates.length - 1];
}

/** Parse the Perks List screen into the things the ACs talk about. */
function parseList(xml) {
  const all = inventory(xml);
  const cards = all
    .filter((r) => /^perk-card-/.test(r.name || r.id || r.desc || ''))
    .map((r) => {
      const id = (r.name || r.id || r.desc || '').replace(/^.*perk-card-/, '');
      const label = (r.label || r.desc || '').trim();
      const [title, ...rest] = label.split(',');
      return {
        perkId: id,
        label,
        title: (title || '').trim(),
        subheader: rest.join(',').trim(),
        bounds: r.bounds,
        centre: r.bounds ? centre(r.bounds) : null,
      };
    });
  return { nodeCount: all.length, cards, rawRows: all.map((r) => ({ id: r.id || r.name, t: txt(r), b: r.bounds })) };
}

async function run(platform, locale, phone) {
  const tag = `${platform}-${locale}`;
  const { sid } = await toPayHome.run(platform, locale, phone);
  log(`[${tag}] on Pay home — looking for the perks-section "See all"`);

  // The Pay surface is Jetpack Compose and its node tree populates NON-DETERMINISTICALLY: with the
  // same code, consecutive runs exposed 25 nodes (all 34 perk cards reachable) and then 10 nodes
  // (nothing reachable). A single read plus a fixed sleep is therefore not enough — re-assert the
  // invisible-element settings and re-read until the perks section actually appears. Measured
  // 2026-07-30 on Samsung Galaxy S23 / Android 13.
  let all = await rows(sid);
  let seeAll = perksSeeAll(all);
  for (let i = 0; !seeAll && i < 6; i++) {
    // The Pay tab intermittently fails to load and renders "Something went wrong. / Try reloading
    // the page or restarting the app." with a "Try again" button. Observed 2026-07-30 on Android;
    // other runs of the identical flow reached Pay home normally. Recover by tapping "Try again"
    // rather than mistaking an app error state for missing Compose nodes.
    const errBtn = all.find((r) => /^(Try again|إعادة المحاولة|حاول مرة أخرى)$/i.test((r.text || r.label || r.name || r.desc || '').trim()));
    const errText = all.some((r) => /Something went wrong|حدث خطأ/i.test((r.text || r.label || r.name || r.desc || '')));
    if (errBtn) {
      const c = centre(errBtn.bounds);
      await tap(sid, c.x, c.y);
      log(`  Pay tab showed an error state${errText ? ' ("Something went wrong")' : ''} — tapped "Try again"`);
      await sleep(9000);
    } else {
      await bsReq('POST', `/wd/hub/session/${sid}/appium/settings`,
        { settings: { allowInvisibleElements: true, ignoreUnimportantViews: false } }).catch(() => {});
      await sleep(2500);
    }
    all = await rows(sid);
    seeAll = perksSeeAll(all);
    log(`  retry ${i + 1}: ${all.length} labelled nodes, perks "See all" ${seeAll ? 'FOUND' : 'not yet'}`);
  }
  if (!seeAll) {
    await dump(sid, tag, 'ERR-no-see-all');
    throw new Error(`perks-section "See all" not found on Pay home after retries (last read: ${all.length} labelled nodes)`);
  }
  const c = centre(seeAll.bounds);
  await tap(sid, c.x, c.y);
  log(`  tapped "${txt(seeAll)}" @ ${c.x},${c.y}`);
  await sleep(9000);

  await shot(sid, tag, '08-perks-list-top');
  const xml = await dump(sid, tag, '08-perks-list-top');
  const parsed = parseList(xml);

  fs.writeFileSync(
    path.join(EVID, `${tag}-perks-list.json`),
    JSON.stringify({ sid, tag, capturedAt: new Date().toISOString(), ...parsed }, null, 2),
  );

  log(`[${tag}] PERKS LIST reached. nodes=${parsed.nodeCount}, perk cards exposed=${parsed.cards.length}`);
  parsed.cards.forEach((k, i) => log(`   ${i + 1}. ${k.perkId} → "${k.title}" / "${k.subheader}"`));
  return { sid, ...parsed };
}

module.exports = { run, parseList, perksSeeAll, PERKS_HEADER, SEE_ALL };

if (require.main === module) {
  const [platform = 'android', locale = 'en', phone = '1188369495'] = process.argv.slice(2);
  run(platform, locale, phone)
    .then(() => console.log('OK'))
    .catch((e) => { console.error('ERR', e.message); process.exit(1); });
}
