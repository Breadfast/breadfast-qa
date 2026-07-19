'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '../../lib/api';

interface StoryRow {
  id: string;
  jiraKey: string;
  title: string;
  platform: string;
  status: string;
  runs: Array<{ id: string; status: string }>;
}

export default function StoriesPage() {
  const [rows, setRows] = useState<StoryRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<StoryRow[]>('/stories').then(setRows).catch((e) => setError(String(e)));
  }, []);

  return (
    <div className="px-8 py-7 max-w-5xl">
      <header className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-ink tracking-tight">Stories</h1>
        <Link href="/stories/new" className="bg-accent text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-accent-bright">
          ＋ New Story
        </Link>
      </header>

      {error && <p className="text-sm text-muted">Could not reach the API ({error}). Sign in from <Link className="text-accent" href="/login">/login</Link>.</p>}

      {rows && (
        <div className="rounded-xl border border-line bg-surface divide-y divide-line">
          {rows.length === 0 && <div className="px-5 py-6 text-sm text-muted">No stories yet.</div>}
          {rows.map((s) => (
            <Link key={s.id} href={`/stories/${s.id}`} className="px-5 py-3 flex items-center justify-between text-sm hover:bg-ground transition-colors">
              <div className="flex items-center gap-3">
                <span className="font-mono text-accent">{s.jiraKey}</span>
                <span className="text-body">{s.title}</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="font-mono text-[11px] text-muted">{s.platform}</span>
                <span className="font-mono text-[11px] px-2 py-0.5 rounded-full bg-[#EEF2F6] text-body">{s.status}</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
