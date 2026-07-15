'use client';

import { useEffect, useState } from 'react';
import { api } from '../../lib/api';

interface TeamMember {
  ownerId: string; ownerName: string; runs: number; completedRuns: number;
  avgStoryHealth: number | null; avgReviewConfidence: number | null; avgParity: number | null;
  totalCostUsd: number; openDefects: number;
}
interface TrendPoint { runId: string; storyKey: string; at: string | null; parity: number | null; review: number | null; health: number | null }
interface Analytics {
  totals: { stories: number; runs: number; completedRuns: number; successRate: number; totalCostUsd: number; totalTokens: number; openDefects: number; totalDefects: number };
  averages: { parity: number | null; reviewConfidence: number | null; storyHealth: number | null };
  distributions: { parityCertification: Record<string, number>; storyHealthLevel: Record<string, number>; reviewLevel: Record<string, number> };
  recommendations: { total: number; byCategory: Record<string, number>; bySeverity: Record<string, number> };
  defects: { bySeverity: Record<string, number>; byStatus: Record<string, number> };
  trend: TrendPoint[];
  team: TeamMember[];
  generatedFromRuns: number;
}

const n = (v: number | null | undefined, suffix = '') => (v == null ? '—' : `${v}${suffix}`);

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface px-4 py-3">
      <div className="text-2xl font-semibold text-ink tabular-nums">{value}</div>
      <div className="text-xs text-muted mt-0.5">{label}</div>
    </div>
  );
}
function DistBar({ title, dist }: { title: string; dist: Record<string, number> }) {
  const entries = Object.entries(dist);
  const total = entries.reduce((a, [, v]) => a + v, 0) || 1;
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <h3 className="text-xs font-mono uppercase tracking-wider text-muted mb-2">{title}</h3>
      {entries.length === 0 ? <p className="text-sm text-muted">No data yet.</p> : (
        <ul className="flex flex-col gap-1.5">
          {entries.map(([k, v]) => (
            <li key={k} className="text-sm">
              <div className="flex justify-between"><span className="text-ink">{k}</span><span className="text-muted tabular-nums">{v}</span></div>
              <div className="h-1.5 bg-line rounded-full mt-1"><div className="h-1.5 bg-accent rounded-full" style={{ width: `${(v / total) * 100}%` }} /></div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function AnalyticsPage() {
  const [data, setData] = useState<Analytics | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => { api<Analytics>('/analytics').then(setData).catch(() => setErr(true)); }, []);

  if (err) return <div className="px-8 py-7"><h1 className="text-2xl font-semibold text-ink">Analytics</h1><p className="text-sm text-fail mt-2">Failed to load analytics.</p></div>;
  if (!data) return <div className="px-8 py-7 text-sm text-muted">Loading analytics…</div>;

  return (
    <div className="px-8 py-7 max-w-6xl">
      <h1 className="text-2xl font-semibold text-ink tracking-tight mb-1">QA Analytics</h1>
      <p className="text-sm text-muted mb-6">Deterministic roll-up across {data.generatedFromRuns} run(s) — derived from persisted run intelligence (no AI).</p>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <Kpi label="Stories" value={String(data.totals.stories)} />
        <Kpi label="Runs" value={String(data.totals.runs)} />
        <Kpi label="Success rate" value={n(data.totals.successRate, '%')} />
        <Kpi label="Open defects" value={String(data.totals.openDefects)} />
        <Kpi label="Avg Story Health" value={n(data.averages.storyHealth)} />
        <Kpi label="Avg Review Confidence" value={n(data.averages.reviewConfidence)} />
        <Kpi label="Avg Parity" value={n(data.averages.parity)} />
        <Kpi label="Total cost (USD)" value={`$${data.totals.totalCostUsd}`} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
        <DistBar title="Parity certification" dist={data.distributions.parityCertification} />
        <DistBar title="Story Health level" dist={data.distributions.storyHealthLevel} />
        <DistBar title="Review Confidence level" dist={data.distributions.reviewLevel} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
        <DistBar title={`Recommendations by category (${data.recommendations.total})`} dist={data.recommendations.byCategory} />
        <DistBar title="Defects by severity" dist={data.defects.bySeverity} />
      </div>

      <div className="rounded-xl border border-line bg-surface p-4 mb-4">
        <h3 className="text-xs font-mono uppercase tracking-wider text-muted mb-2">Team insights</h3>
        {data.team.length === 0 ? <p className="text-sm text-muted">No data yet.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-muted text-xs">
                <th className="py-1.5 pr-3">Owner</th><th className="pr-3">Runs</th><th className="pr-3">Done</th>
                <th className="pr-3">Avg Health</th><th className="pr-3">Avg Review</th><th className="pr-3">Avg Parity</th>
                <th className="pr-3">Open defects</th><th className="pr-3">Cost</th>
              </tr></thead>
              <tbody>
                {data.team.map((t) => (
                  <tr key={t.ownerId} className="border-t border-line">
                    <td className="py-1.5 pr-3 text-ink">{t.ownerName}</td>
                    <td className="pr-3 tabular-nums">{t.runs}</td><td className="pr-3 tabular-nums">{t.completedRuns}</td>
                    <td className="pr-3 tabular-nums">{n(t.avgStoryHealth)}</td><td className="pr-3 tabular-nums">{n(t.avgReviewConfidence)}</td>
                    <td className="pr-3 tabular-nums">{n(t.avgParity)}</td><td className="pr-3 tabular-nums">{t.openDefects}</td>
                    <td className="pr-3 tabular-nums">${t.totalCostUsd}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="rounded-xl border border-line bg-surface p-4">
        <h3 className="text-xs font-mono uppercase tracking-wider text-muted mb-2">Trend (chronological)</h3>
        {data.trend.length === 0 ? <p className="text-sm text-muted">No runs yet.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-muted text-xs"><th className="py-1.5 pr-3">Story</th><th className="pr-3">When</th><th className="pr-3">Parity</th><th className="pr-3">Review</th><th className="pr-3">Health</th></tr></thead>
              <tbody>
                {data.trend.map((p) => (
                  <tr key={p.runId} className="border-t border-line">
                    <td className="py-1.5 pr-3 text-ink font-mono text-xs">{p.storyKey}</td>
                    <td className="pr-3 text-muted text-xs">{p.at ? new Date(p.at).toLocaleString() : '—'}</td>
                    <td className="pr-3 tabular-nums">{n(p.parity)}</td><td className="pr-3 tabular-nums">{n(p.review)}</td><td className="pr-3 tabular-nums">{n(p.health)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
