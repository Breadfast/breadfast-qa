/**
 * Real Jira ingestion for the worker (Milestone 1, P0).
 *
 * Reuses the proven, verified credential loader at
 * automation/config/credentials.js (env → credentials.local.js) rather than
 * re-implementing auth — per the parity decision "reuse proven REST scripts".
 * Resolution order: env (JIRA_*) → automation/config/credentials.js.
 *
 * Fetches description, acceptance criteria (HeroCoders checklist issue
 * property, falling back to the description), comments, linked issues, and
 * attachments, and extracts any per-story Figma URL — so every downstream AI
 * node reasons on the REAL ticket instead of just its key.
 */
import { createRequire } from 'node:module';
import { companionPath } from '@qa/shared/paths';

const require = createRequire(import.meta.url);

const CREDENTIALS_PATH =
  process.env.QA_CREDENTIALS_PATH || companionPath('automation', 'config', 'credentials.js');

/** HeroCoders "Acceptance criteria" checklist is stored in these issue properties.
 *  `acceptanceCriteria` holds the rendered content ({ items: "1- … 2- …", progressText }). */
const AC_PROPERTY_KEYS = [
  'acceptanceCriteria',
  'acceptance-criteria-pro_issue-checklist-content',
  'acceptance-criteria-free_issue-checklist-content',
];

export interface JiraLink {
  key: string;
  relationship: string;
  summary?: string;
}
export interface JiraComment {
  author: string;
  created?: string;
  text: string;
}
export interface JiraAttachment {
  filename: string;
  mimeType?: string;
  url: string;
}
export interface JiraSource {
  fetched: boolean;
  key: string;
  summary: string;
  status?: string;
  descriptionText: string;
  acceptanceCriteria?: string;
  comments: JiraComment[];
  links: JiraLink[];
  attachments: JiraAttachment[];
  figmaUrls: string[];
  error?: string;
}

export interface JiraAuth {
  baseUrl: string;
  authHeader: string;
  email: string;
}

/** Resolve Jira base URL + Basic auth header: env first, then credentials.js. Throws if unavailable. */
export function getJiraAuth(): JiraAuth {
  const envEmail = process.env.JIRA_EMAIL;
  const envToken = process.env.JIRA_API_TOKEN;
  const baseUrl = (process.env.JIRA_BASE_URL || 'https://breadfast.atlassian.net').replace(/\/+$/, '');
  if (envEmail && envToken) {
    return { baseUrl, email: envEmail, authHeader: 'Basic ' + Buffer.from(`${envEmail}:${envToken}`).toString('base64') };
  }
  // Reuse the proven loader (it does env → credentials.local.js internally).
  const creds = require(CREDENTIALS_PATH) as {
    jira: { baseUrl: string; email(): string; apiToken(): string; authHeader(): string };
  };
  return {
    baseUrl: (creds.jira.baseUrl || baseUrl).replace(/\/+$/, ''),
    email: creds.jira.email(),
    authHeader: creds.jira.authHeader(),
  };
}

