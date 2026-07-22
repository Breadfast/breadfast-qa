# lib/ — QA workflow machinery

Authoring/validation machinery (Node, run by the workflow orchestration). **Not** runtime automation —
Playwright/Appium helpers live in `../../automation/**` and are invoked during execution.

| Module | Purpose | Migrates to |
|---|---|---|
| `freshness/` | fingerprint sources → invalidate → list-stale (the `Reconcile()` engine) | plugin `drift` internals |
| `schema/` | validators for `qa-state.json` + skill frontmatter | plugin `lib/schema/` |

Both are **scaffold stubs**; implemented in the implementation phase, drift-shaped so the plugin's
`drift` command can absorb the freshness engine unchanged.
