'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { api } from '../../lib/api';
import { CLAUDE_MODELS } from '@qa/shared';

// ── Figma session types ───────────────────────────────────────────────────────
type FigmaStatus = 'connected' | 'connecting' | 'disconnected' | 'expired' | 'loading';

interface FigmaStatusPayload {
  status: FigmaStatus;
  savedAt?: string;
  cookieCount?: number;
  message?: string;
  recentLogs?: string[];
}

// ── Settings catalog ──────────────────────────────────────────────────────────
// Every field is self-documenting: friendly label, one-line description, when it
// runs in the QA lifecycle, whether it's mandatory, and where to obtain the value.
type Requirement =
  | 'required'
  | 'optional'
  | 'required-web'
  | 'required-mobile'
  | 'required-bs'
  | 'required-figma';

// Runtime behaviour of a credential: can it be supplied later, is it reused, etc.
type Runtime = 'now' | 'runtime' | 'saved';

type FieldDef = {
  key: string;
  // Storage group — MUST be one of the backend SETTING_GROUPS enum values.
  group: 'jira' | 'browserstack' | 'figma' | 'ai' | 'automation' | 'integrations';
  label: string;              // friendly display name (never a raw env var name)
  description: string;        // one sentence: what it is used for
  requirement: Requirement;   // mandatory status
  whenUsed: string;           // which lifecycle stage consumes it
  obtain: { text: string; url?: string }; // "How to get this"
  runtime: Runtime[];         // configure-now / requested-at-runtime / saved
  secret?: boolean;
  placeholder?: string;
  // When present, the field renders as a dropdown of these options instead of a
  // free-text input. The current saved value is auto-injected if not listed, so
  // custom/older ids never break. Include a { value: '' } entry to allow "unset".
  options?: readonly { value: string; label: string }[];
  advanced?: boolean;         // rendered inside the Advanced section
  withoutIt?: string;         // for integrations: graceful-degradation behaviour
};

type Section = {
  id: string;
  title: string;
  icon: string;
  purpose: string;            // why this section exists
  stages: string;            // which workflow stages use it
  requirement: Requirement;   // section-level headline requirement
  kind: 'intro' | 'fields' | 'link' | 'integrations';
  fields?: FieldDef[];
  link?: { href: string; label: string };
};

