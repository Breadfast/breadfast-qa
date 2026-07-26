'use strict';

/**
 * ConformanceCapability — the generic contract every QA capability plugs into.
 * ADR-003 §3.1/§3.7: the platform primitive is a *Conformance Engine* — compare an
 * Actual against an Expected via a Resolver (identity pairing) + an ordered Validator
 * pipeline + an AI residual gate, emitting Findings scored into Health. Visual Testing
 * is instance #1 (Expected = Figma, Actual = screenshot+dump, Validators = L1–L7);
 * accessibility / api / performance / localization / requirement are the same engine
 * with different (Expected, Actual, Validators) triples.
 *
 * This module defines/validates the DESCRIPTOR (what a capability declares). The
 * runtime ports it references are documented as typedefs below; their concrete
 * implementations are supplied per capability and injected by the pipeline runner
 * (dependency inversion — the core depends on the interfaces, never the adapters).
 *
 * Zero-dependency, pure. Contract:
 * docs/ai/architecture/adr-003-visual-conformance-engine-plugin-aligned.md
 */

const KEY = /^[a-z][a-z0-9-]*$/;

/**
 * @typedef {object} Validator  A single pipeline stage.
 * @property {string}  id            stable id (e.g. "l2")
 * @property {string}  layer         semantic layer (e.g. "component-tree")
 * @property {string}  title         human label
 * @property {boolean} deterministic true = deterministic; false = AI residual
 * @property {(expected:any, actual:any, ctx:any)=>object[]} [run]  (expected,actual,ctx) → Finding[]
 *
 * @typedef {object} ExpectedModelProvider  Produces the Expected side.
 * @property {(ref:any)=>Promise<any>} load  e.g. Figma frame | WCAG ruleset | OpenAPI spec
 *
 * @typedef {object} ActualCaptureProvider  Produces the Actual side.
 * @property {(ref:any)=>Promise<any>} capture  e.g. screenshot+dump | a11y tree | HTTP response
 *
 * @typedef {object} Resolver  Pairs Expected↔Actual by stable identity.
 * @property {(expected:any[], actual:any[], ctx:any)=>object[]} resolve  identity-first → floor → abstain
 */

/**
 * @typedef {object} ConformanceCapability
 * @property {string}  id                 KEY, e.g. "visual"
 * @property {string}  title
 * @property {{provider:string, kind:string}} expected  e.g. { provider:"figma", kind:"design-frame" }
 * @property {{capture:string, kind:string}}  actual    e.g. { capture:"screenshot+structured-dump", kind:"rendered-screen" }
 * @property {string}  resolver           identity strategy id, e.g. "screen-id"
 * @property {Validator[]} stages         ordered; cheapest/most-structural first
 * @property {string[]} findingExtension  extra Finding fields this capability adds (e.g. ["component","token"])
 * @property {string}  renderer           report renderer id
 */

/** Validate a capability descriptor. Returns { valid, errors:[{path,message}] }. */
function validateCapability(c) {
  const errors = [];
  const err = (path, message) => errors.push({ path, message });
  const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
  if (!isObj(c)) return { valid: false, errors: [{ path: '', message: 'capability must be an object' }] };

  if (typeof c.id !== 'string' || !KEY.test(c.id)) err('id', 'must match ' + KEY);
  if (typeof c.title !== 'string' || !c.title) err('title', 'required non-empty string');

  if (!isObj(c.expected) || typeof c.expected.provider !== 'string' || !c.expected.provider) err('expected.provider', 'required string');
  if (isObj(c.expected) && (typeof c.expected.kind !== 'string' || !c.expected.kind)) err('expected.kind', 'required string');
  if (!isObj(c.actual) || typeof c.actual.capture !== 'string' || !c.actual.capture) err('actual.capture', 'required string');
  if (isObj(c.actual) && (typeof c.actual.kind !== 'string' || !c.actual.kind)) err('actual.kind', 'required string');

  if (typeof c.resolver !== 'string' || !c.resolver) err('resolver', 'required string');

  if (!Array.isArray(c.stages) || c.stages.length === 0) err('stages', 'required non-empty array');
  else {
    const seen = new Set();
    c.stages.forEach((s, i) => {
      const p = `stages[${i}]`;
      if (!isObj(s)) { err(p, 'must be an object'); return; }
      if (typeof s.id !== 'string' || !s.id) err(`${p}.id`, 'required string');
      else if (seen.has(s.id)) err(`${p}.id`, 'duplicate stage id "' + s.id + '"');
      else seen.add(s.id);
      if (typeof s.layer !== 'string' || !s.layer) err(`${p}.layer`, 'required string');
      if (typeof s.deterministic !== 'boolean') err(`${p}.deterministic`, 'must be boolean');
    });
    // The engine is deterministic-first: at least one deterministic stage must exist.
    if (Array.isArray(c.stages) && !c.stages.some((s) => s && s.deterministic === true))
      err('stages', 'at least one deterministic stage is required (deterministic-first)');
  }

  if (c.findingExtension != null && (!Array.isArray(c.findingExtension) || !c.findingExtension.every((x) => typeof x === 'string')))
    err('findingExtension', 'must be a string[]');
  if (typeof c.renderer !== 'string' || !c.renderer) err('renderer', 'required string');

  return { valid: errors.length === 0, errors };
}

/**
 * Define a capability: validate then freeze. Throws on an invalid descriptor so a
 * misdeclared capability fails at load, not at run.
 * @returns {ConformanceCapability} the frozen descriptor
 */
function defineCapability(desc) {
  const { valid, errors } = validateCapability(desc);
  if (!valid) {
    const msg = errors.map((e) => `${e.path || '(root)'}: ${e.message}`).join('; ');
    throw new Error('invalid ConformanceCapability: ' + msg);
  }
  const frozen = { ...desc, stages: desc.stages.map((s) => Object.freeze({ ...s })) };
  frozen.stages = Object.freeze(frozen.stages);
  return Object.freeze(frozen);
}

/** The deterministic-first ordering: deterministic stages, in declared order, then AI. */
function deterministicStages(c) {
  return (c.stages || []).filter((s) => s.deterministic === true);
}
function residualStages(c) {
  return (c.stages || []).filter((s) => s.deterministic !== true);
}

module.exports = { KEY, validateCapability, defineCapability, deterministicStages, residualStages };
