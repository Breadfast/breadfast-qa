'use strict';
/**
 * Focused AC12 probe — does tapping "See more" expand the Branches card, or not?
 *
 * Two runs reported AC12 FAIL (collapsed 3 -> expanded 3, "See less" missing). The first used a
 * coordinate tap, which had already been proven unreliable on this surface, so that result was
 * discarded. The second used a W3C element click on `branches-toggle-btn` — but `clickById` falls
 * back to a coordinate tap when the element is not found, so the log alone cannot say which path ran.
 *
 * This probe removes the ambiguity before anything is filed:
 *   1. assert the toggle element EXISTS and print its attributes (clickable/enabled/displayed/bounds)
 *   2. click it through the element endpoint and print the RAW driver response
 *   3. re-read the branches card and report the line count and toggle label
 *   4. if unchanged, retry with a coordinate tap at the toggle's CURRENT on-screen position
 *   5. if still unchanged, retry once more after scrolling the card fully into view
 * Screenshots and dumps are written at every step.
 */
const fs = require('fs');
const path = require('path');
const { sleep, screenshot, getSource, tap, bsReq } = require('../../../bs_helper.js');
const { inventory, centre } = require('./drive.js');
const toPerksList = require('./to-perks-list.js');
const D = require('./to-perk-details.js');
const R = require('./run-acs.js');

const ROOT = path.resolve(__dirname, '..', '..');
const SHOTS = path.join(ROOT, 'screenshots');
const EVID = path.join(ROOT, 'evidence');
const PHONE = '1188369495';
const TOGGLE = 'branches-toggle-btn';
const txt = (r) => (r.text || r.label || r.value || r.name || r.desc || '').trim();

async function shot(sid, n) { await screenshot(sid, path.join(SHOTS, `${n}.png`)); return `${n}.png`; }
const rows = async (sid) => inventory(await getSource(sid));

function branchState(all) {
  const label = all.find((r) => /^Branches$/i.test(txt(r)));
  if (!label) return { lines: [], toggle: null };
  const yOf = (b) => { const m = /\[(\d+),(\d+)\]/.exec(b || ''); return m ? Number(m[2]) : 0; };
  const top = yOf(label.bounds);
  const next = all.filter((r) => /^(Cashback processing|Expiry)$/i.test(txt(r))).map((r) => yOf(r.bounds)).filter((y) => y > top).sort((a, b) => a - b)[0] || Infinity;
  const inside = all.filter((r) => { const y = yOf(r.bounds); return y > top && y < next && txt(r); });
  return {
    lines: inside.map(txt).filter((t) => !/^(See more|See less)$/i.test(t)),
    toggle: (inside.find((r) => /^(See more|See less)$/i.test(txt(r))) || {}).text || null,
  };
}

