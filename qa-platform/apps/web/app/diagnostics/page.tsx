'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api';

type Status = 'pass' | 'warn' | 'fail' | 'skip';
interface Fix { why: string; how: string; docsUrl?: string }
interface Check {
  id: string; group: string; label: string; status: Status; detail: string;
  version?: string | null; required: boolean; fix?: Fix;
}
interface Report {
  checks: Check[];
  readiness: 'ready' | 'web-ready' | 'mobile-ready' | 'not-ready';
  summary: { pass: number; warn: number; fail: number; skip: number };
}

const PILL: Record<Status, string> = {
  pass: 'bg-green-50 text-green-700 border-green-200',
  warn: 'bg-yellow-50 text-yellow-700 border-yellow-200',
  fail: 'bg-red-50 text-red-600 border-red-200',
  skip: 'bg-gray-50 text-gray-400 border-gray-200',
};
const READINESS: Record<Report['readiness'], { label: string; cls: string }> = {
  ready: { label: 'Ready — web & mobile', cls: 'bg-green-50 text-green-700 border-green-200' },
  'web-ready': { label: 'Web-ready', cls: 'bg-green-50 text-green-700 border-green-200' },
  'mobile-ready': { label: 'Mobile-ready', cls: 'bg-green-50 text-green-700 border-green-200' },
  'not-ready': { label: 'Not ready — required checks failing', cls: 'bg-red-50 text-red-600 border-red-200' },
};
const GROUPS = ['core', 'integrations', 'frameworks', 'tools'] as const;
const GROUP_LABEL: Record<string, string> = { core: 'Core', integrations: 'Integrations', frameworks: 'Frameworks', tools: 'Mobile toolchain' };

export default function DiagnosticsPage() {
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setBusy(true);
    api<Report>('/diagnostics').then(setReport).catch(() => {}).finally(() => setBusy(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  async function retest(id: string) {
    setBusy(true);
    try { setReport(await api<Report>(`/diagnostics/${id}/retest`, { method: 'POST' })); } finally { setBusy(false); }
  }

  return (
    <div className="px-8 py-7 max-w-3xl">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-2xl font-semibold text-ink tracking-tight">Diagnostics</h1>
        <button onClick={load} disabled={busy} className="text-sm px-4 py-2 rounded-lg border border-line text-muted hover:text-ink hover:border-ink disabled:opacity-40">
          {busy ? 'Checking…' : 'Re-test all'}
        </button>
      </div>
      <p className="text-sm text-muted mb-5">Environment health — required checks must pass before a story can execute.</p>

      {report && (
        <div className={`inline-flex items-center gap-2 text-sm font-medium px-3 py-1.5 rounded-full border mb-6 ${READINESS[report.readiness].cls}`}>
          {READINESS[report.readiness].label}
          <span className="font-mono text-xs opacity-70">
            {report.summary.pass}✓ {report.summary.warn}! {report.summary.fail}✗
          </span>
        </div>
      )}

      {GROUPS.map((g) => {
        const items = report?.checks.filter((c) => c.group === g) ?? [];
        if (!items.length) return null;
        return (
          <section key={g} className="mb-5">
            <h2 className="text-xs font-mono uppercase tracking-wider text-muted mb-2">{GROUP_LABEL[g]}</h2>
            <div className="flex flex-col gap-2">
              {items.map((c) => (
                <div key={c.id} className="rounded-xl border border-line bg-surface p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-ink text-sm">{c.label}</span>
                        {c.required && <span className="text-[10px] uppercase tracking-wide text-muted">required</span>}
                        <span className={`text-xs px-2 py-0.5 rounded-full border ${PILL[c.status]}`}>{c.status}</span>
                      </div>
                      <div className="text-xs text-muted mt-1 break-all">{c.detail}</div>
                    </div>
                    {c.status !== 'pass' && c.status !== 'skip' && (
                      <button onClick={() => retest(c.id)} disabled={busy} className="text-xs px-3 py-1.5 rounded-lg border border-line text-muted hover:text-ink hover:border-ink shrink-0 disabled:opacity-40">
                        Re-test
                      </button>
                    )}
                  </div>
                  {c.fix && (
                    <div className="mt-3 rounded-lg bg-gray-50 border border-line p-3 text-xs text-body">
                      <div><span className="font-semibold">Why:</span> {c.fix.why}</div>
                      <div className="mt-1"><span className="font-semibold">How to fix:</span> {c.fix.how}</div>
                      {c.fix.docsUrl && (
                        <a href={c.fix.docsUrl} target="_blank" rel="noreferrer" className="text-accent mt-1 inline-block">Where to get it ↗</a>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
