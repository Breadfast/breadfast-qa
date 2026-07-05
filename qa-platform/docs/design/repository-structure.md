# Design — Repository Structure & Git Strategy

> **Status:** LOCKED (Phase 0). Decision: **new clean repo `breadfast-qa` + selective migration**. Never `git init` the polluted `D:\BreadfastQA`.

## 1. Target repository tree

```
breadfast-qa/                          # the git repo (working clone: D:\breadfast-qa)
├── .gitignore
├── README.md
├── ARCHITECTURE.md                    # canonical architecture (Phase 0 rewrite)
├── CLAUDE.md                          # frozen canonical workflow (source of truth)
├── AGENTS.md
├── docs/ai/**                         # knowledge base (engine loads it from the repo root)
├── project-defaults.json             # NON-secret project profiles (§ project-profiles)
├── automation/                        # shared automation assets (no secrets)
│   ├── pages/  helpers/               # shared page objects / helpers
│   ├── import_browserstack_csv.js
│   ├── provision_for_execution.js
│   ├── helpers/FigmaExporter.js
│   ├── bs_helper.js  gen_report.js
│   └── config/credentials.example.js  # template ONLY
└── qa-platform/                       # the app (npm workspaces)
    ├── ARCHITECTURE.md  README.md  ARCHITECTURE-REVIEW.md
    ├── docs/design/**                 # Phase 0 design specs (this folder)
    ├── .env.example                   # no D:\ paths, no secrets, dry-run defaults true
    ├── packages/{shared,db,engine}/
    └── apps/{api,worker,web}/
```

> Note: the **knowledge base** (`CLAUDE.md` + `docs/ai/**`) sits at the **repo root** because the engine runs with `cwd = repo root` and auto-loads it. The **design specs** (`docs/design/**`) and platform docs live **under `qa-platform/`** with the app they describe.

**Not in the repo (external, config-referenced):** the Java/Appium framework, the Playwright `b55168_pom` framework, the local `claude` CLI. Registered via the Framework Registry (see [framework-registry](./framework-registry.md)).

**Not in the repo (personal, in the runtime workspace):** SQLite DB, story artifacts, reports, screenshots, videos, logs, Figma session, browser sessions. See [runtime-workspace](./runtime-workspace.md).

## 2. `.gitignore` (root)

```
# deps / build
node_modules/
dist/
.next/
*.tsbuildinfo
coverage/

# secrets & env
.env
.env.*
!.env.example
**/credentials.js
**/credentials.local.js
auth/
*.pem  *.key

# runtime & personal (belt-and-suspenders; these live in the workspace, not the repo)
runtime/
stories/
**/*.db  **/*.db-journal
*.log

# generated media / artifacts
*.zip
*.mp4
*.png  *.jpg  *.jpeg   # (allow-list specific committed UI assets explicitly if ever needed)
test-results/
playwright-report/
.playwright-mcp/
.history/
```

## 3. Migration manifest

**Migrate IN (only these):**

| From `D:\BreadfastQA` | → `breadfast-qa/` | Sanitize |
|---|---|---|
| `CLAUDE.md`, `AGENTS.md` | root | — |
| `docs/ai/**` (companion root) | `docs/ai/**` | knowledge base at repo root |
| `qa-platform/docs/design/**` | `qa-platform/docs/design/**` | design specs stay with the app (carried by the `qa-platform/**` copy) |
| `qa-platform/**` | `qa-platform/**` | drop `node_modules`, `dist`, `.next`, `.env`, `*.db`, `auth/`, `*.log`, `*.zip`, `PARITY-PROPOSAL.pdf`, `api.log`, `web.log`, `launcher.out.log` |
| `automation/**` | `automation/**` | replace real `config/credentials.js` with `credentials.example.js`; drop any `*.local.js`, secrets, generated output |
| `bs_helper.js`, `gen_report.js` | `automation/` | — |
| *(new)* `project-defaults.json`, `README.md`, `.gitignore` | root | authored fresh |

**Do NOT migrate:** `B10-*` + `B10-55570-verify`, `BUILD-SMOKE-*`, `FigmaCheck/`, `_validation/`, `figma-export-test/`, `presentation/`, all loose `*.png`/`*.mp4`/`*.zip`/`*.xlsx`/`*.csv`/`*.html`/`*.mjs`/`*.yml` at root, `dev.db`, `.env`, `auth/figma-auth.json`, `node_modules/`, `playwright-report/`, `test-results/`, `.history/`, `.playwright-mcp/`, `log/`, the nested `b55168_pom/`.

## 4. Git strategy

- **Clean init:** create `D:\breadfast-qa`, copy only the manifest, add `.gitignore` **first**, then `git init` + first commit. Verify `git status` shows zero personal/secret files before the first commit.
- **Secret scan before first push:** run a secret scan (e.g. gitleaks) over the working tree; the initial history must be clean by construction (fresh repo, no prior commits).
- **Branch model:** `main` protected; feature branches per phase (`phase-a-shareability`, …); PRs reviewed against the parity baseline.
- The old `D:\BreadfastQA` is left untouched as the historical working dir.

## 5. Parity note

Pure relocation + hygiene. No workflow behavior changes. The engine still runs with cwd = repo root so `CLAUDE.md` + `docs/ai/**` auto-load exactly as today.