const SECTIONS: Section[] = [
  // 1 ── General ───────────────────────────────────────────────────────────────
  {
    id: 'general',
    title: 'General',
    icon: '◆',
    purpose:
      'How the platform uses these settings. You do not have to configure everything up front — only Jira and Claude are needed to start. Anything else can be added now or supplied the moment a story needs it.',
    stages: 'Applies to the whole QA lifecycle',
    requirement: 'optional',
    kind: 'intro',
  },
  // 2 ── Jira ────────────────────────────────────────────────────────────────
  {
    id: 'jira',
    title: 'Jira',
    icon: '▤',
    purpose: 'Reads the story (description, acceptance criteria, comments, attachments) and writes back the High Level Scenarios checklist and any defects.',
    stages: 'Requirements Analysis · HLS · Defect Reporting',
    requirement: 'required',
    kind: 'fields',
    fields: [
      {
        key: 'jira.baseUrl', group: 'jira', label: 'Jira Site URL',
        description: 'The address of your Atlassian site — the platform reads every story from here.',
        requirement: 'required', whenUsed: 'Used from the first step of every story (Requirements Analysis).',
        obtain: { text: 'The URL in your browser when viewing Jira, e.g. https://breadfast.atlassian.net' },
        runtime: ['now', 'saved'], placeholder: 'https://breadfast.atlassian.net',
      },
      {
        key: 'jira.auth', group: 'jira', label: 'Jira Personal Access Token', secret: true,
        description: 'Used to read Jira stories, comments and attachments, and to update High Level Scenarios and file defects.',
        requirement: 'required', whenUsed: 'Used during Requirements Analysis, when posting HLS, and when filing bugs.',
        obtain: { text: 'Atlassian → Profile → Security → Create and manage API tokens', url: 'https://id.atlassian.com/manage-profile/security/api-tokens' },
        runtime: ['now', 'runtime', 'saved'],
      },
      {
        key: 'jira.defaultProject', group: 'jira', label: 'Default Project Key',
        description: 'Pre-fills the project when you create a new story, so you don’t retype it each time.',
        requirement: 'optional', whenUsed: 'Used on the New Story form.',
        obtain: { text: 'The prefix of your issue keys — e.g. "B10" in B10-56337.' },
        runtime: ['now', 'saved'], placeholder: 'B10',
      },
    ],
  },
  // 3 ── BrowserStack ──────────────────────────────────────────────────────────
  {
    id: 'browserstack',
    title: 'BrowserStack',
    icon: '▦',
    purpose: 'Runs mobile and web sessions on real devices, and imports the generated test cases into BrowserStack Test Management.',
    stages: 'Mobile/Web Execution · Test Case Import',
    requirement: 'required-mobile',
    kind: 'fields',
    fields: [
      {
        key: 'browserstack.username', group: 'browserstack', label: 'BrowserStack Username',
        description: 'Identifies your BrowserStack account for device sessions and test-case uploads.',
        requirement: 'required-mobile', whenUsed: 'Used during mobile execution and when importing test cases.',
        obtain: { text: 'BrowserStack → Account & Profile → Settings → Username', url: 'https://www.browserstack.com/accounts/profile/details' },
        runtime: ['now', 'runtime', 'saved'],
      },
      {
        key: 'browserstack.accessKey', group: 'browserstack', label: 'BrowserStack Access Key', secret: true,
        description: 'Authenticates App Automate device sessions when running mobile stories.',
        requirement: 'required-mobile', whenUsed: 'Used only when executing a story on real iOS/Android devices.',
        obtain: { text: 'BrowserStack → Account Settings → Access Keys', url: 'https://www.browserstack.com/accounts/settings' },
        runtime: ['now', 'runtime', 'saved'],
      },
      {
        key: 'browserstack.tmApiToken', group: 'browserstack', label: 'Test Management API Token', secret: true,
        description: 'Uploads the generated test cases into BrowserStack Test Management.',
        requirement: 'required-bs', whenUsed: 'Used only when importing test cases into BrowserStack.',
        obtain: { text: 'BrowserStack Test Management → API Tokens', url: 'https://test-management.browserstack.com/' },
        runtime: ['now', 'runtime', 'saved'],
      },
      {
        key: 'browserstack.defaultProject', group: 'browserstack', label: 'Test Management Project',
        description: 'The Test Management project that uploaded test cases land in.',
        requirement: 'required-bs', whenUsed: 'Used only when importing test cases into BrowserStack.',
        obtain: { text: 'Test Management → open your project → the project ID appears in the page URL.' },
        runtime: ['now', 'saved'],
      },
      {
        key: 'browserstack.defaultFolder', group: 'browserstack', label: 'Test Management Folder',
        description: 'The folder within the project that cases upload into. Leave empty to use the project root.',
        requirement: 'optional', whenUsed: 'Used only when importing test cases into BrowserStack.',
        obtain: { text: 'Test Management → open the folder → the folder ID appears in the page URL.' },
        runtime: ['now', 'saved'],
      },
      {
        key: 'browserstack.organization', group: 'browserstack', label: 'Organization',
        description: 'Your BrowserStack Test Management organization — used to address uploads correctly.',
        requirement: 'optional', whenUsed: 'Used only when importing test cases into BrowserStack.',
        obtain: { text: 'BrowserStack Test Management → Organization settings.' },
        runtime: ['now', 'saved'],
      },
      {
        key: 'browserstack.workspace', group: 'browserstack', label: 'Workspace',
        description: 'Your Test Management workspace, when your organization uses more than one.',
        requirement: 'optional', whenUsed: 'Used only when importing test cases into BrowserStack.',
        obtain: { text: 'BrowserStack Test Management → Workspace switcher.' },
        runtime: ['now', 'saved'],
      },
      {
        key: 'browserstack.publicFolderUrl', group: 'browserstack', label: 'Public Folder URL',
        description: 'A shareable link to the imported cases, included in reports so stakeholders can open them.',
        requirement: 'optional', whenUsed: 'Used in execution reports after a BrowserStack import.',
        obtain: { text: 'Test Management → open the folder → Share → copy the public link.' },
        runtime: ['now', 'saved'],
      },
    ],
  },
  // 4 ── Figma ─────────────────────────────────────────────────────────────────
  {
    id: 'figma',
    title: 'Figma',
    icon: '◈',
    purpose: 'Fetches design frames so the platform can validate the built screens against the design (states, copy, localization, error/empty states).',
    stages: 'Figma Analysis · Figma Validation',
    requirement: 'required-figma',
    kind: 'fields',
    fields: [
      {
        key: 'figma.token', group: 'figma', label: 'Figma Personal Access Token', secret: true,
        description: 'REST API fallback for exporting design frames when the browser session above is not connected.',
        requirement: 'required-figma', whenUsed: 'Used during Figma Analysis — only if the story contains a Figma link.',
        obtain: { text: 'Figma → Settings → Security → Personal access tokens', url: 'https://www.figma.com/developers/api#access-tokens' },
        runtime: ['now', 'runtime', 'saved'],
      },
      {
        key: 'figma.defaultFile', group: 'figma', label: 'Default File Key',
        description: 'A fallback file key. Normally the file key is taken automatically from the story’s Figma URL.',
        requirement: 'optional', whenUsed: 'Used only if a story references Figma without an explicit file link.',
        obtain: { text: 'The <FILE_KEY> segment of a Figma URL: figma.com/design/<FILE_KEY>/…' },
        runtime: ['now', 'saved'],
      },
      {
        key: 'figma.team', group: 'figma', label: 'Team',
        description: 'Your Figma team — used to scope file/workspace lookups.',
        requirement: 'optional', whenUsed: 'Used only during Figma browsing/lookups.',
        obtain: { text: 'Figma → the team name in the left sidebar; the team ID appears in team URLs.' },
        runtime: ['now', 'saved'],
      },
      {
        key: 'figma.defaultWorkspace', group: 'figma', label: 'Default Workspace',
        description: 'Your default Figma workspace, when the account has more than one.',
        requirement: 'optional', whenUsed: 'Used only during Figma browsing/lookups.',
        obtain: { text: 'Figma → workspace switcher (top-left).' },
        runtime: ['now', 'saved'],
      },
    ],
  },
  // 5 ── AI (Claude) ─────────────────────────────────────────────────────────
  {
    id: 'ai',
    title: 'AI (Claude)',
    icon: '✦',
    purpose: 'The Claude model that drives every reasoning step — requirements analysis, test design, exploratory testing and automation generation.',
    stages: 'Every AI-driven stage',
    requirement: 'required',
    kind: 'fields',
    fields: [
      {
        key: 'ai.model', group: 'ai', label: 'Claude Model',
        description: 'The primary model used for analysis, test-case design and automation.',
        requirement: 'required', whenUsed: 'Used across all AI-driven stages.',
        obtain: { text: 'Pick a current model. Installed automatically with the Claude CLI.' },
        runtime: ['now', 'saved'], placeholder: 'claude-opus-4-8', options: CLAUDE_MODELS,
      },
      {
        key: 'ai.modelCheap', group: 'ai', label: 'Fast Model',
        description: 'A lower-cost model used for lightweight steps to save time and tokens.',
        requirement: 'optional', whenUsed: 'Used for cheap, high-volume sub-steps.',
        obtain: { text: 'Pick a current fast model, e.g. Haiku 4.5.' },
        runtime: ['now', 'saved'], placeholder: 'claude-haiku-4-5-20251001',
        options: [{ value: '', label: 'Use platform default' }, ...CLAUDE_MODELS],
      },
    ],
  },
  // 6 ── Framework Registry (link only) ─────────────────────────────────────────
  {
    id: 'frameworks',
    title: 'Framework Registry',
    icon: '❏',
    purpose: 'Playwright / Appium framework locations are managed in one place, with path validation and scan status — not as loose text fields here.',
    stages: 'Automation · Framework Learning',
    requirement: 'optional',
    kind: 'link',
    link: { href: '/frameworks', label: 'Open Framework Registry →' },
  },
  // 7 ── Integrations ────────────────────────────────────────────────────────
  {
    id: 'integrations',
    title: 'Integrations',
    icon: '⚡',
    purpose: 'Optional helpers that make specific stages smoother. The platform works without every one of these — each entry explains what you lose if it’s left blank.',
    stages: 'Various — see each integration',
    requirement: 'optional',
    kind: 'integrations',
    fields: [
      {
        key: 'integrations.slackToken', group: 'integrations', label: 'Slack Token', secret: true,
        description: 'Retrieves login/OTP codes automatically during mobile onboarding.',
        requirement: 'optional', whenUsed: 'Workflow: Mobile Testing → OTP Retrieval.',
        obtain: { text: 'From internal QA documentation — ask the QA team for the shared #testing-otp token.' },
        runtime: ['now', 'runtime', 'saved'],
        withoutIt: 'The platform pauses and you enter the OTP manually.',
      },
      {
        key: 'integrations.databaseUrl', group: 'integrations', label: 'Database URL', secret: true,
        description: 'Provisions test users and validates backend data directly.',
        requirement: 'optional', whenUsed: 'Workflow: Test Data Preparation / Backend Validation.',
        obtain: { text: 'From the QA Team / Engineering — the read-only testing database connection string.' },
        runtime: ['now', 'runtime', 'saved'],
        withoutIt: 'Automatic provisioning is skipped and the platform asks for test data manually.',
      },
      {
        key: 'integrations.githubToken', group: 'integrations', label: 'GitHub Token', secret: true,
        description: 'Enables repository analysis and automation generation from remote repos.',
        requirement: 'optional', whenUsed: 'Workflow: Framework Learning.',
        obtain: { text: 'GitHub → Settings → Developer settings → Personal access tokens', url: 'https://github.com/settings/tokens' },
        runtime: ['now', 'runtime', 'saved'],
        withoutIt: 'Only local repositories are analyzed; remote repos are unavailable.',
      },
    ],
  },
  // 8 ── Advanced ──────────────────────────────────────────────────────────────
  {
    id: 'advanced',
    title: 'Advanced',
    icon: '⚙',
    purpose: 'Overrides and tuning. Sensible defaults apply automatically — most QA engineers never need to touch anything here.',
    stages: 'Rarely needed',
    requirement: 'optional',
    kind: 'fields',
    fields: [
      {
        key: 'ai.claudeBin', group: 'ai', label: 'Claude Binary Path', advanced: true,
        description: 'Path to the Claude CLI executable. Detected automatically; override only if it is not on your PATH.',
        requirement: 'optional', whenUsed: 'Used when the platform launches Claude.',
        obtain: { text: 'Installed automatically with Claude Code. Leave as "claude" unless told otherwise.' },
        runtime: ['now', 'saved'], placeholder: 'claude',
      },
      {
        key: 'ai.mcpConfig', group: 'ai', label: 'MCP Config Path', advanced: true,
        description: 'Path to a custom MCP server configuration file. Uses the built-in config when empty.',
        requirement: 'optional', whenUsed: 'Used when connecting Jira/Figma/Slack MCP tools.',
        obtain: { text: 'Set by Engineering only if you run a non-default MCP setup.' },
        runtime: ['now', 'saved'],
      },
      {
        key: 'ai.knowledgeBasePath', group: 'ai', label: 'Knowledge Base Path', advanced: true,
        description: 'Where the QA knowledge base (docs/ai) lives. Auto-detected from the repo root.',
        requirement: 'optional', whenUsed: 'Used when the platform reads business rules and framework docs.',
        obtain: { text: 'Auto-detected — override only if your checkout is in a non-standard location.' },
        runtime: ['now', 'saved'], placeholder: 'auto-detected (repo root)',
      },
      {
        key: 'hls.maxScenarios', group: 'jira', label: 'Max HLS Scenarios', advanced: true,
        description: 'Caps how many High Level Scenarios are generated per story (default 20).',
        requirement: 'optional', whenUsed: 'Used during HLS generation.',
        obtain: { text: 'Any number. Leave empty to use the default of 20.' },
        runtime: ['now', 'saved'], placeholder: '20',
      },
      {
        key: 'browserstack.uiUsername', group: 'browserstack', label: 'Test Management UI Username', advanced: true,
        description: 'Fallback web-login username used to import test cases when the API token path is unavailable.',
        requirement: 'optional', whenUsed: 'Used only as a fallback during BrowserStack import.',
        obtain: { text: 'Your BrowserStack Test Management login email.' },
        runtime: ['now', 'saved'],
      },
      {
        key: 'browserstack.uiPassword', group: 'browserstack', label: 'Test Management UI Password', secret: true, advanced: true,
        description: 'Fallback web-login password used to import test cases when the API token path is unavailable.',
        requirement: 'optional', whenUsed: 'Used only as a fallback during BrowserStack import.',
        obtain: { text: 'Your BrowserStack Test Management login password.' },
        runtime: ['now', 'runtime', 'saved'],
      },
      {
        key: 'jira.squadName', group: 'jira', label: 'Squad Name', advanced: true,
        description: 'Sets the Squad field on filed defects so bugs are routed to the right team.',
        requirement: 'optional', whenUsed: 'Used during Defect Reporting.',
        obtain: { text: 'Your squad as it appears in the Jira "Squad" field, e.g. BCard Squad.' },
        runtime: ['now', 'saved'],
      },
      {
        key: 'jira.components', group: 'jira', label: 'Default Components', advanced: true,
        description: 'Comma-separated Jira components applied to filed defects.',
        requirement: 'optional', whenUsed: 'Used during Defect Reporting.',
        obtain: { text: 'Component names from your Jira project settings, comma-separated.' },
        runtime: ['now', 'saved'], placeholder: 'Card Service, Control Room',
      },
      {
        key: 'jira.bugDryRun', group: 'jira', label: 'Defect Dry-Run',
        advanced: true,
        description: 'When "true" (default), defects are prepared but not actually created in Jira — a safety switch. Set "false" to file for real.',
        requirement: 'optional', whenUsed: 'Used during Defect Reporting.',
        obtain: { text: 'Enter "true" to preview only, or "false" to file bugs into Jira.' },
        runtime: ['now', 'saved'], placeholder: 'true',
      },
    ],
  },
];

