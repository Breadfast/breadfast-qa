'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '../../lib/api';

type Status = 'pass' | 'warn' | 'fail' | 'skip';
interface Check { id: string; group: string; label: string; status: Status; detail: string; required: boolean; fix?: { why: string; how: string; docsUrl?: string } }
interface Report { checks: Check[]; readiness: 'ready' | 'web-ready' | 'mobile-ready' | 'not-ready'; summary: { pass: number; warn: number; fail: number; skip: number } }

const STEPS = ['Welcome', 'Environment', 'Configure', 'Health Report'] as const;
const PILL: Record<Status, string> = {
  pass: 'bg-green-50 text-green-700 border-green-200',
  warn: 'bg-yellow-50 text-yellow-700 border-yellow-200',
  fail: 'bg-red-50 text-red-600 border-red-200',
  skip: 'bg-gray-50 text-gray-400 border-gray-200',
};
const READY: Record<Report['readiness'], { label: string; cls: string; ok: boolean }> = {
  ready: { label: 'Ready — you can execute web & mobile stories', cls: 'bg-green-50 text-green-700 border-green-200', ok: true },
  'web-ready': { label: 'Web-ready — web stories can run (mobile toolchain incomplete)', cls: 'bg-green-50 text-green-700 border-green-200', ok: true },
  'mobile-ready': { label: 'Mobile-ready', cls: 'bg-green-50 text-green-700 border-green-200', ok: true },
  'not-ready': { label: 'Not ready — resolve the required checks below', cls: 'bg-red-50 text-red-600 border-red-200', ok: false },
};

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [report, setReport] = useState<Report | null>(null);
  const [env, setEnv] = useState<{ companionDir: string; workspaceDir: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const loadReport = useCallback(() => {
    setBusy(true);
    api<Report>('/diagnostics').then(setReport).catch(() => {}).finally(() => setBusy(false));
  }, []);
  useEffect(() => {
    api<{ companionDir: string; workspaceDir: string }>('/onboarding/env').then(setEnv).catch(() => {});
    loadReport();
  }, [loadReport]);

  async function finish() {
    setBusy(true);
    try { await api('/onboarding/complete', { method: 'POST' }); router.push('/'); } finally { setBusy(false); }
  }

  const core = report?.checks.filter((c) => c.group === 'core') ?? [];

  return (
    <div className="px-8 py-7 max-w-3xl">
      <h1 className="text-2xl font-semibold text-ink tracking-tight mb-1">Welcome to Breadfast QA</h1>
      <p className="text-sm text-muted mb-5">A few checks and you’re ready to run the full QA workflow on your machine.</p>

      <div className="flex items-center gap-1 text-[11px] font-mono mb-5">
        {STEPS.map((s, i) => (
          <div key={s} className="flex items-center gap-1">
            <span className={`px-2 py-1 rounded-full ${i === step ? 'bg-accent text-white' : i < step ? 'text-accent' : 'text-muted'}`}>{i + 1}. {s}</span>
            {i < STEPS.length - 1 && <span className="text-line">—</span>}
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-line bg-surface p-6 flex flex-col gap-4">
        {step === 0 && (
          <div className="text-sm text-body leading-relaxed">
            <p>This platform is an orchestration layer over the canonical AI QA Companion — it runs the frozen 27-step workflow locally on your Claude subscription.</p>
            <ul className="list-disc ml-5 mt-3 space-y-1 text-muted">
              <li>Runs locally — your stories, reports and data stay on your machine.</li>
              <li>Only reusable knowledge (CLAUDE.md + docs/ai) is shared via the repo.</li>
              <li>This wizard verifies your environment and points you at anything missing.</li>
            </ul>
          </div>
        )}

        {step === 1 && (
          <>
            <div className="text-sm font-medium text-ink">Environment</div>
            {env && (
              <div className="rounded-lg border border-line divide-y divide-line text-sm">
                <Row k="Repo / knowledge base" v={env.companionDir} />
                <Row k="Runtime workspace" v={env.workspaceDir} />
              </div>
            )}
            <p className="text-xs text-muted">Runtime data (DB, artifacts, logs, sessions) lives in the workspace, outside the repo. Override with <code>QA_WORKSPACE_DIR</code>.</p>
            <div className="text-sm font-medium text-ink mt-2">Prerequisites</div>
            <div className="flex flex-col gap-2">
              {core.map((c) => <CheckRow key={c.id} c={c} />)}
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <div className="text-sm font-medium text-ink">Configure integrations & frameworks</div>
            <p className="text-sm text-muted">Set these up now, or later — the platform will prompt for anything a run actually needs.</p>
            <div className="grid grid-cols-2 gap-3">
              <ConfigCard href="/frameworks" title="Framework Registry" desc="Register your Playwright / Appium framework clones." />
              <ConfigCard href="/settings" title="Integrations" desc="Jira, BrowserStack, Figma, AI — with connection help." />
              <ConfigCard href="/settings" title="Figma session" desc="Connect Figma for visual export (Settings)." />
              <ConfigCard href="/stories/new" title="Project Profiles" desc="Pick a project to pre-fill story defaults." />
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium text-ink">Environment Health Report</div>
              <button onClick={loadReport} disabled={busy} className="text-xs px-3 py-1.5 rounded-lg border border-line text-muted hover:text-ink disabled:opacity-40">
                {busy ? 'Checking…' : 'Refresh'}
              </button>
            </div>
            {report && (
              <>
                <div className={`inline-flex items-center gap-2 text-sm font-medium px-3 py-1.5 rounded-full border ${READY[report.readiness].cls}`}>
                  {READY[report.readiness].label}
                  <span className="font-mono text-xs opacity-70">{report.summary.pass}✓ {report.summary.warn}! {report.summary.fail}✗</span>
                </div>
                <div className="flex flex-col gap-2 mt-2">
                  {report.checks.map((c) => <CheckRow key={c.id} c={c} />)}
                </div>
                <p className="text-xs text-muted mt-1">
                  <Link href="/diagnostics" className="text-accent">Full diagnostics</Link> with per-check re-test and fix steps.
                </p>
              </>
            )}
          </>
        )}

        <div className="flex items-center justify-between pt-3 border-t border-line">
          <button onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0} className="text-sm px-4 py-2 rounded-lg border border-line text-body hover:border-accent disabled:opacity-30">‹ Back</button>
          {step < STEPS.length - 1 ? (
            <button onClick={() => setStep((s) => s + 1)} className="text-sm font-medium px-5 py-2 rounded-lg bg-accent text-white hover:bg-accent-bright">Next ›</button>
          ) : (
            <button onClick={finish} disabled={busy} className="text-sm font-medium px-5 py-2 rounded-lg bg-accent text-white hover:bg-accent-bright disabled:opacity-40">
              {busy ? 'Finishing…' : 'Finish & go to dashboard'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-4 px-3 py-2">
      <span className="text-muted">{k}</span>
      <span className="text-ink font-mono text-xs text-right break-all">{v}</span>
    </div>
  );
}
function CheckRow({ c }: { c: Check }) {
  return (
    <div className="rounded-lg border border-line p-3">
      <div className="flex items-center gap-2">
        <span className="text-sm text-ink">{c.label}</span>
        {c.required && <span className="text-[10px] uppercase tracking-wide text-muted">required</span>}
        <span className={`text-xs px-2 py-0.5 rounded-full border ml-auto ${PILL[c.status]}`}>{c.status}</span>
      </div>
      <div className="text-xs text-muted mt-1 break-all">{c.detail}</div>
      {c.fix && (
        <div className="text-xs text-body mt-2">
          <span className="font-semibold">Fix:</span> {c.fix.how}
          {c.fix.docsUrl && <a href={c.fix.docsUrl} target="_blank" rel="noreferrer" className="text-accent ml-1">↗</a>}
        </div>
      )}
    </div>
  );
}
function ConfigCard({ href, title, desc }: { href: string; title: string; desc: string }) {
  return (
    <Link href={href} className="rounded-lg border border-line p-4 hover:border-accent transition-colors">
      <div className="text-sm font-medium text-ink">{title} ↗</div>
      <div className="text-xs text-muted mt-1">{desc}</div>
    </Link>
  );
}
