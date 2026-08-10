/**
 * B10-57774 — Phase 0 prerequisite probe (Admin Portal · Perks Nav re-structure).
 *
 * Answers, with real authenticated calls:
 *  1. Admin panel URL + credentials work.
 *  2. What permission Actions the admin account actually holds (AC1 sub-links are
 *     permission-gated per the dev comment "each with a separate permissions").
 *  3. Whether the four sub-screens' backing endpoints exist on testing today
 *     (positive + negative controls, so a 404 means "no such route" and not our own bad path).
 *  4. Whether the deployed FE bundle already contains the nav re-structure.
 *  5. Test-data volumes behind Perks / Merchants / Categories / Mobile sections.
 *
 * Run: node B10-57774/automation/explore/probe-prereq.js
 */
const fs = require('fs');
const path = require('path');

const cfg = require('../../../automation/config/environments/cardServiceConfigs_testing.js');
const BASE = cfg.cardServicesAdminPanelBaseURL;
const OUT = path.join(__dirname, 'prereq-probe.json');

const report = { base: BASE, login: null, actions: null, routes: {}, fe: null, data: {} };

async function post(url, body, token) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body || {}) });
  let json = null;
  const text = await res.text();
  try { json = JSON.parse(text); } catch { /* non-JSON */ }
  return { status: res.status, json, text: text.slice(0, 400) };
}

(async () => {
  // --- 1. login -------------------------------------------------------------
  const login = await post(`${BASE}/api/v1/web/user/login`, {
    username: cfg.adminUserName, password: cfg.adminPassword,
  });
  report.login = { status: login.status, ok: login.status === 200 };
  if (login.status !== 200) {
    console.log('LOGIN FAILED', login.status, login.text);
    fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
    return;
  }
  const d = login.json.data || login.json;
  const token = d.token || d.accessToken || d.access_token;
  report.login.roleName = d.roleName || d.role?.name;
  report.login.roleId = d.roleId ?? d.role?.id;

  // --- 2. permission action map -------------------------------------------
  const actions = d.actions || d.permissions || {};
  const flat = JSON.stringify(actions);
  const keys = [];
  (function walk(o, p) {
    if (!o || typeof o !== 'object') return;
    for (const [k, v] of Object.entries(o)) {
      keys.push(p ? `${p}.${k}` : k);
      if (v && typeof v === 'object') walk(v, p ? `${p}.${k}` : k);
    }
  })(actions, '');
  report.actions = {
    totalKeys: keys.length,
    perkRelated: keys.filter((k) => /perk/i.test(k)),
    merchantRelated: keys.filter((k) => /merchant/i.test(k)),
    sectionRelated: keys.filter((k) => /section/i.test(k)),
    categoryRelated: keys.filter((k) => /categor/i.test(k)),
    mobileRelated: keys.filter((k) => /mobile/i.test(k)),
    allKeysSample: keys.slice(0, 400),
  };
  fs.writeFileSync(path.join(__dirname, 'action-map.json'), JSON.stringify(actions, null, 2));

  // --- 3. backing endpoints, with controls ---------------------------------
  const A = `${BASE}/api/v1/web`;
  const probes = {
    'POST perks/list (positive control)':        [`${A}/card/perks/list`, { skip: 0, limit: 1 }],
    'POST perks/definitelyNotARoute (neg ctrl)': [`${A}/card/perks/definitelyNotARoute`, {}],
    'POST perks/section/list':                  [`${A}/card/perks/section/list`, {}],
    'POST perks/merchant/list':                 [`${A}/card/perks/merchant/list`, {}],
    'POST card/merchants/list':                 [`${A}/card/merchants/list`, {}],
    'POST perks/category/list':                 [`${A}/card/perks/category/list`, {}],
    'POST perks/mobile-section/list':           [`${A}/card/perks/mobile-section/list`, {}],
    'POST perks/mobileSection/list':            [`${A}/card/perks/mobileSection/list`, {}],
    'POST perks/homepage/list':                 [`${A}/card/perks/homepage/list`, {}],
  };
  for (const [label, [url, body]] of Object.entries(probes)) {
    const r = await post(url, body, token);
    const rows = r.json?.data?.rows || r.json?.data?.data || r.json?.data;
    report.routes[label] = {
      status: r.status,
      count: Array.isArray(rows) ? rows.length : (rows?.count ?? null),
      total: r.json?.data?.count ?? r.json?.count ?? null,
      snippet: r.status === 200 ? undefined : r.text.slice(0, 160),
    };
    console.log(String(r.status).padEnd(4), label, report.routes[label].total ?? '');
  }

  // --- 4. deployed FE bundle: is the nav re-structure live? ----------------
  const idx = await fetch(BASE).then((r) => r.text());
  const assetRefs = [...idx.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)].map((m) => m[1]);
  const entry = assetRefs.filter((a) => a.endsWith('.js'));
  const NAV_PATTERNS = [
    /Mobile\s*sections?/i, /mobile[-_]sections?/i, /Merchants?/, /Categories/,
    /list_merchants?/i, /list_categor/i, /manage_merchant/i, /perks\/merchants?/i,
    /perks\/categories/i, /perks\/mobile/i, /Card\s*perks/i,
  ];
  const feHits = {};
  const chunkUrls = new Set(entry.map((e) => new URL(e, BASE).href));
  for (const u of [...chunkUrls]) {
    const t = await fetch(u).then((r) => (r.ok ? r.text() : ''));
    // discover lazy chunks referenced from the entry bundle
    for (const m of t.matchAll(/["'`](\/?(?:assets|static)\/[\w./-]+\.js)["'`]/g)) {
      chunkUrls.add(new URL(m[1], BASE).href);
    }
    for (const p of NAV_PATTERNS) if (p.test(t)) (feHits[p.source] ||= []).push(u.split('/').pop());
  }
  report.fe = { entryAssets: entry, chunksScanned: chunkUrls.size, hits: feHits };

  // --- 5. test data volumes ------------------------------------------------
  const perks = await post(`${A}/card/perks/list`, { skip: 0, limit: 1 }, token);
  report.data.perksTotal = perks.json?.data?.count ?? null;
  const sections = await post(`${A}/card/perks/section/list`, {}, token);
  const secRows = sections.json?.data?.rows || sections.json?.data || [];
  report.data.sections = Array.isArray(secRows)
    ? secRows.map((s) => ({ id: s.id, name_en: s.name_en, is_active: s.is_active }))
    : secRows;

  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log('\nwrote', OUT);
  console.log('actions →', JSON.stringify({
    perk: report.actions.perkRelated, merchant: report.actions.merchantRelated,
    section: report.actions.sectionRelated, category: report.actions.categoryRelated,
    mobile: report.actions.mobileRelated,
  }, null, 2));
  console.log('FE hits →', JSON.stringify(feHits, null, 2));
})();