// Flat list of every persisted field (used for save + reset).
const ALL_FIELDS: FieldDef[] = SECTIONS.flatMap((s) => s.fields ?? []);
const MASK = '••••••••';

// ── Small presentational helpers ──────────────────────────────────────────────
const REQ: Record<Requirement, { label: string; cls: string }> = {
  required:         { label: 'Required',                       cls: 'bg-[#FDECEA] text-fail border-[#F5C6C0]' },
  optional:         { label: 'Optional',                       cls: 'bg-ground text-muted border-line' },
  'required-web':   { label: 'Required for Web stories',       cls: 'bg-[#FBF1DE] text-warn border-[#F0DCB0]' },
  'required-mobile':{ label: 'Required for Mobile stories',    cls: 'bg-[#FBF1DE] text-warn border-[#F0DCB0]' },
  'required-bs':    { label: 'Required for BrowserStack import',cls: 'bg-[#FBF1DE] text-warn border-[#F0DCB0]' },
  'required-figma': { label: 'Required for Figma validation',  cls: 'bg-[#FBF1DE] text-warn border-[#F0DCB0]' },
};

const RUNTIME_LABEL: Record<Runtime, string> = {
  now: 'Configure now',
  runtime: 'Can be requested during a run',
  saved: 'Saved for future stories',
};

