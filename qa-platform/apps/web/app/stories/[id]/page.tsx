'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { GATE_SOURCE, type LifecycleNode } from '@qa/shared';
import { api, API_BASE } from '../../../lib/api';

interface StepError { message: string; isTimeout: boolean; durationMs: number; stack?: string }
interface Step {
  id: string;
  name: string;
  type: string;
  status: string;
  ordinal: number;
  logs?: string | null;
  outputJson?: unknown;
  feedback?: string | null;
  attempt?: number;
  errorJson?: StepError | null;
  approval?: { action: string; decision?: string | null; payload?: unknown } | null;
  clarification?: { questionsJson: unknown; answersJson?: unknown } | null;
}

interface CredentialSpec {
  key: string; label: string; description: string; whenUsed: string;
  secret: boolean; group: string; obtainText?: string; obtainUrl?: string;
}
type CredentialRequest = { reason: string; credentials: CredentialSpec[] };
type ClarifyQuestion = { id: string; question: string; why?: string };

/** A clarification carries either free-form questions or a credential request. */
function credentialRequestOf(step: Step): CredentialRequest | null {
  const q = step.clarification?.questionsJson as { credentialRequest?: CredentialRequest } | undefined;
  return q && typeof q === 'object' && 'credentialRequest' in q ? q.credentialRequest ?? null : null;
}
interface RunDetail {
  id: string;
  status: string;
  pauseReason?: string | null;
  totalCostUsd: number;
  story: { jiraKey: string; title: string; status: string };
  steps: Step[];
}

/** "Step 14 of 27 · 13 remaining · 2 skipped" — cheap client-side progress summary. */
function progressSummary(run: RunDetail): string {
  const total = run.steps.length;
  const completed = run.steps.filter((s) => s.status === 'succeeded' || s.status === 'skipped' || s.status === 'rejected').length;
  const skipped = run.steps.filter((s) => s.status === 'skipped').length;
  const remaining = total - completed;
  const current = run.steps.find((s) => s.status === 'running');
  const parts = [`${completed}/${total} steps complete`];
  if (current) parts.push(`on ${label(current.name)}`);
  if (remaining > 0) parts.push(`${remaining} remaining`);
  if (skipped > 0) parts.push(`${skipped} skipped`);
  return parts.join(' · ');
}

const PAUSE_REASON_COPY: Record<string, { title: string; body: string }> = {
  manual: {
    title: 'Run paused',
    body: 'This run was paused manually. Steps that already succeeded are untouched — hit Resume to continue exactly where it left off.',
  },
  usage_limit: {
    title: 'Paused automatically',
    body: 'Claude usage reached the limit. Resume this run after your usage resets.',
  },
};
interface Story {
  id: string;
  jiraKey: string;
  title: string;
  platform: string;
  status: string;
  runs: Array<{ id: string; status: string }>;
}

const ICON: Record<string, string> = {
  pending: '○', running: '◐', awaiting_approval: '⏸', awaiting_input: '⏸',
  succeeded: '●', rejected: '✕', failed: '✕', skipped: '–', cancelled: '■', interrupted: '⏸',
};
const TONE: Record<string, string> = {
  succeeded: 'text-pass', running: 'text-ai', awaiting_approval: 'text-warn',
  awaiting_input: 'text-warn', failed: 'text-fail', rejected: 'text-fail', pending: 'text-muted',
  skipped: 'text-muted', cancelled: 'text-fail', interrupted: 'text-warn',
};

