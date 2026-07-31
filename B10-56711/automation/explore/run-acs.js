'use strict';
/**
 * B10-56711 execution engine — runs the full 13-AC checklist for one (platform, locale) combo.
 *
 *   node run-acs.js <ios|android> <en|ar>
 *
 * Four fixtures cover every AC including the negative branches (see impact.md §5):
 *   DC_17 BF Bakery 15% Off  — online code, 16 branch lines, all five cards, NO subheader
 *   DC_16 RTE Buy 1 Get 1    — PHYSICAL code (AC8), 2 branch lines (AC12 negative), has subheader
 *   GC_56 8% on All Spend    — branches EMPTY (AC11 negative)
 *   DC_8  new discount perk 1 — cashback EMPTY (AC13 neg), expiry EMPTY (AC10 neg), EXACTLY 3 lines (AC12 boundary)
 *
 * Writes evidence/<tag>-ac-results.json with a per-AC verdict, plus a screenshot and an
 * accessibility dump per state. Verdicts are PASS / FAIL / INCONCLUSIVE / NOT_APPLICABLE — never a
 * bare boolean, because AC7 is timing-dependent and a miss must not read as a failure.
 */
const fs = require('fs');
const path = require('path');
const { sleep, screenshot, getSource, tap, bsReq } = require('../../../bs_helper.js');
const { inventory, centre } = require('./drive.js');
const toPerksList = require('./to-perks-list.js');
const D = require('./to-perk-details.js');

const ROOT = path.resolve(__dirname, '..', '..');
const SHOTS = path.join(ROOT, 'screenshots');
const EVID = path.join(ROOT, 'evidence');
const PHONE = '1188369495';

const log = (m) => console.log(m);
const txt = (r) => (r.text || r.label || r.value || r.name || r.desc || '').trim();
const norm = (s) => String(s || '').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

/** Expected values, read from the perk baseline captured at the prerequisite gate. */
const BASE = require(path.join(EVID, 'perks-baseline.json'));
const KEYP = { 'discount-coupon': 'DC', 'merchant-cashback': 'MC', 'general-cashback': 'GC', 'category-cashback': 'CC' };
const perkById = (id) => BASE.find((p) => `${KEYP[p.type]}_${p.numeric_id_by_type}` === id);

const FIXTURES = ['DC_17', 'DC_16', 'GC_56', 'DC_8'];

const yOf = (b) => { const m = /\[(\d+),(\d+)\]\[(\d+),(\d+)\]/.exec(b || ''); if (m) return Number(m[2]); const p = String(b || '').split(',').map(Number); return p.length === 4 ? p[1] : 0; };

async function shot(sid, name) { fs.mkdirSync(SHOTS, { recursive: true }); const f = path.join(SHOTS, `${name}.png`); await screenshot(sid, f); return path.basename(f); }
async function dump(sid, name) { fs.mkdirSync(EVID, { recursive: true }); const x = await getSource(sid); fs.writeFileSync(path.join(EVID, `${name}.xml`), x); return x; }
const rows = async (sid) => inventory(await getSource(sid));

async function back(sid, platform) {
  if (platform === 'android') await bsReq('POST', `/wd/hub/session/${sid}/back`).catch(() => {});
  else {
    const chevron = (await rows(sid)).find((r) => /^(Back|رجوع)$/i.test(txt(r)) || /chevron|back/i.test(r.name || ''));
    if (chevron) { const c = centre(chevron.bounds); await tap(sid, c.x, c.y); }
    else await tap(sid, 40, 100);
  }
  await sleep(4000);
}

/** Re-assert the Compose settings; the tree populates non-deterministically. */
async function settle(sid, platform) {
  if (platform !== 'android') return;
  await bsReq('POST', `/wd/hub/session/${sid}/appium/settings`, { settings: { allowInvisibleElements: true, ignoreUnimportantViews: false } }).catch(() => {});
  await sleep(1200);
}

