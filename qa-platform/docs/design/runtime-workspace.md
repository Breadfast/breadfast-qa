# Design — Runtime Workspace

> **Status:** LOCKED (Phase 0). Per-user, configurable, **outside the repo**. Changeable later from Settings. Missing folders auto-created.

## 1. Location

Resolution order (first hit wins):
1. `QA_WORKSPACE_DIR` environment variable (power users / CI).
2. Value saved at onboarding (or later changed in Settings), persisted in a small **bootstrap config** outside both repo and workspace:
   - Windows: `%APPDATA%\breadfast-qa\config.json`
   - macOS/Linux: `~/.config/breadfast-qa/config.json`
3. OS default:
   - Windows: `C:\Users\<user>\BreadfastQA\Workspace`
   - macOS/Linux: `~/BreadfastQA/Workspace`

The bootstrap config holds only the workspace path (and non-secret machine-local prefs) — **never** secrets; those live encrypted in the workspace DB.

## 2. Layout

```
<workspace>/
├── qa.db                      # SQLite (replaces packages/db/dev.db)
├── stories/<TICKET>/          # the 10 standard subfolders per story (artifacts)
│   ├── requirements-analysis/ figma-analysis/ hls/ browserstack/ testcases/
│   └── automation/ execution-reports/ screenshots/ defects/ evidence/
├── cache/                     # temp files, exec input scratch, zip extraction
├── logs/                      # api / worker / web logs
├── auth/figma-auth.json       # Figma session cookies (per-user)
└── browser-sessions/<TICKET>/app-session.json  # Session Continuity: app-under-test cookies +
                                                 # localStorage, ONE per story (never shared across
                                                 # stories) — appSessionPath() in packages/shared/src/paths.ts
```

## 3. Path resolution module

A single `resolveWorkspace()` in `@qa/shared` (or a small `@qa/paths` util) is the ONLY place that computes workspace paths. Everything else (worker nodes, API story creation, engine, figma-auth service) imports helpers:

```ts
workspaceRoot(): string                 // resolved per §1, created if missing
storyDir(jiraKey): string               // <ws>/stories/<jiraKey>, subfolders ensured
dbUrl(): string                         // file:<ws>/qa.db
figmaAuthPath(): string                 // <ws>/auth/figma-auth.json
logsDir() / cacheDir() / browserSessionsDir()
```

This **replaces** every `COMPANION_DIR ?? 'D:\\BreadfastQA'` fallback and the `path.join(COMPANION_DIR, jiraKey)` story-dir logic. Note: `COMPANION_DIR` (knowledge base / engine cwd = repo root) and `WORKSPACE_DIR` (runtime data) become **two distinct concepts** — today they are conflated under one `D:\BreadfastQA`.

- **Repo root (engine cwd):** auto-detected (walk up from the app to the dir containing `CLAUDE.md` + `docs/ai/`), overridable via `QA_COMPANION_DIR`.
- **Workspace (runtime data):** resolved per §1.

## 4. Auto-creation & change-location

- On startup and on first write, `mkdir -p` (recursive) every required folder — never assume existence.
- **Change from Settings:** a "Workspace location" field. On change: validate the new path is writable → offer to **move** existing `qa.db` + `stories/` (copy-verify-delete) or **start fresh** → update bootstrap config → require an app restart (DB handle rebind). Guard against pointing at a non-empty unrelated folder.

## 5. Automatic maintenance (refinement #5)

The platform keeps the workspace tidy without manual cleanup, driven by configurable retention (user Settings; sensible defaults):

| Target | Default policy |
|---|---|
| `cache/` temp files (zip extraction, exec scratch) | delete on run completion; sweep anything > 24 h on startup |
| `logs/` | rotate; keep last 14 days (or last N MB), gzip older, delete beyond retention |
| `browser-sessions/` | delete stale/unused profiles > 30 days; never touch the active Figma session |
| Obsolete artifacts | for a story re-run, previous run's transient artifacts (not final reports/evidence) pruned; keep the last **K** runs' reports per story (default K=5) |

- Runs as a lightweight maintenance task on app startup + after each run; never deletes final reports, defect records, or the DB.
- A **"Clean workspace now"** action in Settings runs it on demand and shows what was reclaimed.
- All destructive sweeps respect a dry-run preview in the UI before first enable; retention values live in the Settings registry (`workspace.retention.*`).

## 6. Cross-platform & parity

- All paths via `path.join`; no drive letters; `DATABASE_URL` derived from `dbUrl()`.
- Artifacts land in the same 10-subfolder structure the canonical Companion uses (STEP 0) — only the *root* moves from `D:\BreadfastQA\<TICKET>` to `<workspace>/stories/<TICKET>`. Report/CSV/evidence contents unchanged → parity preserved.
