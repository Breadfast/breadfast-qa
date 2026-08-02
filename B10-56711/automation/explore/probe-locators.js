'use strict';
/**
 * Which Perk-Details ids are actually RESOLVABLE by the driver, and by which strategy?
 *
 * The AC12 probe showed `branches-toggle-btn` present in the page source but returning
 * "no such element" from the element endpoint using `id`. If that holds for the other ids, the Java
 * page objects — which are built entirely on @FindBy(id = ...) — would silently fail against this
 * Compose surface, so this has to be settled before those page objects are trusted.
 *
 * For each id, tries: id · accessibility id · xpath on @resource-id · xpath on @content-desc.
 */
const path = require('path');
const { sleep, getSource, tap, bsReq } = require('../../../bs_helper.js');
const { inventory, centre } = require('./drive.js');
const toPerksList = require('./to-perks-list.js');
const D = require('./to-perk-details.js');
const R = require('./run-acs.js');

const PHONE = '1188369495';
const IDS = ['perk-details-screen', 'perk-details-back-btn', 'coupon-code-card', 'coupon-code-copy-btn',
  'perk-details-usage-card', 'branches-card', 'branches-toggle-btn', 'perk-details-cashback-card',
  'perk-details-expiry-card'];
const txt = (r) => (r.text || r.label || r.value || r.name || r.desc || '').trim();
const rows = async (sid) => inventory(await getSource(sid));

async function tryFind(sid, using, value) {
  const r = await bsReq('POST', `/wd/hub/session/${sid}/element`, { using, value });
  const id = r && r.value && (r.value.ELEMENT || r.value['element-6066-11e4-a52e-4f735466cecf']);
  return id ? 'FOUND' : 'no';
}

(async () => {
  await R.loadLivePerks();
  const perkId = R.pickFixtures().find((i) => i.startsWith('DC_')) || 'DC_17';
  const { sid } = await toPerksList.run('android', 'en', PHONE);

  const find = async () => (await rows(sid)).find((r) => (r.name || r.id || r.desc || '').includes(`perk-card-${perkId}`));
  let card = await find();
  for (let i = 0; !card && i < 12; i++) { await D.swipeUp(sid, 'android'); card = await find(); }
  let c = centre(card.bounds);
  for (let i = 0; i < 40 && (c.y < 300 || c.y > 2000); i++) { await D.swipeUp(sid, 'android'); const f = await find(); if (!f) break; card = f; c = centre(card.bounds); }
  await tap(sid, c.x, c.y);
  await sleep(6500);
  await bsReq('POST', `/wd/hub/session/${sid}/appium/settings`, { settings: { allowInvisibleElements: true, ignoreUnimportantViews: false } }).catch(() => {});
  await sleep(1500);

  const src = await getSource(sid);
  console.log(`\n[probe] on ${perkId} details. Legend: inSource = the id appears in the page source.\n`);
  console.log('id                          inSource  by:id   by:accessibility id  xpath@resource-id  xpath@content-desc');
  for (const id of IDS) {
    const inSource = src.includes(`"${id}"`) ? 'yes' : 'NO ';
    const byId = await tryFind(sid, 'id', id);
    const byAcc = await tryFind(sid, 'accessibility id', id);
    const byXpathRes = await tryFind(sid, 'xpath', `//*[@resource-id='${id}']`);
    const byXpathDesc = await tryFind(sid, 'xpath', `//*[@content-desc='${id}']`);
    console.log(`${id.padEnd(28)}${inSource.padEnd(10)}${byId.padEnd(8)}${byAcc.padEnd(21)}${byXpathRes.padEnd(19)}${byXpathDesc}`);
  }
  await bsReq('DELETE', `/wd/hub/session/${sid}`);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
