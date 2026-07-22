# lib/freshness/ — the Reconcile engine (scaffold)

Implements the freshness algorithm in
[`../../../docs/ai/architecture/qa-artifact-contract.md`](../../../docs/ai/architecture/qa-artifact-contract.md) §5.

**Contract (to implement):**
- `fingerprintJira(issue)` → `{ updated, hash, fieldsHashed }`
- `fingerprintFigma({fileKey,nodeIds,lastModified,version,framesHash?})` → figma fingerprint
- `reconcile(qaState, liveSources)` → `{ reuse[], stale[], modified[], conflicts[] }` (DAG-ordered)
- honors: human-edit detection (edits win), conflict surfacing, clarifications materiality gate,
  `version:`-bump invalidation, domain-fingerprint invalidation.

Drift-shaped: the same fingerprint/invalidate core the plugin's `drift` command will reuse for skills.
