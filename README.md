# breadfast-qa

Shareable monorepo for the Breadfast QA Platform + the canonical AI QA Companion.

- `CLAUDE.md` + `docs/ai/**` — the frozen canonical workflow + knowledge base (single source of truth).
- `automation/` — shared automation scripts, page objects, and team-shared QA testing config.
- `qa-platform/` — the platform app (npm workspaces). See [qa-platform/README.md](./qa-platform/README.md).

Runtime/personal data (SQLite DB, story artifacts, reports, screenshots, videos, logs,
browser/Figma sessions) lives in a per-user **workspace outside this repo** and is never committed.

## Quick start
```
cd qa-platform
cp .env.example .env
npm install && npm run build
npm run dev
```
