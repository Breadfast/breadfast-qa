/**
 * Jira defect filing (Milestone 1) — files each execution defect as a Bug
 * SUB-TASK under the story, to the canonical bug standard (docs/ai/bug-reporting.md
 * + memory): issuetype 10084, ADF fields Steps cf_10042 / Actual cf_10043 /
 * Expected cf_10044 / Environment cf_10348, Platform cf_10467, Squad cf_10183
 * (array), Components — one defect per Bug, title = the actual wrong result.
 * Screenshots + videos are attached via the REST attachments endpoint (the
 * Atlassian MCP cannot attach).
 *
 * DRY-RUN: when enabled, nothing is POSTed — the fully-built create payloads
 * are returned/saved so they can be reviewed, and the run still exercises the
 * approval gate. Live writes turn on only when the platform reaches parity.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { getJiraAuth, type JiraAuth } from './jira.js';

/** Structural shape of an execution Defect (matches @qa/shared Defect). */
export interface DefectInput {
  title: string;
  severity?: string;
  priority?: string;
  caseTitle?: string;
  combo?: string;
  stepsToReproduce?: string[];
  expected?: string;
  actual?: string;
  evidence?: string[];
}

export interface BugFieldConfig {
  issueTypeId: string; // Bug sub-task id (B10 = 10084)
  components: string[]; // Components field (names)
  squad: string[]; // cf_10183 — array of { value }
  platformValue?: string; // cf_10467 — single option value
  environmentOption?: string; // cf_10348 — region SELECT option (e.g. "Egypt"); NOT the QA env. Omitted unless configured.
  fieldIds: { steps: string; actual: string; expected: string; environment: string };
}

export interface FiledBug {
  defectTitle: string;
  key?: string; // created issue key (live)
  attachments: string[]; // file paths attached / would-be attached
  payload: unknown; // the create payload (saved in dry-run)
  error?: string;
}

const DEFAULT_FIELD_IDS = {
  steps: 'customfield_10042',
  actual: 'customfield_10043',
  expected: 'customfield_10044',
  environment: 'customfield_10348',
};

/** Map a platform enum to the cf_10467 Platform option value. */
function platformOption(platform: string): string {
  switch (platform) {
    case 'web': return 'Web';
    case 'android': return 'Android';
    case 'ios': return 'iOS';
    default: return 'Web';
  }
}

/** Resolve bug-field config from Settings/env with B10 defaults. */
export function resolveBugConfig(settings: Record<string, string>, platform: string): BugFieldConfig {
  const csv = (v?: string) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : []);
  const fid = (k: string, d: string) => settings[k] || d;
  return {
    issueTypeId: settings['jira.bugIssueTypeId'] || process.env.JIRA_BUG_ISSUETYPE_ID || '10084',
    components: csv(settings['jira.components']),
    squad: csv(settings['jira.squadName']),
    platformValue: settings['jira.platformValue'] || platformOption(platform),
    environmentOption: settings['jira.environmentValue'] || undefined,
    fieldIds: {
      steps: fid('jira.field.steps', DEFAULT_FIELD_IDS.steps),
      actual: fid('jira.field.actual', DEFAULT_FIELD_IDS.actual),
      expected: fid('jira.field.expected', DEFAULT_FIELD_IDS.expected),
      environment: fid('jira.field.environment', DEFAULT_FIELD_IDS.environment),
    },
  };
}

// ── ADF builders ────────────────────────────────────────────────────────────
function adfParagraph(text: string) {
  return { type: 'paragraph', content: text ? [{ type: 'text', text }] : [] };
}
function adfText(text: string) {
  return { type: 'doc', version: 1, content: [adfParagraph(text || '—')] };
}
function adfBulletList(items: string[]) {
  const list = (items.length ? items : ['—']).map((t) => ({
    type: 'listItem',
    content: [adfParagraph(t)],
  }));
  return { type: 'doc', version: 1, content: [{ type: 'bulletList', content: list }] };
}

/** Build the Jira create payload for one defect as a Bug sub-task under parentKey. */
export function buildBugPayload(
  parentKey: string,
  projectKey: string,
  d: DefectInput,
  environment: string,
  cfg: BugFieldConfig,
): Record<string, unknown> {
  const fields: Record<string, unknown> = {
    project: { key: projectKey },
    parent: { key: parentKey },
    issuetype: { id: cfg.issueTypeId },
    // Title = the actual wrong result (bug-writing standard).
    summary: `[${d.combo ?? 'web'}] ${d.title}`.slice(0, 250),
    [cfg.fieldIds.steps]: adfBulletList(d.stepsToReproduce ?? []),
    [cfg.fieldIds.actual]: adfText(d.actual ?? d.title),
    [cfg.fieldIds.expected]: adfText(d.expected ?? ''),
  };
  // cf_10348 ("Environment") is a region SELECT (KSA/Egypt/Both), not a QA env — only
  // send it when a valid option is configured; sending ADF text 400s the create.
  if (cfg.environmentOption) fields[cfg.fieldIds.environment] = { value: cfg.environmentOption };
  if (cfg.components.length) fields.components = cfg.components.map((name) => ({ name }));
  if (cfg.squad.length) fields[mapCf('jira.field.squad', 'customfield_10183')] = cfg.squad.map((value) => ({ value }));
  if (cfg.platformValue) fields[mapCf('jira.field.platform', 'customfield_10467')] = { value: cfg.platformValue };
  return { fields };
}

