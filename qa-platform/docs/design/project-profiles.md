# Design — Project Profiles

> **Status:** LOCKED (Phase 0). Profiles are the **primary entry point for story creation**. Selecting a profile auto-configures the wizard; per-story overrides always allowed.

## 1. Model

```ts
interface ProjectProfile {
  id: string;                        // "card-service"
  name: string;                      // "Card Service"
  jiraProject: string;               // "B10"
  browserstack: {
    project?: string;                // BS project id
    defaultFolder?: string;          // default BS folder id for new cases
    folderDefaults?: Record<string, string>; // optional per-area/platform folder map (refinement #4)
  };
  figma?: {                          // Figma defaults (refinement #4)
    defaultFileKey?: string;
    team?: string;
    workspace?: string;
  };
  frameworks: string[];              // Framework Registry ids/names this project uses
  urls: Partial<Record<Environment, string>>;   // testing/staging/production app URLs
  adminUrls?: Partial<Record<Environment, string>>;
  defaultEnvironment: Environment;   // testing
  defaultPlatform: Platform;         // web | android | ios | cross-platform | web-mobile
  defaultLocales: Locale[];          // [en-US, ar-EG]
  defaultExecutionType: ExecutionType; // full | smoke | regression
  defaultExecutionInstructions?: string; // free-text guidance pre-filled into the wizard (refinement #4)
  testDataTemplates?: TestDataTemplate[]; // reusable test-data presets (refinement #4)
  credentialRefs?: Record<string, string>; // logical name → Setting key (NEVER inline secrets)
  notes?: string;
}

// Reusable test-data preset (non-secret shape; concrete secret values resolved at run time).
interface TestDataTemplate {
  name: string;                      // "KYC-ready card user"
  type: TestDataType;                // phone | package | account | card | otp
  fields: Record<string, unknown>;  // template fields (e.g. status target, package tier) — no secrets
  notes?: string;
}
```

## 2. Storage (shared vs personal split)

- **Non-secret profile defaults** → committed **`project-defaults.json`** at the repo root (shared: Card Service, Customer App, Control Room, Chatbot, …). Loaded into the DB on startup; the (currently dead) `Project.defaultsJson` table is **repurposed** as the loaded/overridable form.
- **Secrets** → never in the profile; `credentialRefs` point to encrypted `Setting` keys resolved at run time.
- **Personal overrides** → a user may override a profile's paths/URLs locally (stored in workspace `qa.db`), e.g. their own framework clone location.

## 3. Behavior

- **Story creation starts with a Project selector.** Choosing a profile pre-fills: Jira project, BrowserStack project + folder, frameworks, app/admin URLs (by environment), default environment, platform, locales, execution type, and any default execution settings.
- Every pre-filled field remains **editable per story** (the wizard captures overrides onto the `Story` row, as today).
- Profiles also seed **diagnostics** (which frameworks/integrations to validate) and **progressive settings** (which `credentialRefs` a run may need).

## 4. API / UI

- `GET /profiles`, `POST /profiles`, `PATCH /profiles/:id`, `DELETE /profiles/:id`.
- New-story page: profile dropdown at the top; on select → `applyProfileDefaults()` populates the form; a "customized" badge appears on any field the tester overrides.
- Profiles are editable in Settings → Projects (leads/admins for shared defaults; anyone for personal overrides).

## 5. Parity note

Profiles are pure convenience/config — they change *how inputs are populated*, not what any lifecycle node does. The canonical workflow runs identically whether inputs came from a profile or were typed by hand.