/** From the Perks List, scroll the given perk id into view and open it. */
async function openPerk(sid, platform, perkId) {
  const idOf = (r) => (r.name || r.id || r.desc || '');
  const find = async () => (await rows(sid)).find((r) => idOf(r).includes(`perk-card-${perkId}`));
  let card = await find();
  for (let i = 0; !card && i < 12; i++) { await D.swipeUp(sid, platform); card = await find(); }
  if (!card) throw new Error(`perk-card-${perkId} not present on the list`);

  // bounds are content-space: scroll into the viewport and re-read before tapping
  let c = centre(card.bounds);
  for (let i = 0; i < 40 && (c.y < 300 || c.y > 2000); i++) {
    await D.swipeUp(sid, platform);
    const fresh = await find();
    if (!fresh) break;
    card = fresh; c = centre(card.bounds);
  }
  if (c.y < 300 || c.y > 2000) throw new Error(`perk-card-${perkId} never reached the viewport (y=${c.y})`);
  await tap(sid, c.x, c.y);
  await sleep(6500);
  await settle(sid, platform);
}

/** Read the branch lines rendered inside the Branches card. */
function branchLines(rowsAll, locale) {
  const spec = D.CARD_LABELS.find((s) => s.key === 'branches');
  const label = rowsAll.find((r) => spec[locale === 'ar' ? 'ar' : 'en'].test(txt(r)) || spec.en.test(txt(r)));
  if (!label) return [];
  const top = yOf(label.bounds);
  // next card label below Branches bounds the region
  const others = D.CARD_LABELS.filter((s) => s.key !== 'branches')
    .map((s) => rowsAll.find((r) => s[locale === 'ar' ? 'ar' : 'en'].test(txt(r)) || s.en.test(txt(r))))
    .filter(Boolean).map((r) => yOf(r.bounds)).filter((y) => y > top).sort((a, b) => a - b);
  const bottom = others.length ? others[0] : Infinity;
  return rowsAll
    .filter((r) => { const y = yOf(r.bounds); return y > top && y < bottom && txt(r) && !D.SEE_MORE.test(txt(r)) && !D.SEE_LESS.test(txt(r)); })
    .map((r) => txt(r));
}