export default function StoryWorkspace() {
  const { id } = useParams<{ id: string }>();
  const [story, setStory] = useState<Story | null>(null);
  const [run, setRun] = useState<RunDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  const loadRun = useCallback(async (runId: string) => {
    const r = await api<RunDetail>(`/runs/${runId}`);
    setRun(r);
  }, []);

  const loadStory = useCallback(async () => {
    const s = await api<Story>(`/stories/${id}`);
    setStory(s);
    if (s.runs[0]) await loadRun(s.runs[0].id);
  }, [id, loadRun]);

  useEffect(() => { loadStory(); }, [loadStory]);

  // Subscribe to the live run stream; refetch the run on every event.
  // A polling fallback guarantees the timeline keeps refreshing even if the
  // SSE connection silently drops (proxy idle-timeout, sleep, etc.) — otherwise
  // the page can freeze on a stale "running" step and look stuck.
  useEffect(() => {
    const runId = story?.runs[0]?.id;
    if (!runId) return;
    const es = new EventSource(`${API_BASE}/runs/${runId}/events`, { withCredentials: true });
    es.onmessage = () => loadRun(runId);
    ['step.started', 'step.finished', 'run.status', 'gate.awaiting', 'ask.awaiting', 'credential.awaiting', 'step.log'].forEach((t) =>
      es.addEventListener(t, () => loadRun(runId)),
    );
    esRef.current = es;
    const poll = setInterval(() => loadRun(runId), 5000);
    return () => { es.close(); clearInterval(poll); };
  }, [story?.runs, loadRun]);

  async function runQA() {
    setBusy(true);
    try {
      await api(`/stories/${id}/runs`, { method: 'POST' });
      await loadStory();
    } finally {
      setBusy(false);
    }
  }

  async function stopRun() {
    if (!run) return;
    setBusy(true);
    try {
      await api(`/runs/${run.id}/cancel`, { method: 'POST' });
      await loadRun(run.id);
    } finally {
      setBusy(false);
    }
  }

  async function pauseRun() {
    if (!run) return;
    setBusy(true);
    try {
      await api(`/runs/${run.id}/pause`, { method: 'POST' });
      await loadRun(run.id);
    } finally {
      setBusy(false);
    }
  }

  async function resumeRun() {
    if (!run) return;
    setBusy(true);
    try {
      await api(`/runs/${run.id}/resume`, { method: 'POST' });
      await loadRun(run.id);
    } finally {
      setBusy(false);
    }
  }

  if (!story) return <div className="px-8 py-7 text-sm text-muted">Loading…</div>;

  const blocking = run?.steps.find((s) => s.status === 'awaiting_input' || s.status === 'awaiting_approval');
  function scrollToBlocking() {
    if (blocking) document.getElementById(`step-${blocking.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  return (
    <div className="px-8 py-7 max-w-4xl">
      <header className="flex items-center justify-between mb-5">
        <div>
          <div className="flex items-center gap-3">
            <span className="font-mono text-accent text-lg">{story.jiraKey}</span>
            <h1 className="text-xl font-semibold text-ink">{story.title}</h1>
          </div>
          <div className="text-xs text-muted mt-1 font-mono">{story.platform} · status: {run?.status ?? story.status}</div>
          {run && <div className="text-xs text-muted mt-0.5 font-mono">{progressSummary(run)}</div>}
        </div>
        <div className="flex items-center gap-3">
          {run && <span className="font-mono text-xs text-muted tnum">${run.totalCostUsd.toFixed(3)}</span>}
          {run && ['queued', 'running'].includes(run.status) && (
            <button onClick={pauseRun} disabled={busy}
              className="border border-warn/50 text-warn text-sm font-medium px-4 py-2 rounded-lg hover:bg-warn/10 disabled:opacity-40">
              {busy ? 'Pausing…' : 'Pause'}
            </button>
          )}
          {run && ['queued', 'running', 'pausing', 'paused'].includes(run.status) && (
            <button onClick={stopRun} disabled={busy}
              className="border border-fail/50 text-fail text-sm font-medium px-4 py-2 rounded-lg hover:bg-fail/10 disabled:opacity-40">
              {busy ? 'Stopping…' : 'Stop'}
            </button>
          )}
          {(run?.status === 'cancelled' || run?.status === 'failed'
            || (run?.status === 'paused' && (run.pauseReason === 'manual' || run.pauseReason === 'usage_limit'))) && (
            <button onClick={resumeRun} disabled={busy}
              className="border border-accent text-accent text-sm font-medium px-4 py-2 rounded-lg hover:bg-accent/10 disabled:opacity-40">
              {busy ? 'Resuming…' : 'Resume'}
            </button>
          )}
          <button onClick={runQA} disabled={busy} className="bg-accent text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-accent-bright disabled:opacity-40">
            {busy ? 'Starting…' : run ? 'Re-run QA (restart)' : 'Run QA'}
          </button>
        </div>
      </header>

      {!run && <p className="text-sm text-muted">No run yet — hit <strong>Run QA</strong> to start the workflow.</p>}

      {run?.status === 'pausing' && (
        <div className="w-full mb-4 flex items-center gap-3 rounded-xl border border-warn/50 bg-[#FBF1DE] px-4 py-3">
          <span className="text-warn text-lg">⏸</span>
          <span className="text-sm text-ink">Pausing — the current step will finish, then the run will stop.</span>
        </div>
      )}

      {run?.status === 'paused' && run.pauseReason && PAUSE_REASON_COPY[run.pauseReason] && (
        <div className="w-full mb-4 flex items-center gap-3 rounded-xl border border-warn/50 bg-[#FBF1DE] px-4 py-3">
          <span className="text-warn text-lg">⏸</span>
          <span className="flex-1">
            <span className="block text-sm font-semibold text-ink">{PAUSE_REASON_COPY[run.pauseReason].title}</span>
            <span className="block text-xs text-muted">{PAUSE_REASON_COPY[run.pauseReason].body}</span>
          </span>
        </div>
      )}

      {blocking && (
        <button onClick={scrollToBlocking}
          className="w-full mb-4 flex items-center gap-3 rounded-xl border border-warn/50 bg-[#FBF1DE] px-4 py-3 text-left hover:bg-[#F8EACB]">
          <span className="text-warn text-lg">⏸</span>
          <span className="flex-1">
            <span className="block text-sm font-semibold text-ink">
              {blocking.status === 'awaiting_input'
                ? credentialRequestOf(blocking) ? 'A credential is needed' : 'Awaiting your input'
                : 'Awaiting your approval'} — {label(blocking.name)}
            </span>
            <span className="block text-xs text-muted">
              {blocking.status === 'awaiting_input'
                ? credentialRequestOf(blocking)
                  ? 'The run is paused because a required credential isn’t configured — provide it below (Use Once / Save to My Settings / Cancel Run).'
                  : 'The run is paused for clarification — answer the questions below to continue.'
                : `The run is paused for approval${blocking.approval ? ` (${blocking.approval.action})` : ''} — review and approve/reject below to continue.`}
            </span>
          </span>
          <span className="text-xs font-medium text-accent whitespace-nowrap">Jump to it →</span>
        </button>
      )}

      {run && (
        <ol className="rounded-xl border border-line bg-surface divide-y divide-line">
          {run.steps.map((s) => (
            <li key={s.id} id={`step-${s.id}`} className="px-5 py-3 scroll-mt-6 relative">
              <div className="flex items-center gap-3 text-sm">
                <span className={`${TONE[s.status] ?? 'text-muted'} w-4 text-center`}>{ICON[s.status] ?? '○'}</span>
                <span className="text-ink font-medium">{label(s.name)}</span>
                <span className="font-mono text-[10px] uppercase tracking-wider text-muted ml-auto">{s.type}</span>
                {!['running', 'pausing', 'cancelling'].includes(run.status) && s.status !== 'pending' && (
                  <RestartControl runId={run.id} step={s} allSteps={run.steps} onDone={() => loadRun(run.id)} />
                )}
              </div>
              {s.logs && <div className="ml-7 mt-1 font-mono text-[11px] text-muted whitespace-pre-wrap">{s.logs}</div>}
              {(s.status === 'failed' || s.status === 'interrupted') && (
                <FailureCard runId={run.id} step={s} onDone={() => loadRun(run.id)} />
              )}
              {s.status === 'awaiting_approval' && s.approval && (
                <GateCard runId={run.id} step={s} onDone={() => loadRun(run.id)} />
              )}
              {s.status === 'awaiting_input' && s.clarification && (
                credentialRequestOf(s)
                  ? <CredentialCard runId={run.id} step={s} request={credentialRequestOf(s)!} onDone={() => loadRun(run.id)} />
                  : <ClarifyCard runId={run.id} step={s} onDone={() => loadRun(run.id)} />
              )}
            </li>
          ))}
        </ol>
      )}

      {run && <ActivityTimelinePanel runId={run.id} status={run.status} />}

      {/* Unconditional once a run exists (matches ActivityTimelinePanel) — the panel and the
          /explain endpoint already degrade gracefully section-by-section (Story Health/
          Recommendations/Review Confidence only render if present; the artifact-citation list
          is independent of parity and comes from requirements/HLS/testcases/defects data that
          can exist long before html_report runs). Gating on run.status or parityJson would hide
          real, already-available citations for any run that hasn't reached/computed those yet
          — including every run from before parity/health computation existed (Run Lifecycle
          Management: a run that failed/paused after html_report should still show everything
          that's actually there, not less than what a plain artifact fetch already returns). */}
      {run && <ExplainabilityPanel runId={run.id} />}

      {run?.status === 'succeeded' && (
        <SignoffCard storyId={id} signedOff={story.status === 'signed_off'} onDone={loadStory} />
      )}
    </div>
  );
}

// ── AI Explainability + Review Confidence (Phase 2 M2) ───────────────────────
interface ResolvedCite { kind: string; ref: string; label: string; title?: string; href?: string }
interface Explanation {
  artifactKind: string; artifactLabel: string; node: string; reason: string;
  contributed: {
    acceptanceCriteria: ResolvedCite[]; storyComments: ResolvedCite[]; figmaFrames: ResolvedCite[];
    businessRules: ResolvedCite[]; testCases: ResolvedCite[]; other: ResolvedCite[];
  };
  versions: { prompt?: string | null; workflow?: string | null; knowledge?: string | null; framework?: string | null; platform?: string | null };
  evidence: string[];
}
interface ReviewSignal { key: string; label: string; applicable: boolean; satisfied: boolean }
interface HealthDimension { key: string; label: string; applicable: boolean; score: number; level: string; detail: string }
interface StoryHealth { score: number; level: string; summary: string; reductions: string[]; dimensions: HealthDimension[] }
interface Recommendation {
  id: string; title: string; category: string; severity: string; impact: string; effort: string;
  expectedBenefit: string; confidence: string; priorityScore: number; rootCause: string;
  actions: string[]; eliminatesFindings: number; layer: string; derivedFrom: string[];
}
interface ExplainResponse {
  reviewConfidence: { score: number; level: string; reductions: string[]; signals: ReviewSignal[] } | null;
  storyHealth: StoryHealth | null;
  recommendations: Recommendation[] | null;
  versions: Record<string, string | null>;
  artifacts: Explanation[];
}

function sevChip(sev: string) {
  return sev === 'critical' || sev === 'major' ? 'bg-fail/10 text-fail' : sev === 'minor' ? 'bg-amber-100 text-amber-800' : 'bg-line text-muted';
}

function levelTone(level: string) {
  return level === 'high' ? 'text-emerald-700' : level === 'medium' ? 'text-amber-700' : 'text-fail';
}
function levelChip(level: string) {
  return level === 'high' ? 'bg-emerald-100 text-emerald-800' : level === 'medium' ? 'bg-amber-100 text-amber-800' : 'bg-fail/10 text-fail';
}

function citeChips(list: ResolvedCite[]) {
  if (!list.length) return <span className="text-muted">—</span>;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {list.map((c, i) =>
        c.href ? (
          <a key={i} href={c.href} target="_blank" rel="noreferrer" title={c.title}
            className="text-[11px] px-2 py-0.5 rounded-full bg-accent/10 text-accent hover:bg-accent/20">{c.label}</a>
        ) : (
          <span key={i} title={c.title} className="text-[11px] px-2 py-0.5 rounded-full bg-line text-ink">{c.label}</span>
        ),
      )}
    </span>
  );
}

function ExplainabilityPanel({ runId }: { runId: string }) {
  const [data, setData] = useState<ExplainResponse | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  useEffect(() => { api<ExplainResponse>(`/runs/${runId}/explain`).then(setData).catch(() => {}); }, [runId]);
  if (!data) return null;
  const rc = data.reviewConfidence;
  const sh = data.storyHealth;
  const recs = data.recommendations ?? [];
  const tone = rc ? levelTone(rc.level) : 'text-muted';

  return (
    <section className="mt-6">
      {sh && (
        <div className="rounded-xl border border-line bg-surface px-5 py-4 mb-4">
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold text-ink">Story Health</span>
            <span className={`font-mono text-sm font-semibold ${levelTone(sh.level)}`}>{sh.level.toUpperCase()} · {sh.score}</span>
            <span className="text-xs text-muted">deterministic roll-up (no AI) · reuses Parity + Review Confidence + Visual Health</span>
          </div>
          <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2">
            {sh.dimensions.map((d) => (
              <div key={d.key} title={d.detail}
                className={`rounded-lg border border-line px-3 py-2 ${d.applicable ? '' : 'opacity-50'}`}>
                <div className="text-xs text-muted">{d.label}</div>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className="font-mono text-lg font-semibold text-ink">{d.applicable ? d.score : '—'}</span>
                  {d.applicable
                    ? <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${levelChip(d.level)}`}>{d.level}</span>
                    : <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-line text-muted">n/a</span>}
                </div>
              </div>
            ))}
          </div>
          {sh.reductions.length > 0 && (
            <ul className="mt-3 text-xs text-muted list-disc pl-5">
              {sh.reductions.map((r, i) => <li key={i}>{r}</li>)}
            </ul>
          )}
        </div>
      )}
      {recs.length > 0 && (
        <div className="rounded-xl border border-line bg-surface px-5 py-4 mb-4">
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold text-ink">Recommendations</span>
            <span className="font-mono text-sm font-semibold text-accent">{recs.length}</span>
            <span className="text-xs text-muted">deterministic + rule-based · 0 AI invocations (ADR-001) · prioritized</span>
          </div>
          <ul className="mt-3 space-y-2">
            {recs.map((r) => (
              <li key={r.id} className="rounded-lg border border-line px-3 py-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${sevChip(r.severity)}`}>{r.severity}</span>
                  <span className="text-sm text-ink font-medium">{r.title}</span>
                  <span className="text-[11px] text-muted">· {r.category} · P{r.priorityScore}</span>
                </div>
                <div className="mt-1 flex flex-wrap gap-1.5 text-[10px]">
                  <span className="px-1.5 py-0.5 rounded-full bg-line text-muted">impact {r.impact}</span>
                  <span className="px-1.5 py-0.5 rounded-full bg-line text-muted">effort {r.effort}</span>
                  <span className="px-1.5 py-0.5 rounded-full bg-line text-muted">confidence {r.confidence}</span>
                  {r.eliminatesFindings > 1 && <span className="px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800">clears {r.eliminatesFindings}</span>}
                  <span className="px-1.5 py-0.5 rounded-full bg-line text-muted">{r.layer}</span>
                </div>
                {r.rootCause && <p className="mt-1.5 text-xs text-ink"><span className="text-muted">Root cause: </span>{r.rootCause}</p>}
                {r.actions.length > 0 && <p className="text-xs text-muted"><span className="font-medium">Action:</span> {r.actions.join(' ')}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {rc && (
        <div className="rounded-xl border border-line bg-surface px-5 py-4 mb-4">
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold text-ink">Review Confidence</span>
            <span className={`font-mono text-sm font-semibold ${tone}`}>{rc.level.toUpperCase()} · {rc.score}</span>
            <span className="text-xs text-muted">evidence-based · deterministic (not model-estimated)</span>
          </div>
          {rc.reductions.length > 0 && (
            <ul className="mt-2 text-xs text-muted list-disc pl-5">
              {rc.reductions.map((r, i) => <li key={i}>{r}</li>)}
            </ul>
          )}
          <div className="mt-3 flex flex-wrap gap-1.5">
            {rc.signals.filter((s) => s.applicable).map((s) => (
              <span key={s.key} title={s.label}
                className={`text-[11px] px-2 py-0.5 rounded-full ${s.satisfied ? 'bg-emerald-100 text-emerald-800' : 'bg-fail/10 text-fail'}`}>
                {s.satisfied ? '✓' : '✗'} {s.label}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="rounded-xl border border-line bg-surface">
        <div className="px-5 py-3 text-sm font-semibold text-ink border-b border-line">Explainability — why each artifact was generated</div>
        <ul className="divide-y divide-line">
          {data.artifacts.map((a, i) => (
            <li key={i} className="px-5 py-3">
              <button onClick={() => setOpen(open === i ? null : i)} className="w-full flex items-center gap-3 text-left">
                <span className="font-mono text-[10px] uppercase tracking-wider text-muted w-28 shrink-0">{a.artifactKind.replace(/_/g, ' ')}</span>
                <span className="text-sm text-ink flex-1">{a.artifactLabel}</span>
                <span className="text-xs text-accent">{open === i ? 'Hide' : 'Explain'}</span>
              </button>
              {open === i && (
                <div className="mt-3 ml-28 text-sm space-y-2">
                  <p className="text-ink"><span className="text-muted">Why: </span>{a.reason}</p>
                  <div className="grid grid-cols-[130px_1fr] gap-y-1.5 gap-x-3 text-[13px]">
                    <span className="text-muted">Acceptance Criteria</span>{citeChips(a.contributed.acceptanceCriteria)}
                    <span className="text-muted">Story Comments</span>{citeChips(a.contributed.storyComments)}
                    <span className="text-muted">Figma Frames</span>{citeChips(a.contributed.figmaFrames)}
                    <span className="text-muted">Business Rules</span>{citeChips(a.contributed.businessRules)}
                    <span className="text-muted">Prompt Version</span><span className="font-mono text-xs">{a.versions.prompt ?? '—'}</span>
                    <span className="text-muted">Workflow Version</span><span className="font-mono text-xs">{a.versions.workflow ?? '—'}</span>
                    {(a.versions.knowledge || a.versions.framework) && (<>
                      <span className="text-muted">Knowledge / Framework</span>
                      <span className="font-mono text-xs">{a.versions.knowledge ?? '—'} / {a.versions.framework ?? '—'}</span>
                    </>)}
                    {a.evidence.length > 0 && (<>
                      <span className="text-muted">Evidence</span>
                      <span className="text-xs">{a.evidence.length} file(s)</span>
                    </>)}
                  </div>
                </div>
              )}
            </li>
          ))}
          {data.artifacts.length === 0 && <li className="px-5 py-3 text-sm text-muted">No explainable artifacts yet.</li>}
        </ul>
      </div>
    </section>
  );
}

// ── Activity Timeline (Phase 2 M6) ──────────────────────────────────────────
interface ActivityEvent { ts: string | null; kind: string; node?: string; label: string; status?: string; durationMs?: number | null }
interface ActivityMilestone { key: string; label: string; at: string | null; durationMs?: number | null }
interface TimelineResponse {
  events: ActivityEvent[]; milestones: ActivityMilestone[];
  nodeCount: number; completedCount: number; failedCount: number; gateCount: number; totalDurationMs: number | null;
}
function fmtDuration(msv?: number | null) {
  if (msv == null) return null;
  const s = Math.round(msv / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m ${s % 60}s` : `${Math.floor(m / 60)}h ${m % 60}m`;
}
function fmtTime(ts: string | null) {
  if (!ts) return '—';
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
function eventDot(kind: string) {
  if (kind === 'node_failed' || kind === 'gate_rejected') return 'bg-fail';
  if (kind === 'node_finished' || kind === 'gate_approved' || kind === 'run_finished') return 'bg-emerald-500';
  if (kind.startsWith('gate') || kind.startsWith('clarification')) return 'bg-amber-500';
  return 'bg-line';
}

function ActivityTimelinePanel({ runId, status }: { runId: string; status: string }) {
  const [data, setData] = useState<TimelineResponse | null>(null);
  useEffect(() => { api<TimelineResponse>(`/runs/${runId}/timeline`).then(setData).catch(() => {}); }, [runId, status]);
  if (!data || data.events.length === 0) return null;
  return (
    <section className="mt-6">
      <div className="rounded-xl border border-line bg-surface px-5 py-4">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-sm font-semibold text-ink">Activity Timeline</span>
          <span className="text-xs text-muted">deterministic · from persisted run data · 0 AI</span>
          <span className="ml-auto text-xs text-muted">
            {data.completedCount}/{data.nodeCount} steps
            {data.failedCount > 0 && <span className="text-fail"> · {data.failedCount} failed</span>}
            {data.gateCount > 0 && <span> · {data.gateCount} gate(s)</span>}
            {data.totalDurationMs != null && <span> · {fmtDuration(data.totalDurationMs)}</span>}
          </span>
        </div>
        <ol className="mt-3 space-y-1.5">
          {data.events.map((e, i) => (
            <li key={i} className="flex items-center gap-3 text-sm">
              <span className="font-mono text-[11px] text-muted w-20 shrink-0 tabular-nums">{fmtTime(e.ts)}</span>
              <span className={`h-2 w-2 rounded-full shrink-0 ${eventDot(e.kind)}`} />
              <span className="text-ink flex-1">{e.label}</span>
              {e.durationMs != null && <span className="text-[11px] text-muted">{fmtDuration(e.durationMs)}</span>}
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function SignoffCard({ storyId, signedOff, onDone }: { storyId: string; signedOff: boolean; onDone: () => void }) {
  const [dims, setDims] = useState({ requirements: false, exploratory: false, visual: false });
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  if (signedOff) {
    return (
      <div className="mt-4 rounded-xl border border-pass/40 bg-[#E6F5EE] px-4 py-3 text-sm text-[#0f6f49] font-medium">
        ✓ Story signed off — recorded in the audit trail.
      </div>
    );
  }
  const all = dims.requirements && dims.exploratory && dims.visual;
  const Row = ({ k, label: l }: { k: keyof typeof dims; label: string }) => (
    <label className="flex items-center gap-2 text-sm text-body">
      <input type="checkbox" checked={dims[k]} onChange={(e) => setDims((d) => ({ ...d, [k]: e.target.checked }))} />
      Manual review confirmed — {l}
    </label>
  );
  async function approve() {
    setBusy(true);
    try {
      await api(`/stories/${storyId}/signoff`, { method: 'POST', body: JSON.stringify({ ...dims, note: note || undefined }) });
      onDone();
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mt-4 rounded-xl border border-line bg-surface p-4 flex flex-col gap-2">
      <div className="text-sm font-semibold text-ink">Manual review sign-off</div>
      <p className="text-xs text-muted">AI assists; the tester is accountable. Confirm each dimension, then approve the story.</p>
      <Row k="requirements" label="Requirements" />
      <Row k="exploratory" label="Exploratory" />
      <Row k="visual" label="Visual / Figma" />
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional note"
        className="mt-1 w-full rounded border border-line px-2 py-1.5 text-xs" />
      <button disabled={busy || !all} onClick={approve}
        className="self-start mt-1 bg-pass text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-40">
        {busy ? 'Recording…' : 'Approve Story'}
      </button>
      {!all && <span className="text-[11px] text-muted">Confirm all three dimensions to enable sign-off.</span>}
    </div>
  );
}

/**
 * Restart From Step (Run Lifecycle Management): re-run this step and every
 * step after it, discarding what they already produced. Available on any
 * non-pending step; the confirm panel names exactly which downstream steps
 * get discarded so a tester never triggers it by accident.
 */
function RestartControl({
  runId, step, allSteps, onDone,
}: { runId: string; step: Step; allSteps: Step[]; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  const downstream = allSteps.filter((s) => s.ordinal > step.ordinal && s.status !== 'pending');

  async function confirmRestart() {
    setBusy(true);
    try {
      await api(`/runs/${runId}/steps/${step.id}/restart`, {
        method: 'POST',
        body: JSON.stringify({ feedback: feedback || undefined }),
      });
      onDone();
    } finally {
      setBusy(false);
      setOpen(false);
    }
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="text-[11px] text-muted hover:text-accent hover:underline">
        Restart from here
      </button>
    );
  }
  return (
    <div className="absolute right-5 mt-8 z-10 w-72 rounded-lg border border-line bg-surface shadow-lg p-3">
      <div className="text-sm font-medium text-ink">Restart from {label(step.name)}?</div>
      <div className="text-xs text-muted mt-1">
        {downstream.length > 0
          ? `This discards the output of ${label(step.name)} and ${downstream.length} step(s) after it: ${downstream.map((s) => label(s.name)).join(', ')}.`
          : `This re-runs ${label(step.name)} — nothing after it has run yet.`}
      </div>
      <textarea value={feedback} onChange={(e) => setFeedback(e.target.value)}
        placeholder="Optional guidance for the re-run"
        className="mt-2 w-full rounded border border-line px-2 py-1.5 text-xs" rows={2} />
      <div className="flex gap-2 mt-2">
        <button disabled={busy} onClick={confirmRestart} className="bg-fail text-white text-xs px-3 py-1.5 rounded-lg disabled:opacity-40">
          {busy ? 'Restarting…' : 'Confirm Restart'}
        </button>
        <button disabled={busy} onClick={() => setOpen(false)} className="border border-line text-body text-xs px-3 py-1.5 rounded-lg disabled:opacity-40">
          Cancel
        </button>
      </div>
    </div>
  );
}

/** Failure Details + Retry Failed Step (Run Lifecycle Management). */
function FailureCard({ runId, step, onDone }: { runId: string; step: Step; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [showStack, setShowStack] = useState(false);
  const err = step.errorJson;

  async function retry() {
    setBusy(true);
    try {
      await api(`/runs/${runId}/steps/${step.id}/retry`, { method: 'POST' });
      onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ml-7 mt-3 rounded-lg border border-fail/40 bg-fail/5 p-3">
      <div className="text-sm font-medium text-ink">
        {step.status === 'interrupted' ? 'Interrupted' : 'Failed'}
        {step.attempt && step.attempt > 1 ? ` — attempt ${step.attempt}` : ''}
      </div>
      {err && (
        <div className="mt-1 text-xs text-body">
          <div>{err.message}</div>
          <div className="text-muted mt-0.5">
            {err.isTimeout ? 'Hit the step\'s hard timeout · ' : ''}
            {Math.round(err.durationMs / 1000)}s elapsed
          </div>
          {err.stack && (
            <>
              <button onClick={() => setShowStack((v) => !v)} className="mt-1 text-accent hover:underline">
                {showStack ? 'Hide' : 'Show'} stack trace
              </button>
              {showStack && (
                <pre className="mt-1 max-h-40 overflow-auto font-mono text-[10px] text-muted bg-white/60 rounded p-2">{err.stack}</pre>
              )}
            </>
          )}
        </div>
      )}
      <div className="flex gap-2 mt-2">
        <button disabled={busy} onClick={retry} className="bg-ai text-white text-sm px-3 py-1.5 rounded-lg disabled:opacity-40">
          {busy ? 'Retrying…' : 'Retry Failed Step'}
        </button>
      </div>
    </div>
  );
}

function GateCard({ runId, step, onDone }: { runId: string; step: Step; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  const canRegenerate = Boolean(GATE_SOURCE[step.name as LifecycleNode]);
  const isReviewGate = step.approval!.action.startsWith('review.');

  async function decide(decision: 'approved' | 'rejected') {
    setBusy(true);
    try {
      await api(`/runs/${runId}/steps/${step.id}/approve`, {
        method: 'POST',
        body: JSON.stringify({ action: step.approval!.action, decision, feedback: feedback || undefined }),
      });
      onDone();
    } finally {
      setBusy(false);
    }
  }
  async function regenerate() {
    if (!feedback.trim()) return;
    setBusy(true);
    try {
      await api(`/runs/${runId}/steps/${step.id}/regenerate`, {
        method: 'POST',
        body: JSON.stringify({ feedback }),
      });
      onDone();
    } finally {
      setBusy(false);
    }
  }
  async function skip() {
    setBusy(true);
    try {
      await api(`/runs/${runId}/steps/${step.id}/skip`, { method: 'POST' });
      onDone();
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="ml-7 mt-3 rounded-lg border border-warn/40 bg-[#FBF1DE] p-3">
      <div className="text-sm font-medium text-ink">Approval required — {step.approval!.action}</div>
      <pre className="mt-2 max-h-40 overflow-auto font-mono text-[11px] text-body bg-white/60 rounded p-2">
        {JSON.stringify(step.approval!.payload, null, 2)}
      </pre>
      <input value={feedback} onChange={(e) => setFeedback(e.target.value)}
        placeholder={canRegenerate ? 'Feedback — required to Regenerate, optional to Reject' : 'Optional feedback (sent back to the AI on reject)'}
        className="mt-2 w-full rounded border border-line px-2 py-1.5 text-xs" />
      <div className="flex gap-2 mt-2 flex-wrap">
        <button disabled={busy} onClick={() => decide('approved')} className="bg-pass text-white text-sm px-3 py-1.5 rounded-lg disabled:opacity-40">Approve &amp; Continue</button>
        {canRegenerate && (
          <button disabled={busy || !feedback.trim()} onClick={regenerate} title={!feedback.trim() ? 'Add feedback to regenerate' : ''}
            className="bg-ai text-white text-sm px-3 py-1.5 rounded-lg disabled:opacity-40">Regenerate</button>
        )}
        <button disabled={busy} onClick={() => decide('rejected')} className="border border-line text-body text-sm px-3 py-1.5 rounded-lg disabled:opacity-40">Reject</button>
        {isReviewGate && (
          <button disabled={busy} onClick={skip} className="border border-line text-muted text-sm px-3 py-1.5 rounded-lg disabled:opacity-40">Skip</button>
        )}
      </div>
    </div>
  );
}

function ClarifyCard({ runId, step, onDone }: { runId: string; step: Step; onDone: () => void }) {
  const qs = (step.clarification!.questionsJson as ClarifyQuestion[]) ?? [];
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true);
    try {
      await api(`/runs/${runId}/steps/${step.id}/answer`, {
        method: 'POST',
        body: JSON.stringify({ answers: qs.map((q) => ({ id: q.id, answer: answers[q.id] ?? '' })) }),
      });
      onDone();
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="ml-7 mt-3 rounded-lg border border-ai/40 bg-[#EEEBFA] p-3 flex flex-col gap-3">
      <div className="text-sm font-medium text-ink">Clarification needed</div>
      {qs.map((q) => (
        <label key={q.id} className="block">
          <span className="text-sm text-body">{q.question}</span>
          {q.why && <span className="block text-[11px] text-muted">{q.why}</span>}
          <input value={answers[q.id] ?? ''} onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
            className="mt-1 w-full rounded border border-line px-2 py-1.5 text-sm" />
        </label>
      ))}
      <button disabled={busy} onClick={submit} className="self-start bg-accent text-white text-sm px-3 py-1.5 rounded-lg disabled:opacity-40">
        Submit answers
      </button>
    </div>
  );
}

function CredentialCard({
  runId, step, request, onDone,
}: { runId: string; step: Step; request: CredentialRequest; onDone: () => void }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<null | 'use-once' | 'save' | 'cancel'>(null);
  const allFilled = request.credentials.every((c) => (values[c.key] ?? '').trim().length > 0);

  async function submit(decision: 'use-once' | 'save' | 'cancel') {
    setBusy(decision);
    try {
      await api(`/runs/${runId}/steps/${step.id}/credential`, {
        method: 'POST',
        body: JSON.stringify({
          decision,
          values: decision === 'cancel'
            ? []
            : request.credentials.map((c) => ({ key: c.key, value: values[c.key] ?? '', secret: c.secret, group: c.group })),
        }),
      });
      onDone();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="ml-7 mt-3 rounded-lg border border-warn/50 bg-[#FBF1DE] p-4 flex flex-col gap-3">
      <div>
        <div className="text-sm font-semibold text-ink">A credential is needed to continue</div>
        <p className="text-xs text-body mt-0.5 leading-relaxed">{request.reason}</p>
      </div>

      {request.credentials.map((c) => (
        <div key={c.key} className="rounded-lg border border-line bg-white/70 p-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-ink">{c.label}</span>
            {c.secret && <span title="Stored securely" className="text-muted text-xs">🔒</span>}
          </div>
          <p className="text-xs text-body mt-0.5 leading-relaxed">{c.description}</p>
          <div className="flex items-center gap-1.5 mt-1 text-[11px] text-muted">
            <span className="text-accent">◷</span><span>{c.whenUsed}</span>
          </div>
          <input
            type={c.secret ? 'password' : 'text'}
            value={values[c.key] ?? ''}
            onChange={(e) => setValues((v) => ({ ...v, [c.key]: e.target.value }))}
            className="mt-2 w-full rounded border border-line px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
          />
          {c.obtainText && (
            <details className="mt-1.5 group">
              <summary className="cursor-pointer text-[11px] text-accent hover:text-accent-bright select-none list-none">
                <span className="group-open:hidden">How to get this ▸</span>
                <span className="hidden group-open:inline">How to get this ▾</span>
              </summary>
              <div className="mt-1 text-[11px] text-body bg-accent-wash border border-line rounded px-2 py-1.5 leading-relaxed">
                {c.obtainText}
                {c.obtainUrl && (
                  <> <a href={c.obtainUrl} target="_blank" rel="noreferrer" className="text-accent underline break-all">Open guide ↗</a></>
                )}
              </div>
            </details>
          )}
        </div>
      ))}

      <div className="flex gap-2 flex-wrap items-center">
        <button disabled={!!busy || !allFilled} onClick={() => submit('use-once')}
          className="bg-accent text-white text-sm font-medium px-3 py-1.5 rounded-lg hover:bg-accent-bright disabled:opacity-40">
          {busy === 'use-once' ? 'Continuing…' : 'Use Once'}
        </button>
        <button disabled={!!busy || !allFilled} onClick={() => submit('save')}
          className="bg-pass text-white text-sm font-medium px-3 py-1.5 rounded-lg disabled:opacity-40">
          {busy === 'save' ? 'Saving…' : 'Save to My Settings'}
        </button>
        <button disabled={!!busy} onClick={() => submit('cancel')}
          className="border border-fail/50 text-fail text-sm font-medium px-3 py-1.5 rounded-lg hover:bg-fail/10 disabled:opacity-40">
          {busy === 'cancel' ? 'Cancelling…' : 'Cancel Run'}
        </button>
        {!allFilled && <span className="text-[11px] text-muted">Fill every field to continue, or Cancel Run.</span>}
      </div>
      <p className="text-[11px] text-muted">
        <span className="font-medium">Use Once</span> keeps the value for this run only.{' '}
        <span className="font-medium">Save to My Settings</span> also stores it (encrypted) for future stories.
      </p>
    </div>
  );
}

function label(name: string): string {
  return name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
