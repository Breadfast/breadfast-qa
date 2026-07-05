'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, type DashboardSummary } from '../lib/api';

const STAT_META: Array<{ key: keyof DashboardSummary['cards']; label: string; tone: string }> = [
  { key: 'active', label: 'Active stories', tone: 'text-accent' },
  { key: 'running', label: 'Running jobs', tone: 'text-ai' },
  { key: 'awaitingGates', label: 'Awaiting approval', tone: 'text-warn' },
  { key: 'defects', label: 'Open defects', tone: 'text-fail' },
  { key: 'completed', label: 'Completed', tone: 'text-pass' },
];

export default function DashboardPage() {
  const [data, setData] = useState<DashboardSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [onboarded, setOnboarded] = useState<boolean | null>(null);

  useEffect(() => {
    api<DashboardSummary>('/dashboard').then(setData).catch((e) => setError(String(e)));
    api<{ completed: boolean }>('/onboarding/state').then((s) => setOnboarded(s.completed)).catch(() => setOnboarded(null));
  }, []);

  return (
    <div className="px-8 py-7 max-w-6xl">
      <header className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-ink tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted mt-0.5">Single entry point for all QA activities.</p>
        </div>
        <Link
          href="/stories/new"
          className="bg-accent text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-accent-bright transition-colors"
        >
          ＋ New Story
        </Link>
      </header>

      {onboarded === false && (
        <div className="rounded-xl border border-accent/30 bg-[#EAF4F8] p-5 mb-6 flex items-center justify-between gap-4">
          <div>
            <div className="text-sm font-semibold text-ink">Finish setting up your environment</div>
            <p className="text-sm text-muted mt-0.5">
              Configure your frameworks and integrations, and verify your environment is ready — before running your first story.
            </p>
          </div>
          <Link
            href="/onboarding"
            className="shrink-0 bg-accent text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-accent-bright transition-colors"
          >
            Go to Setup →
          </Link>
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-line bg-surface p-4 text-sm text-muted">
          Could not reach the API ({error}). Start it with <code className="font-mono">npm run dev:api</code> and sign in.
        </div>
      )}

      {data && (
        <>
          <section className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-7">
            {STAT_META.map((s) => (
              <div key={s.key} className="rounded-xl border border-line bg-surface p-4">
                <div className={`text-3xl font-semibold tnum ${s.tone}`}>{data.cards[s.key]}</div>
                <div className="text-xs text-muted mt-1">{s.label}</div>
              </div>
            ))}
          </section>

          <section className="rounded-xl border border-line bg-surface">
            <div className="px-5 py-3 border-b border-line text-sm font-semibold text-ink">Recent runs</div>
            <ul className="divide-y divide-line">
              {data.recentRuns.length === 0 && (
                <li className="px-5 py-6 text-sm text-muted">No runs yet — create a story and hit Run QA.</li>
              )}
              {data.recentRuns.map((r) => (
                <li key={r.id} className="px-5 py-3 flex items-center justify-between text-sm">
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-accent">{r.story.jiraKey}</span>
                    <span className="text-body truncate max-w-md">{r.story.title}</span>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="font-mono text-xs tnum text-muted">${r.totalCostUsd.toFixed(3)}</span>
                    <StatusPill status={r.status} />
                  </div>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    running: 'bg-[#EEEBFA] text-ai',
    paused: 'bg-[#FBF1DE] text-warn',
    succeeded: 'bg-[#E7F5ED] text-pass',
    failed: 'bg-[#FBEAE8] text-fail',
    queued: 'bg-[#EEF2F6] text-body',
  };
  return (
    <span className={`font-mono text-[11px] px-2 py-0.5 rounded-full ${map[status] ?? 'bg-[#EEF2F6] text-body'}`}>
      {status}
    </span>
  );
}
