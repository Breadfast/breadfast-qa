# lib/freshness/ — the Reconcile engine

Implements the freshness algorithm in
[`../../../docs/ai/architecture/qa-artifact-contract.md`](../../../docs/ai/architecture/qa-artifact-contract.md) §5.
Zero-dependency (built-in `crypto` only). Drift-shaped: the same fingerprint/invalidate core the
plugin's `drift` command can reuse for skills.

| Module | Exports | Purpose |
|---|---|---|
| `dag.js` | `DAG`, `BASELINE`, `topoOrder`, `dependentsOf` | artifact dependency graph (cascade edges + context) |
| `fingerprint.js` | `sha256`, `normalizeJira`, `fingerprintJira`, `fingerprintFigma`, `fileChecksum` | source/artifact fingerprints |
| `reconcile.js` | `reconcile(qaState, live, io, opts)` | pure classifier → `{ reuse, stale, modified, conflicts, reasons, sourceChanged }` |

`reconcile()` is pure (file checks injected via `io`) and fully unit-tested in `freshness.test.js`:
human-edit detection (edits win), conflict surfacing, cascade, clarifications materiality gate,
`version:`-bump and domain-change invalidation, topological ordering.
