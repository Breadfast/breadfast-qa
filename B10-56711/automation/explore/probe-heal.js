'use strict';
/**
 * Settle the two remaining Java assertion failures against evidence.
 *
 *  A) after Close, is the coupon code REALLY visible on the details screen, or merely still present in
 *     the tree? isTextDisplayed() uses contains(@text,...) with no visibility check, and this surface
 *     has repeatedly proved that "in the tree" != "on screen".
 *  B) does branches-card have DESCENDANT text nodes? getCardTextLines() searches `.//*[@text]` relative
 *     to the card; if Compose flattens the tree, the lines are SIBLINGS and the search returns nothing
 *     while the lines plainly render.
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
const findEl = async (sid, xp) => { const r = await bsReq('POST', `/wd/hub/session/${sid}/element`, { using: 'xpath', value: xp }); return (r && r.value && (r.value.ELEMENT || r.value['element-6066-11e4-a52e-4f735466cecf'])) || null; };

async function open(sid, perkId) {
  const find = async () => (await rows(sid)).find((r) => (r.name || r.id || r.desc || '').includes(`perk-card-${perkId}`));
  let card = await find();
  for (let i = 0; !card && i < 12; i++) { await D.swipeUp(sid, 'android'); card = await find(); }
  let c = centre(card.bounds);
  for (let i = 0; i < 40 && (c.y < 300 || c.y > 2000); i++) { await D.swipeUp(sid, 'android'); const f = await find(); if (!f) break; card = f; c = centre(card.bounds); }
  await tap(sid, c.x, c.y); await sleep(6500);
  await bsReq('POST', `/wd/hub/session/${sid}/appium/settings`, { settings: { allowInvisibleElements: true, ignoreUnimportantViews: false } }).catch(() => {});
  await sleep(1500);
}

(async () => {
  await R.loadLivePerks();
  const phys = R.pickFixtures().find((i) => { const p = R.perkById(i); return String((p.perk_attributes || {}).coupon_type).toLowerCase() === 'physical'; });
  const code = (R.perkById(phys).perk_attributes || {}).coupon_code;
  const { sid } = await toPerksList.run('android', 'en', '1188369495');

  // ---------- A ----------
  console.log(`\n[A] physical perk ${phys}, code ${code}`);
  await open(sid, phys);
  await bsReq('POST', `/wd/hub/session/${sid}/element/${await findEl(sid, "//*[@resource-id='coupon-code-view-btn']")}/click`, {});
  await sleep(3000);
  console.log(`[A] sheet open, code in tree: ${(await rows(sid)).some((r) => txt(r) === code)}`);
  const closeEl = (await rows(sid)).find((r) => /^Close$/i.test(txt(r)));
  if (closeEl) { const p = centre(closeEl.bounds); await tap(sid, p.x, p.y); await sleep(3000); }
  const after = await rows(sid);
  const node = after.find((r) => txt(r) === code || String(r.text || '').includes(code));
  console.log(`[A] after Close — code node in tree: ${!!node}`);
  if (node) {
    const el = await findEl(sid, `//*[@text='${code}']`);
    if (el) {
      for (const a of ['displayed', 'bounds']) {
        const v = await bsReq('GET', `/wd/hub/session/${sid}/element/${el}/attribute/${a}`);
        console.log(`      ${a} = ${JSON.stringify(v && v.value)}`);
      }
    }
    console.log(`      raw bounds from tree: ${node.bounds}`);
  }
  await screenshot(sid, path.join(SHOTS, 'probe-heal-A-after-close.png'));

  // ---------- B ----------
  await bsReq('POST', `/wd/hub/session/${sid}/back`).catch(() => {});
  await sleep(4000);
  const withBranches = R.pickFixtures().find((i) => { const a = R.perkById(i).perk_attributes || {}; return a.branches_description_en && String(a.branches_description_en).trim(); });
  console.log(`\n[B] perk with branches: ${withBranches}`);
  await open(sid, withBranches);
  const cardEl = await findEl(sid, "//*[@resource-id='branches-card']");
  console.log(`[B] branches-card element: ${cardEl ? 'FOUND' : 'NOT FOUND'}`);
  if (cardEl) {
    const desc = await bsReq('POST', `/wd/hub/session/${sid}/element/${cardEl}/elements`, { using: 'xpath', value: ".//*[string-length(@text)>0]" });
    const n = (desc && desc.value && desc.value.length) || 0;
    console.log(`[B] DESCENDANT text nodes under branches-card (what the Java reader uses): ${n}`);
    const abs = await bsReq('POST', `/wd/hub/session/${sid}/elements`, { using: 'xpath', value: "//*[@resource-id='branches-card']//*[string-length(@text)>0]" });
    console.log(`[B] absolute-xpath descendants: ${(abs && abs.value && abs.value.length) || 0}`);
  }
  const all = await rows(sid);
  const branchTexts = all.map(txt).filter((t) => /^\d+\.\s|^-\s/.test(t));
  console.log(`[B] branch-looking text nodes anywhere on screen: ${branchTexts.length} ${JSON.stringify(branchTexts.slice(0, 5))}`);
  await screenshot(sid, path.join(SHOTS, 'probe-heal-B-branches.png'));
  await bsReq('DELETE', `/wd/hub/session/${sid}`);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
