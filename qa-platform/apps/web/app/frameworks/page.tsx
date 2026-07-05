'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api';

interface Framework {
  id: string;
  name: string;
  platform: string;
  type: string;
  localPath: string;
  description?: string | null;
  validationStatus: 'valid' | 'invalid' | 'not-found' | 'unscanned';
  scanDetails?: string | null;
  lastScan?: string | null;
  version?: string | null;
  gitCommit?: string | null;
  gitBranch?: string | null;
  lastSuccessfulGeneration?: string | null;
}

const TYPES = ['playwright', 'appium', 'java-appium', 'api', 'other'];
const PLATFORMS = ['web', 'android', 'ios', 'mobile', 'api', 'cross-platform'];

const STATUS_CLS: Record<string, string> = {
  valid: 'bg-green-50 text-green-700 border-green-200',
  invalid: 'bg-red-50 text-red-600 border-red-200',
  'not-found': 'bg-red-50 text-red-600 border-red-200',
  unscanned: 'bg-gray-50 text-gray-500 border-gray-200',
};

const EMPTY = { name: '', type: 'playwright', platform: 'web', localPath: '', description: '' };

export default function FrameworksPage() {
  const [rows, setRows] = useState<Framework[]>([]);
  const [form, setForm] = useState<typeof EMPTY>({ ...EMPTY });
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api<Framework[]>('/frameworks').then(setRows).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);

  async function add() {
    if (!form.name || !form.localPath) return;
    setBusy(true);
    try {
      await api('/frameworks', { method: 'POST', body: JSON.stringify(form) });
      setForm({ ...EMPTY });
      load();
    } finally { setBusy(false); }
  }

  async function rescan(id: string) { await api(`/frameworks/${id}/scan`, { method: 'POST' }); load(); }
  async function remove(id: string) { await api(`/frameworks/${id}`, { method: 'DELETE' }); load(); }

  return (
    <div className="px-8 py-7 max-w-4xl">
      <h1 className="text-2xl font-semibold text-ink tracking-tight mb-1">Framework Registry</h1>
      <p className="text-sm text-muted mb-6">
        Register your local automation frameworks (Playwright, Appium/Java, …). The platform uses these paths instead of
        any hardcoded folder — so nothing depends on a specific machine layout.
      </p>

      {/* Registered frameworks */}
      <div className="flex flex-col gap-3 mb-8">
        {rows.length === 0 && <p className="text-sm text-muted">No frameworks registered yet.</p>}
        {rows.map((f) => (
          <div key={f.id} className="rounded-xl border border-line bg-surface p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-ink">{f.name}</span>
                  <span className="text-xs font-mono text-muted">{f.type} · {f.platform}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full border ${STATUS_CLS[f.validationStatus]}`}>
                    {f.validationStatus}
                  </span>
                </div>
                <div className="text-xs font-mono text-muted mt-1 truncate">{f.localPath}</div>
                <div className="text-xs text-muted mt-1">
                  {f.scanDetails}{f.version ? ` · v${f.version}` : ''}
                  {f.gitCommit ? ` · git ${f.gitCommit}${f.gitBranch ? `@${f.gitBranch}` : ''}` : ''}
                  {f.lastScan ? ` · scanned ${new Date(f.lastScan).toLocaleString()}` : ''}
                </div>
                {f.lastSuccessfulGeneration && (
                  <div className="text-xs text-green-700 mt-0.5">
                    last automation gen: {new Date(f.lastSuccessfulGeneration).toLocaleString()}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button onClick={() => rescan(f.id)} className="text-xs px-3 py-1.5 rounded-lg border border-line text-muted hover:text-ink hover:border-ink">
                  Re-scan
                </button>
                <button onClick={() => remove(f.id)} className="text-xs px-3 py-1.5 rounded-lg border border-line text-red-500 hover:border-red-400">
                  Remove
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Add a framework */}
      <section className="rounded-xl border border-line bg-surface p-5">
        <h2 className="text-sm font-semibold text-ink mb-4">Register a framework</h2>
        <div className="grid grid-cols-2 gap-4">
          <label className="block">
            <span className="text-xs font-mono uppercase tracking-wider text-muted">Name</span>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Breadfast Web (Playwright)"
              className="mt-1.5 w-full rounded-lg border border-line px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent" />
          </label>
          <label className="block">
            <span className="text-xs font-mono uppercase tracking-wider text-muted">Local path</span>
            <input value={form.localPath} onChange={(e) => setForm({ ...form, localPath: e.target.value })}
              placeholder="path to your framework clone"
              className="mt-1.5 w-full rounded-lg border border-line px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-accent" />
          </label>
          <label className="block">
            <span className="text-xs font-mono uppercase tracking-wider text-muted">Type</span>
            <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}
              className="mt-1.5 w-full rounded-lg border border-line px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-accent">
              {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-mono uppercase tracking-wider text-muted">Platform</span>
            <select value={form.platform} onChange={(e) => setForm({ ...form, platform: e.target.value })}
              className="mt-1.5 w-full rounded-lg border border-line px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-accent">
              {PLATFORMS.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
          <label className="block col-span-2">
            <span className="text-xs font-mono uppercase tracking-wider text-muted">Description (optional)</span>
            <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="mt-1.5 w-full rounded-lg border border-line px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent" />
          </label>
        </div>
        <button onClick={add} disabled={busy || !form.name || !form.localPath}
          className="mt-4 bg-accent text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-accent-bright disabled:opacity-40">
          {busy ? 'Adding…' : 'Register & scan'}
        </button>
      </section>
    </div>
  );
}
