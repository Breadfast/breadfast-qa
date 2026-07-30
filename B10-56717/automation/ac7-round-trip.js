'use strict';
/**
 * AC7 round trip — "the category tab list is driven by categories configured and enabled via the
 * admin dashboard". Static verification (tab labels equal the section names) does not prove
 * propagation, so this creates a section, moves one perk into it, and checks the app.
 *
 *   node ac7-round-trip.js prep      # snapshot + create section + move one perk into it
 *   node ac7-round-trip.js restore   # put the perk back and deactivate the probe section
 *   node ac7-round-trip.js state     # print current state
 *
 * MUTATION DISCIPLINE (clarifications.md §C): the exact prior value of every field touched is written
 * to evidence/data-mutations.json BEFORE the change, the restore writes it back, and the restore is
 * verified by re-reading and diffing. This is a shared testing environment.
 */
const fs = require('fs');
const path = require('path');

const B = 'https://card-panel-testing.breadfast.tech';
const LOG = path.resolve(__dirname, '..', 'evidence', 'data-mutations.json');
const PROBE_EN = 'zz QA 56717 probe';
const PROBE_AR = 'زد كيو ايه 56717';
// A Breadfast-section perk that is already active and visible in the app.
const PERK = 'MC_53';

async function token() {
  const r = await fetch(`${B}/api/v1/web/user/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'agent', password: 'Admin@123456789' }),
  });
  const j = await r.json();
  const t = (j.data && (j.data.token || j.data.access_token)) || j.token;
  if (!t) throw new Error('admin login failed: ' + JSON.stringify(j).slice(0, 200));
  return t;
}

const H = (t) => ({ 'Content-Type': 'application/json', Authorization: 'Bearer ' + t });

async function post(t, p, body) {
  const r = await fetch(B + p, { method: 'POST', headers: H(t), body: JSON.stringify(body) });
  const text = await r.text();
  let j = null; try { j = JSON.parse(text); } catch { j = { raw: text.slice(0, 300) }; }
  return { status: r.status, j };
}

const sections = async (t) => (await post(t, '/api/v1/web/card/perks/section/list', { limit: 300 })).j.data || [];
const perks = async (t) => (await post(t, '/api/v1/web/card/perks/list', { limit: 300 })).j.data || [];

function readLog() { try { return JSON.parse(fs.readFileSync(LOG, 'utf8')); } catch { return { mutations: [] }; } }
function writeLog(l) { fs.mkdirSync(path.dirname(LOG), { recursive: true }); fs.writeFileSync(LOG, JSON.stringify(l, null, 2)); }

async function state(t) {
  const [S, P] = [await sections(t), await perks(t)];
  const probe = S.find((s) => s.name_en === PROBE_EN);
  const perk = P.find((p) => p.id === PERK);
  const active = P.filter((p) => p.status === 'active');
  const bySection = {};
  active.forEach((p) => { const k = p.section_id ?? 'null'; bySection[k] = (bySection[k] || 0) + 1; });
  const withActive = Object.keys(bySection).filter((k) => k !== 'null')
    .map((k) => ({ id: Number(k), name: (S.find((s) => s.id === Number(k)) || {}).name_en, count: bySection[k] }));
  return { probeSection: probe || null, perk: perk ? { id: perk.id, section_id: perk.section_id, status: perk.status } : null, sectionsWithActivePerks: withActive };
}

async function prep() {
  const t = await token();
  const before = await state(t);
  console.log('BEFORE:', JSON.stringify(before, null, 1));

  const log = readLog();

  let probe = before.probeSection;
  if (!probe) {
    const r = await post(t, '/api/v1/web/card/perks/section/create', { name_en: PROBE_EN, name_ar: PROBE_AR });
    console.log('create section ->', r.status, JSON.stringify(r.j).slice(0, 200));
    probe = (await sections(t)).find((s) => s.name_en === PROBE_EN);
    if (!probe) throw new Error('probe section not created');
    log.mutations.push({ at: new Date().toISOString(), kind: 'section-created', id: probe.id, name_en: PROBE_EN, restoreAction: 'set is_active=false (sections cannot be hard-deleted from here)' });
  }
  console.log('probe section id', probe.id);

  // Move the perk into the probe section, recording its prior section first.
  const prior = before.perk.section_id;
  log.mutations.push({ at: new Date().toISOString(), kind: 'perk-section-changed', perk: PERK, field: 'section_id', before: prior, after: probe.id });
  writeLog(log);

  const upd = await post(t, '/api/v1/web/card/perks/update', { id: PERK, section_id: probe.id });
  console.log('perk update ->', upd.status, JSON.stringify(upd.j).slice(0, 200));

  const after = await state(t);
  console.log('AFTER:', JSON.stringify(after, null, 1));
  return { probeSectionId: probe.id, priorSection: prior };
}

async function restore() {
  const t = await token();
  const log = readLog();
  const results = [];
  for (const m of [...log.mutations].reverse()) {
    if (m.restored) continue;
    if (m.kind === 'perk-section-changed') {
      const r = await post(t, '/api/v1/web/card/perks/update', { id: m.perk, section_id: m.before });
      results.push({ ...m, restoreStatus: r.status });
      m.restored = true;
    } else if (m.kind === 'section-created') {
      const r = await post(t, '/api/v1/web/card/perks/section/update', { id: m.id, is_active: false });
      results.push({ ...m, restoreStatus: r.status, note: 'deactivated' });
      m.restored = true;
    }
  }
  writeLog(log);

  // VERIFY the restore against the original baseline, not against hope.
  const baseline = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'evidence', 'perks-baseline.json'), 'utf8')).data;
  const now = await perks(t);
  const diffs = [];
  for (const b of baseline) {
    const n = now.find((p) => p.id === b.id);
    if (!n) { diffs.push({ id: b.id, field: 'missing' }); continue; }
    if ((b.section_id ?? null) !== (n.section_id ?? null)) diffs.push({ id: b.id, field: 'section_id', baseline: b.section_id, now: n.section_id });
    if ((b.status ?? null) !== (n.status ?? null)) diffs.push({ id: b.id, field: 'status', baseline: b.status, now: n.status });
  }
  const out = { restoredAt: new Date().toISOString(), actions: results, diffVsBaseline: diffs, clean: diffs.length === 0 };
  fs.writeFileSync(path.resolve(__dirname, '..', 'evidence', 'restore-verification.json'), JSON.stringify(out, null, 2));
  console.log(`restore actions: ${results.length} · diff vs baseline: ${diffs.length} ${diffs.length ? '*** NOT CLEAN ***' : '(CLEAN)'}`);
  diffs.forEach((d) => console.log('  DIFF', JSON.stringify(d)));
  return out;
}

if (require.main === module) {
  const cmd = process.argv[2] || 'state';
  (async () => {
    if (cmd === 'prep') await prep();
    else if (cmd === 'restore') await restore();
    else console.log(JSON.stringify(await state(await token()), null, 2));
  })().catch((e) => { console.error('ERR', e.message); process.exit(1); });
}