(async () => {
  await R.loadLivePerks();
  const perkId = R.pickFixtures().find((id) => id.startsWith('DC_')) || 'DC_17';
  const listed = await toPerksList.run('android', 'en', PHONE);
  const sid = listed.sid;
  console.log(`\n[probe] opening ${perkId}`);

  // reuse run-acs' navigation by re-implementing the minimal bit: find + scroll + tap
  const find = async () => (await rows(sid)).find((r) => (r.name || r.id || r.desc || '').includes(`perk-card-${perkId}`));
  let card = await find();
  for (let i = 0; !card && i < 12; i++) { await D.swipeUp(sid, 'android'); card = await find(); }
  let c = centre(card.bounds);
  for (let i = 0; i < 40 && (c.y < 300 || c.y > 2000); i++) {
    if (c.y < 300) { await bsReq('POST', `/wd/hub/session/${sid}/actions`, { actions: [{ type: 'pointer', id: 'f', parameters: { pointerType: 'touch' }, actions: [{ type: 'pointerMove', duration: 0, x: 540, y: 550 }, { type: 'pointerDown', button: 0 }, { type: 'pause', duration: 300 }, { type: 'pointerMove', duration: 600, x: 540, y: 1750 }, { type: 'pointerUp', button: 0 }] }] }); await sleep(1500); }
    else await D.swipeUp(sid, 'android');
    const f = await find(); if (!f) break; card = f; c = centre(card.bounds);
  }
  await tap(sid, c.x, c.y);
  await sleep(6500);
  await bsReq('POST', `/wd/hub/session/${sid}/appium/settings`, { settings: { allowInvisibleElements: true, ignoreUnimportantViews: false } }).catch(() => {});
  await sleep(1200);

  // ---- 1. does the toggle element exist, and what are its attributes? ----
  const XP = `//*[@resource-id='${TOGGLE}']`;
  const found = await bsReq('POST', `/wd/hub/session/${sid}/element`, { using: 'xpath', value: XP });
  const eid = found && found.value && (found.value.ELEMENT || found.value['element-6066-11e4-a52e-4f735466cecf']);
  console.log(`[probe] find ${TOGGLE} -> ${eid ? 'FOUND ' + eid : 'NOT FOUND: ' + JSON.stringify(found).slice(0, 200)}`);
  if (eid) {
    for (const attr of ['clickable', 'enabled', 'displayed', 'bounds', 'text', 'content-desc']) {
      const v = await bsReq('GET', `/wd/hub/session/${sid}/element/${eid}/attribute/${attr}`);
      console.log(`        ${attr.padEnd(13)} = ${JSON.stringify(v && v.value)}`);
    }
  }

  const before = branchState(await rows(sid));
  console.log(`[probe] BEFORE: ${before.lines.length} lines ${JSON.stringify(before.lines)} toggle=${JSON.stringify(before.toggle)}`);
  await shot(sid, 'probe-ac12-1-before');

  // ---- 2. element click, raw response ----
  if (eid) {
    const res = await bsReq('POST', `/wd/hub/session/${sid}/element/${eid}/click`, {});
    console.log(`[probe] element click -> ${JSON.stringify(res).slice(0, 200)}`);
    await sleep(3000);
    const after = branchState(await rows(sid));
    console.log(`[probe] AFTER element click: ${after.lines.length} lines toggle=${JSON.stringify(after.toggle)}`);
    await shot(sid, 'probe-ac12-2-after-element-click');
    if (after.lines.length > before.lines.length) {
      console.log('[probe] EXPAND OK. Now exercising COLLAPSE ("See less").');
      // re-find: the toggle element may have been recreated when the card re-rendered
      const f2 = await bsReq('POST', `/wd/hub/session/${sid}/element`, { using: 'xpath', value: XP });
      const eid2 = f2 && f2.value && (f2.value.ELEMENT || f2.value['element-6066-11e4-a52e-4f735466cecf']);
      console.log(`[probe] re-find toggle after expand -> ${eid2 ? 'FOUND ' + eid2 : 'NOT FOUND'}`);
      if (eid2) {
        const t = await bsReq('GET', `/wd/hub/session/${sid}/element/${eid2}/attribute/text`);
        console.log(`[probe] toggle text now = ${JSON.stringify(t && t.value)}`);
        const res2 = await bsReq('POST', `/wd/hub/session/${sid}/element/${eid2}/click`, {});
        console.log(`[probe] collapse click -> ${JSON.stringify(res2).slice(0, 160)}`);
        await sleep(3000);
        const back = branchState(await rows(sid));
        console.log(`[probe] AFTER collapse click: ${back.lines.length} lines toggle=${JSON.stringify(back.toggle)}`);
        await shot(sid, 'probe-ac12-5-after-collapse');
        if (back.lines.length === 3 && /See more/i.test(back.toggle || '')) console.log('[probe] RESULT: COLLAPSE WORKS — AC12 fully passes');
        else {
          // second attempt: coordinate tap at the CURRENT "See less" position
          const cur = (await rows(sid)).find((r) => /^See less$/i.test(txt(r)));
          if (cur) {
            const p2 = centre(cur.bounds);
            console.log(`[probe] retry: coordinate tap at current "See less" ${p2.x},${p2.y} (bounds ${cur.bounds})`);
            await tap(sid, p2.x, p2.y); await sleep(3000);
            const back2 = branchState(await rows(sid));
            console.log(`[probe] AFTER coordinate collapse: ${back2.lines.length} lines toggle=${JSON.stringify(back2.toggle)}`);
            await shot(sid, 'probe-ac12-6-after-coord-collapse');
            console.log(back2.lines.length === 3 ? '[probe] RESULT: collapse works by coordinate tap (element click was the problem)' : '[probe] RESULT: COLLAPSE DOES NOT WORK by either interaction — candidate DEFECT');
          } else console.log('[probe] no "See less" node present to retry — candidate DEFECT');
        }
      }
      await bsReq('DELETE', `/wd/hub/session/${sid}`); return;
    }
  }

  // ---- 3. coordinate tap at the toggle's CURRENT position ----
  let all = await rows(sid);
  const seeMore = all.find((r) => /^See more$/i.test(txt(r)));
  if (seeMore) {
    const p = centre(seeMore.bounds);
    console.log(`[probe] coordinate tap at CURRENT "See more" position ${p.x},${p.y} (bounds ${seeMore.bounds})`);
    await tap(sid, p.x, p.y);
    await sleep(3000);
    const after2 = branchState(await rows(sid));
    console.log(`[probe] AFTER coordinate tap: ${after2.lines.length} lines toggle=${JSON.stringify(after2.toggle)}`);
    await shot(sid, 'probe-ac12-3-after-coord-tap');
    if (after2.lines.length > before.lines.length) { console.log('[probe] RESULT: EXPANDS via coordinate tap — element click was the problem'); await bsReq('DELETE', `/wd/hub/session/${sid}`); return; }
  } else {
    console.log('[probe] no "See more" text node found at this point');
  }

  // ---- 4. tap the Branches CARD itself, in case the whole card is the target ----
  const cardEl = (await rows(sid)).find((r) => (r.id || r.name || '') === 'branches-card');
  if (cardEl) {
    const p = centre(cardEl.bounds);
    console.log(`[probe] tapping the branches-card body at ${p.x},${p.y}`);
    await tap(sid, p.x, p.y);
    await sleep(3000);
    const after3 = branchState(await rows(sid));
    console.log(`[probe] AFTER card tap: ${after3.lines.length} lines toggle=${JSON.stringify(after3.toggle)}`);
    await shot(sid, 'probe-ac12-4-after-card-tap');
  }

  fs.writeFileSync(path.join(EVID, 'probe-ac12.xml'), await getSource(sid));
  console.log('[probe] RESULT: Branches did NOT expand by any interaction tried.');
  await bsReq('DELETE', `/wd/hub/session/${sid}`);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
