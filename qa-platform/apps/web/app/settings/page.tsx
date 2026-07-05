'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api';

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
type FieldDef = { key: string; label: string; secret?: boolean; placeholder?: string };
const CATALOG: Array<{ group: string; title: string; fields: FieldDef[] }> = [
  { group: 'jira', title: 'Jira', fields: [
    { key: 'jira.baseUrl', label: 'Base URL', placeholder: 'https://breadfast.atlassian.net' },
    { key: 'jira.auth', label: 'Auth token', secret: true },
    { key: 'jira.defaultProject', label: 'Default project', placeholder: 'B10' },
  ]},
  { group: 'browserstack', title: 'BrowserStack', fields: [
    { key: 'browserstack.username', label: 'Username' },
    { key: 'browserstack.accessKey', label: 'Access key (App Automate)', secret: true },
    { key: 'browserstack.tmApiToken', label: 'Test Management API token', secret: true },
    { key: 'browserstack.organization', label: 'Organization' },
    { key: 'browserstack.workspace', label: 'Workspace' },
    { key: 'browserstack.defaultProject', label: 'Default project' },
    { key: 'browserstack.defaultFolder', label: 'Default folder' },
    { key: 'browserstack.publicFolderUrl', label: 'Public folder URL' },
  ]},
  { group: 'figma', title: 'Figma', fields: [
    { key: 'figma.token', label: 'Personal access token (REST API)', secret: true },
    { key: 'figma.team', label: 'Team' },
    { key: 'figma.defaultFile', label: 'Default file key' },
    { key: 'figma.defaultWorkspace', label: 'Default workspace' },
  ]},
  { group: 'ai', title: 'AI', fields: [
    { key: 'ai.claudeBin', label: 'Claude binary', placeholder: 'claude' },
    { key: 'ai.model', label: 'Model', placeholder: 'claude-opus-4-8' },
    { key: 'ai.modelCheap', label: 'Cheap model', placeholder: 'claude-haiku-4-5-20251001' },
    { key: 'ai.mcpConfig', label: 'MCP config path' },
    { key: 'ai.knowledgeBasePath', label: 'Knowledge base path', placeholder: 'auto-detected (repo root) — override only if needed' },
  ]},
  { group: 'automation', title: 'Automation', fields: [
    { key: 'automation.playwrightPath', label: 'Playwright framework path', placeholder: 'path to your Playwright framework clone' },
    { key: 'automation.appiumPath', label: 'Appium framework path', placeholder: 'path to your Appium/Java framework clone' },
    { key: 'automation.canonicalFramework', label: 'Canonical framework', placeholder: 'b55168_pom' },
    { key: 'automation.repoLocations', label: 'Repository locations' },
  ]},
  { group: 'integrations', title: 'Integrations', fields: [
    { key: 'integrations.slackToken', label: 'Slack token', secret: true },
    { key: 'integrations.databaseUrl', label: 'Database URL', secret: true },
    { key: 'integrations.githubToken', label: 'GitHub token', secret: true },
  ]},
];

// ── Status badge component ────────────────────────────────────────────────────
function FigmaStatusBadge({ status }: { status: FigmaStatus }) {
  const cfg: Record<FigmaStatus, { label: string; cls: string }> = {
    connected:    { label: 'Connected',    cls: 'bg-green-50 text-green-700 border-green-200' },
    connecting:   { label: 'Connecting…',  cls: 'bg-yellow-50 text-yellow-700 border-yellow-200' },
    disconnected: { label: 'Not connected', cls: 'bg-gray-50 text-gray-500 border-gray-200' },
    expired:      { label: 'Session expired', cls: 'bg-red-50 text-red-600 border-red-200' },
    loading:      { label: 'Checking…',    cls: 'bg-gray-50 text-gray-400 border-gray-200' },
  };
  const { label, cls } = cfg[status] ?? cfg.disconnected;
  return (
    <span className={`inline-flex items-center text-xs font-medium px-2.5 py-1 rounded-full border ${cls}`}>
      {label}
    </span>
  );
}

