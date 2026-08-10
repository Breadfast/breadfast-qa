/**
 * B10-57776 — follow-up probe.
 *
 *  A. AC12 backwards-compat: which merchants does `is_breadfast` actually flag?
 *     (AC12 says "all existing Breadfast merchants default to the Breadfast logo and
 *      Breadfast coffee defaults to the Breadfast coffee logo" — that needs a definition
 *      of "Breadfast merchant", and the row already carries an `is_breadfast` boolean.)
 *  B. AC8/AC9 test data: which merchants are CONNECTED to a perk, by both plan paths —
 *     (1) branch assigned to a perk, (2) a branch MID in some perk's excluded_merchants_ids.
 *     We need at least one connected AND one unconnected merchant to test both branches.
 *  C. FE bundle coverage sanity — prove the chunk sweep really reads the perks module
 *     (control strings that MUST exist today) before trusting its zero-hits as "not deployed".
 *
 * Run: node B10-57776/automation/explore/probe-connection.js
 */
const fs = require('fs');
const path = require('path');

const cfg = require('../../../automation/config/environments/cardServiceConfigs_testing.js');
const BASE = cfg.cardServicesAdminPanelBaseURL;
const OUT = path.join(__dirname, 'connection-probe.json');
const P = '/api/v1/web/card/perks';

const out = {};

async function post(url, body, token) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(BASE + url, { method: 'POST', headers, body: JSON.stringify(body || {}) });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* */ }
  return { status: res.status, json, text: text.slice(0, 300) };
}