const FIGMA_RE = /https?:\/\/(?:www\.)?figma\.com\/(?:design|file|proto)\/[A-Za-z0-9]+[^\s"'<>)\]]*/g;

/** Strip rendered-HTML (renderedFields) to readable plain text. */
function htmlToText(html: string | undefined): string {
  if (!html) return '';
  return html
    .replace(/<\s*(br|\/p|\/li|\/h[1-6]|\/tr)\s*>/gi, '\n')
    .replace(/<\s*li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Flatten an Atlassian Document Format node tree to plain text (fallback). */
function adfToText(node: any): string {
  if (!node || typeof node !== 'object') return '';
  if (node.type === 'text') return node.text ?? '';
  if (node.type === 'hardBreak') return '\n';
  const inner = Array.isArray(node.content) ? node.content.map(adfToText).join('') : '';
  if (['paragraph', 'heading', 'listItem', 'tableRow'].includes(node.type)) return inner + '\n';
  if (node.type === 'bulletList' || node.type === 'orderedList') return inner;
  return inner;
}

function clamp(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + `\n…(${s.length - n} more chars truncated)` : s;
}

async function getJson(url: string, auth: JiraAuth): Promise<any | null> {
  const res = await fetch(url, { headers: { Authorization: auth.authHeader, Accept: 'application/json' } });
  if (!res.ok) return null;
  return res.json();
}

/** Normalize a HeroCoders checklist property value to readable text. */
function checklistToText(value: any): string | undefined {
  if (!value) return undefined;
  if (typeof value === 'string') return value.trim() || undefined;
  // The rendered `acceptanceCriteria` property carries items as a single string:
  // "1- Verify … 2- Verify …" — split it onto one line per item.
  if (typeof value.items === 'string' && value.items.trim()) {
    return value.items.replace(/\s+(\d+)-\s/g, '\n$1- ').trim();
  }
  const arr = Array.isArray(value.items) ? value.items : Array.isArray(value) ? value : null;
  if (arr?.length) {
    return arr
      .map((it: any) => (typeof it === 'string' ? it : it?.name ?? it?.text ?? ''))
      .filter(Boolean)
      .map((t: string, i: number) => `${i + 1}. ${t}`)
      .join('\n');
  }
  return undefined;
}

/** Best-effort AC from the HeroCoders checklist issue properties. */
async function fetchAcceptanceCriteria(baseUrl: string, key: string, auth: JiraAuth): Promise<string | undefined> {
  for (const prop of AC_PROPERTY_KEYS) {
    const data = await getJson(`${baseUrl}/rest/api/3/issue/${key}/properties/${prop}`, auth);
    const txt = checklistToText(data?.value);
    if (txt) return txt;
  }
  return undefined;
}

/**
 * Fetch the full story context from Jira. Never throws — on failure returns a
 * JiraSource with fetched=false + an error string so the run can continue
 * (degraded) rather than die.
 */
export async function fetchJiraIssue(key: string, log: (l: string) => void): Promise<JiraSource> {
  const empty: JiraSource = {
    fetched: false, key, summary: '', descriptionText: '', comments: [], links: [], attachments: [], figmaUrls: [],
  };
  let auth: JiraAuth;
  try {
    auth = getJiraAuth();
  } catch (e) {
    const error = (e as Error).message;
    log(`fetch_jira: no Jira credentials (${error}) — continuing without ticket text`);
    return { ...empty, error };
  }

  try {
    const issue = await getJson(
      `${auth.baseUrl}/rest/api/3/issue/${key}` +
        `?fields=summary,description,issuelinks,attachment,comment,status,labels&expand=renderedFields`,
      auth,
    );
    if (!issue) {
      log(`fetch_jira: ${key} not reachable (auth/permission/key?) — continuing without ticket text`);
      return { ...empty, error: 'issue fetch returned non-200' };
    }

    const f = issue.fields ?? {};
    const rf = issue.renderedFields ?? {};
    const summary: string = f.summary ?? '';
    const descriptionText = htmlToText(rf.description) || adfToText(f.description);

    // Comments: prefer rendered HTML, fall back to ADF.
    const rawComments: any[] = f.comment?.comments ?? [];
    const rendered: any[] = rf.comment?.comments ?? [];
    const comments: JiraComment[] = rawComments.slice(-20).map((c, i) => ({
      author: c.author?.displayName ?? 'unknown',
      created: c.created,
      text: clamp(htmlToText(rendered[i]?.body) || adfToText(c.body), 2000),
    }));

    const links: JiraLink[] = (f.issuelinks ?? [])
      .map((l: any) => {
        const other = l.outwardIssue ?? l.inwardIssue;
        if (!other) return null;
        const rel = l.outwardIssue ? l.type?.outward : l.type?.inward;
        return { key: other.key, relationship: rel ?? l.type?.name ?? 'relates to', summary: other.fields?.summary };
      })
      .filter(Boolean) as JiraLink[];

    const attachments: JiraAttachment[] = (f.attachment ?? []).map((a: any) => ({
      filename: a.filename, mimeType: a.mimeType, url: a.content,
    }));

    const ac = await fetchAcceptanceCriteria(auth.baseUrl, key, auth);

    // Figma URLs from description + comments + AC.
    const haystack = [descriptionText, ac ?? '', ...comments.map((c) => c.text)].join('\n');
    const figmaUrls = Array.from(new Set((haystack.match(FIGMA_RE) ?? []).map((u) => u.trim())));

    log(
      `fetch_jira: ${key} "${summary}" — desc ${descriptionText.length}c, ` +
        `${comments.length} comment(s), ${links.length} link(s), ${attachments.length} attachment(s), ` +
        `${ac ? 'AC found, ' : ''}${figmaUrls.length} figma url(s)`,
    );

    return {
      fetched: true,
      key,
      summary,
      status: f.status?.name,
      descriptionText: clamp(descriptionText, 8000),
      acceptanceCriteria: ac ? clamp(ac, 4000) : undefined,
      comments,
      links,
      attachments,
      figmaUrls,
    };
  } catch (e) {
    const error = (e as Error).message;
    log(`fetch_jira: error fetching ${key} (${error}) — continuing without ticket text`);
    return { ...empty, error };
  }
}

/** Render a JiraSource to a readable markdown artifact (requirements-analysis/jira-source.md). */
export function jiraSourceMarkdown(j: JiraSource): string {
  if (!j.fetched) return `# Jira source — ${j.key}\n\n_Not fetched: ${j.error ?? 'unknown'}_\n`;
  const lines = [
    `# Jira source — ${j.key}`,
    ``,
    `**${j.summary}**  ·  status: ${j.status ?? '—'}`,
    ``,
    `## Description`,
    j.descriptionText || '_(empty)_',
  ];
  if (j.acceptanceCriteria) lines.push(``, `## Acceptance Criteria`, j.acceptanceCriteria);
  if (j.comments.length) {
    lines.push(``, `## Comments (${j.comments.length})`);
    for (const c of j.comments) lines.push(`- **${c.author}**${c.created ? ` (${c.created.slice(0, 10)})` : ''}: ${c.text}`);
  }
  if (j.links.length) {
    lines.push(``, `## Linked issues`);
    for (const l of j.links) lines.push(`- ${l.key} — ${l.relationship}${l.summary ? `: ${l.summary}` : ''}`);
  }
  if (j.attachments.length) {
    lines.push(``, `## Attachments`);
    for (const a of j.attachments) lines.push(`- ${a.filename}${a.mimeType ? ` (${a.mimeType})` : ''}`);
  }
  if (j.figmaUrls.length) lines.push(``, `## Figma`, ...j.figmaUrls.map((u) => `- ${u}`));
  return lines.join('\n') + '\n';
}

/** Compact context block injected into downstream AI nodes so they reason on the real ticket. */
export function jiraContextBlock(j: JiraSource | undefined): string {
  if (!j || !j.fetched) return '';
  const parts = [`=== JIRA SOURCE (${j.key}) ===`, `Summary: ${j.summary}`];
  if (j.acceptanceCriteria) parts.push(`Acceptance Criteria:\n${j.acceptanceCriteria}`);
  parts.push(`Description:\n${j.descriptionText}`);
  if (j.comments.length) parts.push(`Comments:\n${j.comments.map((c) => `- ${c.author}: ${c.text}`).join('\n')}`);
  if (j.links.length) parts.push(`Linked: ${j.links.map((l) => `${l.key} (${l.relationship})`).join(', ')}`);
  if (j.figmaUrls.length) parts.push(`Figma: ${j.figmaUrls.join(' ')}`);
  return parts.join('\n\n');
}
