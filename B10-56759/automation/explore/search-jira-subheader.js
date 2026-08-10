/**
 * Duplicate / history check for B10-58511: has the missing perk-subheader on the
 * Perk details screen ever been reported before?
 *
 * Searches B10 for any issue whose text mentions the subheader, and prints key,
 * type, status, created date and parent so a prior report cannot hide behind a
 * differently-worded summary.
 */
'use strict';
const creds = require('../../../automation/config/credentials.js');

const BASE = 'https://breadfast.atlassian.net';
const AUTH = creds.jira.authHeader();

const JQLS = [
  ['text ~ "subheader" ORDER BY created ASC', 'anything mentioning "subheader"'],
  ['text ~ "Perk subheader" ORDER BY created ASC', 'anything mentioning "Perk subheader"'],
  ['parent in (B10-56759, B10-56729, B10-56757, B10-57393) ORDER BY created ASC', 'all bugs under the perk-panel stories'],
];

async function search(jql) {
  const res = await fetch(`${BASE}/rest/api/3/search/jql`, {
    method: 'POST',
    headers: { Authorization: AUTH, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      jql: `project = B10 AND (${jql.replace(/ ORDER BY.*$/, '')}) ORDER BY created ASC`,
      maxResults: 60,
      fields: ['summary', 'issuetype', 'status', 'created', 'parent', 'resolution'],
    }),
  });
  if (!res.ok) return { error: `HTTP ${res.status} — ${(await res.text()).slice(0, 300)}` };
  return res.json();
}

(async () => {
  for (const [jql, label] of JQLS) {
    console.log(`\n=== ${label} ===`);
    const r = await search(jql);
    if (r.error) { console.log('  ', r.error); continue; }
    if (!r.issues || !r.issues.length) { console.log('   (no matches)'); continue; }
    for (const i of r.issues) {
      const f = i.fields;
      console.log(`   ${i.key.padEnd(11)} ${String(f.issuetype && f.issuetype.name).padEnd(9)} ${String(f.status && f.status.name).padEnd(14)} ${String(f.created).slice(0, 10)}  parent=${f.parent ? f.parent.key : '-'}`);
      console.log(`               ${f.summary}`);
    }
  }
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
