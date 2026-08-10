'use strict';
/**
 * What exactly is the Java reader collecting as "branch lines"? It reports 5 where 3 render.
 * Print every text node with its y, plus the Branches label and the next card label, so the band
 * boundaries and the extra two strings are visible rather than guessed at.
 */
const path = require('path');
const { sleep, screenshot, getSource, tap, bsReq } = require('../../../bs_helper.js');
const { inventory, centre } = require('./drive.js');
const toPerksList = require('./to-perks-list.js');
const D = require('./to-perk-details.js');
const R = require('./run-acs.js');
const txt = (r) => (r.text || r.label || r.value || r.name || r.desc || '').trim();
const rows = async (sid) => inventory(await getSource(sid));
const yTop = (b) => { const m = /\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/.exec(b || ''); return m ? Number(m[2]) : null; };
const yBot = (b) => { const m = /\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/.exec(b || ''); return m ? Number(m[4]) : null; };

(async () => {
  await R.loadLivePerks();
  const perkId = R.pickFixtures()[0];
  const p = R.perkById(perkId);
  const authored = String((p.perk_attributes || {}).branches_description_en || '').split(/\r?\n/).filter((s) => s.trim());
  console.log(`\n[band] perk ${perkId} "${p.title_en}" — ${authored.length} authored lines`);
  console.log(`[band] first 4 authored: ${JSON.stringify(authored.slice(0, 4))}`);

  const { sid } = await toPerksList.run('android', 'en', '1188369495');
  const find = async () => (await rows(sid)).find((r) => (r.name || r.id || r.desc || '').includes(`perk-card-${perkId}`));
  let card = await find();
  for (let i = 0; !card && i < 12; i++) { await D.swipeUp(sid, 'android'); card = await find(); }
  let c = centre(card.bounds);
  for (let i = 0; i < 40 && (c.y < 300 || c.y > 2000); i++) { await D.swipeUp(sid, 'android'); const f = await find(); if (!f) break; card = f; c = centre(card.bounds); }
  await tap(sid, c.x, c.y); await sleep(6500);
  await bsReq('POST', `/wd/hub/session/${sid}/appium/settings`, { settings: { allowInvisibleElements: true, ignoreUnimportantViews: false } }).catch(() => {});
  await sleep(1500);

  const all = await rows(sid);
  const branchesLabel = all.find((r) => /^Branches$/.test(txt(r)));
  const cardEl = all.find((r) => (r.id || r.name || '') === 'branches-card');
  const nextLabel = all.filter((r) => /^(Cashback processing|Expiry)$/.test(txt(r)))
    .filter((r) => branchesLabel && yTop(r.bounds) > yTop(branchesLabel.bounds))
    .sort((a, b) => yTop(a.bounds) - yTop(b.bounds))[0];

  console.log(`\n[band] Branches label   y=${branchesLabel && yTop(branchesLabel.bounds)}..${branchesLabel && yBot(branchesLabel.bounds)}`);
  console.log(`[band] branches-card    ${cardEl ? yTop(cardEl.bounds)+'..'+yBot(cardEl.bounds) : 'NOT FOUND'}`);
  console.log(`[band] next card label  ${nextLabel ? '"'+txt(nextLabel)+'" y='+yTop(nextLabel.bounds) : 'NOT ON SCREEN'}`);

  const from = branchesLabel ? yBot(branchesLabel.bounds) : 0;
  const to = nextLabel ? yTop(nextLabel.bounds) : (cardEl ? yBot(cardEl.bounds) : 2340);
  console.log(`[band] region used: ${from} .. ${to}\n`);
  console.log('[band] EVERY text node with its vertical centre, marking those inside the region:');
  all.filter((r) => txt(r)).forEach((r) => {
    const t = yTop(r.bounds), b = yBot(r.bounds);
    if (t == null) return;
    const cy = Math.round((t + b) / 2);
    const inBand = cy > from && cy < to;
    console.log(`   ${inBand ? '>>' : '  '} y=${String(cy).padStart(5)}  ${JSON.stringify(txt(r)).slice(0, 70)}`);
  });
  await screenshot(sid, path.resolve(__dirname, '..', '..', 'screenshots', 'probe-branchband.png'));
  await bsReq('DELETE', `/wd/hub/session/${sid}`);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
