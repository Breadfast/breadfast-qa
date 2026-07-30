'use strict';
/**
 * B10-56652 — reversible test-data window for the AC3/AC4 boundary cases.
 *
 * WHY SECTIONS AND NOT PERKS (learned the hard way, 2026-07-28):
 *   The obvious lever — expire a perk via `POST /perks/update {id, end_date:<past>}` — WORKS but is
 *   **ONE-WAY**: the perk flips to `expired` and every subsequent update is rejected with
 *   `"Card Perk is not editable"`. Setting `start_date` on an active perk is accepted with
 *   `"Card Perk updated successfully"` but **silently changes nothing**. So there is NO reversible way
 *   to make an individual perk ineligible.
 *   `POST /perks/section/update {id, is_active}` **round-trips cleanly in both directions** and removes
 *   every perk in that section from the app's eligible set. That is the lever this script uses.
 *
 * One perk (`MC_52`, "15% Cashback", section Breadfast, display_order null — invisible in the carousel)
 * was expired while discovering the above and CANNOT be restored. Disclosed in the QA summary.
 *
 * Usage:
 *   node perk-window.js snapshot                 # record section state + predicted carousel
 *   node perk-window.js off <sectionIds…>        # deactivate sections (records what it changed)
 *   node perk-window.js on  <sectionIds…>        # reactivate specific sections
 *   node perk-window.js restore                  # reactivate EVERYTHING this script turned off, and verify
 *   node perk-window.js state                    # current eligible set + predicted carousel orders
 */
const fs = require('fs');
const path = require('path');
const creds = require('../../automation/config/credentials.js');

const BASE = 'https://card-panel-testing.breadfast.tech';
const EVID = path.resolve(__dirname, '..', 'evidence');
const LEDGER = path.join(EVID, 'perk-window-ledger.json');

