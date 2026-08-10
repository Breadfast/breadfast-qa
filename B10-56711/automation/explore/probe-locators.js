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

const PLATFORM = process.argv[2] || 'android';

(async () => {
  await R.loadLivePerks();
  const perkId = R.pickFixtures().find((i) => i.startsWith('DC_')) || 'DC_17';
  const { sid } = await toPerksList.run(PLATFORM, 'en', PHONE);

  const find = async () => (await rows(sid)).find((r) => (r.name || r.id || r.desc || '').includes(`perk-card-${perkId}`));
  let card = await find();
  for (let i = 0; !card && i < 12; i++) { await D.swipeUp(sid, PLATFORM); card = await find(); }

  // The safe tap band must come from the DEVICE, not from a constant. This previously hardcoded
  // Android's 300..2000 px onto iOS's 844-POINT viewport, which accepts y=800 — underneath the bottom
  // tab bar, so the tap opens "More" instead of the perk and the details screen never appears. The tab
  // bar overlays roughly the last 110 pt/px on both platforms (pay-appium-compose-traps).
  const rect = await bsReq('GET', `/wd/hub/session/${sid}/window/rect`);
  const screenH = (rect && rect.value && rect.value.height) || 844;
  const top = Math.round(screenH * 0.15);
  const bottom = screenH - 110;
  let c = centre(card.bounds);
  console.log(`[probe] screen height ${screenH}; safe tap band ${top}..${bottom}; card centre y=${c.y}`);
  for (let i = 0; i < 40 && (c.y < top || c.y > bottom); i++) {
    await D.swipeUp(sid, PLATFORM);
    const f = await find();
    if (!f) break;
    card = f;
    c = centre(card.bounds);
  }
  console.log(`[probe] tapping perk-card-${perkId} @ ${c.x},${c.y}`);
  await tap(sid, c.x, c.y);
  await sleep(6500);
  if (PLATFORM === 'android') await bsReq('POST', `/wd/hub/session/${sid}/appium/settings`, { settings: { allowInvisibleElements: true, ignoreUnimportantViews: false } }).catch(() => {});
  await sleep(1500);

  // Accumulate the source across the WHOLE scroll, not just the first viewport. Reading it once at the
  // top is what produced the false "iOS does not render the Coupon code or Branches cards" finding
  // (defects.md C5): both cards are below the fold and lazy-render, so the top-of-screen dump is
  // evidence of nothing. A negative here has to survive a scroll to the end.
  let src = await getSource(sid);
  let previous = '';
  for (let i = 0; i < 8 && src !== previous; i++) {
    previous = src;
    await D.swipeUp(sid, PLATFORM);
    await sleep(1200);
    src += await getSource(sid);
  }
  console.log(`\n[probe] on ${perkId} details, source accumulated over a full scroll.`);
  console.log('Legend: inSource = the id appears anywhere in the scrolled page source.\n');
  console.log(PLATFORM === 'ios'
    ? 'id                          inSource  by:id   by:accessibility id  xpath@name         xpath@label'
    : 'id                          inSource  by:id   by:accessibility id  xpath@resource-id  xpath@content-desc');
  for (const id of IDS) {
    const inSource = src.includes(`"${id}"`) ? 'yes' : 'NO ';
    const byId = await tryFind(sid, 'id', id);
    const byAcc = await tryFind(sid, 'accessibility id', id);
    const byXpathRes = await tryFind(sid, 'xpath', PLATFORM === 'ios' ? `//*[@name='${id}']` : `//*[@resource-id='${id}']`);
    const byXpathDesc = await tryFind(sid, 'xpath', PLATFORM === 'ios' ? `//*[@label='${id}']` : `//*[@content-desc='${id}']`);
    console.log(`${id.padEnd(28)}${inSource.padEnd(10)}${byId.padEnd(8)}${byAcc.padEnd(21)}${byXpathRes.padEnd(19)}${byXpathDesc}`);
  }
  await bsReq('DELETE', `/wd/hub/session/${sid}`);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
