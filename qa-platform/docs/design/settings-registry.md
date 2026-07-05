# Design — Settings Registry & Credentials

> **Status:** LOCKED (Phase 0). One registry drives UI + validation + runtime. Every field carries help. Credentials requested only when needed, always with Use-once / Save-to-me / Save-as-project-default.

## 1. Registry entry (single source of truth)

One declarative array in `@qa/shared` — the UI, API validation, and worker all read it. No more UI/worker drift (today many UI keys are never consumed).

```ts
interface SettingDef {
  key: string;                 // "browserstack.username"
  group: SettingGroup;         // jira | browserstack | figma | ai | automation | integrations
  label: string;
  scope: 'user' | 'project' | 'story' | 'runtime';
  secret: boolean;             // encrypted at rest + masked in UI
  // ── help (all four required for every field) ──
  help: {
    what: string;              // what this field is
    why: string;               // why it is needed
    when: string;              // when in the QA workflow it is used
    where: string;             // where/how to obtain it
  };
  requiredByNodes?: LifecycleNode[]; // which lifecycle nodes need it → drives progressive prompting
  validate?: (v: string) => string | null; // optional format/connection check
  placeholder?: string;
  defaultPersistence?: CredentialPersistence; // suggested mode when first prompted
}

// Refinement #7 — how a credential's value is retained across runs.
type CredentialPersistence =
  | 'use-once'         // apply for THIS run only; remember nothing (re-prompt next run, no stored preference)
  | 'ask-every-run'    // never store the value; ALWAYS prompt at the start of every run (preference IS stored)
  | 'save-permanently';// store the value (encrypted if secret) in user settings; don't prompt again
```

### Example entries

| key | scope | secret | what / why / when / where |
|---|---|---|---|
| `browserstack.username` | user | no | BrowserStack account username · needed for Test Management + execution · used at `gate_upload_browserstack` + `execution` · BrowserStack → Account Settings |
| `browserstack.accessKey` | user | yes | App Automate access key · API auth for mobile execution · at `execution` (mobile) · BrowserStack → Account Settings |
| `figma.token` | user | yes | Figma Personal Access Token · REST fallback when browser export is rate-limited · at `figma_analysis` · Figma → Settings → Personal Access Tokens |
| `jira.apiToken` | user | yes | Jira API token · read stories / push HLS / file defects · at `fetch_jira`, `gate_push_hls`, `gate_file_bugs` · Atlassian → Account Security |
| `jira.baseUrl` | project | no | Jira base URL · endpoint for the project's issues · at `fetch_jira` · your Atlassian site URL |

## 2. Scope → storage (local-first)

| Scope | Stored where | Committed? |
|---|---|---|
| **user** | `Setting` table in workspace `qa.db` (secrets encrypted) | no |
| **project** | committed `project-defaults.json` (non-secret) + optional local override | non-secret only |
| **story** | `Story` columns (existing) | no |
| **runtime** | held in run state for one run, never persisted | no |

## 3. Encryption at rest

- Wire the already-declared `SECRETS_ENCRYPTION_KEY` (32-byte base64) with `node:crypto` **AES-256-GCM** (iv + authTag stored with ciphertext).
- Encrypt `Setting.value` where `secret=true`, and `Story.credentials`.
- Key resolution: `SECRETS_ENCRYPTION_KEY` env → key file in the OS config dir (generated on first run, `chmod 600`). If absent, the platform generates one at onboarding.
- **Guard `GET /settings/resolved`** — the worker authenticates with a local worker token (shared secret in the bootstrap config), not an open endpoint. Never return decrypted secrets to the browser; the UI only ever sees masks + `isSet`.

## 4. Progressive collection — `config.needed`

A new runtime event kind alongside `ask`/`gate`, reusing the existing `PausedForInput` pause/resume machinery and the `Clarification`-style persistence.

**Flow:**
1. A node about to use a credential resolves it (runtime override → user setting → project default → env). If a `requiredByNodes` key is missing, the node emits `config.needed` and pauses the run.
2. The event payload carries the `SettingDef` (label + full help + secret flag + where-to-obtain).
3. The UI renders the field with its help text and asks the tester to pick a **persistence mode** (refinement #7):
   - **Use Once** → value kept in run state only, discarded when the run ends; no preference stored (next run prompts again).
   - **Ask Every Run** → value never stored, but the *preference* is stored, so this field is always prompted at the start of every run (good for high-sensitivity creds).
   - **Save Permanently** → value stored in `Setting` (user scope, encrypted if secret); not prompted again.
   - **Save as Project Default** → additionally written to the project profile; offered **only** for non-secret keys.
4. Tester submits → run requeues → the node resumes and proceeds.

**Persistence state** lives per key: `save-permanently` stores value+mode; `ask-every-run` stores only the mode (no value); `use-once` stores nothing. A "Reset saved credential" control in Settings clears a stored value/preference.

**Rule:** never prompt for a credential a node doesn't actually need on this run (respects directives/skips and platform — e.g. no BrowserStack prompt for a web-only story). `ask-every-run` keys are gathered up-front at run start if already known to be required; others are prompted lazily when a node first needs them.

## 5. Migration of today's flat keys

- Keep the working keys (`browserstack.*`, `jira.baseUrl`, `figma.token`, `gates.*`, `hls.maxScenarios`) — attach help + scope.
- **Wire the dead keys** (`ai.model*`, `ai.claudeBin`, `jira.auth`, `integrations.*`) into their consumers, or delete them so the UI stops implying nonexistent features.
- `GET /settings` stays masked+guarded; `POST /settings` stays with the "masked secret = unchanged" rule.

## 6. Parity note

Same credentials the canonical Companion uses (CLAUDE.md §7/§8) — this only changes *when/how* they're collected and that they're encrypted. No workflow behavior change.