let token = null;
async function login() {
  if (token) return token;
  const r = await fetch(`${BASE}/api/v1/web/user/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'agent', password: 'Admin@123456789' }),
  });
  if (!r.ok) throw new Error('panel login HTTP ' + r.status);
  token = (await r.json()).token;
  return token;
}

async function api(p, body) {
  const t = await login();
  const r = await fetch(BASE + p, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 200) }; }
  return { status: r.status, json };
}

const perks = async () => ((await api('/api/v1/web/card/perks/list', { limit: 400 })).json.data || []);
const sections = async () => ((await api('/api/v1/web/card/perks/section/list', { limit: 300 })).json.data || []);

function ledger() {
  try { return JSON.parse(fs.readFileSync(LEDGER, 'utf8')); } catch { return { turnedOff: [], history: [] }; }
}
function saveLedger(l) {
  fs.mkdirSync(EVID, { recursive: true });
  fs.writeFileSync(LEDGER, JSON.stringify(l, null, 2));
}

/**
 * Predict the carousel under the two competing ordering rules, so an observation can DISCRIMINATE.
 *   A) locked rule  : section order → perk display_order            (what the operator approved)
 *   B) observed rule: section order → perk TYPE → perk display_order (what the build appears to do)
 * Perks with no section, or no display_order, sort last / are excluded — both observed behaviours.
 */
function predict(allPerks, allSections) {
  const secById = new Map(allSections.map((s) => [s.id, s]));
  const eligible = allPerks.filter((p) => p.status === 'active' && p.section_id != null && p.display_order != null)
    .filter((p) => { const s = secById.get(p.section_id); return s && s.is_active; });

  const bySection = (a, b) => (secById.get(a.section_id).display_order) - (secById.get(b.section_id).display_order);
  const TYPE_SEQ = ['category-cashback', 'merchant-cashback', 'general-cashback', 'discount-coupon'];
  const typeRank = (t) => { const i = TYPE_SEQ.indexOf(t); return i === -1 ? 99 : i; };

  const ruleA = eligible.slice().sort((a, b) => bySection(a, b) || a.display_order - b.display_order || String(a.id).localeCompare(String(b.id)));
  const ruleB = eligible.slice().sort((a, b) => bySection(a, b) || typeRank(a.type) - typeRank(b.type) || a.display_order - b.display_order || String(a.id).localeCompare(String(b.id)));
  return {
    eligibleCount: eligible.length,
    ruleA: ruleA.slice(0, 5).map((p) => `${p.id}(${p.type.split('-')[0]},${p.display_order})`),
    ruleB: ruleB.slice(0, 5).map((p) => `${p.id}(${p.type.split('-')[0]},${p.display_order})`),
    sameEither: JSON.stringify(ruleA.slice(0, 5).map((p) => p.id)) === JSON.stringify(ruleB.slice(0, 5).map((p) => p.id)),
  };
}

async function state() {
  const [P, S] = [await perks(), await sections()];
  const off = S.filter((s) => !s.is_active);
  const pr = predict(P, S);
  console.log(`active perks ${P.filter((p) => p.status === 'active').length} · sections ${S.length} (inactive: ${off.length}${off.length ? ' → ' + off.map((s) => s.id + ':' + s.name_en).join(', ') : ''})`);
  console.log(`eligible (active + in an active section + has display_order): ${pr.eligibleCount}`);
  console.log(`  rule A (section→order)      first 5: ${pr.ruleA.join('  ')}`);
  console.log(`  rule B (section→type→order) first 5: ${pr.ruleB.join('  ')}`);
  console.log(pr.sameEither ? '  ⚠ both rules predict the SAME 5 — this state cannot discriminate them'
    : '  ✓ the rules predict DIFFERENT sets — this state DISCRIMINATES');
  return pr;
}

async function snapshot() {
  const [P, S] = [await perks(), await sections()];
  fs.mkdirSync(EVID, { recursive: true });
  fs.writeFileSync(path.join(EVID, 'window-snapshot-sections.json'), JSON.stringify(S.map((s) => ({ id: s.id, name_en: s.name_en, is_active: s.is_active, display_order: s.display_order })), null, 2));
  fs.writeFileSync(path.join(EVID, 'window-snapshot-perks.json'), JSON.stringify(P.map((p) => ({ id: p.id, type: p.type, status: p.status, section_id: p.section_id, display_order: p.display_order, start_date: p.start_date, end_date: p.end_date, title_en: p.title_en })), null, 2));
  console.log(`snapshot written: ${S.length} sections, ${P.length} perks → evidence/window-snapshot-*.json`);
  await state();
}

async function toggle(ids, value) {
  const l = ledger();
  for (const id of ids) {
    const r = await api('/api/v1/web/card/perks/section/update', { id: Number(id), is_active: value });
    const ok = r.status >= 200 && r.status < 300;
    console.log(`  section ${id} → is_active=${value}: ${ok ? 'OK' : 'FAILED ' + r.status + ' ' + JSON.stringify(r.json).slice(0, 160)}`);
    if (ok) {
      if (!value && !l.turnedOff.includes(Number(id))) l.turnedOff.push(Number(id));
      if (value) l.turnedOff = l.turnedOff.filter((x) => x !== Number(id));
      l.history.push({ id: Number(id), is_active: value });
    }
  }
  saveLedger(l);
  await state();
}

async function restore() {
  const l = ledger();
  if (!l.turnedOff.length) { console.log('ledger is empty — nothing this script turned off remains off.'); }
  else { console.log(`reactivating ${l.turnedOff.length} section(s): ${l.turnedOff.join(', ')}`); await toggle(l.turnedOff.slice(), true); }
  const S = await sections();
  const stillOff = S.filter((s) => !s.is_active);
  if (stillOff.length) {
    console.log(`⚠ ${stillOff.length} section(s) are STILL inactive: ${stillOff.map((s) => s.id + ':' + s.name_en).join(', ')}`);
    console.log('  (if these were not turned off by this script they were already inactive — compare evidence/window-snapshot-sections.json)');
    process.exitCode = 1;
  } else {
    console.log('✓ RESTORE VERIFIED — every section is active again.');
  }
}

const [cmd, ...args] = process.argv.slice(2);
(async () => {
  if (cmd === 'snapshot') return snapshot();
  if (cmd === 'state') return void (await state());
  if (cmd === 'off') return toggle(args, false);
  if (cmd === 'on') return toggle(args, true);
  if (cmd === 'restore') return restore();
  console.log('usage: node perk-window.js <snapshot|state|off <ids…>|on <ids…>|restore>');
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
