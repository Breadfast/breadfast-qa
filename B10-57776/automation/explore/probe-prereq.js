/**
 * B10-57776 — Phase 0 prerequisite probe (Admin Portal · Merchant Management).
 *
 * Answers, with real authenticated calls:
 *  1. Admin panel URL + credentials work.
 *  2. Which permission Actions the admin account holds (the plan seeds new
 *     list_merchants / create_merchant / edit_merchant / delete_merchant keys — AC1 nav gating).
 *  3. Whether the NEW merchant endpoints exist on testing today
 *     (get / update / delete / logo-upload), with positive + negative controls so a
 *     404 means "no such route" and not our own wrong path.
 *  4. Whether the EXISTING list/create contract already carries the additive fields
 *     (logo_en, logo_ar, branchesCount, addedToPerk) that AC2 renders.
 *  5. Test data: how many merchants exist, how many have branches, how many are
 *     connected to a perk (AC8/AC9 need BOTH a connected and an unconnected merchant).
 *  6. Whether the deployed FE bundle contains the Merchants screens (AC1) and whether
 *     the perk form still has the inline "Add merchant" entry point (AC11).
 *
 * Run: node B10-57776/automation/explore/probe-prereq.js
 */
const fs = require('fs');
const path = require('path');

const cfg = require('../../../automation/config/environments/cardServiceConfigs_testing.js');
const BASE = cfg.cardServicesAdminPanelBaseURL;
const OUT = path.join(__dirname, 'prereq-probe.json');

const report = { base: BASE, login: null, actions: null, routes: {}, listContract: null, data: {}, fe: null };

