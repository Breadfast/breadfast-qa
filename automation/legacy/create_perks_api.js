'use strict';

/**
 * Standalone runner — create general-cashback perks via the Card Admin Panel API.
 *
 * Creates three perks named "api created perk" covering the MID-exclusion boundary
 * (B10-55168 — capacity increased from 60 to 200):
 *   1. "api created perk - 199 MIDs"  → less than 200  → expected 200 OK (accepted)
 *   2. "api created perk - 200 MIDs"  → exactly 200    → expected 200 OK (accepted, max)
 *   3. "api created perk - 201 MIDs"  → more than 200  → expected 4xx  (rejected)
 *
 * Run:  node create_perks_api.js
 */

const { request } = require('@playwright/test');
const ApiHelper   = require('../helpers/ApiHelper');

async function main() {
  const ctx   = await request.newContext();
  const token = await ApiHelper.loginAndGetToken(ctx);
  console.log('✓ Logged in, token acquired.\n');

  const scenarios = [
    { label: 'less than 200', count: 199, offset: 100,  title: 'api created perk - 199 MIDs', expect: 'accepted' },
    { label: 'exactly 200',   count: 200, offset: 400,  title: 'api created perk - 200 MIDs', expect: 'accepted' },
    { label: 'more than 200', count: 201, offset: 800,  title: 'api created perk - 201 MIDs', expect: 'rejected' },
  ];

  for (const s of scenarios) {
    const ids  = ApiHelper.buildMerchantIds(s.count, s.offset);
    const resp = await ApiHelper.createGeneralCashbackPerk(
      ctx, token, ids, 5, 'percentage', 1, s.title
    );
    const status = resp.status();
    const ok     = status === 200;
    const body   = await resp.text();

    let createdId = '';
    if (ok) {
      try {
        const j = JSON.parse(body);
        createdId = j.id ?? j.data?.id ?? j.perk?.id ?? '';
      } catch { /* non-JSON body */ }
    }

    const verdict =
      (s.expect === 'accepted' && ok) || (s.expect === 'rejected' && !ok)
        ? '✓ AS EXPECTED'
        : '✗ UNEXPECTED';

    console.log(`[${s.label}] "${s.title}"`);
    console.log(`   ${s.count} MIDs → HTTP ${status}  (${s.expect})  ${verdict}`);
    if (createdId) console.log(`   created perk id: ${createdId}`);
    if (!ok)       console.log(`   response: ${body.slice(0, 300)}`);
    console.log('');
  }

  await ctx.dispose();
}

main().catch(e => { console.error(e); process.exit(1); });
