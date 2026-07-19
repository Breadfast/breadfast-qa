'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '../../../lib/api';

interface BlockingStep {
  id: string;
  name: string;
  type: string;
  status: string;
  attempt: number;
}
interface InterruptedRun {
  id: string;
  status: string;
  pauseReason?: string | null;
  totalCostUsd: number;
  createdAt: string;
  finishedAt?: string | null;
  story: { id: string; jiraKey: string; title: string };
  blockingStep: BlockingStep | null;
}

const STATUS_LABEL: Record<string, string> = {
  paused: 'Paused', failed: 'Failed', cancelled: 'Cancelled',
};

/** True for the two pause reasons a generic bulk Resume can act on. */
function isResumable(r: InterruptedRun) {
  return r.status === 'cancelled' || r.status === 'failed'
    || (r.status === 'paused' && (r.pauseReason === 'manual' || r.pauseReason === 'usage_limit'));
}
function isRetryable(r: InterruptedRun) {
  return r.blockingStep && (r.blockingStep.status === 'failed' || r.blockingStep.status === 'interrupted');
}

/**
 * Paused-run queue (Run Lifecycle Management, §6b): every run across every
 * story currently needing tester attention, in one place, with bulk Resume/
 * Retry so resuming several interrupted runs at once doesn't mean opening
 * each story page one by one.
 */
export default function RunsQueuePage() {
  const [rows, setRows] = useState<InterruptedRun[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [lastBulkResult, setLastBulkResult] = useState<string | null>(null);

  const load = useCallback(() => {
    api<InterruptedRun[]>('/runs/interrupted').then(setRows).catch((e) => setError(String(e)));
  }, []);

  useEffect(() => { load(); }, [load]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function bulkRetry() {
    setBusy(true);
    setLastBulkResult(null);
    try {
      const runIds = [...selected].filter((id) => rows?.find((r) => r.id === id && isRetryable(r)));
      if (!runIds.length) return;
      const res = await api<{ results: Array<{ runId: string; ok: boolean; error?: string }> }>('/runs/retry-failed', {
        method: 'POST',
        body: JSON.stringify({ runIds }),
      });
      const failedCount = res.results.filter((r) => !r.ok).length;
      setLastBulkResult(
        failedCount
          ? `${res.results.length - failedCount}/${res.results.length} retried — ${failedCount} could not be retried`
          : `${res.results.length} run(s) retried`,
      );
      setSelected(new Set());
      load();
    } finally {
      setBusy(false);
    }
  }

  async function bulkResume() {
    setBusy(true);
    setLastBulkResult(null);
    try {
      const targets = [...selected].filter((id) => rows?.find((r) => r.id === id && isResumable(r)));
      const results = await Promise.all(
        targets.map((id) => api(`/runs/${id}/resume`, { method: 'POST' }).then(() => true).catch(() => false)),
      );
      const okCount = results.filter(Boolean).length;
      setLastBulkResult(`${okCount}/${targets.length} resumed`);
      setSelected(new Set());
      load();
    } finally {
      setBusy(false);
    }
  }

  const selectableIds = rows?.filter((r) => isResumable(r) || isRetryable(r)).map((r) => r.id) ?? [];
  const anySelectedRetryable = rows?.some((r) => selected.has(r.id) && isRetryable(r)) ?? false;
  const anySelectedResumable = rows?.some((r) => selected.has(r.id) && isResumable(r)) ?? false;

  return (
    <div className="px-8 py-7 max-w-5xl">
      <header className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-ink tracking-tight">Paused &amp; Failed Runs</h1>
          <p className="text-sm text-muted mt-1">Every run across every story currently waiting on you.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            disabled={busy || !anySelectedRetryable}
            onClick={bulkRetry}
            className="bg-ai text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-40"
          >
            Retry Selected
          </button>
          <button
            disabled={busy || !anySelectedResumable}
            onClick={bulkResume}
            className="border border-accent text-accent text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-40"
          >
            Resume Selected
          </button>
        </div>
      </header>

      {error && <p className="text-sm text-muted">Could not reach the API ({error}). Sign in from <Link className="text-accent" href="/login">/login</Link>.</p>}
      {lastBulkResult && <p className="text-sm text-muted mb-3">{lastBulkResult}</p>}

      {rows && (
        <div className="rounded-xl border border-line bg-surface divide-y divide-line">
          {rows.length === 0 && <div className="px-5 py-6 text-sm text-muted">Nothing paused, failed, or cancelled right now.</div>}
          {rows.map((r) => {
            const canAct = isResumable(r) || isRetryable(r);
            return (
              <div key={r.id} className="px-5 py-3 flex items-center gap-3 text-sm">
                <input
                  type="checkbox"
                  disabled={!canAct}
                  checked={selected.has(r.id)}
                  onChange={() => toggle(r.id)}
                  className="disabled:opacity-30"
                />
                <Link href={`/stories/${r.story.id}`} className="flex items-center gap-3 flex-1 min-w-0 hover:opacity-80">
                  <span className="font-mono text-accent shrink-0">{r.story.jiraKey}</span>
                  <span className="text-body truncate">{r.story.title}</span>
                </Link>
                <span className="font-mono text-[11px] text-muted whitespace-nowrap">
                  {r.blockingStep ? r.blockingStep.name.replace(/_/g, ' ') : '—'}
                  {r.blockingStep && r.blockingStep.attempt > 1 ? ` (attempt ${r.blockingStep.attempt})` : ''}
                </span>
                <span className="font-mono text-[11px] text-muted whitespace-nowrap">${r.totalCostUsd.toFixed(3)}</span>
                <span className="font-mono text-[11px] px-2 py-0.5 rounded-full bg-[#EEF2F6] text-body whitespace-nowrap">
                  {STATUS_LABEL[r.status] ?? r.status}{r.pauseReason ? ` · ${r.pauseReason}` : ''}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
