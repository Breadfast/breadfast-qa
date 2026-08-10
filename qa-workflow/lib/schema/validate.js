'use strict';

/**
 * Zero-dependency validator for qa-state.json.
 * Mirrors the canonical JSON Schema: docs/ai/architecture/qa-state.schema.json.
 * Returns { valid:boolean, errors:Array<{path,message}> }.
 *
 * (The JSON Schema remains the formal spec; this runtime validator avoids an ajv
 * dependency so qa-workflow stays self-contained. Keep the two in sync.)
 */

const SHA256 = /^[a-f0-9]{64}$/;
const TICKET = /^[A-Z][A-Z0-9]+-[0-9]+$/;
const KEY = /^[a-z][a-z0-9-]*$/;
const GEN = /^[a-z0-9-]+@[0-9]+\.[0-9]+$/;
const NODE = /^[0-9]+[:-][0-9]+$/;
const VER = /^[0-9]+\.[0-9]+$/;
const STATUS = ['complete', 'partial', 'missing', 'stale', 'modified'];
const FIELDS = ['summary', 'description', 'ac', 'comments', 'attachments', 'links'];

function validateQaState(s) {
  const errors = [];
  const err = (path, message) => errors.push({ path, message });
  const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

  if (!isObj(s)) { return { valid: false, errors: [{ path: '', message: 'root must be an object' }] }; }

  if (s.schemaVersion !== 1) err('schemaVersion', 'must be 1');
  if (typeof s.ticket !== 'string' || !TICKET.test(s.ticket)) err('ticket', 'must match ' + TICKET);
  if (s.updatedAt != null && typeof s.updatedAt !== 'string') err('updatedAt', 'must be a string date-time');
  if (s.generatedBy != null && !GEN.test(String(s.generatedBy))) err('generatedBy', 'must match <name>@<major.minor>');

  // sources
  if (!isObj(s.sources)) err('sources', 'required object');
  else {
    const j = s.sources.jira;
    if (!isObj(j)) err('sources.jira', 'required object');
    else {
      if (typeof j.updated !== 'string') err('sources.jira.updated', 'required date-time string');
      if (!SHA256.test(String(j.hash))) err('sources.jira.hash', 'must be sha256');
      if (j.fieldsHashed != null && (!Array.isArray(j.fieldsHashed) || !j.fieldsHashed.every((f) => FIELDS.includes(f))))
        err('sources.jira.fieldsHashed', 'must be a subset of ' + FIELDS.join('|'));
    }
    const f = s.sources.figma;
    if (f != null) {
      if (!isObj(f)) err('sources.figma', 'must be an object');
      else {
        if (typeof f.fileKey !== 'string' || !f.fileKey) err('sources.figma.fileKey', 'required string');
        if (f.nodeIds != null && (!Array.isArray(f.nodeIds) || !f.nodeIds.every((n) => NODE.test(String(n)))))
          err('sources.figma.nodeIds', 'each must match ' + NODE);
        if (f.framesHash != null && !SHA256.test(String(f.framesHash)))
          err('sources.figma.framesHash', 'must be sha256 or null');
      }
    }
  }

  // domains (optional)
  if (s.domains != null) {
    if (!isObj(s.domains)) err('domains', 'must be an object');
    else for (const [id, d] of Object.entries(s.domains)) {
      if (!KEY.test(id)) err(`domains.${id}`, 'domain id must match ' + KEY);
      if (!isObj(d) || !VER.test(String(d.version))) err(`domains.${id}.version`, 'required <major.minor>');
      if (d && d.checksum != null && !SHA256.test(String(d.checksum))) err(`domains.${id}.checksum`, 'must be sha256');
    }
  }

  // deferrals / approvals (optional) — operator decisions, always with a name attached
  if (s.deferrals != null) {
    if (!isObj(s.deferrals)) err('deferrals', 'must be an object');
    else for (const [key, d] of Object.entries(s.deferrals)) {
      if (!KEY.test(key)) err(`deferrals.${key}`, 'key must match ' + KEY);
      if (!isObj(d) || typeof d.approvedBy !== 'string' || !d.approvedBy) err(`deferrals.${key}.approvedBy`, 'required string');
      if (!isObj(d) || typeof d.reason !== 'string' || !d.reason) err(`deferrals.${key}.reason`, 'required string');
    }
  }
  if (s.approvals != null) {
    if (!isObj(s.approvals)) err('approvals', 'must be an object');
    else for (const [key, a] of Object.entries(s.approvals)) {
      if (!KEY.test(key)) err(`approvals.${key}`, 'key must match ' + KEY);
      if (!isObj(a) || typeof a.approvedBy !== 'string' || !a.approvedBy) err(`approvals.${key}.approvedBy`, 'required string');
      if (isObj(a) && a.checksum != null && !SHA256.test(String(a.checksum))) err(`approvals.${key}.checksum`, 'must be sha256');
      if (isObj(a) && a.history != null) {
        if (!Array.isArray(a.history)) err(`approvals.${key}.history`, 'must be an array');
        else a.history.forEach((h, i) => {
          if (!isObj(h) || typeof h.approvedBy !== 'string' || !h.approvedBy) err(`approvals.${key}.history[${i}].approvedBy`, 'required string');
        });
      }
    }
  }
  if (s.skips != null) {
    if (!isObj(s.skips)) err('skips', 'must be an object');
    else for (const [key, k] of Object.entries(s.skips)) {
      if (!KEY.test(key)) err(`skips.${key}`, 'key must match ' + KEY);
      if (!isObj(k) || typeof k.decidedBy !== 'string' || !k.decidedBy) err(`skips.${key}.decidedBy`, 'required string');
      if (!isObj(k) || typeof k.reason !== 'string' || !k.reason) err(`skips.${key}.reason`, 'required string');
    }
  }

  // artifacts
  if (!isObj(s.artifacts)) err('artifacts', 'required object');
  else for (const [key, r] of Object.entries(s.artifacts)) {
    const p = `artifacts.${key}`;
    if (!KEY.test(key)) err(p, 'artifact key must match ' + KEY);
    if (!isObj(r)) { err(p, 'must be an object'); continue; }
    if (typeof r.path !== 'string' || !r.path) err(`${p}.path`, 'required string');
    if (!STATUS.includes(r.status)) err(`${p}.status`, 'must be one of ' + STATUS.join('|'));
    if (!GEN.test(String(r.generator))) err(`${p}.generator`, 'must match <name>@<major.minor>');
    if (r.generatedAt != null && typeof r.generatedAt !== 'string') err(`${p}.generatedAt`, 'must be a string');
    if (r.derivedFrom != null) {
      if (!isObj(r.derivedFrom)) err(`${p}.derivedFrom`, 'must be an object');
      else for (const [k, v] of Object.entries(r.derivedFrom)) {
        if (!KEY.test(k)) err(`${p}.derivedFrom.${k}`, 'key must match ' + KEY);
        if (!SHA256.test(String(v))) err(`${p}.derivedFrom.${k}`, 'value must be sha256');
      }
    }
    if (r.checksum != null && !SHA256.test(String(r.checksum))) err(`${p}.checksum`, 'must be sha256');
    if (r.domains != null && (!Array.isArray(r.domains) || !r.domains.every((d) => KEY.test(String(d)))))
      err(`${p}.domains`, 'each must match ' + KEY);
  }

  return { valid: errors.length === 0, errors };
}

module.exports = { validateQaState };
