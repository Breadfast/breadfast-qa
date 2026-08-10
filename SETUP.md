# Setup Guide — Breadfast QA Platform

Everything a QA engineer needs to go from **empty machine → running a QA workflow**, on
**Windows** and **macOS** (Linux works the same as macOS).

Follow it top to bottom. Total time: **~20 minutes**, most of it downloads.

> **Verify at any point with `npm run doctor`.** It checks every prerequisite below and
> prints a fix-it hint for anything missing. If it ends with *"Environment is fully
> ready"*, your setup is correct.

---

## Contents

1. [Prerequisites](#1-prerequisites)
2. [Clone the repository](#2-clone-the-repository)
3. [Install dependencies](#3-install-dependencies)
4. [Configure credentials](#4-configure-credentials)
5. [Connect the MCP integrations](#5-connect-the-mcp-integrations)
6. [Optional: register the automation frameworks](#6-optional-register-the-automation-frameworks)
7. [Verify the install](#7-verify-the-install)
8. [Run your first workflow](#8-run-your-first-workflow)
9. [Environment variables reference](#9-environment-variables-reference)
10. [Where files live](#10-where-files-live)
11. [Troubleshooting](#troubleshooting)

---

## 1. Prerequisites

### Required — the workflows will not run without these

| Tool | Version | Windows | macOS |
|---|---|---|---|
| **Node.js** | **20+** (22 LTS recommended) | [nodejs.org](https://nodejs.org) installer, or `winget install OpenJS.NodeJS.LTS` | `brew install node@22`, or [nodejs.org](https://nodejs.org) |
| **Git** | 2.30+ | [Git for Windows](https://git-scm.com/download/win) — **includes Git Bash** | `xcode-select --install` or `brew install git` |
| **Claude Code** | latest | [claude.com/claude-code](https://claude.com/claude-code) | same |

The **Claude CLI must be signed in** (`claude` in a terminal, then follow the prompt) —
the engine shells out to it with your per-user subscription.

### Optional — only for the automation-execution paths

| Tool | Needed for | Install |
|---|---|---|
| **JDK 17+** | running the Java/Appium/Selenium framework | `brew install openjdk@17` / [Adoptium](https://adoptium.net) |
| **Maven 3.9+** | building & running that framework | `brew install maven`, or IntelliJ's bundled Maven |
| **Xcode** | iOS mobile automation (**macOS only**) | App Store |
| **Android SDK** | Android mobile automation | Android Studio |
| **Chromium** | web execution + Figma design export | `npm run playwright:install` (step 3) |

> You do **not** need JDK/Maven/Xcode to run the analysis and design phases
> (requirements, Figma, HLS, test cases). `npm run doctor` reports them as
> warnings, not blockers.

### A note on shells

| | Windows | macOS |
|---|---|---|
| Default shell | PowerShell | zsh |
| POSIX shell available | **Git Bash** (ships with Git for Windows) | built in |

Where this guide gives two code blocks, run the one for your platform. Commands in
`docs/ai/**` are occasionally PowerShell-flavoured; the POSIX equivalent is normally
just the path separators.

---

## 2. Clone the repository

```bash
git clone https://github.com/Breadfast/qa-platform.git breadfast-qa
cd breadfast-qa
```

Clone to a path **without spaces or non-ASCII characters** — some Appium and Maven
tooling mishandles them.

| | Suggested location |
|---|---|
| Windows | `D:\breadfast-qa` or `C:\dev\breadfast-qa` |
| macOS | `~/dev/breadfast-qa` |

> **Windows: do not enable `core.autocrlf=input`.** `.gitattributes` already normalizes
> line endings correctly for both platforms (LF in the repo, CRLF for `.cmd`/`.bat` in
> your working tree). Leave `core.autocrlf` unset, or set it to `true`.

---

## 3. Install dependencies

### 3a. Repo-root dependencies (Playwright, DB/SSH helpers)

```bash
npm install
npm run playwright:install     # downloads Chromium (~150 MB)
```

### 3b. The platform app — only if you will run the web UI

`qa-platform/` is the optional orchestration UI (a legacy execution engine — see
[CLAUDE.md](CLAUDE.md)). **Skip this if you are running workflows through Claude
Code**, which is the primary path.

```bash
cd qa-platform
cp .env.example .env          # Windows: copy .env.example .env
npm install
npm run build
npm run dev                   # api + worker + web
cd ..
```

Then complete the in-app onboarding wizard (workspace, frameworks, integrations).
Double-click launchers also exist: `Breadfast QA Platform.cmd` (Windows) and
`start.command` (macOS).

---

## 4. Configure credentials

**No secrets are committed to this repository, ever.** Every credential is read from
your environment or from a gitignored local file.

Copy the template:

```bash
cp automation/config/credentials.local.example.js automation/config/credentials.local.js
```
```powershell
copy automation\config\credentials.local.example.js automation\config\credentials.local.js
```

Then fill in **your own** values:

| Field | Where to get it |
|---|---|
| `jiraEmail` | your `@breadfast.com` address |
| `jiraApiToken` | [id.atlassian.com → Security → API tokens](https://id.atlassian.com/manage-profile/security/api-tokens) → *Create* |
| `browserstackEmail` / `browserstackPassword` | your BrowserStack login (team vault) |
| `bsTmApiToken` *(optional)* | BrowserStack → Profile → **API tokens** — *Test Management* token, **not** the App Automate key |
| `figmaApiToken` *(optional)* | Figma → Settings → Security → Personal access tokens (`file_content:read`). **Metadata only** |

`automation/config/credentials.local.js` is **gitignored**. `npm run doctor` fails loudly
if it ever becomes tracked.

Environment variables take precedence over the file, so CI and shared machines can skip
it entirely:

```bash
export JIRA_EMAIL="you@breadfast.com" JIRA_API_TOKEN="…"
```
```powershell
$env:JIRA_EMAIL="you@breadfast.com"; $env:JIRA_API_TOKEN="…"
```

> **Never commit a real token.** If one is ever exposed, **revoke it at the source
> first** (Atlassian / BrowserStack / Figma), then remove it from the repo — deleting the
> file is not enough, because git history keeps it.

---

## 5. Connect the MCP integrations

The workflows read Jira, export Figma frames, and fetch login OTPs from Slack through
**MCP connectors**, which are **per-user** and authenticated interactively — they are not
part of the clone.

In Claude Code, run `/mcp` and connect:

| Connector | Used for | Without it |
|---|---|---|
| **Atlassian (Jira)** | fetch the story, AC, comments; publish HLS; file defects | a run cannot start |
| **Figma** | design metadata + the authenticated browser export session | Phase 2 cannot run |
| **Slack** | login OTPs from `#testing-otp` | mobile login cannot complete |

Then authorize the **Figma browser session** once — design export uses Figma's own
native PNG export driven through a real browser, never the REST image API:

```bash
node qa-workflow/bin/figma-connect.js            # opens a browser; log in to Figma
node qa-workflow/bin/figma-connect.js --status    # expect: FRESH
```

The saved session is per-user and gitignored.

---

## 6. Optional: register the automation frameworks

Only needed to **generate or run** automation code.

The canonical framework is the **Breadfast Java framework** (Java + Appium + Selenium +
TestNG + Maven). Clone it anywhere, then point the repo at it:

```bash
export QA_FRAMEWORK_PATH="$HOME/dev/projects"      # the folder containing pom.xml
```
```powershell
$env:QA_FRAMEWORK_PATH="D:\projects"
```

Make it permanent (`~/.zshrc`, or Windows *System → Environment Variables*).

Resolution is **cross-platform and never hardcoded** — `QA_FRAMEWORK_PATH` →
`BF_JAVA_FRAMEWORK_DIR` → conventional locations (`../projects`, `~/projects`,
`~/Projects`, `~/dev/projects`). `npm run doctor` prints exactly which paths it tried.

---

## 7. Verify the install

```bash
npm run doctor      # every prerequisite, with fix-it hints
npm test            # 133 tests, 0 fail — the workflow engine
```

`npm test` is portable (Node's own glob — no `globstar`, works in PowerShell, cmd, bash
and zsh). Narrower slices: `npm run test:machinery` · `npm run test:visual`.

```bash
node qa-workflow/bin/qa-cli.js show "B10-56729"    # inspect an existing story ledger
```

---

## 8. Run your first workflow

Open the **repo root** as the folder in Claude Code — the `/qa-*` entrypoints live in
[`.claude/skills/`](.claude/skills/) and are discovered **only** then.

| Your situation | Command |
|---|---|
| Story groomed, **not built yet** | `/qa-shift-left B10-XXXXX` |
| Built, and a baseline **exists** | `/qa-validate B10-XXXXX` |
| Built, **no baseline** | `/qa-full B10-XXXXX` |

Each writes to `<repo-root>/B10-XXXXX/`. Full workflow semantics:
[ONBOARDING.md](ONBOARDING.md) — the engineering handbook.

---

## 9. Environment variables reference

All are **optional** — each has a working cross-platform default.

### Paths

| Variable | Default | Purpose |
|---|---|---|
| `QA_COMPANION_DIR` | auto-detected (walks up to `CLAUDE.md`) | repo root / engine cwd |
| `QA_WORKSPACE_DIR` | `~/BreadfastQA/Workspace` | per-user runtime data — **outside the repo** |
| `QA_STORY_ROOT` | repo root | where `B10-*/` story folders are created |
| `QA_FRAMEWORK_PATH` | conventional locations | Java framework checkout (folder with `pom.xml`) |
| `BF_JAVA_FRAMEWORK_DIR` | — | same, set by the platform's Framework Registry |
| `BF_B55168_DIR` | — | legacy Playwright framework checkout |
| `BF_PROPERTIES_PATH` | `<framework>/resources/environments/config_testing.properties` | override the properties file directly |
| `BS_PROPERTIES_PATH` | `<framework>/…/browserStackConfigs.properties` | BrowserStack properties |
| `FIGMA_AUTH_PATH` | `<workspace>/auth/figma-auth.json` | saved Figma browser session |

### Credentials (prefer `credentials.local.js`)

`JIRA_EMAIL` · `JIRA_API_TOKEN` · `JIRA_BASE_URL` · `BROWSERSTACK_EMAIL` ·
`BROWSERSTACK_PASSWORD` · `BS_TM_USERNAME` · `BS_TM_API_TOKEN` ·
`BROWSERSTACK_USERNAME` · `BROWSERSTACK_ACCESS_KEY` · `FIGMA_API_TOKEN` ·
`CARD_ADMIN_USERNAME` · `CARD_ADMIN_PASSWORD`

### Reporting

`QA_SHOTS_DIR` · `QA_STORY_ID` · `QA_REPORT_OUT` · `TEST_DATA_INVENTORY`

Platform app vars (ports, SSO, dry-run guards, encryption key) are documented in
[`qa-platform/.env.example`](qa-platform/.env.example).

---

## 10. Where files live

Two roots, deliberately separate — this is why nothing personal gets committed:

```
<repo>/                          COMMITTED — the platform
├── CLAUDE.md  docs/ai/**        canonical workflow + knowledge base
├── .claude/skills/              the /qa-* workflow entrypoints
├── qa-workflow/                 the engine (zero runtime dependencies)
├── automation/                  shared page objects, helpers, config (NO secrets)
├── scripts/doctor.mjs           environment checker
├── qa-platform/                 optional orchestration UI (legacy engine)
└── B10-*/automation/            per-story test scripts + README only

~/BreadfastQA/Workspace/         NEVER COMMITTED — per-user runtime
├── qa.db                        SQLite state
├── auth/figma-auth.json         saved Figma session
├── browser-sessions/  logs/  cache/
└── test_report_*.html
```

Per-run evidence — Figma frames, screenshots, videos, CSVs, reports — is **gitignored by
design** so clones stay small. Only automation scripts and READMEs are tracked inside
`B10-*/`.

---

## Troubleshooting

### `npm test` reports 0 tests, or a "Cannot find module" error

You are likely using the old bash-only invocation. Use the portable script:

```bash
npm test
```

`node --test qa-workflow/` (a bare directory) fails on Node 22 — it resolves the path as
a *module*. The quoted glob in `npm test` is what works everywhere.

### The `/qa-shift-left` etc. commands don't exist in Claude Code

The skills are discovered only when the **repo root itself** is the open folder — not a
parent directory, and not a subfolder. Reopen the folder and check
`npm run doctor` reports *"Workflow skills — 4 discovered"*.

### `claude: command not found` (doctor reports Claude CLI FAIL)

Install Claude Code and make sure its binary is on `PATH`. On macOS with a shell that
isn't zsh, confirm your `PATH` export lives in the right rc file. Verify with
`claude --version`.

### "Java QA framework not located on this machine"

Expected if you haven't cloned it — it's a **warning**, not a blocker, and only affects
automation generation/execution. To fix, set `QA_FRAMEWORK_PATH` to the folder containing
`pom.xml` (§6). `npm run doctor` lists every path it tried.

### `PropertiesReader: the Java QA framework checkout could not be located`

Same cause. Set `QA_FRAMEWORK_PATH`, or point `BF_PROPERTIES_PATH` straight at
`config_testing.properties`.

### `bad interpreter: /bin/bash^M` on macOS

A shell script got CRLF endings. `.gitattributes` prevents this for tracked files; if you
hit it, re-checkout the file:

```bash
git rm --cached -r . && git reset --hard
```

### A `.cmd` launcher fails oddly on Windows

Same problem inverted — batch files need CRLF. `.gitattributes` forces this. Confirm with
`git check-attr eol -- "qa-platform/Breadfast QA Platform.cmd"` (expect `eol: crlf`).

### `mvn: command not found`, but Maven is installed

IntelliJ's bundled Maven isn't on `PATH`. Either install Maven standalone
(`brew install maven`), or invoke the bundled binary by full path. On Windows PowerShell,
prefix Maven args with `--%` so PowerShell doesn't eat them.

### Maven runs all suites instead of the one I chose

Use `-Dsurefire.suiteXmlFiles=…`. The `-DsuiteXmlFile=` form is **ignored**.

### Figma export fails, or `figma-connect --status` isn't FRESH

Re-authorize: `node qa-workflow/bin/figma-connect.js`. Design export **must** come from
Figma's native PNG export in the browser session — never a screenshot and never the REST
image API (deprecated 2026-07-30). See [docs/ai/testing-process.md](docs/ai/testing-process.md) §4.1.

### BrowserStack Test Management calls return 401

Two common causes: you used the **App Automate access key** instead of a **Test
Management API token**, or you hit **API v1**. Only `…/api/v2` exists; v1 returns a
misleading 401 with an SSO redirect. See
[docs/ai/browserstack-process.md](docs/ai/browserstack-process.md) §10.6.

### Jira 401/404

Confirm the token is current and the base URL is `https://breadfast.atlassian.net`.
Treat a 404 as *probably a wrong path or API version* before concluding the resource is
missing.

### Something is missing and I'm not sure what to ask for

Run `npm run doctor` and paste its output — every gap comes with a fix-it hint. The QA
process rule is **ask, never block**: a missing credential or access is something to
request, not a reason to report a phase as blocked.

---

## Related documentation

| Document | What it covers |
|---|---|
| [README.md](README.md) | repository overview + quick start |
| [ONBOARDING.md](ONBOARDING.md) | engineering handbook — vision, architecture, the three workflows |
| [CLAUDE.md](CLAUDE.md) | the operating manual for QA sessions (orchestration layer) |
| [docs/ai/QA_PROCESS.md](docs/ai/QA_PROCESS.md) | authoritative QA methodology (seven gated phases) |
| [qa-platform/README.md](qa-platform/README.md) | the optional platform app |
| [automation/README.md](automation/README.md) | shared automation rules |
