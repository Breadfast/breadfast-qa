'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { TEST_DATA_TYPES, TEST_DATA_STATUSES } from '@qa/shared';

interface Item {
  id: string;
  type: string;
  label: string;
  value: Record<string, unknown>;
  status: string;
  notes?: string | null;
}
type Stats = Record<string, { available: number; reserved: number; consumed: number }>;

const STATUS_TONE: Record<string, string> = {
  available: 'bg-[#E7F5ED] text-pass',
  reserved: 'bg-[#FBF1DE] text-warn',
  consumed: 'bg-[#EEF2F6] text-muted',
};

export default function TestDataPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [filter, setFilter] = useState('');
  const [draft, setDraft] = useState({ type: 'phone', label: '', value: '', notes: '' });

  const load = useCallback(async () => {
    const [list, st] = await Promise.all([
      api<Item[]>(`/test-data${filter ? `?type=${filter}` : ''}`),
      api<Stats>('/test-data/stats'),
    ]);
    setItems(list);
    setStats(st);
  }, [filter]);

  useEffect(() => { load().catch(() => {}); }, [load]);

  async function add() {
    if (!draft.label) return;
    await api('/test-data', { method: 'POST', body: JSON.stringify({
      type: draft.type, label: draft.label, value: { value: draft.value }, status: 'available', notes: draft.notes || undefined,
    }) });
    setDraft({ type: draft.type, label: '', value: '', notes: '' });
    load();
  }
  async function cycle(it: Item) {
    const order = TEST_DATA_STATUSES as unknown as string[];
    const next = order[(order.indexOf(it.status) + 1) % order.length];
    await api(`/test-data/${it.id}/status`, { method: 'POST', body: JSON.stringify({ status: next }) });
    load();
  }
  async function remove(id: string) { await api(`/test-data/${id}`, { method: 'DELETE' }); load(); }

  return (
    <div className="px-8 py-7 max-w-4xl">
      <h1 className="text-2xl font-semibold text-ink tracking-tight mb-1">Test Data</h1>
      <p className="text-sm text-muted mb-5">Phones, packages, accounts, cards, OTP accounts — auto-allocated during execution.</p>

      {stats && (
        <div className="grid grid-cols-5 gap-3 mb-6">
          {Object.entries(stats).map(([type, c]) => (
            <div key={type} className="rounded-xl border border-line bg-surface p-3">
              <div className="text-[10px] uppercase tracking-wide text-muted mb-1">{type}</div>
              <div className="flex gap-2 text-xs font-mono tnum">
                <span className="text-pass">{c.available}a</span>
                <span className="text-warn">{c.reserved}r</span>
                <span className="text-muted">{c.consumed}c</span>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="rounded-xl border border-line bg-surface p-4 mb-5">
        <div className="text-sm font-medium text-ink mb-3">Add item</div>
        <div className="flex flex-wrap gap-2 items-end">
          <select value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value })} className="rounded-lg border border-line px-2 py-2 text-sm bg-white">
            {TEST_DATA_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <input value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} placeholder="label" className="rounded-lg border border-line px-3 py-2 text-sm flex-1 min-w-[120px]" />
          <input value={draft.value} onChange={(e) => setDraft({ ...draft, value: e.target.value })} placeholder="value (e.g. 01203365955)" className="rounded-lg border border-line px-3 py-2 text-sm font-mono flex-1 min-w-[160px]" />
          <button onClick={add} className="bg-accent text-white text-sm px-4 py-2 rounded-lg hover:bg-accent-bright">Add</button>
        </div>
      </div>

      <div className="flex gap-2 mb-3 text-sm">
        <button onClick={() => setFilter('')} className={`px-3 py-1 rounded-full ${filter === '' ? 'bg-accent text-white' : 'border border-line text-body'}`}>all</button>
        {TEST_DATA_TYPES.map((t) => (
          <button key={t} onClick={() => setFilter(t)} className={`px-3 py-1 rounded-full ${filter === t ? 'bg-accent text-white' : 'border border-line text-body'}`}>{t}</button>
        ))}
      </div>

      <div className="rounded-xl border border-line bg-surface divide-y divide-line">
        {items.length === 0 && <div className="px-4 py-6 text-sm text-muted">No test data yet.</div>}
        {items.map((it) => (
          <div key={it.id} className="px-4 py-2.5 flex items-center gap-3 text-sm">
            <span className="font-mono text-[10px] uppercase text-muted w-16">{it.type}</span>
            <span className="text-ink">{it.label}</span>
            <span className="font-mono text-muted">{String((it.value as any)?.value ?? '')}</span>
            <button onClick={() => cycle(it)} className={`ml-auto font-mono text-[11px] px-2 py-0.5 rounded-full ${STATUS_TONE[it.status] ?? ''}`} title="click to change status">{it.status}</button>
            <button onClick={() => remove(it.id)} className="text-muted hover:text-fail">✕</button>
          </div>
        ))}
      </div>
    </div>
  );
}
