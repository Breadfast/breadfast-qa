# Setup Guide — Breadfast QA

Everything a QA engineer needs to go from **empty machine → running a QA workflow**, on
**Windows** and **macOS** (Linux works the same as macOS).

Follow it top to bottom. Total time: **~20 minutes**, most of it downloads.

> **Verify at any point with `npm run doctor`.** It checks every prerequisite below and
> prints a fix-it hint for anything missing. If it ends with *"Environment is fully
> ready"*, your setup is correct.

---

## Contents

1. [Prerequisites](#1-prerequisites)
2. [Clone the repositories](#2-clone-the-repositories)
3. [Install dependencies](#3-install-dependencies)
4. [Configure credentials](#4-configure-credentials)
5. [Claude Code: MCP servers and plugins](#5-claude-code-mcp-servers-and-plugins)
6. [The Java framework's config files](#6-the-java-frameworks-config-files)
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
| **GitHub access** | — | membership of the `Breadfast` GitHub org (ask your lead) | same |

The **Claude CLI must be signed in** (`claude` in a terminal, then follow the prompt).

### Needed for automation and mobile execution

| Tool | Needed for | Install |
|---|---|---|
| **JDK 17+** | running the Java/Appium/Selenium framework | `brew install --cask temurin` / [Adoptium](https://adoptium.net) |
| **Maven 3.9+** | building & running that framework | `brew install maven`, or IntelliJ's bundled Maven |
| **Company VPN** | the live card-service DB (only if you use it) | IT |
| **Chromium** | web execution + Figma design export | `npm run playwright:install` (step 3) |

Mobile runs go to BrowserStack App Automate, so no local Xcode or Android SDK is needed.

> You do **not** need JDK/Maven to run the analysis and design phases (requirements,
> Figma, HLS, test cases). `npm run doctor` reports them as warnings, not blockers.

### A note on shells

| | Windows | macOS |
|---|---|---|
| Default shell | PowerShell | zsh |
| POSIX shell available | **Git Bash** (ships with Git for Windows) | built in |

Where this guide gives two code blocks, run the one for your platform. Commands in
`docs/ai/**` and in story write-ups are occasionally PowerShell-flavoured, and paths
such as `D:\projects` are the author's machine: read them as *your* framework checkout.

---

## 2. Clone the repositories

Clone **both** repos side by side. This one holds the QA process; the Java framework holds
the automation.

```bash
mkdir -p ~/dev && cd ~/dev                      # Windows: any folder, e.g. C:\dev or D:\
git clone https://github.com/Breadfast/breadfast-qa.git
git clone https://github.com/Breadfast/QA_Automation_Framework.git projects
cd breadfast-qa
```

Cloning the framework as **`projects` next to `breadfast-qa`** means it's found with no
configuration (see §9 for the other locations that are searched automatically).

Clone to a path **without spaces or non-ASCII characters**; some Appium and Maven tooling
mishandles them.

> **Line endings.** `.gitattributes` normalizes them for both platforms (LF in the repo,
> CRLF for `.cmd`/`.bat` in your working tree). On Windows leave `core.autocrlf` unset or
> `true`; on macOS leave it unset or `input`.

---

## 3. Install dependencies

```bash
npm install
npm run playwright:install     # downloads Chromium (~150 MB)
```

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
| `browserstackUsername` / `browserstackAccessKey` | BrowserStack → Account → Settings → *Authentication & Security* (the App Automate hub key) |
| `bsTmUsername` / `bsTmApiToken` *(optional)* | BrowserStack → Profile → **API tokens**: the *Test Management* token, **not** the App Automate key |
| `figmaApiToken` *(optional)* | Figma → Settings → Security → Personal access tokens (`file_content:read`). **Metadata only** |
| `cardPanelAdminPassword` *(optional)* | card squad; otherwise read from the framework's `cardServiceConfigs_testing.properties` |
| `cardDb*` / `cardCron*` *(optional)* | card squad: live card-service DB over the VPN, and the testing cron trigger |

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
> first** (Atlassian / BrowserStack / Figma), then remove it from the repo. Deleting the
> file is not enough, because git history keeps it.

---

## 5. Claude Code: MCP servers and plugins

Open the **repo root** in Claude Code (`claude` from inside `breadfast-qa/`, or open the
folder in VS Code). The repo declares what the process needs, and Claude Code offers it
on first open:

| Declared in | What | Your action |
|---|---|---|
| [`.mcp.json`](.mcp.json) | **Atlassian** (Jira: story, AC, comments, HLS), **Figma** (design metadata), **Playwright** (browser driving) | approve the project MCP servers when prompted, then run `/mcp` and **Authenticate** Atlassian and Figma (browser sign-in, per user) |
| [`.claude/settings.json`](.claude/settings.json) | plugins **`breadfast-workflow`** (from `Breadfast/breadfast-workflow`) and **`humanizer`** (mandatory for bug and test-case wording) | trust the marketplaces and install when prompted, or run `/plugin` |

If you already have Atlassian or Figma connected as a **claude.ai connector**, you can
skip that server here; both routes give the same tools.

**Login OTPs** are read from the Google Chat `#testing-otp` space by the automation
itself, using the credentials in the framework's `config_testing.properties` (§6). No
MCP connector is needed for them, and Slack is retired.

Then authorize the **Figma browser session** once. Design export uses Figma's own
native PNG export driven through a real browser, never the REST image API:

```bash
node qa-workflow/bin/figma-connect.js            # opens a browser; log in to Figma
node qa-workflow/bin/figma-connect.js --status    # expect: FRESH
```

The saved session is per-user and gitignored.

---

## 6. The Java framework's config files

The framework's environment files are **gitignored in that repo too**, so a fresh clone
has none of them. Get them from the QA team (team vault) and copy them into
`<framework>/resources/environments/`:

| File | Used for |
|---|---|
| `config_testing.properties` | base URLs, test users, Google Chat OTP credentials, DB bastion |
| `cardServiceConfigs_testing.properties` | card-service URLs and the card-panel admin account |
| `browserStackConfigs.properties` | BrowserStack App Automate credentials and app ids |
| `webConfig.properties`, `iPhone_14.properties`, `Pixel_2.properties`, `cardServiceEncryptionPublicKey.pub` | web runs, device profiles, card PIN encryption |

`npm run doctor` reports which of the first three are missing.

If you cloned the framework somewhere other than a sibling `projects/` folder, point the
repo at it and make it permanent (`~/.zshrc`, or Windows *System → Environment
Variables*):

```bash
export QA_FRAMEWORK_PATH="$HOME/work/projects"      # the folder containing pom.xml
```
```powershell
setx QA_FRAMEWORK_PATH "D:\projects"
```

---

## 7. Verify the install

```bash
npm run doctor      # every prerequisite, with fix-it hints
npm test            # 202 tests, 0 fail — the workflow engine
```

`npm test` is portable (Node's own glob; works in PowerShell, cmd, bash and zsh).
Narrower slices: `npm run test:machinery` · `npm run test:visual`.

Story folders (`B10-*/`) are **not** in the clone: each engineer's runs stay on their own
machine. To see the ledger tooling work, create a scratch story and inspect it:

```bash
node qa-workflow/bin/qa-cli.js init B10-00000 B10-00000
node qa-workflow/bin/qa-cli.js status B10-00000      # then delete the B10-00000 folder
```

---

## 8. Run your first workflow

Open the **repo root** as the folder in Claude Code. The `/qa-*` entrypoints live in
[`.claude/skills/`](.claude/skills/) and are discovered **only** then.

| Your situation | Command |
|---|---|
| Story groomed, **not built yet** | `/qa-shift-left B10-XXXXX` |
| Built, and a baseline **exists** | `/qa-validate B10-XXXXX` |
| Built, **no baseline** | `/qa-full B10-XXXXX` |

Each writes to `<repo-root>/B10-XXXXX/` (gitignored). Every story also gets a branch in
**both** repos, `<year>/sprintQ<n>.<n>/<ticket>-<slug>` ([CLAUDE.md](CLAUDE.md) §5).
Full workflow semantics: [ONBOARDING.md](ONBOARDING.md), the engineering handbook.

---

## 9. Environment variables reference

All are **optional**; each has a working cross-platform default.

### Paths

| Variable | Default | Purpose |
|---|---|---|
| `QA_FRAMEWORK_PATH` | searched: `../projects`, `~/projects`, `~/Projects`, `~/dev/projects`, `~/breadfast/projects`, then `D:\projects` | Java framework checkout (folder with `pom.xml`) |
| `BF_JAVA_FRAMEWORK_DIR` · `BF_JAVA_DIR` | — | aliases for the same, checked after `QA_FRAMEWORK_PATH` |
| `QA_WORKSPACE_DIR` | `~/BreadfastQA/Workspace` | per-user runtime data — **outside the repo** |
| `BF_PROPERTIES_PATH` | `<framework>/resources/environments/config_testing.properties` | override the properties file directly |
| `BF_CARD_PROPERTIES_PATH` · `BF_CARD_PUBKEY_PATH` | `<framework>/resources/environments/…` | card-service properties / public key |
| `BS_PROPERTIES_PATH` | `<framework>/…/browserStackConfigs.properties` | BrowserStack properties |
| `FIGMA_AUTH_PATH` | `<workspace>/auth/figma-auth.json` | saved Figma browser session |

### Credentials (prefer `credentials.local.js`)

`JIRA_EMAIL` · `JIRA_API_TOKEN` · `JIRA_BASE_URL` · `BROWSERSTACK_EMAIL` ·
`BROWSERSTACK_PASSWORD` · `BROWSERSTACK_USERNAME` · `BROWSERSTACK_ACCESS_KEY` ·
`BS_TM_USERNAME` · `BS_TM_API_TOKEN` · `FIGMA_API_TOKEN` · `CARD_PANEL_ADMIN_PASSWORD` ·
`CARD_DB_HOST` · `CARD_DB_USER` · `CARD_DB_PASSWORD` · `CARD_DB_SSH_HOST` ·
`CARD_DB_SSH_USER` · `CARD_DB_SSH_PASSWORD` · `CARD_CRON_AUTHORIZATION` · `CARD_CRON_TOKEN` ·
`GOOGLE_CHAT_*` (normally read from the framework properties)

### Reporting

`QA_SHOTS_DIR` · `QA_STORY_ID` · `QA_REPORT_OUT` · `TEST_DATA_INVENTORY`

---

## 10. Where files live

Three roots, deliberately separate. This is why nothing personal gets committed:

```
breadfast-qa/                    COMMITTED — the QA process
├── CLAUDE.md  docs/ai/**        canonical workflow + knowledge base
├── .claude/skills/              the /qa-* workflow entrypoints
├── .claude/settings.json        required plugins       .mcp.json   MCP servers
├── qa-workflow/                 the engine (zero runtime dependencies)
├── automation/                  shared page objects, helpers, config (NO secrets)
├── scripts/doctor.mjs           environment checker
└── B10-*/                       LOCAL ONLY — your story runs (gitignored)

projects/                        the Java framework (its own repo)
└── resources/environments/      LOCAL ONLY — config files from the team (gitignored)

~/BreadfastQA/Workspace/         LOCAL ONLY — per-user runtime
├── auth/figma-auth.json         saved Figma session
└── test_report_*.html
```

Story folders, evidence, screenshots, videos and reports are **gitignored by design**.
Anything reusable a story produces is promoted into `automation/` or `docs/ai/`.

---

## Troubleshooting

### `npm test` reports 0 tests, or a "Cannot find module" error

Use the portable script, `npm test`. `node --test qa-workflow/` (a bare directory) fails
on Node 22 because it resolves the path as a *module*.

### The `/qa-shift-left` etc. commands don't exist in Claude Code

The skills are discovered only when the **repo root itself** is the open folder, not a
parent directory and not a subfolder. Reopen the folder and check `npm run doctor`
reports *"Workflow skills — 4 discovered"*.

### The `breadfast-workflow` plugin won't install

It comes from the private `Breadfast/breadfast-workflow` repo, so your git must be able to
clone it: run `git clone https://github.com/Breadfast/breadfast-workflow.git` once in a
scratch folder to confirm access, then `/plugin` again.

### `claude: command not found` (doctor reports Claude CLI FAIL)

Install Claude Code and make sure its binary is on `PATH`. Verify with `claude --version`.

### "Java QA framework not located on this machine"

Expected if you haven't cloned it; it's a **warning**, not a blocker, and only affects
automation. Clone it as a sibling `projects/` folder, or set `QA_FRAMEWORK_PATH` (§6).
`npm run doctor` lists every path it tried.

### `PropertiesReader: … is missing the properties file`

The framework is found, but its gitignored config files aren't there. Copy them in (§6).

### `bad interpreter: /bin/bash^M` on macOS

A shell script got CRLF endings. `.gitattributes` prevents this for tracked files; if you
hit it, re-checkout: `git rm --cached -r . && git reset --hard`.

### `mvn: command not found`, but Maven is installed

IntelliJ's bundled Maven isn't on `PATH`. Install Maven standalone (`brew install maven`),
or invoke the bundled binary by full path. On Windows PowerShell, prefix Maven args with
`--%` so PowerShell doesn't eat them.

### Maven runs all suites instead of the one I chose

Use `-Dsurefire.suiteXmlFiles=…`. The `-DsuiteXmlFile=` form is **ignored**.

### Figma export fails, or `figma-connect --status` isn't FRESH

Re-authorize: `node qa-workflow/bin/figma-connect.js`. Design export **must** come from
Figma's native PNG export in the browser session, never a screenshot and never the REST
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

Run `npm run doctor` and paste its output; every gap comes with a fix-it hint. The QA
process rule is **ask, never block**: a missing credential or access is something to
request, not a reason to report a phase as blocked.

---

## Related documentation

| Document | What it covers |
|---|---|
| [README.md](README.md) | repository overview + quick start |
| [ONBOARDING.md](ONBOARDING.md) | engineering handbook: vision, architecture, the three workflows |
| [CLAUDE.md](CLAUDE.md) | the operating manual for QA sessions (orchestration layer) |
| [docs/ai/QA_PROCESS.md](docs/ai/QA_PROCESS.md) | authoritative QA methodology (seven gated phases) |
| [automation/README.md](automation/README.md) | shared automation rules |
