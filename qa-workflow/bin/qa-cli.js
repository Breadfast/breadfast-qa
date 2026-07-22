#!/usr/bin/env node
'use strict';

/**
 * qa-cli — the concrete qa-state operations the workflows invoke.
 * Thin wrapper over lib/ so agent-followed workflow steps are deterministic & testable.
 *
 * Usage:
 *   node qa-workflow/bin/qa-cli.js init <storyDir> <TICKET>
 *   node qa-workflow/bin/qa-cli.js fingerprint-jira <storyDir>            # issue JSON on stdin
 *   node qa-workflow/bin/qa-cli.js fingerprint-figma <storyDir> --file <key> --nodes 1:1,1:2 [--version v] [--frames <sha256>] [--last <iso>]
 *   node qa-workflow/bin/qa-cli.js checksum <file>
 *   node qa-workflow/bin/qa-cli.js record <storyDir> <key> --path <rel> --generator <name@x.y>
 *          [--derive-sources jira,figma] [--derive-artifacts requirements,...] [--domains card,...] [--status complete]
 *   node qa-workflow/bin/qa-cli.js show <storyDir>
 *
 * Jira issue JSON (stdin for fingerprint-jira):
 *   { "updated": "<iso>", "summary": "...", "description": "...", "ac": "...", "comments": [ {"id":1,"body":"..."} ] }
 */

const fs = require('fs');
const path = require('path');
const qs = require('../lib/qa-state');
const { fingerprintJira, fingerprintFigma, fileChecksum } = require('../lib/freshness/fingerprint');

function parseFlags(argv) {
  const flags = {}; const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) { const k = a.slice(2); const v = (argv[i + 1] && !argv[i + 1].startsWith('--')) ? argv[++i] : true; flags[k] = v; }
    else positional.push(a);
  }
  return { flags, positional };
}
const csv = (v) => (typeof v === 'string' && v ? v.split(',').map((s) => s.trim()).filter(Boolean) : []);
function die(msg) { process.stderr.write('qa-cli: ' + msg + '\n'); process.exit(2); }
function readStdin() { try { return fs.readFileSync(0, 'utf8'); } catch { return ''; } }
function loadOrInit(dir, ticket) { return qs.load(dir) || qs.newState(ticket || 'B10-0'); }

function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const { flags, positional } = parseFlags(rest);

  switch (cmd) {
    case 'init': {
      const [dir, ticket] = positional;
      if (!dir || !ticket) die('init <storyDir> <TICKET>');
      fs.mkdirSync(dir, { recursive: true });
      const state = qs.load(dir) || qs.newState(ticket);
      state.ticket = ticket;
      // Skeleton is intentionally incomplete (no jira fingerprint yet) — becomes valid after fingerprint-jira.
      const file = qs.save(dir, state, { validate: false });
      process.stdout.write(file + '\n');
      break;
    }
    case 'fingerprint-jira': {
      const [dir] = positional;
      if (!dir) die('fingerprint-jira <storyDir>  (issue JSON on stdin)');
      const issue = JSON.parse(readStdin() || '{}');
      const fp = fingerprintJira(issue);
      const state = loadOrInit(dir);
      state.sources = state.sources || {};
      state.sources.jira = fp;
      qs.save(dir, state);
      process.stdout.write(JSON.stringify(fp) + '\n');
      break;
    }
    case 'fingerprint-figma': {
      const [dir] = positional;
      if (!dir || !flags.file) die('fingerprint-figma <storyDir> --file <key> [--nodes ..] [--version ..] [--frames ..] [--last ..]');
      const figma = {
        fileKey: flags.file,
        nodeIds: csv(flags.nodes),
        version: flags.version || undefined,
        lastModified: flags.last || undefined,
        framesHash: flags.frames || undefined,
      };
      const state = loadOrInit(dir);
      state.sources = state.sources || { jira: null };
      state.sources.figma = figma;
      qs.save(dir, state, { validate: false }); // jira may not be set yet during authoring
      process.stdout.write(fingerprintFigma(figma) + '\n');
      break;
    }
    case 'checksum': {
      const [file] = positional;
      if (!file) die('checksum <file>');
      const c = fileChecksum(file);
      if (!c) die('cannot read ' + file);
      process.stdout.write(c + '\n');
      break;
    }
    case 'record': {
      const [dir, key] = positional;
      if (!dir || !key || !flags.path || !flags.generator) die('record <storyDir> <key> --path <rel> --generator <name@x.y> [..]');
      const state = loadOrInit(dir);
      const derivedFrom = {};
      for (const s of csv(flags['derive-sources'])) {
        if (s === 'jira' && state.sources && state.sources.jira) derivedFrom.jira = state.sources.jira.hash;
        else if (s === 'figma' && state.sources && state.sources.figma) derivedFrom.figma = fingerprintFigma(state.sources.figma);
        else die('cannot derive from source "' + s + '" (fingerprint it first)');
      }
      for (const a of csv(flags['derive-artifacts'])) {
        const up = state.artifacts && state.artifacts[a];
        if (!up || !up.checksum) die('cannot derive from artifact "' + a + '" (record it first)');
        derivedFrom[a] = up.checksum;
      }
      const checksum = fileChecksum(path.join(dir, flags.path));
      if (!checksum) die('artifact file not found: ' + flags.path);
      const record = {
        path: flags.path,
        status: flags.status || 'complete',
        generatedAt: new Date().toISOString(),
        generator: flags.generator,
        derivedFrom,
        checksum,
      };
      const domains = csv(flags.domains);
      if (domains.length) record.domains = domains;
      qs.setArtifact(state, key, record);
      qs.save(dir, state);
      process.stdout.write(JSON.stringify({ key, ...record }, null, 2) + '\n');
      break;
    }
    case 'show': {
      const [dir] = positional;
      const state = qs.load(dir);
      if (!state) die('no qa-state.json in ' + dir);
      process.stdout.write(JSON.stringify(state, null, 2) + '\n');
      break;
    }
    default:
      die('unknown command "' + (cmd || '') + '". See header for usage.');
  }
}

main();
