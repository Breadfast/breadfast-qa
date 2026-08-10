'use strict';
/**
 * Why "See less" reported 9 lines on iOS (TC-54260), decided by looking rather than by arithmetic.
 *
 * The Java suite failed TWICE with `expected [3] but found [9]` while its sibling TC-54259 — which
 * asserts the SAME collapsed count on the SAME discovered fixture — passed 70 minutes earlier. The
 * dashboard says why: the perk the shape-finder now returns first, DC_24 "freedelivery2", was edited
 * mid-run (updatedAt 2026-08-03T11:34:01Z) and its branches field is the dashboard PLACEHOLDER text
 * "List / of / valid / branches / (if any)" repeated three times — 15 authored lines, only 5 distinct.
 *
 * `countRenderedAuthoredBranchLines` walks the AUTHORED list and counts every entry that matches any
 * string on screen, so three visible lines match at positions 1,2,3 / 6,7,8 / 11,12,13 → 9. That is
 * arithmetic, not evidence, so this probe settles it on the device: it reproduces the Java reader's
 * exact matching rule against the live screen and captures a screenshot next to it. If the screen
 * shows 3 lines while the reader says 9, the product collapsed correctly and the COUNTER is wrong for
 * a fixture with duplicate lines.
 *
 *   NODE_PATH=D:/breadfast-qa/node_modules node probe-ios-seeless.js
 */
const fs = require('fs');
const path = require('path');
const { sleep, screenshot, getSource, tap, bsReq } = require('../../../bs_helper.js');
const { inventory, centre } = require('./drive.js');
const D = require('./to-perk-details.js');
const R = require('./run-acs.js');

const SHOTS = path.resolve(__dirname, '..', '..', 'screenshots');
const EVID = path.resolve(__dirname, '..', '..', 'evidence');
const PHONE = '1188369495';
const txt = (r) => (r.text || r.label || r.value || r.name || r.desc || '').trim();

/** The finder the Java suite uses: FIRST active perk, in dashboard list order, with > 3 branch lines. */
function finderPick(live) {
  for (const p of live) {
    if (String(p.status).toLowerCase() !== 'active') continue;
    const raw = (p.perk_attributes || {}).branches_description_en || '';
    const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length > 3) return { id: p.id, title: p.title_en, lines, updatedAt: p.updatedAt };
  }
  return null;
}

/** IosNativeCardPerkDetailsScreen.countRenderedAuthoredBranchLines, transcribed exactly. */
function javaCount(authoredLines, onScreenStrings) {
  let rendered = 0;
  for (const authored of authoredLines) {
    for (const shown of onScreenStrings) {
      const stripped = shown.replace(/…/g, '').replace(/\.\.\./g, '').trim();
      if (shown === authored || (stripped && authored.startsWith(stripped))) { rendered++; break; }
    }
  }
  return rendered;
}

/** Every label/value on screen, as the Java XPath `//*[@label or @value]` collects them. */
function onScreen(xml) {
  const set = new Set();
  for (const r of inventory(xml)) {
    const v = (r.label && r.label.trim()) || (r.value && r.value.trim()) || '';
    if (v) set.add(v.trim());
  }
  return [...set];
}

/** The same nodes WITH the visible attribute iOS reports, which the Java reader never consults. */
function nodesFor(xml, authoredSet) {
  const out = [];
  for (const m of xml.matchAll(/<([\w.]+)\s([^>]*?)\/?>/g)) {
    const a = m[2];
    const get = (k) => { const r = new RegExp(k + '="([^"]*)"').exec(a); return r ? r[1] : ''; };
    const v = (get('label') || get('value')).trim();
    if (v && authoredSet.has(v)) {
      out.push({ cls: m[1], value: v, visible: get('visible'), y: get('y'), h: get('height') });
    }
  }
  return out;
}

(async () => {
  const live = await R.loadLivePerks();
  const pick = finderPick(live);
  if (!pick) throw new Error('no active perk with more than 3 branch lines — the finder would return null');
  const authored = pick.lines;
  const distinct = [...new Set(authored)];
  console.log(`[seeless] finder picks ${pick.id} "${pick.title}" — ${authored.length} authored lines,`
    + ` ${distinct.length} distinct, updatedAt ${pick.updatedAt}`);
  authored.forEach((l, i) => console.log(`          ${i + 1}. ${JSON.stringify(l)}`));

  const { sid } = await D.run('ios', 'en', pick.id, PHONE);
  const report = { perk: pick, states: [] };

  const readState = async (label) => {
    const xml = await getSource(sid);
    const strings = onScreen(xml);
    const count = javaCount(authored, strings);
    const distinctCount = javaCount(distinct, strings);
    const nodes = nodesFor(xml, new Set(authored));
    const visibleNodes = nodes.filter((n) => n.visible !== 'false');
    const shot = path.join(SHOTS, `probe-ios-seeless-${label}.png`);
    await screenshot(sid, shot);
    fs.writeFileSync(path.join(EVID, `ios-en-seeless-${label}.xml`), xml);
    console.log(`\n[seeless] ${label}`);
    console.log(`   java counter over ${authored.length} authored lines : ${count}`);
    console.log(`   same counter over ${distinct.length} DISTINCT lines : ${distinctCount}`);
    console.log(`   branch-line nodes in the tree                : ${nodes.length} (visible!=false: ${visibleNodes.length})`);
    nodes.forEach((n) => console.log(`     ${JSON.stringify(n.value).padEnd(14)} visible=${n.visible || '-'} y=${n.y} h=${n.h} ${n.cls}`));
    console.log(`   toggle on screen: ${JSON.stringify(strings.filter((s) => /^See (more|less)$/i.test(s)))}`);
    console.log(`   screenshot: ${path.relative(path.resolve(__dirname, '..', '..'), shot)}`);
    report.states.push({ label, javaCount: count, distinctCount, nodes, screenshot: path.basename(shot) });
    return { xml, strings };
  };

  // Bring the toggle into the viewport, exactly as the page object's tapBranchesToggle does.
  const toggleNode = async () => inventory(await getSource(sid)).find((r) => /^See (more|less)$/i.test(txt(r)));
  const scrollToggleIntoView = async () => {
    for (let i = 0; i < 8; i++) {
      const n = await toggleNode();
      if (n) { const c = centre(n.bounds); if (c && c.y > 120 && c.y < 700) return n; }
      await D.swipeUp(sid, 'ios');
    }
    return toggleNode();
  };

  await scrollToggleIntoView();
  await readState('1-collapsed');

  let n = await toggleNode();
  if (!n) throw new Error('no See more / See less toggle found');
  let c = centre(n.bounds);
  console.log(`\n[seeless] tapping "${txt(n)}" @ ${c.x},${c.y}`);
  await tap(sid, c.x, c.y);
  await sleep(3000);
  await scrollToggleIntoView();
  await readState('2-expanded');

  n = await toggleNode();
  c = centre(n.bounds);
  console.log(`\n[seeless] tapping "${txt(n)}" @ ${c.x},${c.y}`);
  await tap(sid, c.x, c.y);
  await sleep(3000);
  await scrollToggleIntoView();
  await readState('3-recollapsed');

  fs.writeFileSync(path.join(EVID, 'ios-en-seeless-probe.json'), JSON.stringify(report, null, 2));
  await bsReq('DELETE', `/wd/hub/session/${sid}`);
  console.log('\n[seeless] done — compare the three screenshots against the counts above.');
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