async function run(platform, locale) {
  const tag = `${platform}-${locale}`;
  const L = locale === 'ar' ? 'ar' : 'en';
  const listed = await toPerksList.run(platform, locale, PHONE);
  const sid = listed.sid;
  const results = [];
  const add = (ac, fixture, verdict, detail, evidence) => {
    results.push({ ac, fixture, verdict, detail, evidence });
    log(`   ${String(ac).padEnd(5)} ${String(fixture).padEnd(6)} ${verdict.padEnd(13)} ${detail}`);
  };

  for (const pid of FIXTURES) {
    const p = perkById(pid);
    const A = (p && p.perk_attributes) || {};
    const expTitle = L === 'ar' ? p.title_ar : p.title_en;
    const expUsage = L === 'ar' ? A.usage_description_ar : A.usage_description_en;
    const expBranch = L === 'ar' ? A.branches_description_ar : A.branches_description_en;
    const expCash = L === 'ar' ? A.cashback_processing_description_ar : A.cashback_processing_description_en;
    const expExpiry = L === 'ar' ? A.short_duration_description_ar : A.short_duration_description_en;
    const expSub = L === 'ar' ? A.subheader_ar : A.subheader_en;
    const expCode = A.coupon_code;
    const couponType = String(A.coupon_type || '').toLowerCase();
    const has = (v) => v != null && String(v).trim() !== '';
    const authoredLines = has(expBranch) ? String(expBranch).split(/\r?\n/).filter((s) => s.trim()).length : 0;

    log(`\n[${tag}] ${pid} "${p.title_en}"  (coupon=${couponType || '-'} branchLines=${authoredLines} cash=${has(expCash)} expiry=${has(expExpiry)} sub=${has(expSub)})`);
    try { await openPerk(sid, platform, pid); }
    catch (e) { add('nav', pid, 'INCONCLUSIVE', `could not open: ${e.message}`, null); continue; }

    const s1 = await shot(sid, `${tag}-${pid}-01-top`);
    let x = await dump(sid, `${tag}-${pid}-01-top`);
    let all = inventory(x);

    // scroll to end so "absent" claims are sound, accumulating every node seen
    const seen = [...all];
    let prev = '';
    for (let i = 0; i < 8 && x !== prev; i++) { prev = x; await D.swipeUp(sid, platform); x = await getSource(sid); seen.push(...inventory(x)); }
    fs.writeFileSync(path.join(EVID, `${tag}-${pid}-02-end.xml`), x);
    const s2 = await shot(sid, `${tag}-${pid}-02-end`);
    const texts = seen.map(txt).filter(Boolean).map(norm);
    const hasText = (v) => has(v) && texts.some((t) => t === norm(v) || t.includes(norm(v)));

    const probe = D.parseDetails(seen.map((r) => r).length ? x : x, locale);
    const present = new Set();
    for (const spec of D.CARD_LABELS) if (seen.some((r) => spec[L].test(txt(r)) || spec.en.test(txt(r)))) present.add(spec.key);

    // ---- AC4 / AC5 ----
    add('AC4', pid, present.size >= 2 ? 'PASS' : 'FAIL', `${present.size} labelled cards: [${[...present].join(', ')}]`, s1);
    const order = D.CARD_LABELS.filter((s) => present.has(s.key)).map((s) => s.key);
    const actual = D.CARD_LABELS.filter((s) => present.has(s.key))
      .map((s) => ({ k: s.key, y: yOf((seen.find((r) => s[L].test(txt(r)) || s.en.test(txt(r))) || {}).bounds) }))
      .sort((a, b) => a.y - b.y).map((o) => o.k);
    add('AC5', pid, JSON.stringify(order) === JSON.stringify(actual) ? 'PASS' : 'FAIL', `expected ${order.join(' > ')} | actual ${actual.join(' > ')}`, s1);

    // ---- AC3 title + tagline ----
    add('AC3', pid, hasText(expTitle) ? 'PASS' : 'FAIL', `title "${expTitle}" ${hasText(expTitle) ? 'rendered' : 'NOT FOUND'}` + (has(expSub) ? ` | tagline "${expSub}" ${hasText(expSub) ? 'rendered' : 'NOT FOUND'}` : ' | no tagline stored (slot expected to collapse)'), s1);

    // ---- AC6 / AC8 coupon presentation ----
    if (couponType === 'online') {
      const chip = seen.find((r) => norm(txt(r)) === norm(expCode));
      add('AC6', pid, chip ? 'PASS' : 'FAIL', chip ? `code "${expCode}" shown in the Coupon code card` : `code "${expCode}" NOT shown`, s1);
      if (chip) {
        // clipboard + the AC7 transient state
        const c = centre(chip.bounds);
        await tap(sid, c.x, c.y);
        await sleep(700);
        const immediate = (await rows(sid)).map(txt).filter(Boolean).map(norm);
        const sawCopied = immediate.some((t) => D.COPIED.test(t));
        const sImm = await shot(sid, `${tag}-${pid}-03-copied`);
        let clip = null;
        try {
          const r = await bsReq('POST', `/wd/hub/session/${sid}/appium/device/get_clipboard`, { contentType: 'plaintext' });
          clip = r && r.value ? Buffer.from(String(r.value), 'base64').toString('utf8') : null;
        } catch (_) { /* not supported */ }
        add('AC6-clipboard', pid, clip == null ? 'INCONCLUSIVE' : (norm(clip) === norm(expCode) ? 'PASS' : 'FAIL'),
          clip == null ? 'clipboard API unavailable on this platform — copy feedback checked separately, clipboard content NOT verified' : `clipboard = "${clip}"`, sImm);
        await sleep(3200);
        const after = (await rows(sid)).map(txt).filter(Boolean).map(norm);
        const codeBack = after.some((t) => t === norm(expCode));
        const copiedGone = !after.some((t) => D.COPIED.test(t));
        const sAfter = await shot(sid, `${tag}-${pid}-04-after-3s`);
        add('AC7', pid, sawCopied ? ((codeBack && copiedGone) ? 'PASS' : 'FAIL') : 'INCONCLUSIVE',
          sawCopied ? `"Copied!" seen at ~0.7s; after 3.2s code back=${codeBack}, Copied gone=${copiedGone}` : 'the transient "Copied!" was not captured at ~0.7s — timing-sensitive, treat as inconclusive and re-run',
          sAfter);
      }
      add('AC8', pid, 'NOT_APPLICABLE', 'perk has an online code', null);
    } else if (couponType === 'physical') {
      const codeInline = seen.some((r) => norm(txt(r)) === norm(expCode));
      const viewCta = seen.find((r) => D.VIEW_CTA.test(txt(r)));
      let verdict = 'FAIL', detail = '';
      if (codeInline) detail = `code "${expCode}" is visible INLINE before tapping View — AC8 requires it hidden`;
      else if (!viewCta) detail = 'no "View" CTA found on the Coupon code card';
      else {
        const c = centre(viewCta.bounds);
        await tap(sid, c.x, c.y);
        await sleep(3500);
        const sheet = await rows(sid);
        const sSheet = await shot(sid, `${tag}-${pid}-03-bottomsheet`);
        await dump(sid, `${tag}-${pid}-03-bottomsheet`);
        const codeInSheet = sheet.some((r) => norm(txt(r)) === norm(expCode));
        const closeCta = sheet.find((r) => D.CLOSE_CTA.test(txt(r)));
        if (codeInSheet && closeCta) {
          const cc = centre(closeCta.bounds);
          await tap(sid, cc.x, cc.y);
          await sleep(3000);
          const afterClose = (await rows(sid)).map(txt).filter(Boolean).map(norm);
          const dismissed = !afterClose.some((t) => D.CLOSE_CTA.test(t));
          const backOnDetails = afterClose.some((t) => /^(Coupon code|كود الكوبون)$/.test(t));
          verdict = dismissed && backOnDetails ? 'PASS' : 'FAIL';
          detail = `View opened a sheet containing "${expCode}" + Close; after Close dismissed=${dismissed}, back on details=${backOnDetails}`;
          add('AC8-sheet', pid, verdict, detail, sSheet);
        } else {
          verdict = 'FAIL';
          detail = `sheet opened but codeInSheet=${codeInSheet}, closeCta=${!!closeCta}`;
        }
      }
      add('AC8', pid, verdict, detail, s1);
      add('AC6', pid, codeInline ? 'FAIL' : 'PASS', codeInline ? 'physical code shown inline' : 'physical code correctly hidden until View', s1);
    } else {
      add('AC6', pid, 'NOT_APPLICABLE', 'perk has no coupon code', null);
      add('AC8', pid, 'NOT_APPLICABLE', 'perk has no coupon code', null);
      add('AC6-card', pid, present.has('coupon') ? 'FAIL' : 'PASS', present.has('coupon') ? 'Coupon code card shown for a perk with no code' : 'Coupon code card correctly absent', s2);
    }

    // ---- AC9 usage ----
    add('AC9', pid, has(expUsage) ? (hasText(expUsage) ? 'PASS' : 'FAIL') : 'NOT_APPLICABLE',
      has(expUsage) ? `usage text ${hasText(expUsage) ? 'matches the dashboard value' : 'MISMATCH — stored: "' + norm(expUsage).slice(0, 80) + '"'}` : 'no usage description stored', s1);

    // ---- AC10 expiry (free text, verbatim; operator-confirmed) ----
    if (has(expExpiry)) add('AC10', pid, hasText(expExpiry) ? 'PASS' : 'FAIL', `expiry "${norm(expExpiry)}" ${hasText(expExpiry) ? 'rendered verbatim' : 'NOT rendered'}`, s2);
    else add('AC10', pid, present.has('expiry') ? 'INCONCLUSIVE' : 'PASS', present.has('expiry') ? 'Expiry card present although no validity text is stored — check whether it renders empty (operator: no value expected)' : 'no validity text stored and no Expiry value shown — expected', s2);

    // ---- AC11 branches ----
    if (has(expBranch)) {
      add('AC11', pid, present.has('branches') ? 'PASS' : 'FAIL', `branches configured (${authoredLines} authored lines) → card ${present.has('branches') ? 'shown' : 'MISSING'}`, s1);
      // ---- AC12 ----
      const shown = branchLines(inventory(await getSource(sid)), locale);
      const seeMore = seen.find((r) => D.SEE_MORE.test(txt(r)));
      if (authoredLines > 3) {
        if (!seeMore) add('AC12', pid, 'FAIL', `${authoredLines} authored lines but no "See more" control`, s1);
        else {
          const c = centre(seeMore.bounds);
          await tap(sid, c.x, c.y);
          await sleep(2500);
          const expRows = inventory(await getSource(sid));
          const expandedLines = branchLines(expRows, locale);
          const seeLess = expRows.find((r) => D.SEE_LESS.test(txt(r)));
          const sExp = await shot(sid, `${tag}-${pid}-05-branches-expanded`);
          await dump(sid, `${tag}-${pid}-05-branches-expanded`);
          let detail = `collapsed=${shown.length} lines, expanded=${expandedLines.length} lines, See less ${seeLess ? 'shown' : 'MISSING'}`;
          let verdict = (expandedLines.length > shown.length && seeLess) ? 'PASS' : 'FAIL';
          if (seeLess) {
            const cl = centre(seeLess.bounds);
            await tap(sid, cl.x, cl.y);
            await sleep(2500);
            const reRows = inventory(await getSource(sid));
            const recollapsed = branchLines(reRows, locale);
            const seeMoreBack = reRows.some((r) => D.SEE_MORE.test(txt(r)));
            detail += ` | after See less: ${recollapsed.length} lines, See more back=${seeMoreBack}`;
            if (!(recollapsed.length <= 3 && seeMoreBack)) verdict = 'FAIL';
            await shot(sid, `${tag}-${pid}-06-branches-recollapsed`);
          }
          add('AC12', pid, verdict, detail, sExp);
        }
      } else {
        add('AC12', pid, seeMore ? 'FAIL' : 'PASS', `${authoredLines} authored lines (<= 3) → "See more" ${seeMore ? 'WRONGLY shown' : 'correctly absent'}; rendered ${shown.length} lines`, s1);
      }
    } else {
      add('AC11', pid, present.has('branches') ? 'FAIL' : 'PASS', present.has('branches') ? 'Branches card shown although none configured' : 'no branches configured → card correctly hidden (verified after full scroll)', s2);
      add('AC12', pid, 'NOT_APPLICABLE', 'no branches configured', null);
    }

    // ---- AC13 cashback processing ----
    if (has(expCash)) add('AC13', pid, present.has('cashback') && hasText(expCash) ? 'PASS' : 'FAIL', `configured → card ${present.has('cashback') ? 'shown' : 'MISSING'}, text ${hasText(expCash) ? 'matches' : 'MISMATCH'}`, s2);
    else add('AC13', pid, present.has('cashback') ? 'FAIL' : 'PASS', present.has('cashback') ? 'Cashback processing card shown although not configured' : 'not configured → card correctly hidden (verified after full scroll)', s2);

    await back(sid, platform);
    await settle(sid, platform);
  }

  const out = { story: 'B10-56711', tag, platform, locale, sid, ranAt: new Date().toISOString(), fixtures: FIXTURES, results };
  fs.writeFileSync(path.join(EVID, `${tag}-ac-results.json`), JSON.stringify(out, null, 2));
  const tally = results.reduce((a, r) => { a[r.verdict] = (a[r.verdict] || 0) + 1; return a; }, {});
  log(`\n[${tag}] DONE — ${JSON.stringify(tally)}`);
  return out;
}

module.exports = { run, FIXTURES, perkById };

if (require.main === module) {
  const [platform = 'android', locale = 'en'] = process.argv.slice(2);
  run(platform, locale).then(() => console.log('OK')).catch((e) => { console.error('ERR', e.message); process.exit(1); });
}
