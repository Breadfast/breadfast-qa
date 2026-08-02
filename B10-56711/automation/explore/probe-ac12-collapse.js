'use strict';
/**
 * AC12 collapse, decided properly: expand, SCROLL "See less" INTO VIEW, then click.
 *
 * The previous probe concluded "collapse does not work". That conclusion was unsafe. After expanding
 * to 16 branch lines the card grows and pushes the toggle below the fold — its reported bounds came
 * back as [313,2940][442,2196]: inverted, and a centre of y=2568 on a 2340px screen. Neither the
 * element click nor the coordinate retry could have landed. An element being in the tree is not the
 * same as it being on screen, and clicking an off-screen control proves nothing about the product.
 *
 * This probe scrolls the toggle into the viewport, asserts its bounds are sane and visible, and only
 * then clicks — so a failure here would be a real one.
 */
const path = require('path');
const { sleep, screenshot, getSource, tap, bsReq } = require('../../../bs_helper.js');
const { inventory, centre } = require('./drive.js');
const toPerksList = require('./to-perks-list.js');
const D = require('./to-perk-details.js');
const R = require('./run-acs.js');

const SHOTS = path.resolve(__dirname, '..', '..', 'screenshots');
const PHONE = '1188369495';
const TOGGLE = "//*[@resource-id='branches-toggle-btn']";
const txt = (r) => (r.text || r.label || r.value || r.name || r.desc || '').trim();
const rows = async (sid) => inventory(await getSource(sid));
const shot = (sid, n) => screenshot(sid, path.join(SHOTS, `${n}.png`));

/** Parsed bounds, or null when the device reports a malformed/inverted rect. */
function rect(b) {
  const m = /\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/.exec(b || '');
  if (!m) return null;
  const [x1, y1, x2, y2] = m.slice(1).map(Number);
  if (y2 <= y1 || x2 <= x1) return null;
  return { x1, y1, x2, y2, cx: Math.round((x1 + x2) / 2), cy: Math.round((y1 + y2) / 2) };
}
const onScreen = (r) => r && r.cy > 250 && r.cy < 2050;

async function branchLines(sid) {
  const all = await rows(sid);
  const yOf = (b) => { const m = /\[(-?\d+),(-?\d+)\]/.exec(b || ''); return m ? Number(m[2]) : 0; };
  const label = all.find((r) => /^Branches$/i.test(txt(r)));
  if (!label) return { lines: [], toggle: null };
  const top = yOf(label.bounds);
  const next = all.filter((r) => /^(Cashback processing|Expiry)$/i.test(txt(r))).map((r) => yOf(r.bounds)).filter((y) => y > top).sort((a, b) => a - b)[0] || Infinity;
  const inside = all.filter((r) => { const y = yOf(r.bounds); return y > top && y < next && txt(r); });
  return { lines: inside.map(txt).filter((t) => !/^(See more|See less)$/i.test(t)), toggle: (inside.find((r) => /^(See more|See less)$/i.test(txt(r))) || {}).text || null };
}

async function findToggle(sid) {
  const r = await bsReq('POST', `/wd/hub/session/${sid}/element`, { using: 'xpath', value: TOGGLE });
  return (r && r.value && (r.value.ELEMENT || r.value['element-6066-11e4-a52e-4f735466cecf'])) || null;
}
async function toggleRect(sid) {
  const all = await rows(sid);
  const node = all.find((r) => /^(See more|See less)$/i.test(txt(r)));
  return node ? { rect: rect(node.bounds), raw: node.bounds, text: txt(node) } : null;
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
  await sleep(1200);

  console.log(`\n[collapse] perk ${perkId}`);
  console.log('[collapse] BEFORE  ', JSON.stringify(await branchLines(sid)).slice(0, 120));

  // ---- expand ----
  let eid = await findToggle(sid);
  await bsReq('POST', `/wd/hub/session/${sid}/element/${eid}/click`, {});
  await sleep(2500);
  const expanded = await branchLines(sid);
  console.log(`[collapse] EXPANDED ${expanded.lines.length} lines, toggle=${JSON.stringify(expanded.toggle)}`);
  await shot(sid, 'probe-collapse-1-expanded');

  // ---- bring the toggle into the viewport before clicking it ----
  let t = await toggleRect(sid);
  console.log(`[collapse] toggle bounds right after expand: ${t && t.raw} -> ${t && t.rect ? 'valid' : 'MALFORMED/off-screen'}`);
  for (let i = 0; i < 8 && !(t && onScreen(t.rect)); i++) {
    await D.swipeUp(sid, 'android');
    t = await toggleRect(sid);
    console.log(`   scroll ${i + 1}: bounds ${t && t.raw} onScreen=${!!(t && onScreen(t.rect))}`);
  }
  await shot(sid, 'probe-collapse-2-toggle-in-view');
  if (!(t && onScreen(t.rect))) {
    console.log('[collapse] RESULT: could not bring "See less" on screen — INCONCLUSIVE, not a defect claim');
    await bsReq('DELETE', `/wd/hub/session/${sid}`); return;
  }
  console.log(`[collapse] "${t.text}" now on screen at ${t.rect.cx},${t.rect.cy}`);

  // ---- collapse: element click first, then a coordinate tap at the VERIFIED on-screen position ----
  eid = await findToggle(sid);
  if (eid) { await bsReq('POST', `/wd/hub/session/${sid}/element/${eid}/click`, {}); await sleep(2500); }
  let after = await branchLines(sid);
  console.log(`[collapse] after element click: ${after.lines.length} lines, toggle=${JSON.stringify(after.toggle)}`);
  if (after.lines.length > 3) {
    console.log(`[collapse] retry with a coordinate tap at the verified position ${t.rect.cx},${t.rect.cy}`);
    await tap(sid, t.rect.cx, t.rect.cy);
    await sleep(2500);
    after = await branchLines(sid);
    console.log(`[collapse] after coordinate tap: ${after.lines.length} lines, toggle=${JSON.stringify(after.toggle)}`);
  }
  await shot(sid, 'probe-collapse-3-after');

  const ok = after.lines.length === 3 && /See more/i.test(after.toggle || '');
  console.log(ok
    ? '[collapse] RESULT: COLLAPSE WORKS — back to 3 lines with "See more" restored. AC12 fully passes.'
    : `[collapse] RESULT: COLLAPSE FAILED with the toggle verified on screen — ${after.lines.length} lines, toggle=${after.toggle}. REAL DEFECT CANDIDATE.`);
  await bsReq('DELETE', `/wd/hub/session/${sid}`);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