// ── Main settings page ────────────────────────────────────────────────────────
export default function SettingsPage() {
  const [vals, setVals] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  // Figma browser session state
  const [figmaStatus, setFigmaStatus] = useState<FigmaStatus>('loading');
  const [figmaPayload, setFigmaPayload] = useState<FigmaStatusPayload | null>(null);
  const [figmaConnecting, setFigmaConnecting] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Load settings + figma status on mount ──
  useEffect(() => {
    api<Array<{ key: string; value: string }>>('/settings')
      .then((rows) => setVals(Object.fromEntries(rows.map((r) => [r.key, r.value]))))
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
  async function save() {
    setBusy(true); setSaved(false);
    try {
      const settings = CATALOG.flatMap((g) => g.fields.map((f) => ({
        key: f.key, group: g.group, value: vals[f.key] ?? '', secret: Boolean(f.secret),
      })));
      await api('/settings', { method: 'POST', body: JSON.stringify({ settings }) });
      setSaved(true);
    } finally { setBusy(false); }
  }

  // ── Render ──
  return (
    <div className="px-8 py-7 max-w-3xl">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-2xl font-semibold text-ink tracking-tight">Settings</h1>
        <button
          onClick={save}
          disabled={busy}
          className="bg-accent text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-accent-bright disabled:opacity-40"
        >
          {busy ? 'Saving…' : saved ? 'Saved ✓' : 'Save'}
        </button>
      </div>
      <p className="text-sm text-muted mb-6">Reusable configuration. Set once; the wizard and workflow reuse it.</p>

      <div className="flex flex-col gap-5">

        {/* ── Figma Browser Session (action card, not a settings field) ── */}
        <section className="rounded-xl border border-line bg-surface p-5">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-sm font-semibold text-ink">Figma Browser Session</h2>
            <FigmaStatusBadge status={figmaStatus} />
          </div>
          <p className="text-xs text-muted mb-4 leading-relaxed">
            Authenticate with Figma via browser login to enable visual frame export (batch export + screenshot fallback)
            without API rate limits. Clicking <strong>Connect Figma</strong> opens a browser window — sign in with Google,
            then the session is saved automatically. The session is reused by all future Figma export steps.
          </p>

          <div className="flex items-center gap-3">
            {figmaStatus !== 'connected' && (
              <button
                onClick={handleConnectFigma}
                disabled={figmaConnecting}
                className="bg-accent text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-accent-bright disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {figmaConnecting ? 'Opening browser…' :
                  figmaStatus === 'expired' ? 'Reconnect Figma' : 'Connect Figma'}
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
              <button
                onClick={fetchFigmaStatus}
                className="text-xs text-muted hover:text-ink underline"
              >
                Refresh status
              </button>
            )}
          </div>

          {figmaPayload?.message && (
            <p className="text-xs text-muted mt-3">{figmaPayload.message}</p>
          )}

          {figmaPayload?.savedAt && figmaStatus === 'connected' && (
            <p className="text-xs text-muted mt-1">
              Session saved: {new Date(figmaPayload.savedAt).toLocaleString()}
              {figmaPayload.cookieCount ? ` · ${figmaPayload.cookieCount} cookies` : ''}
            </p>
          )}

          {/* Live logs while connecting */}
          {figmaConnecting && figmaPayload?.recentLogs && figmaPayload.recentLogs.length > 0 && (
            <pre className="mt-3 text-xs bg-gray-50 border border-line rounded p-2 text-gray-600 overflow-x-auto max-h-24">
              {figmaPayload.recentLogs.join('\n')}
            </pre>
          )}
        </section>

        {/* ── Catalog sections ── */}
        {CATALOG.map((g) => (
          <section key={g.group} className="rounded-xl border border-line bg-surface p-5">
            <h2 className="text-sm font-semibold text-ink mb-4">{g.title}</h2>
            <div className="grid grid-cols-2 gap-4">
              {g.fields.map((f) => (
                <label key={f.key} className="block">
                  <span className="text-xs font-mono uppercase tracking-wider text-muted">
                    {f.label}{f.secret && ' 🔒'}
                  </span>
                  <input
                    type={f.secret ? 'password' : 'text'}
                    value={vals[f.key] ?? ''}
                    placeholder={f.placeholder}
                    onChange={(e) => { setVals((v) => ({ ...v, [f.key]: e.target.value })); setSaved(false); }}
                    className="mt-1.5 w-full rounded-lg border border-line px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                  />
                </label>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