(async () => {
  const login = await post('/api/v1/web/user/login', {
    username: cfg.adminUserName, password: cfg.adminPassword,
  });
  const d = login.json.data || login.json;
  const token = d.token || d.accessToken;

  // ---- merchants ---------------------------------------------------------
  const ml = await post(`${P}/merchant/list`, { skip: 0, limit: 500 }, token);
  const merchants = (ml.json.data || []);
  out.merchantCount = merchants.length;
  out.isBreadfastTrue = merchants.filter((m) => m.is_breadfast === true)
    .map((m) => ({ id: m.id, name_en: m.name_en, name_ar: m.name_ar, branches: (m.merchantBranches || []).length }));
  out.isBreadfastFalseButNamedBreadfast = merchants
    .filter((m) => m.is_breadfast !== true && /breadfast/i.test(String(m.name_en || '')))
    .map((m) => ({ id: m.id, name_en: m.name_en, is_breadfast: m.is_breadfast }));
  out.legacyMerchantIdColumn = {
    nonNull: merchants.filter((m) => m.merchant_id != null).length,
    sample: merchants.filter((m) => m.merchant_id != null).slice(0, 5)
      .map((m) => ({ id: m.id, name_en: m.name_en, merchant_id: m.merchant_id })),
  };
  out.duplicateNameEn = Object.entries(
    merchants.reduce((a, m) => { const k = String(m.name_en || '').trim().toLowerCase(); a[k] = (a[k] || 0) + 1; return a; }, {}),
  ).filter(([, n]) => n > 1);

  // MID -> merchant map
  const midOwner = new Map();
  const branchIdOwner = new Map();
  merchants.forEach((m) => (m.merchantBranches || []).forEach((b) => {
    midOwner.set(String(b.mid), m);
    branchIdOwner.set(b.id, m);
  }));
  out.branchTotals = { branches: midOwner.size, distinctMids: new Set([...midOwner.keys()]).size };

  // ---- perks: both connection paths -------------------------------------
  const pl = await post(`${P}/list`, { skip: 0, limit: 500 }, token);
  const perks = (pl.json.data || []);
  out.perkCount = perks.length;

  // path 2: exclusion by MID
  const excludedMids = new Set();
  perks.forEach((p) => {
    const ex = (p.perk_attributes || {}).excluded_merchants_ids;
    if (Array.isArray(ex)) ex.forEach((x) => excludedMids.add(String(x)));
  });
  const connectedByExclusion = new Set();
  excludedMids.forEach((mid) => { const m = midOwner.get(mid); if (m) connectedByExclusion.add(m.id); });
  out.exclusionPath = {
    distinctExcludedMids: excludedMids.size,
    excludedMidsMatchingAKnownBranch: [...excludedMids].filter((m) => midOwner.has(m)).length,
    connectedMerchantIds: [...connectedByExclusion],
    connectedMerchants: [...connectedByExclusion].map((id) => {
      const m = merchants.find((x) => x.id === id); return { id, name_en: m && m.name_en };
    }),
  };

  // path 1: assignment — inspect perk_attributes for branch/merchant references
  const attrKeys = new Set();
  perks.forEach((p) => Object.keys(p.perk_attributes || {}).forEach((k) => attrKeys.add(k)));
  out.perkAttributeKeys = [...attrKeys];
  const mc = perks.filter((p) => p.type === 'merchant-cashback');
  out.merchantCashbackSample = mc.slice(0, 4).map((p) => ({
    id: p.id, title_en: p.title_en, status: p.status, perk_attributes: p.perk_attributes,
  }));

  // try the perk-detail endpoint — assignment usually only shows there
  if (mc.length) {
    for (const cand of ['/get', '/getById', '/details', '/show']) {
      const r = await post(`${P}${cand}`, { id: mc[0].id }, token);
      out.perkDetail = out.perkDetail || {};
      out.perkDetail[cand] = { status: r.status, sample: r.status === 200 ? JSON.stringify(r.json).slice(0, 1500) : r.text };
      if (r.status === 200) break;
    }
  }

  // ---- FE bundle coverage sanity ----------------------------------------
  const idx = await fetch(BASE, { headers: { 'user-agent': 'Mozilla/5.0' } });
  const html = await idx.text();
  let chunks = [...html.matchAll(/(?:src|href)="([^"]*?\.js)"/g)].map((m) => m[1]);
  const runtime = chunks.find((c) => /main|runtime/.test(c));
  if (runtime) {
    const rt = await (await fetch(`${BASE}/${runtime.replace(/^\//, '')}`)).text();
    chunks = chunks
      .concat([...rt.matchAll(/"([\w.-]+\.js)"/g)].map((m) => m[1]))
      .concat([...rt.matchAll(/(\d+):"([a-f0-9]+)"/g)].map((m) => `${m[1]}.${m[2]}.js`));
  }
  chunks = [...new Set(chunks)];

  const controls = {
    // MUST exist today — if these are 0 the sweep is not reading the perks code at all
    CONTROL_excludedMerchants: /excluded_merchants_ids/,
    CONTROL_perkWord: /general-cashback|merchant-cashback/,
    CONTROL_merchantWordAnywhere: /merchant/i,
    CONTROL_perkMerchantUrl: /perks\/merchant\/(list|create)/,
    // AC11 — the inline creation entry point that this story REMOVES
    AC11_inlineAddMerchantCopy: /Add\s*[Mm]erchant/,
    AC11_createMerchantDialog: /create-merchant-dialog|CreateMerchantDialog|createMerchant/,
    // AC1-AC10 — the new screens (expected ABSENT pre-dev)
    NEW_emptyStateCopy: /no merchants added yet/i,
    NEW_merchantsRoute: /perks\/merchants/,
    NEW_perms: /list_merchants|create_merchant|edit_merchant|delete_merchant/,
    NEW_dupError: /This merchant already exists/i,
    NEW_addedToast: /Merchant added successfully/i,
    NEW_delToast: /Merchant deleted successfully/i,
    NEW_confirmCopy: /delete this merchant/i,
    NEW_logoUpload: /merchant\/logo\/upload/,
    NEW_addedToPerk: /addedToPerk/,
    NEW_branchesCount: /branchesCount/,
  };
  const hits = {}; const where = {};
  Object.keys(controls).forEach((k) => { hits[k] = 0; where[k] = []; });
  let fetched = 0; let bytes = 0;
  for (const c of chunks) {
    const url = `${BASE}/${String(c).replace(/^\.?\//, '')}`;
    try {
      const r = await fetch(url);
      if (!r.ok) continue;
      const body = await r.text();
      fetched++; bytes += body.length;
      for (const [k, re] of Object.entries(controls)) {
        if (re.test(body)) { hits[k]++; if (where[k].length < 3) where[k].push(c); }
      }
    } catch { /* skip */ }
  }
  out.fe = { chunksDiscovered: chunks.length, chunksFetched: fetched, totalBytes: bytes, hits, where };

  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
  console.log(JSON.stringify({
    isBreadfastTrue: out.isBreadfastTrue,
    isBreadfastFalseButNamedBreadfast: out.isBreadfastFalseButNamedBreadfast,
    legacyMerchantIdColumn: out.legacyMerchantIdColumn,
    duplicateNameEn: out.duplicateNameEn,
    branchTotals: out.branchTotals,
    exclusionPath: out.exclusionPath,
    perkAttributeKeys: out.perkAttributeKeys,
    perkDetail: out.perkDetail && Object.fromEntries(Object.entries(out.perkDetail).map(([k, v]) => [k, v.status])),
    fe: out.fe,
  }, null, 2));
  console.log('\nfull ->', OUT);
})();
