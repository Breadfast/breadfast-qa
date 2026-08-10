/**
 * Was the subheader actually SAVED for DC_25?
 *
 * Severity hinges on this: if the backend holds subheader_en/_ar but the details and
 * edit screens do not render the field, the value is stranded (visible in the app,
 * uneditable in the panel). If the backend is empty, the create form discarded it.
 */
'use strict';
const { request } = require('playwright');

const BASE = 'https://card-panel-testing.breadfast.tech';

(async () => {
  const ctx = await request.newContext({ baseURL: BASE, ignoreHTTPSErrors: true });

  const login = await ctx.post('/api/v1/web/user/login', {
    data: { username: 'agent', password: 'Admin@123456789' },
  });
  console.log('login', login.status());
  const lb = await login.json().catch(async () => ({ raw: await login.text() }));
  const token = lb.token || (lb.data && lb.data.token);
  if (!token) { console.log('no token:', JSON.stringify(lb).slice(0, 800)); process.exit(1); }

  const list = await ctx.post('/api/v1/web/card/perks/list', {
    headers: { Authorization: `Bearer ${token}` },
    data: { skip: 1, filter: {} },
  });
  console.log('list', list.status());
  const body = await list.json();
  const arr = body.data || body.perks || body.result || body;
  const perks = Array.isArray(arr) ? arr : (arr.data || arr.perks || []);
  console.log('perks returned:', perks.length);

  const target = perks.find(p => JSON.stringify(p).includes('DC_25'));
  if (!target) {
    console.log('DC_25 not in page 1; keys of first perk:', Object.keys(perks[0] || {}).join(','));
    process.exit(0);
  }
  console.log('\n=== DC_25 as stored ===');
  for (const [k, v] of Object.entries(target)) {
    if (typeof v === 'object' && v !== null) continue;
    console.log(`  ${k} = ${JSON.stringify(v)}`);
  }
  console.log('\n=== DC_25 perk_attributes (where subheader_en/_ar live) ===');
  console.log(JSON.stringify(target.perk_attributes, null, 2));

  const sub = (p) => (p.perk_attributes || {});
  console.log('\nDC_25 subheader_en =', JSON.stringify(sub(target).subheader_en));
  console.log('DC_25 subheader_ar =', JSON.stringify(sub(target).subheader_ar));

  const withSub = perks.filter(p => sub(p).subheader_en).map(p => `${p.id}="${sub(p).subheader_en}"`);
  console.log('\nperks on page 1 that DO hold a subheader_en:', withSub.length);
  withSub.slice(0, 15).forEach(s => console.log('   ', s));
  await ctx.dispose();
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