function RequirementBadge({ requirement }: { requirement: Requirement }) {
  const { label, cls } = REQ[requirement];
  return <span className={`inline-flex items-center text-[11px] font-medium px-2 py-0.5 rounded-full border ${cls}`}>{label}</span>;
}

function FigmaStatusBadge({ status }: { status: FigmaStatus }) {
  const cfg: Record<FigmaStatus, { label: string; cls: string }> = {
    connected:    { label: 'Connected',       cls: 'bg-green-50 text-green-700 border-green-200' },
    connecting:   { label: 'Connecting…', cls: 'bg-yellow-50 text-yellow-700 border-yellow-200' },
    disconnected: { label: 'Not connected',   cls: 'bg-gray-50 text-gray-500 border-gray-200' },
    expired:      { label: 'Session expired', cls: 'bg-red-50 text-red-600 border-red-200' },
    loading:      { label: 'Checking…',   cls: 'bg-gray-50 text-gray-400 border-gray-200' },
  };
  const { label, cls } = cfg[status] ?? cfg.disconnected;
  return <span className={`inline-flex items-center text-xs font-medium px-2.5 py-1 rounded-full border ${cls}`}>{label}</span>;
}

// ── Field row: friendly name, description, requirement, when-used, how-to-get ──
function FieldRow({
  field, value, isSet, onChange,
}: {
  field: FieldDef;
  value: string;
  isSet: boolean;
  onChange: (v: string) => void;
}) {
  return (
    <div className="py-4 border-t border-line first:border-t-0">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-ink">{field.label}</span>
          {field.secret && <span title="Stored securely (encrypted secret)" className="text-muted text-xs">🔒</span>}
          {field.secret && isSet && (
            <span className="inline-flex items-center text-[11px] font-medium px-2 py-0.5 rounded-full border bg-green-50 text-green-700 border-green-200">Configured</span>
          )}
        </div>
        <RequirementBadge requirement={field.requirement} />
      </div>

      <p className="text-xs text-body mt-1 leading-relaxed">{field.description}</p>

      <div className="flex items-center gap-1.5 mt-2 text-[11px] text-muted">
        <span className="text-accent">◷</span>
        <span>{field.whenUsed}</span>
      </div>

      {field.withoutIt && (
        <div className="flex items-start gap-1.5 mt-1 text-[11px] text-warn">
          <span className="mt-[1px]">↳</span>
          <span><span className="font-medium">Without it:</span> {field.withoutIt}</span>
        </div>
      )}

      {field.options ? (
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="mt-2.5 w-full rounded-lg border border-line px-3 py-2 text-sm text-ink bg-white focus:outline-none focus:ring-2 focus:ring-accent"
        >
          {/* Preserve a saved custom/older value that isn't one of the presets. */}
          {value && !field.options.some((o) => o.value === value) && (
            <option value={value}>{value} (current)</option>
          )}
          {field.options.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      ) : (
        <input
          type={field.secret ? 'password' : 'text'}
          value={value}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value)}
          className="mt-2.5 w-full rounded-lg border border-line px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-accent"
        />
      )}

      {/* Runtime behaviour chips */}
      <div className="flex flex-wrap gap-1.5 mt-2">
        {field.runtime.map((r) => (
          <span key={r} className="inline-flex items-center gap-1 text-[10px] text-muted bg-ground border border-line rounded px-1.5 py-0.5">
            <span className="text-pass">✓</span>{RUNTIME_LABEL[r]}
          </span>
        ))}
      </div>

      {/* How to get this — expandable, no extra state */}
      <details className="mt-2 group">
        <summary className="cursor-pointer text-[11px] text-accent hover:text-accent-bright select-none list-none">
          <span className="group-open:hidden">How to get this ▸</span>
          <span className="hidden group-open:inline">How to get this ▾</span>
        </summary>
        <div className="mt-1.5 text-[11px] text-body bg-accent-wash border border-line rounded-lg px-3 py-2 leading-relaxed">
          {field.obtain.text}
          {field.obtain.url && (
            <>
              {' '}
              <a href={field.obtain.url} target="_blank" rel="noreferrer" className="text-accent underline hover:text-accent-bright break-all">
                Open guide ↗
              </a>
            </>
          )}
        </div>
      </details>
    </div>
  );
}

