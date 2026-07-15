/**
 * Secret redaction for persisted LLM prompts (Phase 1 #7).
 *
 * Extracted from the worker so it is independently testable. Masks obvious
 * `secretKey: value` / `secretKey=value` pairs and bounds length before a prompt
 * is written to the LLM Request Log. Local-first (values live only in the local
 * DB), but raw credentials are still never stored.
 */
export function redactSecrets(s?: string): string | undefined {
  if (!s) return s;
  return s
    .replace(
      /("?(?:password|passcode|pin|otp|token|secret|api[_-]?key|apikey|access[_-]?key)"?\s*[:=]\s*)("?)([^"\n,}]+)(\2)/gi,
      '$1$2«redacted»$4',
    )
    .slice(0, 8000);
}
