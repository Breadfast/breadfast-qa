/**
 * Visual Testing engine selection flags (BACKLOG-002 VT0-S1).
 *
 * Pure precedence resolvers for the `QA_VISUAL_ENGINE` / `QA_VISUAL_ABSTAIN`
 * flags. The worker passes the Settings value + the env value; these functions
 * only decide precedence + normalization so they are unit-testable without the
 * worker runtime. Precedence: Settings value → env value → default. An
 * empty/whitespace string is treated as "unset" and falls through.
 *
 * M0 plumbs these flags; only `'legacy'` is implemented today — `'shadow'` and
 * `'pyramid'` dispatch land in later VT stories (VT4-S1) and currently degrade
 * to the legacy comparator so the pipeline stays working.
 */

/** Which visual comparison engine a run uses. */
export type VisualEngine = 'legacy' | 'shadow' | 'pyramid';

/** First non-empty (trimmed) string among the candidates, or '' if none. */
function firstSet(...vals: Array<string | null | undefined>): string {
  for (const v of vals) {
    const s = (v ?? '').toString().trim();
    if (s) return s;
  }
  return '';
}

/**
 * Resolve the visual engine. Settings value wins over env; unknown values fall
 * back to the safe default `'legacy'` (never throws).
 */
export function resolveVisualEngine(
  settingValue?: string | null,
  envValue?: string | null,
): VisualEngine {
  const raw = firstSet(settingValue, envValue).toLowerCase();
  return raw === 'shadow' || raw === 'pyramid' ? raw : 'legacy';
}

/**
 * Resolve the pairing-abstain flag (consumed by the unified resolver in VT1-S1;
 * a no-op today). Truthy tokens: true/1/on/yes. Anything else → false.
 */
export function resolveVisualAbstain(
  settingValue?: string | null,
  envValue?: string | null,
): boolean {
  const raw = firstSet(settingValue, envValue).toLowerCase();
  return raw === 'true' || raw === '1' || raw === 'on' || raw === 'yes';
}
