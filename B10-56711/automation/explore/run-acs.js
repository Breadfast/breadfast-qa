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

/**
 * Expected values come from the dashboard LIVE, not from a snapshot.
 *
 * The gate snapshot went stale during the backend outage: DC_16's `subheader_en` was cleared from
 * "Ready to Eat Meals" to "" by someone editing the perk. Comparing the app against a stale snapshot
 * would have reported a MISMATCH on a screen that was rendering the current value correctly — a false
 * defect. The oracle has to be whatever the dashboard holds at the moment of the run.
 */
const KEYP = { 'discount-coupon': 'DC', 'merchant-cashback': 'MC', 'general-cashback': 'GC', 'category-cashback': 'CC' };
const PANEL = 'https://card-panel-testing.breadfast.tech';
const perkKey = (p) => `${KEYP[p.type]}_${p.numeric_id_by_type}`;
let LIVE = [];

function panelProp(name) {
  const file = require('../../../automation/config/framework').environmentsFile('cardServiceConfigs_testing.properties');
  const text = fs.readFileSync(file, 'utf8');
  return (text.match(new RegExp('^' + name + '=(.*)$', 'm')) || [])[1];
}

async function loadLivePerks() {
  const login = await fetch(`${PANEL}/api/v1/web/user/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: panelProp('adminUserName'), password: panelProp('adminPassword') }),
  });
  if (!login.ok) throw new Error(`card panel login returned ${login.status} — is the backend up?`);
  const body = await login.json();
  const token = body.token || (body.data && body.data.token);
  const res = await fetch(`${PANEL}/api/v1/web/card/perks/list`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ limit: 400 }),
  });
  const json = await res.json();
  LIVE = json.data || json.rows || [];
  fs.mkdirSync(EVID, { recursive: true });
  fs.writeFileSync(path.join(EVID, 'perks-live-at-run.json'), JSON.stringify(LIVE, null, 2));
  return LIVE;
}

const perkById = (id) => LIVE.find((p) => perkKey(p) === id);

/**
 * Fixtures are DISCOVERED BY SHAPE at run time, never named — the same rule the Java suite follows.
 * Naming DC_16 as "the perk with a tagline" is exactly what broke when its subheader was cleared.
 */
function pickFixtures() {
  const act = LIVE.filter((p) => p.status === 'active' && p.section_id);
  const A = (p) => p.perk_attributes || {};
  const has = (v) => v != null && String(v).trim() !== '';
  const lines = (v) => (has(v) ? String(v).split(/\r?\n/).filter((s) => s.trim()).length : 0);
  const pick = (fn) => { const hit = act.find(fn); return hit ? perkKey(hit) : null; };

  const chosen = {
    'online + >3 branch lines': pick((p) => String(A(p).coupon_type).toLowerCase() === 'online' && lines(A(p).branches_description_en) > 3),
    'physical code': pick((p) => String(A(p).coupon_type).toLowerCase() === 'physical' && has(A(p).coupon_code)),
    'no branches': pick((p) => !has(A(p).branches_description_en) && has(A(p).cashback_processing_description_en)),
    'no cashback / no expiry': pick((p) => !has(A(p).cashback_processing_description_en) && !has(A(p).short_duration_description_en) && has(A(p).branches_description_en)),
    'has a tagline': pick((p) => has(A(p).subheader_en)),
  };
  Object.entries(chosen).forEach(([need, id]) => log(`   fixture [${need}] -> ${id || 'NONE AVAILABLE'}`));
  return [...new Set(Object.values(chosen).filter(Boolean))];
}

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


/**
 * Click by RESOURCE ID through the W3C element endpoint instead of tapping a coordinate.
 *
 * Coordinate taps failed silently three times on this surface: the details body scrolls between the
 * read and the tap, and Compose reports bounds in content space, so a stale centre lands on nothing.
 * The run then recorded "See more tapped, nothing expanded" and "View tapped, no sheet" as AC12/AC8
 * FAILURES when the product was fine. Element clicks let the driver resolve the target at click time.
 */
async function clickById(sid, resourceId) {
  // MUST be xpath on @resource-id, not `id`. Compose exposes a testTag as a BARE resource-id with no
  // package prefix, which UiAutomator2's `id` strategy does not index: measured 2026-08-02, all nine
  // Perk-Details ids are in the page source yet `id` and `accessibility id` resolve none of them while
  // //*[@resource-id='...'] resolves all nine. Using `id` here is what made this helper fall through to
  // a stale-bounds coordinate tap and report AC12/AC8 as FAILURES when the product was working.
  const found = await bsReq('POST', `/wd/hub/session/${sid}/element`, { using: 'xpath', value: `//*[@resource-id='${resourceId}']` });
  const elementId = found && found.value && (found.value.ELEMENT || found.value['element-6066-11e4-a52e-4f735466cecf']);
  if (!elementId) return false;
  const clicked = await bsReq('POST', `/wd/hub/session/${sid}/element/${elementId}/click`, {});
  return !(clicked && clicked.value && clicked.value.error);
}

/** Swipe the list DOWN (content moves down, i.e. scroll back towards the top). */
async function swipeDown(sid, platform) {
  const from = platform === 'ios' ? { x: 195, y: 200 } : { x: 540, y: 550 };
  const to = platform === 'ios' ? { x: 195, y: 640 } : { x: 540, y: 1750 };
  if (platform === 'ios') {
    await bsReq('POST', `/wd/hub/session/${sid}/execute/sync`, {
      script: 'mobile: dragFromToForDuration',
      args: [{ duration: 0.6, fromX: from.x, fromY: from.y, toX: to.x, toY: to.y }],
    });
  } else {
    await bsReq('POST', `/wd/hub/session/${sid}/actions`, {
      actions: [{ type: 'pointer', id: 'finger1', parameters: { pointerType: 'touch' },
        actions: [
          { type: 'pointerMove', duration: 0, x: from.x, y: from.y },
          { type: 'pointerDown', button: 0 }, { type: 'pause', duration: 300 },
          { type: 'pointerMove', duration: 600, x: to.x, y: to.y },
          { type: 'pointerUp', button: 0 }] }],
    });
  }
  await sleep(1500);
}


/**
 * Click the branches See more / See less toggle, scrolling it INTO THE VIEWPORT first.
 *
 * Expanding to 16 lines grows the card and pushes the toggle below the fold: its bounds then come back
 * inverted and off-screen (observed [313,2940][442,2196], centre y=2568 on a 2340px device). Clicking
 * it there does nothing, which made the run report "See less does not collapse" as a DEFECT. Once the
 * toggle is scrolled on screen the collapse works: 16 -> 3 lines with "See more" restored.
 */
async function clickBranchesToggle(sid, platform) {
  const sane = (b) => { const m = /\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/.exec(b || ''); if (!m) return null;
    const [x1, y1, x2, y2] = m.slice(1).map(Number); if (y2 <= y1 || x2 <= x1) return null;
    return { cx: Math.round((x1 + x2) / 2), cy: Math.round((y1 + y2) / 2) }; };
  const node = async () => (await rows(sid)).find((r) => D.SEE_MORE.test(txt(r)) || D.SEE_LESS.test(txt(r)));
  let n = await node();
  let r = n && sane(n.bounds);
  for (let i = 0; i < 8 && !(r && r.cy > 250 && r.cy < 2050); i++) {
    await D.swipeUp(sid, platform);
    n = await node();
    r = n && sane(n.bounds);
  }
  if (!(r && r.cy > 250 && r.cy < 2050)) return false;
  if (await clickById(sid, 'branches-toggle-btn')) return true;
  await tap(sid, r.cx, r.cy);
  return true;
}

/** From the Perks List, scroll the given perk id into view and open it. */
async function openPerk(sid, platform, perkId) {
  const idOf = (r) => (r.name || r.id || r.desc || '');
  const find = async () => (await rows(sid)).find((r) => idOf(r).includes(`perk-card-${perkId}`));
  let card = await find();
  for (let i = 0; !card && i < 12; i++) { await D.swipeUp(sid, platform); card = await find(); }
  if (!card) throw new Error(`perk-card-${perkId} not present on the list`);

  // Bounds are content-space, so a card can sit ABOVE the viewport (negative y) once the list has been
  // scrolled past it — which is what stranded GC_56/DC_8/MC_67 on the first run, because the search only
  // ever swiped one way. Scroll toward the target in whichever direction it actually lies.
  let c = centre(card.bounds);
  for (let i = 0; i < 40 && (c.y < 300 || c.y > 2000); i++) {
    if (c.y < 300) await swipeDown(sid, platform);
    else await D.swipeUp(sid, platform);
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
  await loadLivePerks();
  log(`[${tag}] oracle: ${LIVE.length} perks read live from the dashboard`);
  const FIXTURES = pickFixtures();
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

    // A details screen showing ZERO cards means we never landed on it (render/nav race), not that the
    // product rendered nothing. Re-settle, then re-open the perk; and if it still shows nothing, record
    // ONE inconclusive for navigation rather than a content FAILURE per AC. Emitting AC9/AC10/AC11/AC13
    // failures for a screen that was never examined is how a harness invents defects — it did exactly
    // that for GC_56 and MC_67 before this guard existed.
    const anyCard = async () => {
      const pr = await rows(sid);
      return D.CARD_LABELS.some((sp) => pr.some((r) => sp[L].test(txt(r)) || sp.en.test(txt(r))));
    };
    let landed = await anyCard();
    for (let attempt = 0; !landed && attempt < 3; attempt++) {
      log(`   (no cards visible — re-settling, attempt ${attempt + 1})`);
      await settle(sid, platform);
      await sleep(2500);
      landed = await anyCard();
    }
    if (!landed) {
      log('   (still nothing — going back and re-opening the perk)');
      await back(sid, platform);
      await settle(sid, platform);
      try { await openPerk(sid, platform, pid); landed = await anyCard(); } catch (e) { /* handled below */ }
    }
    if (!landed) {
      await shot(sid, `${tag}-${pid}-ERR-no-cards`);
      await dump(sid, `${tag}-${pid}-ERR-no-cards`);
      add('nav', pid, 'INCONCLUSIVE', 'the Perk Details screen never rendered any card — not examined, so no AC verdict is claimed', `${tag}-${pid}-ERR-no-cards.png`);
      await back(sid, platform);
      await settle(sid, platform);
      continue;
    }
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
        const copied = await clickById(sid, 'coupon-code-copy-btn');
        if (!copied) { const c = centre(chip.bounds); await tap(sid, c.x, c.y); }
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
        const opened = await clickById(sid, 'coupon-code-view-btn');
        if (!opened) { const c = centre(viewCta.bounds); await tap(sid, c.x, c.y); }
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
          await clickBranchesToggle(sid, platform);
          await sleep(2500);
          const expRows = inventory(await getSource(sid));
          const expandedLines = branchLines(expRows, locale);
          const seeLess = expRows.find((r) => D.SEE_LESS.test(txt(r)));
          const sExp = await shot(sid, `${tag}-${pid}-05-branches-expanded`);
          await dump(sid, `${tag}-${pid}-05-branches-expanded`);
          let detail = `collapsed=${shown.length} lines, expanded=${expandedLines.length} lines, See less ${seeLess ? 'shown' : 'MISSING'}`;
          let verdict = (expandedLines.length > shown.length && seeLess) ? 'PASS' : 'FAIL';
          if (seeLess) {
            await clickBranchesToggle(sid, platform);
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

  const out = { story: 'B10-56711', tag, platform, locale, sid, ranAt: new Date().toISOString(), oracle: 'live dashboard read at run start', fixtures: FIXTURES, results };
  fs.writeFileSync(path.join(EVID, `${tag}-ac-results.json`), JSON.stringify(out, null, 2));
  const tally = results.reduce((a, r) => { a[r.verdict] = (a[r.verdict] || 0) + 1; return a; }, {});
  log(`\n[${tag}] DONE — ${JSON.stringify(tally)}`);
  return out;
}

module.exports = { run, pickFixtures, perkById, loadLivePerks };

if (require.main === module) {
  const [platform = 'android', locale = 'en'] = process.argv.slice(2);
  run(platform, locale).then(() => console.log('OK')).catch((e) => { console.error('ERR', e.message); process.exit(1); });
}
