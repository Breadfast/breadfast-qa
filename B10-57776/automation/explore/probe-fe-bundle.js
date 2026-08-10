/**
 * B10-57776 — FE bundle sweep (corrected).
 *
 * The first sweep's controls came back ZERO (`excluded_merchants_ids`, `merchant-cashback`),
 * which proved it never read the perks lazy chunk — its chunk-name regex was wrong.
 * Angular names lazy chunks `<id>-es2018.<hash>.js` (with 592 -> `common`), taken from the
 * runtime's `t.u` map. A negative here only counts once the CONTROLs are non-zero.
 *
 * Run: node B10-57776/automation/explore/probe-fe-bundle.js
 */
const fs = require('fs');
const path = require('path');

const cfg = require('../../../automation/config/environments/cardServiceConfigs_testing.js');
const BASE = cfg.cardServicesAdminPanelBaseURL;
const OUT = path.join(__dirname, 'fe-bundle-probe.json');

const NEEDLES = {
  // ---- CONTROLS: must be > 0 or the sweep is not reading the perks feature code ----
  CONTROL_excludedMerchantsIds: /excluded_merchants_ids/,
  CONTROL_perkTypes: /merchant-cashback/,
  CONTROL_perkMerchantListUrl: /perks\/merchant\/list/,
  CONTROL_perkMerchantCreateUrl: /perks\/merchant\/create/,
  // ---- AC11: the inline merchant creation this story REMOVES (expected PRESENT pre-dev) ----
  AC11_addMerchantCopy: /Add\s+[Mm]erchant/,
  AC11_createMerchantDialogSelector: /app-create-merchant-dialog|create-merchant-dialog/,
  AC11_createMerchantMethod: /createMerchant/,
  AC11_duplicateMidValidator: /duplicateMid|dynamicUniqueMids/,
  // ---- AC1-AC10: the new Merchants screens (expected ABSENT pre-dev) ----
  NEW_emptyStateCopy: /no merchants added yet/i,
  NEW_merchantsRoute: /perks\/merchants|['"]merchants['"]/,
  NEW_permKeys: /list_merchants|create_merchant|edit_merchant|delete_merchant/,
  NEW_dupNameError: /This merchant already exists/i,
  NEW_addedToast: /Merchant added successfully/i,
  NEW_updatedToast: /Merchant updated successfully/i,
  NEW_deletedToast: /Merchant deleted successfully/i,
  NEW_deleteConfirmCopy: /delete this merchant/i,
  NEW_logoUploadUrl: /merchant\/logo\/upload/,
  NEW_merchantGetUrl: /perks\/merchant\/get/,
  NEW_merchantUpdateUrl: /perks\/merchant\/update/,
  NEW_merchantDeleteUrl: /perks\/merchant\/delete/,
  NEW_addedToPerkField: /addedToPerk/,
  NEW_branchesCountField: /branchesCount/,
  NEW_logoEnField: /logo_en/,
  NEW_navDropdown: /appNavDropdown|navDropdown/,
};

(async () => {
  const html = await (await fetch(BASE, { headers: { 'user-agent': 'Mozilla/5.0' } })).text();
  const eager = [...html.matchAll(/<script[^>]+src="([^"]+\.js)"/g)].map((m) => m[1]);

  // build the lazy-chunk list from the runtime's t.u map
  const rtName = eager.find((s) => /runtime-es2018/.test(s));
  const rt = await (await fetch(`${BASE}/${rtName}`)).text();
  const mapSrc = rt.match(/t\.u=function\(e\)\{return\((\d+)===e\?"([^"]+)":e\)\+"(-es2018\.)"\+(\{[^}]+\})\[e\]/);
  const lazy = [];
  if (mapSrc) {
    const specialId = mapSrc[1]; const specialName = mapSrc[2]; const infix = mapSrc[3];
    const entries = [...mapSrc[4].matchAll(/(\d+):"([a-f0-9]+)"/g)];
    entries.forEach(([, id, hash]) => {
      lazy.push(`${id === specialId ? specialName : id}${infix}${hash}.js`);
    });
  }
  const all = [...new Set([...eager.filter((e) => !/-es5\./.test(e)), ...lazy])];

  const hits = {}; const where = {};
  Object.keys(NEEDLES).forEach((k) => { hits[k] = 0; where[k] = []; });
  const perChunk = {};
  let fetched = 0; let bytes = 0; const failed = [];

  for (const c of all) {
    const url = `${BASE}/${c.replace(/^\.?\//, '')}`;
    try {
      const r = await fetch(url);
      if (!r.ok) { failed.push(`${c} -> ${r.status}`); continue; }
      const body = await r.text();
      fetched++; bytes += body.length;
      const local = [];
      for (const [k, re] of Object.entries(NEEDLES)) {
        if (re.test(body)) { hits[k]++; if (where[k].length < 4) where[k].push(c); local.push(k); }
      }
      if (local.length) perChunk[c] = { size: body.length, matched: local };
    } catch (e) { failed.push(`${c} -> ${String(e).slice(0, 60)}`); }
  }

  const controlsOk = Object.entries(hits)
    .filter(([k]) => k.startsWith('CONTROL_')).every(([, v]) => v > 0);

  const out = {
    base: BASE,
    eagerScripts: eager,
    lazyChunksFromRuntimeMap: lazy.length,
    chunksSwept: all.length,
    chunksFetched: fetched,
    totalBytes: bytes,
    failed,
    controlsOk,
    hits,
    where,
    perChunk,
  };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));

  console.log(`swept ${fetched}/${all.length} chunks, ${(bytes / 1e6).toFixed(2)} MB`);
  console.log(`CONTROLS OK: ${controlsOk}  <-- negatives below are only trustworthy if true`);
  console.log('');
  const pad = (s) => s.padEnd(34);
  for (const [k, v] of Object.entries(hits)) {
    console.log(`  ${v > 0 ? 'HIT ' : '--- '} ${pad(k)} ${v}  ${where[k].slice(0, 2).join(' ')}`);
  }
  if (failed.length) console.log('\nfailed:', failed.slice(0, 10));
  console.log('\nfull ->', OUT);
})();