// ── Section header (shared) ────────────────────────────────────────────────────
function SectionHeader({ section }: { section: Section }) {
  return (
    <div className="mb-1">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-accent-bright w-5 text-center">{section.icon}</span>
        <h2 className="text-base font-semibold text-ink">{section.title}</h2>
        <RequirementBadge requirement={section.requirement} />
      </div>
      <p className="text-xs text-body mt-1.5 leading-relaxed">{section.purpose}</p>
      <p className="text-[11px] text-muted mt-1">
        <span className="font-medium">Workflow:</span> {section.stages}
      </p>
    </div>
  );
}

// ── Main settings page ────────────────────────────────────────────────────────
export default function SettingsPage() {
  const [vals, setVals] = useState<Record<string, string>>({});
  const [setKeys, setSetKeys] = useState<Set<string>>(new Set());
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  // Figma browser session state
  const [figmaStatus, setFigmaStatus] = useState<FigmaStatus>('loading');
  const [figmaPayload, setFigmaPayload] = useState<FigmaStatusPayload | null>(null);
  const [figmaConnecting, setFigmaConnecting] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Load settings + figma status on mount ──
  useEffect(() => {
    api<Array<{ key: string; value: string; isSet?: boolean }>>('/settings')
      .then((rows) => {
        setVals(Object.fromEntries(rows.map((r) => [r.key, r.value])));
        setSetKeys(new Set(rows.filter((r) => r.isSet).map((r) => r.key)));
      })
      .catch(() => {});
    fetchFigmaStatus();
  }, []);

  // ── Figma status helpers ──
  const fetchFigmaStatus = useCallback(async () => {
    try {
      const p = await api<FigmaStatusPayload>('/figma/status');
      setFigmaPayload(p);
      setFigmaStatus(p.status);
      return p.status;
    } catch {
      setFigmaStatus('disconnected');
      return 'disconnected' as FigmaStatus;
    }
  }, []);

  const startPolling = useCallback(() => {
    if (pollRef.current) return;
    pollRef.current = setInterval(async () => {
      const s = await fetchFigmaStatus();
      if (s === 'connected' || s === 'disconnected' || s === 'expired') {
        clearInterval(pollRef.current!);
        pollRef.current = null;
        setFigmaConnecting(false);
      }
    }, 3000);
  }, [fetchFigmaStatus]);

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  async function handleConnectFigma() {
    setFigmaConnecting(true);
    setFigmaStatus('connecting');
    try {
      const res = await api<FigmaStatusPayload>('/figma/connect', { method: 'POST' });
      setFigmaPayload(res);
      startPolling();
    } catch {
      setFigmaConnecting(false);
      setFigmaStatus('disconnected');
    }
  }

  async function handleDisconnectFigma() {
    try {
      await api('/figma/connect', { method: 'DELETE' });
    } finally {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      setFigmaConnecting(false);
      setFigmaStatus('disconnected');
      setFigmaPayload(null);
    }
  }

  // ── Save settings ──
  function setField(key: string, v: string) {
    setVals((prev) => ({ ...prev, [key]: v }));
    setSaved(false);
  }

  async function save() {
    setBusy(true); setSaved(false);
    try {
      const settings = ALL_FIELDS.map((f) => ({
        key: f.key, group: f.group, value: vals[f.key] ?? '', secret: Boolean(f.secret),
      }));
      await api('/settings', { method: 'POST', body: JSON.stringify({ settings }) });
      // Any non-empty value is now "set"; masked secrets that were already set stay set.
      setSetKeys((prev) => {
        const next = new Set(prev);
        for (const f of ALL_FIELDS) {
          const v = vals[f.key] ?? '';
          if (v && v !== MASK) next.add(f.key);
          else if (!f.secret && !v) next.delete(f.key);
        }
        return next;
      });
      setSaved(true);
    } finally { setBusy(false); }
  }

  // ── Render ──
  return (
    <div className="px-8 py-7 max-w-3xl">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-1">
        <div>
          <h1 className="text-2xl font-semibold text-ink tracking-tight">Settings</h1>
          <p className="text-sm text-muted mt-1">
            Everything the platform needs, organized by workflow. Each field explains what it is, whether you need it, and where to get it.
          </p>
        </div>
        <button
          onClick={save}
          disabled={busy}
          className="shrink-0 bg-accent text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-accent-bright disabled:opacity-40"
        >
          {busy ? 'Saving…' : saved ? 'Saved ✓' : 'Save'}
        </button>
      </div>

      {/* In-page section navigation */}
      <nav className="flex flex-wrap gap-1.5 mt-4 mb-6">
        {SECTIONS.map((s) => (
          <a
            key={s.id}
            href={`#${s.id}`}
            className="text-xs px-2.5 py-1 rounded-full border border-line text-body bg-surface hover:border-accent hover:text-accent transition-colors"
          >
            {s.title}
          </a>
        ))}
      </nav>

      <div className="flex flex-col gap-5">
        {SECTIONS.map((section) => (
          <section
            key={section.id}
            id={section.id}
            className="scroll-mt-6 rounded-xl border border-line bg-surface p-5"
          >
            <SectionHeader section={section} />

            {/* General — orientation, no fields */}
            {section.kind === 'intro' && (
              <div className="mt-4 space-y-3">
                <div className="rounded-lg border border-line bg-ground p-4">
                  <h3 className="text-xs font-semibold text-ink mb-2">To get started you only need two things</h3>
                  <ul className="text-xs text-body space-y-1 leading-relaxed">
                    <li>• <span className="font-medium">Jira</span> — so the platform can read the story you want to test.</li>
                    <li>• <span className="font-medium">AI (Claude)</span> — the engine that does the analysis and test design.</li>
                  </ul>
                  <p className="text-xs text-muted mt-2">Everything else is optional and only matters for specific kinds of stories (mobile, BrowserStack import, Figma validation).</p>
                </div>
                <div className="rounded-lg border border-line bg-accent-wash p-4">
                  <h3 className="text-xs font-semibold text-ink mb-2">If something is missing while a story runs</h3>
                  <p className="text-xs text-body leading-relaxed">
                    You don’t have to fill everything in first. If a required credential is missing when a run reaches the step that needs it, the platform pauses and asks — with three choices:
                  </p>
                  <div className="flex flex-wrap gap-2 mt-2.5">
                    <span className="text-[11px] font-medium px-2.5 py-1 rounded-lg border border-line bg-surface text-ink">Use Once</span>
                    <span className="text-[11px] font-medium px-2.5 py-1 rounded-lg border border-line bg-surface text-ink">Save to My Settings</span>
                    <span className="text-[11px] font-medium px-2.5 py-1 rounded-lg border border-line bg-surface text-ink">Cancel Run</span>
                  </div>
                  <div className="flex flex-wrap gap-3 mt-3 text-[11px] text-muted">
                    <span className="inline-flex items-center gap-1"><span className="text-pass">✓</span>Configure now</span>
                    <span className="inline-flex items-center gap-1"><span className="text-pass">✓</span>Or supply it when asked, mid-run</span>
                    <span className="inline-flex items-center gap-1"><span className="text-pass">✓</span>Saved values are reused on every future story</span>
                  </div>
                </div>
              </div>
            )}

            {/* Framework Registry — link only */}
            {section.kind === 'link' && section.link && (
              <div className="mt-4">
                <Link
                  href={section.link.href}
                  className="inline-flex items-center text-sm font-medium px-4 py-2 rounded-lg border border-line text-body hover:border-accent hover:text-accent"
                >
                  {section.link.label}
                </Link>
              </div>
            )}

            {/* Figma browser session action card sits above the Figma fields */}
            {section.id === 'figma' && (
              <div className="mt-4 rounded-lg border border-line bg-ground p-4">
                <div className="flex items-center justify-between mb-1 gap-3 flex-wrap">
                  <h3 className="text-sm font-semibold text-ink">Figma Browser Session <span className="text-xs font-normal text-muted">(recommended)</span></h3>
                  <FigmaStatusBadge status={figmaStatus} />
                </div>
                <p className="text-xs text-muted mb-3 leading-relaxed">
                  The easiest way to enable design export: sign in through a browser window once, no token needed and no API rate limits.
                  Clicking <strong>Connect Figma</strong> opens a browser — sign in with Google, and the session is saved and reused by every future export step.
                  The Personal Access Token below is only a fallback for when this session isn’t connected.
                </p>
                <div className="flex items-center gap-3 flex-wrap">
                  {figmaStatus !== 'connected' && (
                    <button
                      onClick={handleConnectFigma}
                      disabled={figmaConnecting}
                      className="bg-accent text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-accent-bright disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {figmaConnecting ? 'Opening browser…' : figmaStatus === 'expired' ? 'Reconnect Figma' : 'Connect Figma'}
                    </button>
                  )}
                  {figmaStatus === 'connected' && (
                    <button
                      onClick={handleDisconnectFigma}
                      className="text-sm font-medium px-4 py-2 rounded-lg border border-line text-muted hover:text-ink hover:border-ink"
                    >
                      Disconnect
                    </button>
                  )}
                  {(figmaStatus === 'connecting' || figmaStatus === 'connected') && (
                    <button onClick={fetchFigmaStatus} className="text-xs text-muted hover:text-ink underline">
                      Refresh status
                    </button>
                  )}
                </div>
                {figmaPayload?.message && <p className="text-xs text-muted mt-3">{figmaPayload.message}</p>}
                {figmaPayload?.savedAt && figmaStatus === 'connected' && (
                  <p className="text-xs text-muted mt-1">
                    Session saved: {new Date(figmaPayload.savedAt).toLocaleString()}
                    {figmaPayload.cookieCount ? ` · ${figmaPayload.cookieCount} cookies` : ''}
                  </p>
                )}
                {figmaConnecting && figmaPayload?.recentLogs && figmaPayload.recentLogs.length > 0 && (
                  <pre className="mt-3 text-xs bg-surface border border-line rounded p-2 text-gray-600 overflow-x-auto max-h-24">
                    {figmaPayload.recentLogs.join('\n')}
                  </pre>
                )}
              </div>
            )}

            {/* Standard field list (also used by Integrations & Advanced) */}
            {(section.kind === 'fields' || section.kind === 'integrations') && section.fields && (
              <div className="mt-3">
                {section.fields.map((f) => (
                  <FieldRow
                    key={f.key}
                    field={f}
                    value={vals[f.key] ?? ''}
                    isSet={setKeys.has(f.key)}
                    onChange={(v) => setField(f.key, v)}
                  />
                ))}
              </div>
            )}
          </section>
        ))}
      </div>

      {/* Bottom save bar */}
      <div className="flex items-center justify-end gap-3 mt-6">
        {saved && <span className="text-xs text-pass">All settings saved.</span>}
        <button
          onClick={save}
          disabled={busy}
          className="bg-accent text-white text-sm font-medium px-5 py-2 rounded-lg hover:bg-accent-bright disabled:opacity-40"
        >
          {busy ? 'Saving…' : saved ? 'Saved ✓' : 'Save all settings'}
        </button>
      </div>
    </div>
  );
}
