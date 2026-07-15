'use client';

import { useEffect, useState } from 'react';
import { api } from '../../lib/api';

interface CoverageRow {
  storyKey: string; title: string; platform: string;
  acCoverage: number | null; comboCoverage: number; automationCoverage: number | null; visualCoverage: number | null;
  requiredCombos: number; executedCombos: number; testCaseCount: number; certified: boolean; gaps: string[];
}
interface CoverageMatrix {
  rows: CoverageRow[];
  overall: { stories: number; storiesCertified: number; acCoverage: number | null; comboCoverage: number; automationCoverage: number | null; visualCoverage: number | null };
  gaps: { storiesWithMissingAc: number; storiesWithMissingCombos: number; storiesWithMissingAutomation: number; storiesWithMissingVisual: number };
}

const cell = (v: number | null) => (v == null ? <span className="text-muted">—</span> : (
  <span className={v >= 90 ? 'text-emerald-700' : v >= 60 ? 'text-amber-700' : 'text-fail'}>{v}%</span>
));

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface px-4 py-3">
      <div className="text-2xl font-semibold text-ink tabular-nums">{value}</div>
      <div className="text-xs text-muted mt-0.5">{label}</div>
    </div>
  );
}

export default function CoveragePage() {
  const [data, setData] = useState<CoverageMatrix | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => { api<CoverageMatrix>('/coverage').then(setData).catch(() => setErr(true)); }, []);

  if (err) return <div className="px-8 py-7"><h1 className="text-2xl font-semibold text-ink">Coverage Matrix</h1><p className="text-sm text-fail mt-2">Failed to load coverage.</p></div>;
  if (!data) return <div className="px-8 py-7 text-sm text-muted">Loading coverage…</div>;

  const o = data.overall;
  const pct = (v: number | null) => (v == null ? '—' : `${v}%`);

  return (
    <div className="px-8 py-7 max-w-6xl">
      <h1 className="text-2xl font-semibold text-ink tracking-tight mb-1">Coverage Matrix</h1>
      <p className="text-sm text-muted mb-6">Deterministic per-story coverage across {o.stories} story(s) — reuses each run&apos;s Platform Parity Certification (no AI).</p>

      <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-5">
        <Kpi label="Stories" value={String(o.stories)} />
        <Kpi label="Certified" value={String(o.storiesCertified)} />
        <Kpi label="AC coverage" value={pct(o.acCoverage)} />
        <Kpi label="Combo coverage" value={pct(o.comboCoverage)} />
        <Kpi label="Automation" value={pct(o.automationCoverage)} />
        <Kpi label="Visual" value={pct(o.visualCoverage)} />
      </div>

      <div className="rounded-xl border border-line bg-surface p-4">
        {data.rows.length === 0 ? <p className="text-sm text-muted">No stories with a completed run yet.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-muted text-xs">
                <th className="py-1.5 pr-3">Story</th><th className="pr-3">Platform</th><th className="pr-3">AC</th>
                <th className="pr-3">Combos</th><th className="pr-3">Automation</th><th className="pr-3">Visual</th>
                <th className="pr-3">Cert</th><th className="pr-3">Gaps</th>
              </tr></thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.storyKey} className="border-t border-line align-top">
                    <td className="py-2 pr-3"><div className="font-mono text-xs text-ink">{r.storyKey}</div><div className="text-xs text-muted max-w-[240px] truncate">{r.title}</div></td>
                    <td className="pr-3 text-xs">{r.platform}</td>
                    <td className="pr-3 tabular-nums">{cell(r.acCoverage)}</td>
                    <td className="pr-3 tabular-nums">{cell(r.comboCoverage)} <span className="text-muted text-xs">({r.executedCombos}/{r.requiredCombos})</span></td>
                    <td className="pr-3 tabular-nums">{cell(r.automationCoverage)}</td>
                    <td className="pr-3 tabular-nums">{cell(r.visualCoverage)}</td>
                    <td className="pr-3">{r.certified ? <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800">certified</span> : <span className="text-[11px] px-2 py-0.5 rounded-full bg-line text-muted">—</span>}</td>
                    <td className="pr-3 text-xs text-muted">{r.gaps.length ? r.gaps.join(' · ') : '—'}</td>
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