// Squad/Platform field ids are also overridable; tiny local resolver to keep the signature small.
function mapCf(_key: string, def: string): string {
  return process.env[_key.replace(/[.]/g, '_').toUpperCase()] || def;
}

async function postJson(url: string, auth: JiraAuth, body: unknown): Promise<{ ok: boolean; status: number; json: any }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: auth.authHeader, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  let json: any = null;
  try { json = await res.json(); } catch { /* no body */ }
  return { ok: res.ok, status: res.status, json };
}

/** Content-Type by extension so Jira previews the attachment inline — crucially, screen
 *  recordings (video/mp4, video/webm) render as a playable video instead of an opaque
 *  application/octet-stream download. Falls back to octet-stream for unknown types. */
const ATTACH_MIME: Record<string, string> = {
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.m4v': 'video/mp4',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.pdf': 'application/pdf', '.json': 'application/json', '.csv': 'text/csv',
  '.txt': 'text/plain', '.html': 'text/html', '.log': 'text/plain', '.zip': 'application/zip',
};
function mimeForFile(f: string): string {
  return ATTACH_MIME[path.extname(f).toLowerCase()] ?? 'application/octet-stream';
}

/** Attach files (screenshots AND screen recordings) to an issue via multipart
 *  (X-Atlassian-Token: no-check), typed so videos preview inline. */
async function attachFiles(key: string, files: string[], auth: JiraAuth, log: (l: string) => void): Promise<string[]> {
  const attached: string[] = [];
  for (const f of files) {
    try {
      const buf = await readFile(f);
      const form = new FormData();
      form.append('file', new Blob([buf], { type: mimeForFile(f) }), path.basename(f));
      const res = await fetch(`${auth.baseUrl}/rest/api/3/issue/${key}/attachments`, {
        method: 'POST',
        headers: { Authorization: auth.authHeader, 'X-Atlassian-Token': 'no-check' },
        body: form,
      });
      if (res.ok) { attached.push(f); } else { log(`attach ${path.basename(f)} → HTTP ${res.status}`); }
    } catch (e) {
      log(`attach ${f} failed: ${(e as Error).message}`);
    }
  }
  return attached;
}

export interface FileDefectsResult {
  dryRun: boolean;
  filed: number;
  bugs: FiledBug[];
}

/**
 * File all defects. In dry-run, builds payloads only (no POST). Live mode
 * creates each Bug sub-task and attaches its evidence. Never throws.
 */
export async function fileDefects(
  parentKey: string,
  defects: DefectInput[],
  environment: string,
  cfg: BugFieldConfig,
  dryRun: boolean,
  log: (l: string) => void,
): Promise<FileDefectsResult> {
  const projectKey = parentKey.split('-')[0];
  const bugs: FiledBug[] = defects.map((d) => ({
    defectTitle: d.title,
    attachments: d.evidence ?? [],
    payload: buildBugPayload(parentKey, projectKey, d, environment, cfg),
  }));

  if (dryRun) {
    log(`DRY-RUN: prepared ${bugs.length} Bug sub-task payload(s) under ${parentKey} (issuetype ${cfg.issueTypeId}); not posted. Saved to defects/jira-payloads.json.`);
    return { dryRun: true, filed: 0, bugs };
  }

  let auth: JiraAuth;
  try {
    auth = getJiraAuth();
  } catch (e) {
    log(`Jira bug filing skipped — no credentials: ${(e as Error).message}`);
    return { dryRun: false, filed: 0, bugs: bugs.map((b) => ({ ...b, error: 'no-credentials' })) };
  }

  let filed = 0;
  for (const bug of bugs) {
    const r = await postJson(`${auth.baseUrl}/rest/api/3/issue`, auth, bug.payload);
    if (r.ok && r.json?.key) {
      bug.key = r.json.key;
      filed++;
      const attached = await attachFiles(bug.key!, bug.attachments, auth, log);
      bug.attachments = attached;
      log(`filed ${bug.key} — ${bug.defectTitle} (${attached.length} attachment(s))`);
    } else {
      bug.error = `HTTP ${r.status}: ${JSON.stringify(r.json?.errors ?? r.json ?? {}).slice(0, 300)}`;
      log(`file failed — ${bug.defectTitle}: ${bug.error}`);
    }
  }
  return { dryRun: false, filed, bugs };
}
