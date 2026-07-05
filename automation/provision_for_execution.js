'use strict';

/**
 * Provision (or tear down) a card user for live QA-platform execution, printing
 * ONE machine-readable line the worker parses: `__PROVISIONED__{json}`.
 *
 * Usage:
 *   node provision_for_execution.js <target>          target = registered | ready | received  (default: ready)
 *   node provision_for_execution.js destroy <phone>
 *
 * Targets:
 *   registered — generate phone + apply for card via API → status "Registered" (no card assigned).
 *   ready      — registered + full Arabic KYC + a card package claimed from the pool, but NOT collected.
 *                This is the state the "Card Collected" agent action needs (e.g. B10-56337 Print-KYC):
 *                the customer is ready to collect so Popup 1 / Popup 2 are reachable.
 *   received   — provisioned all the way through collection (status "Received").
 *
 * Runs against the LIVE testing card service. API steps (provision/editKyc/claimCardFromPool)
 * are reliable; DB teardown goes over the SSH bastion and can time out — callers treat it best-effort.
 * Deps (mysql2/ssh2/properties-reader) resolve via NODE_PATH set to b55168_pom/node_modules.
 */
const CardUserFactory = require('./helpers/CardUserFactory');

async function provision(target) {
  const f = new CardUserFactory();
  if (target === 'registered') {
    const u = await f.provision();
    return { ...u, status: 'Registered' };
  }
  if (target === 'received') {
    return await f.provisionToReceived();
  }
  // ready (pre-collection): provision → KYC → claim package, STOP before collect.
  const base = await f.provision();
  const token = await f._getCardServiceToken();
  await f.editKyc(base.searchMobile, base.nationalId, token);
  const { packageNumber, bcid } = await f.claimCardFromPool(token);
  return { ...base, packageNumber, bcid, status: 'ReadyToCollect' };
}

(async () => {
  const arg = (process.argv[2] || 'ready').toLowerCase();
  if (arg === 'destroy') {
    const phone = process.argv[3];
    if (!phone) { console.error('destroy requires <phone>'); process.exit(2); }
    const f = new CardUserFactory();
    const r = await f.destroy(phone);
    console.log('__TEARDOWN__' + JSON.stringify({ phone, affectedRows: (r && r.affectedRows) || 0 }));
    process.exit(0);
  }
  const u = await provision(arg);
  // Trim to the identity the execution agent needs (avoid leaking tokens/secrets).
  const out = {
    phone: u.phone, searchMobile: u.searchMobile, breadfastId: u.breadfastId,
    nationalId: u.nationalId, firstName: u.firstName, lastName: u.lastName,
    packageNumber: u.packageNumber || null, bcid: u.bcid || null, status: u.status,
  };
  console.log('__PROVISIONED__' + JSON.stringify(out));
  process.exit(0);
})().catch((e) => { console.error('PROVISION_FAILED: ' + (e && e.message ? e.message : e)); process.exit(1); });
