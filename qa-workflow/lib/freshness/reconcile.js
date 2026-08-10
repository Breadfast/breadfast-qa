'use strict';

/**
 * The Reconcile freshness engine.
 * Implements docs/ai/architecture/qa-artifact-contract.md §5.
 * Pure function over a qa-state object + live source fingerprints; no I/O of its own
 * (file checks are injected via `io`), so it is fully unit-testable.
 */
const { DAG, baselineFor, topoOrder } = require('./dag');
const { fingerprintFigma } = require('./fingerprint');

function splitGen(g) {
  const i = String(g).lastIndexOf('@');
  return i < 0 ? [String(g), '0.0'] : [String(g).slice(0, i), String(g).slice(i + 1)];
}
function cmpVer(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

/**
 * @param {object} qaState  parsed qa-state.json ({ sources, artifacts, domains })
 * @param {object} live     { jira: (string|{hash}), figma: (string|object), domains: {id:{version,checksum}} }
 * @param {object} io       { exists(relPath)->bool, checksum(relPath)->string|null }
 * @param {object} [opts]   { expected?:string[], generators?:{key:'name@x.y'}, materiality?:(key)=>bool }
 * @returns {{reuse:string[], stale:string[], modified:Array<{key,newChecksum}>, conflicts:Array<{key,reasons}>, reasons:object, sourceChanged:{jira:boolean,figma:boolean}}}
 */
function reconcile(qaState, live, io, opts = {}) {
  qaState = qaState || {};
  live = live || {};
  const artifacts = qaState.artifacts || {};
  // Default = the required baseline + whichever conditional artifacts this story produced.
  const expected = opts.expected || baselineFor(artifacts);
  const generators = opts.generators || {};
  const materiality = opts.materiality;

  const liveJiraHash = typeof live.jira === 'string' ? live.jira : (live.jira && live.jira.hash) || null;
  const liveFigmaFp = typeof live.figma === 'string' ? live.figma : (live.figma ? fingerprintFigma(live.figma) : null);
  const sourceLive = { jira: liveJiraHash, figma: liveFigmaFp };
  const liveDomains = live.domains || {};
  const storedDomains = qaState.domains || {};

  const sourceChanged = {
    jira: liveJiraHash != null && !!(qaState.sources && qaState.sources.jira) && qaState.sources.jira.hash !== liveJiraHash,
    figma: liveFigmaFp != null && !!(qaState.sources && qaState.sources.figma) && fingerprintFigma(qaState.sources.figma) !== liveFigmaFp,
  };

  const domainChanged = (id) => {
    const l = liveDomains[id], s = storedDomains[id];
    if (!l || !s) return false;
    return (l.checksum || l.version) !== (s.checksum || s.version);
  };

  // Per-artifact source-change (compares the artifact's own provenance, not the global snapshot).
  const srcReasons = (rec, key) => {
    const out = [];
    for (const s of (DAG[key] ? DAG[key].sources : [])) {
      const liveFp = sourceLive[s];
      if (liveFp == null) continue; // can't compare → skip
      const stored = rec.derivedFrom && rec.derivedFrom[s];
      if (stored == null) out.push('no-provenance:' + s);
      else if (stored !== liveFp) out.push('source-changed:' + s);
    }
    return out;
  };

  const genNewer = (rec, key) => {
    const want = generators[key];
    if (!want || !rec.generator) return false;
    const [wn, wv] = splitGen(want), [sn, sv] = splitGen(rec.generator);
    return wn === sn && cmpVer(wv, sv) > 0;
  };

  // ── Pass 1: direct classification ──────────────────────────────────
  const status = {};
  for (const key of expected) {
    const rec = artifacts[key];
    const exists = !!(rec && io.exists(rec.path));
    if (!rec || !exists || ['missing', 'partial', 'stale'].includes(rec.status)) {
      status[key] = { state: 'stale', reasons: [!rec ? 'missing' : (!exists ? 'file-absent' : 'status:' + rec.status)] };
      continue;
    }
    const hard = srcReasons(rec, key);
    if (genNewer(rec, key)) hard.push('generator-version');
    if ((rec.domains || []).some(domainChanged)) hard.push('domain-changed');

    // Materiality gate (clarifications): if the only reason is a jira source change, defer to opts.materiality.
    let gated = false;
    if (DAG[key] && DAG[key].materialityGate && hard.length > 0 &&
        hard.every((r) => r === 'source-changed:jira' || r === 'no-provenance:jira')) {
      const material = materiality ? !!materiality(key) : true;
      gated = !material;
    }
    const isHardStale = hard.length > 0 && !gated;
    const drift = io.checksum(rec.path) !== rec.checksum;

    if (drift && !isHardStale) status[key] = { state: 'modified', reasons: ['hand-edited'], newChecksum: io.checksum(rec.path) };
    else if (drift && isHardStale) status[key] = { state: 'conflict', reasons: ['hand-edited', ...hard] };
    else if (!drift && isHardStale) status[key] = { state: 'stale', reasons: hard };
    else status[key] = { state: 'reuse', reasons: [] };
  }

  // ── Pass 2: cascade upstream→dependent to a fixpoint ───────────────
  let changed = true;
  while (changed) {
    changed = false;
    for (const key of expected) {
      const st = status[key];
      if (!st || st.state === 'stale' || st.state === 'conflict') continue;
      const ups = (DAG[key] ? DAG[key].upstream : []).filter((u) => expected.includes(u));
      const upBlocked = ups.some((u) => status[u] && (status[u].state === 'stale' || status[u].state === 'conflict'));
      if (!upBlocked) continue;
      if (st.state === 'reuse') { status[key] = { state: 'stale', reasons: [...st.reasons, 'upstream-stale'] }; changed = true; }
      else if (st.state === 'modified') { status[key] = { state: 'conflict', reasons: [...st.reasons, 'upstream-stale'], newChecksum: st.newChecksum }; changed = true; }
    }
  }

  // ── Assemble result ────────────────────────────────────────────────
  const reuse = [], stale = [], modified = [], conflicts = [], reasons = {};
  for (const key of expected) {
    const st = status[key];
    if (!st) continue;
    if (st.reasons && st.reasons.length) reasons[key] = st.reasons;
    if (st.state === 'reuse') reuse.push(key);
    else if (st.state === 'modified') { reuse.push(key); modified.push({ key, newChecksum: st.newChecksum }); }
    else if (st.state === 'stale') stale.push(key);
    else if (st.state === 'conflict') conflicts.push({ key, reasons: st.reasons });
  }
  return { reuse, stale: topoOrder(stale), modified, conflicts, reasons, sourceChanged };
}

module.exports = { reconcile };
