'use strict';
/**
 * Decide the iOS question: are the Coupon-code and Branches cards MISSING, or merely un-tagged?
 *
 * probe-locators.js found that on iOS `coupon-code-card`, `coupon-code-copy-btn`, `branches-card` and
 * `branches-toggle-btn` are absent from the page source entirely, while the other five ids resolve.
 * The fixture is an ONLINE-coupon perk WITH 16 branch lines, so there are two very different readings:
 *
 *   (a) the cards render but carry no test id  -> an instrumentation gap, NOT an AC violation
 *   (b) the cards are not rendered at all      -> AC6 and AC11 are violated on iOS: a REAL defect
 *
 * Nothing may be filed until this is settled, so the probe looks for the cards by their visible CONTENT
 * — the label text and the coupon code — which is independent of any test id, and captures a screenshot
 * scrolled to the end so the answer is human-checkable.
 */
const fs = require('fs');
const path = require('path');
const { sleep, screenshot, getSource, tap, bsReq } = require('../../../bs_helper.js');
const { inventory, centre } = require('./drive.js');
const toPerksList = require('./to-perks-list.js');
const D = require('./to-perk-details.js');
const R = require('./run-acs.js');

const SHOTS = path.resolve(__dirname, '..', '..', 'screenshots');
const EVID = path.resolve(__dirname, '..', '..', 'evidence');
const PHONE = '1188369495';
const txt = (r) => (r.text || r.label || r.value || r.name || r.desc || '').trim();
const rows = async (sid) => inventory(await getSource(sid));

(async () => {
  await R.loadLivePerks();
  const perkId = R.pickFixtures().find((i) => i.startsWith('DC_')) || 'DC_17';
  const perk = R.perkById(perkId);
  const A = perk.perk_attributes || {};
  const code = A.coupon_code;
  const branch1 = String(A.branches_description_en || '').split(/\r?\n/)[0];
  console.log(`\n[ios] fixture ${perkId} "${perk.title_en}" — coupon_type=${A.coupon_type}, code=${code}, first branch="${branch1}"`);

  const { sid } = await toPerksList.run('ios', 'en', PHONE);
  const find = async () => (await rows(sid)).find((r) => (r.name || r.id || r.desc || '').includes(`perk-card-${perkId}`));
  let card = await find();
  for (let i = 0; !card && i < 12; i++) { await D.swipeUp(sid, 'ios'); card = await find(); }
  let c = centre(card.bounds);
  for (let i = 0; i < 30 && (c.y < 100 || c.y > 700); i++) { await D.swipeUp(sid, 'ios'); const f = await find(); if (!f) break; card = f; c = centre(card.bounds); }
  await tap(sid, c.x, c.y);
  await sleep(7000);

  // Collect every text node across the WHOLE scroll, so "absent" is only claimed after the end.
  const seen = new Set();
  let prev = '';
  for (let i = 0; i < 10; i++) {
    const src = await getSource(sid);
    inventory(src).map(txt).filter(Boolean).forEach((t) => seen.add(t));
    if (i === 0) { await screenshot(sid, path.join(SHOTS, 'probe-ios-cards-1-top.png')); fs.writeFileSync(path.join(EVID, 'probe-ios-cards-top.xml'), src); }
    if (src === prev) break;
    prev = src;
    await D.swipeUp(sid, 'ios');
  }
  await screenshot(sid, path.join(SHOTS, 'probe-ios-cards-2-end.png'));
  fs.writeFileSync(path.join(EVID, 'probe-ios-cards-end.xml'), await getSource(sid));

  const all = [...seen];
  const hit = (needle) => all.some((t) => t === needle || t.includes(needle));
  const report = [
    ['"Coupon code" label', hit('Coupon code')],
    [`coupon code value "${code}"`, hit(code)],
    ['"Usage" label', hit('Usage')],
    ['"Branches" label', hit('Branches')],
    [`first branch line "${branch1}"`, hit(branch1)],
    ['"See more" control', hit('See more')],
    ['"Cashback processing" label', hit('Cashback processing')],
    ['"Expiry" label', hit('Expiry')],
  ];
  console.log('\n[ios] rendered CONTENT after scrolling to the end (independent of any test id):');
  report.forEach(([what, ok]) => console.log(`   ${ok ? 'PRESENT' : 'ABSENT '}  ${what}`));

  const couponRendered = hit('Coupon code') || hit(code);
  const branchesRendered = hit('Branches') || hit(branch1);
  console.log('\n[ios] VERDICT');
  console.log(`   Coupon-code card: ${couponRendered ? 'RENDERS (ids missing = instrumentation gap only)' : 'NOT RENDERED — candidate AC6 DEFECT'}`);
  console.log(`   Branches card   : ${branchesRendered ? 'RENDERS (ids missing = instrumentation gap only)' : 'NOT RENDERED — candidate AC11 DEFECT'}`);
  console.log(`\n[ios] all text nodes seen (${all.length}):`);
  all.slice(0, 40).forEach((t) => console.log(`     ${JSON.stringify(t)}`));
  await bsReq('DELETE', `/wd/hub/session/${sid}`);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
