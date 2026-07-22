'use strict';

/**
 * QaState — read / write / checksum helper for a story's qa-state.json.
 * See docs/ai/architecture/qa-artifact-contract.md.
 */
const fs = require('fs');
const path = require('path');
const { validateQaState } = require('./schema/validate');
const { fileChecksum } = require('./freshness/fingerprint');

const FILENAME = 'qa-state.json';

/** A fresh, schema-valid skeleton for a new story. */
function newState(ticket) {
  return { schemaVersion: 1, ticket, updatedAt: null, sources: { jira: null }, artifacts: {} };
}

/** Load <storyDir>/qa-state.json, or null if it does not exist. */
function load(storyDir) {
  const file = path.join(storyDir, FILENAME);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/**
 * Validate and write <storyDir>/qa-state.json (stamps updatedAt).
 * Throws if the state is invalid (unless opts.validate === false).
 */
function save(storyDir, state, opts = {}) {
  if (opts.validate !== false) {
    const { valid, errors } = validateQaState(state);
    if (!valid) {
      const msg = errors.map((e) => `${e.path || '(root)'}: ${e.message}`).join('; ');
      throw new Error('qa-state.json invalid: ' + msg);
    }
  }
  state.updatedAt = opts.now || new Date().toISOString();
  const file = path.join(storyDir, FILENAME);
  fs.writeFileSync(file, JSON.stringify(state, null, 2) + '\n', 'utf8');
  return file;
}

/** SHA-256 of an artifact file (path relative to the story dir). Null if absent. */
function checksumArtifact(storyDir, relPath) {
  return fileChecksum(path.join(storyDir, relPath));
}

/** Build the { exists, checksum } io object reconcile() needs, bound to a story dir. */
function makeIo(storyDir) {
  return {
    exists: (relPath) => fs.existsSync(path.join(storyDir, relPath)),
    checksum: (relPath) => fileChecksum(path.join(storyDir, relPath)),
  };
}

/** Upsert an artifact record. */
function setArtifact(state, key, record) {
  state.artifacts = state.artifacts || {};
  state.artifacts[key] = record;
  return state;
}

/** Apply reconcile()'s `modified` list: re-baseline checksum + mark status "modified". */
function applyModified(state, modified) {
  for (const { key, newChecksum } of modified || []) {
    const rec = state.artifacts && state.artifacts[key];
    if (rec) { rec.checksum = newChecksum; rec.status = 'modified'; }
  }
  return state;
}

module.exports = { FILENAME, newState, load, save, checksumArtifact, makeIo, setArtifact, applyModified };
