/**
 * B10-57774 — is the nav re-structure in the DEPLOYED Angular bundle?
 *
 * The panel is Angular with one monolithic `main-es2018.*.js` plus root-level lazy
 * chunks (`<n>-es2018.<hash>.js`), which the generic prereq probe did not walk.
 * This pulls main + every lazy chunk the runtime knows about and extracts:
 *   - the sidebar nav item definitions (label / route / permission key)
 *   - every route path containing "perk"
 *   - every permission-action string literal
 *
 * Run: node B10-57774/automation/explore/probe-fe-nav.js
 */
const fs = require('fs');
const path = require('path');
const cfg = require('../../../automation/config/environments/cardServiceConfigs_testing.js');
const BASE = cfg.cardServicesAdminPanelBaseURL;
const DIR = __dirname;

(async () => {
  const idx = await fetch(BASE).then((r) => r.text());
  const entry = [...idx.matchAll(/(?:src|href)="([^"]+\.js)"/g)].map((m) => new URL(m[1], BASE).href);
  const runtime = entry.find((u) => /runtime-es2018/.test(u));
  const main = entry.find((u) => /main-es2018/.test(u));

  // Angular runtime holds the lazy-chunk id→hash map.
  const rt = await fetch(runtime).then((r) => r.text());
  const hashMap = {};
  for (const m of rt.matchAll(/(\d+):"([0-9a-f]{16,32})"/g)) hashMap[m[1]] = m[2];
  const lazy = Object.entries(hashMap).map(([id, h]) => `${BASE}/${id}-es2018.${h}.js`);

  const bundles = [main, ...lazy];
  const all = [];
  for (const u of bundles) {
    const res = await fetch(u);
    if (!res.ok) { all.push({ u, status: res.status, text: '' }); continue; }
    all.push({ u, status: 200, text: await res.text() });
  }
  const ok = all.filter((b) => b.status === 200);
  console.log(`bundles: main + ${lazy.length} lazy → ${ok.length} fetched OK`);

  const joined = ok.map((b) => b.text).join('\n/*CHUNK*/\n');
  fs.writeFileSync(path.join(DIR, 'fe-bundle.txt'), joined);

  const find = (re) => [...new Set([...joined.matchAll(re)].map((m) => m[0]))];

  const out = {
    bundlesFetched: ok.map((b) => b.u.split('/').pop()),
    bundlesFailed: all.filter((b) => b.status !== 200).map((b) => `${b.status} ${b.u.split('/').pop()}`),
    navLabels: find(/["'`](?:Card ?perks|Perks|Merchants?|Categories|Category|Mobile ?sections?|Mobile ?Section)["'`]/gi),
    perkRoutes: find(/["'`][\w/-]*perks?[\w/-]*["'`]/gi).filter((s) => s.includes('/')),
    merchantRoutes: find(/["'`][\w/-]*merchant[\w/-]*["'`]/gi),
    categoryRoutes: find(/["'`][\w/-]*categor[\w/-]*["'`]/gi),
    mobileSectionRoutes: find(/["'`][\w/-]*mobile[-_]?section[\w/-]*["'`]/gi),
    sectionRoutes: find(/["'`][\w/-]*section[\w/-]*["'`]/gi).filter((s) => s.length < 40),
    permissionLiterals: find(/["'`](?:list|create|update|delete|manage|view)_[a-z_]+["'`]/gi),
    // nav tree shape: look for an object literal carrying both a label and children
    navChildrenSnippets: [...joined.matchAll(/.{240}(?:submenu|children|subItems|subMenu)\s*:\s*\[.{600}/gi)]
      .slice(0, 6).map((m) => m[0]),
  };
  fs.writeFileSync(path.join(DIR, 'fe-nav.json'), JSON.stringify(out, null, 2));

  for (const k of ['navLabels', 'perkRoutes', 'merchantRoutes', 'categoryRoutes',
    'mobileSectionRoutes', 'sectionRoutes', 'permissionLiterals']) {
    console.log(`\n### ${k} (${out[k].length})\n` + out[k].slice(0, 60).join(' '));
  }
  console.log('\nwrote fe-nav.json + fe-bundle.txt');
})();
