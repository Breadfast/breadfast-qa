'use strict';
/**
 * iOS AC12, decided by looking. The runner reported "collapsed=7 lines, expanded=7, See less MISSING",
 * but a direct content probe had already shown iOS rendering exactly "1. Walmart / 2. Target /
 * 3. Costco… / See more". A count of 7 therefore says the LINE COUNTER is wrong on iOS (it is picking
 * up container nodes whose name is the card id), not that the product is broken. This captures the
 * before/after screenshots so the answer does not depend on my parser at all.
 */
const path = require('path');
const { sleep, screenshot, getSource, tap, bsReq } = require('../../../bs_helper.js');
const { inventory, centre } = require('./drive.js');
const toPerksList = require('./to-perks-list.js');
const D = require('./to-perk-details.js');
const R = require('./run-acs.js');
const SHOTS = path.resolve(__dirname, '..', '..', 'screenshots');
const txt = (r) => (r.text || r.label || r.value || r.name || r.desc || '').trim();
const rows = async (sid) => inventory(await getSource(sid));

(async () => {
  await R.loadLivePerks();
  const perkId = 'DC_17';
  const { sid } = await toPerksList.run('ios', 'en', '1188369495');
  const find = async () => (await rows(sid)).find((r) => (r.name || r.id || r.desc || '').includes(`perk-card-${perkId}`));
  let card = await find();
  for (let i = 0; !card && i < 15; i++) { await D.swipeUp(sid, 'ios'); card = await find(); }
  let c = centre(card.bounds);
  for (let i = 0; i < 30 && (c.y < 120 || c.y > 700); i++) { await D.swipeUp(sid, 'ios'); const f = await find(); if (!f) break; card = f; c = centre(card.bounds); }
  await tap(sid, c.x, c.y); await sleep(7000);

  const branchTexts = async () => (await rows(sid)).map(txt).filter((t) => /^\d+\.\s/.test(t));
  const toggle = async () => (await rows(sid)).map(txt).find((t) => /^(See more|See less)$/i.test(t)) || null;

  // scroll the toggle into view
  for (let i = 0; i < 8; i++) {
    const n = (await rows(sid)).find((r) => /^(See more|See less)$/i.test(txt(r)));
    if (n) { const p = centre(n.bounds); if (p && p.y > 120 && p.y < 700) break; }
    await D.swipeUp(sid, 'ios');
  }
  console.log(`[ios-ac12] BEFORE: numbered branch lines = ${(await branchTexts()).length} ${JSON.stringify(await branchTexts())}, toggle=${JSON.stringify(await toggle())}`);
  await screenshot(sid, path.join(SHOTS, 'probe-ios-ac12-1-collapsed.png'));

  let n = (await rows(sid)).find((r) => /^See more$/i.test(txt(r)));
  if (n) { const p = centre(n.bounds); console.log(`[ios-ac12] tapping "See more" at ${p.x},${p.y} (bounds ${n.bounds})`); await tap(sid, p.x, p.y); await sleep(3000); }
  else console.log('[ios-ac12] no "See more" node found');
  console.log(`[ios-ac12] AFTER expand: numbered branch lines = ${(await branchTexts()).length}, toggle=${JSON.stringify(await toggle())}`);
  await screenshot(sid, path.join(SHOTS, 'probe-ios-ac12-2-expanded.png'));

  for (let i = 0; i < 8; i++) {
    const t = (await rows(sid)).find((r) => /^See less$/i.test(txt(r)));
    if (t) { const p = centre(t.bounds); if (p && p.y > 120 && p.y < 700) { console.log(`[ios-ac12] tapping "See less" at ${p.x},${p.y}`); await tap(sid, p.x, p.y); await sleep(3000); break; } }
    await D.swipeUp(sid, 'ios');
  }
  console.log(`[ios-ac12] AFTER collapse: numbered branch lines = ${(await branchTexts()).length}, toggle=${JSON.stringify(await toggle())}`);
  await screenshot(sid, path.join(SHOTS, 'probe-ios-ac12-3-recollapsed.png'));
  await bsReq('DELETE', `/wd/hub/session/${sid}`);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
