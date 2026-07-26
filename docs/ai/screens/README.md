# Screen Registry — authoring guide (DEC-3)

The Screen Registry is the **single source of truth** mapping a stable, semantic
`screenId` to its Figma frames, expected components, validation profile, and
capture rules. It is what makes visual pairing **deterministic** (a lookup, not a
filename guess) and what activates the Validation Pyramid's L2–L6 layers.

> **Ownership:** QA Leads. **Location:** this folder (`docs/ai/screens/`),
> shared in git. **Loader:** `@qa/shared/screen-registry-loader` reads every
> `*.json` here. **Files beginning with `_` are IGNORED** (templates/examples).
> **Schema + validator:** `@qa/shared` (`Screen`, `ValidationProfile`,
> `validateScreenRegistry`). The pre-execution **Diagnostics** gate runs the
> validator (`core.screenRegistry`).

## How it's consumed

1. Automation emits an **Evidence Manifest** carrying `screenId` per captured screen.
2. The visual engine resolves each Figma frame → screenshot **deterministically**
   by `screenId` (registry-first), falling back to the heuristic only when a
   screen isn't registered.
3. For a registered screen, `expectedComponents` (+ optional Figma-extracted
   bounds/styles) are compared against the actual structured dump by the pyramid.

## File shapes

A file may be **one Screen**, an **array of Screens**, or a **chunk**
`{ "profiles": [...], "screens": [...] }`. Use chunks to define shared profiles.

### Screen
| field | required | notes |
|---|---|---|
| `id` | ✅ | stable, semantic, **never changes** (e.g. `address-list`). Identity. |
| `displayName` | | human label |
| `domain` | | e.g. `perks`, `address` |
| `owner` | | team/person |
| `profileId` | | references a `ValidationProfile.id` (else the default profile) |
| `expectedComponents[]` | | the component contract (below) |
| `variants[]` | | one per platform × locale (below) |

### ScreenVariant  (`figmaNodeId` lives HERE — EN/AR/iOS/Android are different frames)
`platform` (`web`\|`ios`\|`android`) · `locale` · `figmaFileKey` · `figmaNodeId`
· `figmaFrameName` (drift detection) · `baselineRef?` · `captureRules?`

### ExpectedComponent  (curated contract — see ADR-002 Rev.2 §3)
`componentId` (prefer the app's real **test-id** so matching is exact) · `role`
· `accessibleName` (expected copy → L5) · `required` · `order` (→ L2 ordering)
· `parent` · `maxCardinality` (→ L2 duplicates) · `bounds?` (→ L4) · `styles?` (→ L6).

### ValidationProfile
`id` · `mode` (`design-conformance`\|`regression`\|`hybrid`) · `enabledLayers[]`
(`identity`,`component-tree`,`visibility`,`layout`,`text`,`styles`,`pixel`,`ai`)
· `tolerances` (`px`,`colorDeltaE`,`fontPx`,`spacingPx`) · `weights`.

## Authoring workflow

1. Copy `_template.json` → `<domain>.<screen>.json` (no `_` prefix).
2. Set a stable `id`; add a variant per platform/locale with the **`figmaNodeId`
   from the Figma URL** (`/design/<fileKey>/…?node-id=<id>`).
3. Author `expectedComponents` using **real test-ids** as `componentId` (Figma
   extraction can seed `bounds`/`styles`; curate identities by hand).
4. Keep `screenId`s **unique** — the validator rejects duplicates.
5. Run the validator: it's part of the Diagnostics gate; fix all errors.

## Rules
- **Never** duplicate a `screenId` or `ValidationProfile.id` (validator error).
- Unregistered screens still run (heuristic pairing) — register **highest-traffic
  screens first**; coverage grows incrementally.
- `_template.json` / `_example.*.json` are **examples only** and are never loaded.
