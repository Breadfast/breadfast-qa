'use strict';

/**
 * Fingerprinting utilities for QA freshness checks.
 * See docs/ai/architecture/qa-artifact-contract.md §4.
 * Zero-dependency: built-in crypto only.
 */
const crypto = require('crypto');
const fs = require('fs');

/** SHA-256 hex of a string (utf8) or Buffer. */
function sha256(input) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

/** Normalize free text so cosmetic re-renders don't produce false changes. */
function normalizeText(s) {
  return String(s == null ? '' : s)
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

/**
 * Build the canonical string hashed for a Jira issue.
 * @param {{summary?:string, description?:string, ac?:string, comments?:Array<{id:(string|number), body:string}>}} issue
 */
function normalizeJira(issue) {
  const comments = (issue.comments || [])
    .slice()
    .sort((a, b) => String(a.id).localeCompare(String(b.id)))
    .map((c) => normalizeText(c.body))
    .join('\n---\n');
  return [
    'summary:' + normalizeText(issue.summary),
    'description:' + normalizeText(issue.description),
    'ac:' + normalizeText(issue.ac),
    'comments:' + comments,
  ].join('\n##\n');
}

/**
 * Fingerprint a Jira issue → the shape stored under sources.jira.
 * @returns {{updated:(string|null), hash:string, fieldsHashed:string[]}}
 */
function fingerprintJira(issue) {
  return {
    updated: issue.updated || null,
    hash: sha256(normalizeJira(issue)),
    fieldsHashed: ['summary', 'description', 'ac', 'comments'],
  };
}

/**
 * The single figma fingerprint used in derivedFrom.figma and staleness checks.
 * Prefer framesHash (confirms the compared frames actually changed); else
 * fall back to sha256(version + sorted(nodeIds)). See contract §4.
 * @param {{version?:string, nodeIds?:string[], framesHash?:(string|null)}} f
 */
function fingerprintFigma(f) {
  if (f && f.framesHash) return f.framesHash;
  const nodes = ((f && f.nodeIds) || []).slice().sort().join(',');
  return sha256('version:' + String((f && f.version) || '') + '|nodes:' + nodes);
}

/** SHA-256 of a file's bytes (relative or absolute path). Returns null if absent. */
function fileChecksum(filePath) {
  try {
    return sha256(fs.readFileSync(filePath));
  } catch {
    return null;
  }
}

module.exports = { sha256, normalizeText, normalizeJira, fingerprintJira, fingerprintFigma, fileChecksum };
