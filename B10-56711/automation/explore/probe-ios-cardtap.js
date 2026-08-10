'use strict';
/**
 * Why does tapping a DEEP perk card fail to open Perk Details on iOS?
 *
 * The Java suite's first iOS test failed on `pressPerkCard(DC_21)` — "The Perk Details screen didn't open".
 * DC_21 is card 26 of the 54 the iOS list lays out, so this is about reaching and hitting a card that
 * starts far below the fold, not about the locator (probe-locators.js proved all nine detail ids resolve).
 *
 * `IosNativeCardPerksListScreen.pressPerkCard` accepts a card whose centre sits anywhere in
 * [height/8, height*7/8] = [101, 710] on this 812pt viewport, then clicks it. That band was copied from
 * Android without checking what covers the top of the iOS list — the sticky tab strip lives there. This
 * script replays that exact loop and reports, per iteration, the card's measured rect, whether the Java
 * band would have accepted it, and what a tap at that point actually does.
 *
 *   node probe-ios-cardtap.js [PERK_ID]
 */
const { sleep, getSource, tap, bsReq } = require('../../../bs_helper.js');
const { inventory, centre } = require('./drive.js');
const toPerksList = require('./to-perks-list.js');
const D = require('./to-perk-details.js');

const PHONE = '1188369495';
const PERK = process.argv[2] || 'DC_21';
const PLATFORM = 'ios';

const rows = async (sid) => inventory(await getSource(sid));

/** `inventory` returns bounds as the raw attribute STRING; on iOS that is "x,y,w,h". */
function rect(bounds) {
  const m = /^(-?\d+),(-?\d+),(-?\d+),(-?\d+)$/.exec(String(bounds).trim());
  if (!m) return null;
  const [, x, y, w, h] = m.map(Number);
  return { x, y, width: w, height: h };
}
const findCard = async (sid) =>
  (await rows(sid)).find((r) => (r.name || r.id || r.desc || '') === `perk-card-${PERK}`);

async function detailsOpen(sid) {
  const r = await bsReq('POST', `/wd/hub/session/${sid}/element`, {
    using: 'xpath', value: "//*[@name='perk-details-screen']",
  });
  return !!(r && r.value && (r.value.ELEMENT || r.value['element-6066-11e4-a52e-4f735466cecf']));
}

(async () => {
  const { sid } = await toPerksList.run(PLATFORM, 'en', PHONE);

  const size = await bsReq('GET', `/wd/hub/session/${sid}/window/rect`);
  const height = (size && size.value && size.value.height) || 812;
  const javaTop = Math.floor(height / 8);
  const javaBottom = Math.floor((height * 7) / 8);
  console.log(`\n[probe] viewport height=${height}. Java accepts a card centre in [${javaTop}, ${javaBottom}].`);

  // What sits over the top of the list? Anything overlapping the Java band's upper edge would swallow a tap.
  const chrome = (await rows(sid)).map((r) => ({ r, b: rect(r.bounds) }))
    .filter(({ b }) => b && b.height > 0 && b.y < javaTop + 80 && b.y + b.height > javaTop);
  console.log('\n[probe] nodes overlapping the top of the Java band (tap-swallowing candidates):');
  for (const { r, b } of chrome.slice(0, 14)) {
    console.log(`   y=${String(b.y).padStart(4)} h=${String(b.height).padStart(4)} ` +
      `${(r.name || r.id || r.cls || '').slice(0, 34).padEnd(34)} "${(r.label || r.value || '').slice(0, 30)}"`);
  }

  console.log(`\n[probe] scroll loop for perk-card-${PERK} (the same loop pressPerkCard runs):`);
  let accepted = null;
  for (let i = 0; i < 14; i++) {
    const card = await findCard(sid);
    if (!card) {
      console.log(`  ${String(i).padStart(2)}. NOT IN TREE`);
    } else {
      const c = centre(card.bounds);
      const b = rect(card.bounds) || { y: -1, height: -1 };
      const inBand = c.y > javaTop && c.y < javaBottom;
      console.log(`  ${String(i).padStart(2)}. y=${String(b.y).padStart(5)} ` +
        `h=${String(b.height).padStart(4)} centreY=${String(c.y).padStart(5)} ` +
        `${inBand ? 'IN BAND  <- Java would click here' : 'out of band'}`);
      if (inBand && accepted === null) {
        accepted = { x: c.x, y: c.y, iteration: i };
        break;
      }
    }
    await D.swipeUp(sid, PLATFORM);
  }

  if (!accepted) {
    console.log('\n[probe] the loop never accepted a position — pressPerkCard would fall through to its wait.');
    await bsReq('DELETE', `/wd/hub/session/${sid}`);
    return;
  }

  console.log(`\n[probe] tapping (${accepted.x}, ${accepted.y}) — the first point Java accepts.`);
  await tap(sid, accepted.x, accepted.y);
  await sleep(5000);
  const opened = await detailsOpen(sid);
  console.log(`[probe] perk-details-screen after tap: ${opened ? 'OPEN' : 'NOT OPEN'}`);

  if (!opened) {
    console.log('\n[probe] still on the list. What is actually at that point:');
    const hits = (await rows(sid)).map((r) => ({ r, b: rect(r.bounds) }))
      .filter(({ b }) => b && accepted.y >= b.y && accepted.y <= b.y + b.height
        && accepted.x >= b.x && accepted.x <= b.x + b.width);
    for (const { r, b } of hits.slice(0, 10)) {
      console.log(`   ${(r.cls || '').padEnd(26)} ${(r.name || r.id || '').slice(0, 30).padEnd(30)} ` +
        `y=${b.y} h=${b.height} "${(r.label || r.value || '').slice(0, 28)}"`);
    }

    // Re-locate and retry lower down the screen — the band the JS exploration proved works is y >= 300.
    const card = await findCard(sid);
    if (card) {
      const c = centre(card.bounds);
      console.log(`\n[probe] card is now at centreY=${c.y}; retrying a tap there.`);
      if (c.y > 300 && c.y < height - 80) {
        await tap(sid, c.x, c.y);
        await sleep(5000);
        console.log(`[probe] perk-details-screen after the lower tap: ${await detailsOpen(sid) ? 'OPEN' : 'NOT OPEN'}`);
      } else {
        console.log('[probe] not in the proven [300, height-80] band either.');
      }
    }
  }
  await bsReq('DELETE', `/wd/hub/session/${sid}`);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