async function post(url, body, token) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body || {}) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-JSON */ }
  return { status: res.status, json, text: text.slice(0, 300) };
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
  report.login.roleName = d.roleName || (d.role && d.role.name);
  report.login.roleId = d.roleId != null ? d.roleId : (d.role && d.role.id);

  // --- 2. permission action map -------------------------------------------
  const actions = d.actions || d.permissions || {};
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
    merchantRelated: keys.filter((k) => /merchant/i.test(k)),
    branchRelated: keys.filter((k) => /branch/i.test(k)),
    logoRelated: keys.filter((k) => /logo|media|upload/i.test(k)),
    perkRelated: keys.filter((k) => /perk/i.test(k)),
  };

  // --- 3. route existence -------------------------------------------------
  const P = '/api/v1/web/card/perks';
  const probes = {
    'merchant/list  (existing)': [`${P}/merchant/list`, { skip: 0, limit: 5 }],
    'merchant/get   (NEW AC7/8)': [`${P}/merchant/get`, { id: 1 }],
    'merchant/update(NEW AC9)': [`${P}/merchant/update`, { id: 1 }],
    'merchant/delete(NEW AC10)': [`${P}/merchant/delete`, { id: 999999 }],
    'merchant/logo/upload (NEW AC4)': [`${P}/merchant/logo/upload`, {}],
    'merchant/create(existing)': [`${P}/merchant/create`, {}],
    'perks/list  (+control)': [`${P}/list`, { skip: 0, limit: 1 }],
    'merchant/definitelyNotARoute (-control)': [`${P}/merchant/definitelyNotARoute`, {}],
  };
  for (const [label, [url, body]] of Object.entries(probes)) {
    const r = await post(BASE + url, body, token);
    report.routes[label] = { status: r.status, body: r.text };
  }

  // --- 4. existing list contract + 5. test data ---------------------------
  const ml = await post(`${BASE}${P}/merchant/list`, { skip: 0, limit: 500 }, token);
  if (ml.status === 200) {
    const payload = ml.json && (ml.json.data || ml.json);
    const rows = Array.isArray(payload) ? payload
      : (payload && (payload.rows || payload.merchants || payload.result)) || [];
    const total = (payload && (payload.count ?? payload.total)) ?? rows.length;
    report.listContract = {
      total,
      returned: rows.length,
      fieldsOnRow: rows[0] ? Object.keys(rows[0]) : [],
      sampleRow: rows[0] || null,
      hasLogoEn: rows.some((r) => 'logo_en' in r),
      hasLogoAr: rows.some((r) => 'logo_ar' in r),
      hasBranchesCount: rows.some((r) => 'branchesCount' in r),
      hasAddedToPerk: rows.some((r) => 'addedToPerk' in r),
    };
    const branchKey = rows[0] && ['merchantBranches', 'branches', 'merchant_branches']
      .find((k) => k in rows[0]);
    report.data.merchants = {
      total,
      branchKey: branchKey || null,
      withBranches: branchKey ? rows.filter((r) => (r[branchKey] || []).length > 0).length : null,
      zeroBranches: branchKey ? rows.filter((r) => (r[branchKey] || []).length === 0).length : null,
      totalBranches: branchKey
        ? rows.reduce((n, r) => n + (r[branchKey] || []).length, 0) : null,
      addedToPerkTrue: rows.filter((r) => r.addedToPerk === true).length,
      addedToPerkFalse: rows.filter((r) => r.addedToPerk === false).length,
      names: rows.slice(0, 40).map((r) => ({
        id: r.id,
        name_en: r.name_en,
        name_ar: r.name_ar,
        branches: branchKey ? (r[branchKey] || []).length : null,
        logo_en: r.logo_en || null,
        addedToPerk: r.addedToPerk,
      })),
      breadfastDefaults: rows
        .filter((r) => /breadfast/i.test(String(r.name_en || '')))
        .map((r) => ({ id: r.id, name_en: r.name_en, logo_en: r.logo_en || null, logo_ar: r.logo_ar || null })),
    };
  } else {
    report.listContract = { error: ml.status, body: ml.text };
  }

  // --- perk↔branch connection ground truth (AC8/AC9) ----------------------
  const pl = await post(`${BASE}${P}/list`, { skip: 0, limit: 500 }, token);
  if (pl.status === 200) {
    const pp = pl.json && (pl.json.data || pl.json);
    const perks = Array.isArray(pp) ? pp : (pp && (pp.rows || pp.perks)) || [];
    const excluded = new Set();
    let withExclusions = 0;
    perks.forEach((p) => {
      const ex = p.perk_attributes && p.perk_attributes.excluded_merchants_ids;
      if (Array.isArray(ex) && ex.length) { withExclusions++; ex.forEach((m) => excluded.add(String(m))); }
    });
    report.data.perks = {
      total: (pp && (pp.count ?? pp.total)) ?? perks.length,
      returned: perks.length,
      withExcludedMerchants: withExclusions,
      distinctExcludedMids: [...excluded].slice(0, 40),
      distinctExcludedMidCount: excluded.size,
      merchantCashbackCount: perks.filter((p) => p.type === 'merchant-cashback').length,
    };
  } else {
    report.data.perks = { error: pl.status, body: pl.text };
  }

  // --- 6. deployed FE bundle ---------------------------------------------
  try {
    const idx = await fetch(BASE, { headers: { 'user-agent': 'Mozilla/5.0' } });
    const html = await idx.text();
    const chunks = [...html.matchAll(/(?:src|href)="([^"]*?\.js)"/g)].map((m) => m[1]);
    const runtime = chunks.find((c) => /main|runtime/.test(c));
    let all = [...chunks];
    if (runtime) {
      const rt = await (await fetch(`${BASE}/${runtime.replace(/^\//, '')}`)).text();
      all = all.concat([...rt.matchAll(/"([\w.-]+\.js)"/g)].map((m) => m[1]));
      all = all.concat([...rt.matchAll(/(\d+):"([a-z0-9]+)"/g)].map((m) => `${m[1]}.${m[2]}.js`));
    }
    all = [...new Set(all)];
    const needles = {
      merchantsScreen: /There are no merchants added yet/i,
      addMerchantCta: /Add merchant/i,
      merchantsRoute: /perks\/merchants/i,
      listMerchantsPerm: /list_merchants|create_merchant|edit_merchant|delete_merchant/,
      merchantAlreadyExists: /This merchant already exists/i,
      merchantAddedToast: /Merchant added successfully/i,
      merchantDeletedToast: /Merchant deleted successfully/i,
      deleteConfirmCopy: /Are you sure you want to delete this merchant/i,
      logoUploadUrl: /merchant\/logo\/upload/i,
      inlineCreateDialogAC11: /create-merchant-dialog|CreateMerchantDialog/i,
      addedToPerkCol: /addedToPerk/,
    };
    const hits = {}; Object.keys(needles).forEach((k) => { hits[k] = 0; });
    let fetched = 0;
    for (const c of all) {
      const url = `${BASE}/${String(c).replace(/^\.?\//, '')}`;
      try {
        const r = await fetch(url);
        if (!r.ok) continue;
        const body = await r.text();
        fetched++;
        for (const [k, re] of Object.entries(needles)) if (re.test(body)) hits[k]++;
      } catch { /* skip */ }
    }
    report.fe = { chunksDiscovered: all.length, chunksFetched: fetched, hits };
  } catch (e) {
    report.fe = { error: String(e).slice(0, 200) };
  }

  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({
    login: report.login,
    actions: report.actions,
    routes: report.routes,
    listContract: report.listContract && {
      total: report.listContract.total,
      fieldsOnRow: report.listContract.fieldsOnRow,
      hasLogoEn: report.listContract.hasLogoEn,
      hasLogoAr: report.listContract.hasLogoAr,
      hasBranchesCount: report.listContract.hasBranchesCount,
      hasAddedToPerk: report.listContract.hasAddedToPerk,
    },
    merchants: report.data.merchants && {
      total: report.data.merchants.total,
      branchKey: report.data.merchants.branchKey,
      withBranches: report.data.merchants.withBranches,
      zeroBranches: report.data.merchants.zeroBranches,
      totalBranches: report.data.merchants.totalBranches,
      addedToPerkTrue: report.data.merchants.addedToPerkTrue,
      breadfastDefaults: report.data.merchants.breadfastDefaults,
    },
    perks: report.data.perks,
    fe: report.fe,
  }, null, 2));
  console.log('\nfull report ->', OUT);
})();
