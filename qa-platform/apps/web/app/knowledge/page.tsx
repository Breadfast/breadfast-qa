'use client';

import { useEffect, useState } from 'react';
import { api } from '../../lib/api';

interface DocRef { path: string; title: string; group: string }

export default function KnowledgePage() {
  const [docs, setDocs] = useState<DocRef[]>([]);
  const [active, setActive] = useState<{ path: string; content: string } | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api<{ docs: DocRef[] }>('/knowledge').then((r) => setDocs(r.docs)).catch(() => {});
  }, []);

  async function open(path: string) {
    setLoading(true);
    try { setActive(await api<{ path: string; content: string }>(`/knowledge/doc?path=${encodeURIComponent(path)}`)); }
    finally { setLoading(false); }
  }

  const groups = Array.from(new Set(docs.map((d) => d.group)));

  return (
    <div className="px-8 py-7 max-w-6xl">
      <h1 className="text-2xl font-semibold text-ink tracking-tight mb-1">Knowledge</h1>
      <p className="text-sm text-muted mb-6">
        The canonical knowledge base the AI runs on — CLAUDE.md, the QA process docs (docs/ai), and the platform design specs.
        Read-only here; edits happen in the repo. (Proposal review is coming in a later release.)
      </p>

      <div className="grid grid-cols-3 gap-5">
        {/* Index */}
        <div className="col-span-1 flex flex-col gap-5">
          {groups.map((g) => (
            <section key={g} className="rounded-xl border border-line bg-surface p-4">
              <h2 className="text-xs font-mono uppercase tracking-wider text-muted mb-2">{g}</h2>
              <ul className="flex flex-col gap-0.5">
                {docs.filter((d) => d.group === g).map((d) => (
                  <li key={d.path}>
                    <button
                      onClick={() => open(d.path)}
                      className={`w-full text-left text-sm px-2 py-1 rounded-md hover:bg-[#EEF2F6] ${active?.path === d.path ? 'bg-[#EAF4F8] text-accent' : 'text-body'}`}
                    >
                      {d.title}
                      <span className="block text-[10px] font-mono text-muted truncate">{d.path}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {docs.length === 0 && <p className="text-sm text-muted">No knowledge docs found.</p>}
        </div>

        {/* Viewer */}
        <div className="col-span-2">
          <div className="rounded-xl border border-line bg-surface p-5 min-h-[60vh]">
            {loading && <p className="text-sm text-muted">Loading…</p>}
            {!loading && !active && <p className="text-sm text-muted">Select a document to read it.</p>}
            {!loading && active && (
              <>
                <div className="text-xs font-mono text-muted mb-3 pb-2 border-b border-line">{active.path}</div>
                <pre className="text-xs text-body whitespace-pre-wrap leading-relaxed font-mono overflow-x-auto">{active.content}</pre>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
