/**
 * Tolerant JSON extraction + repair for LLM output.
 *
 * Roadmap Phase 1 #1 (JSON Repair Layer). LLM JSON output fails to parse for a
 * small, recurring set of reasons: markdown code fences, prose around the
 * object, trailing commas, JS-style comments, smart/typographic quotes, and
 * un-escaped control characters (raw newlines/tabs) inside string values. This
 * module repairs those deterministically BEFORE the caller spends a Claude
 * re-run (see packages/engine/src/task.ts). Repair is always attempted; the
 * model is only re-prompted when repair still cannot produce parseable JSON
 * (and, at the task layer, schema-valid JSON).
 *
 * Behavior-preserving: the previous parseJson() only stripped a fence and took
 * the outermost {...}. parseJsonTolerant() is a strict superset — every input
 * the old path parsed still parses (raw fast-path first), plus the repair
 * stages recover inputs the old path returned undefined for.
 */

export interface JsonParseResult {
  /** The parsed value. Never `undefined` (that is the not-parseable sentinel of the API below). */
  value: unknown;
  /** true when any repair transform beyond a plain JSON.parse was needed. */
  repaired: boolean;
  /** Short label of the stage that succeeded — useful for logging/metrics. */
  stage: string;
}

function tryParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Strip a leading/trailing markdown code fence (```json … ```), if present. */
export function stripCodeFence(text: string): string {
  const fence = text.match(/```(?:json5?|jsonc)?\s*([\s\S]*?)```/i);
  return fence ? fence[1].trim() : text;
}

/**
 * Return the outermost balanced JSON value (object or array) found in `text`,
 * scanning with string/escape awareness so braces inside string literals do not
 * throw off the balance count. Returns the original text if no opener is found,
 * and the slice from the opener to end if it is unbalanced (a later stage may
 * still close it or a comment strip may fix it).
 */
export function extractBalanced(text: string): string {
  const start = text.search(/[{[]/);
  if (start < 0) return text;
  const open = text[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === '\\') {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return text.slice(start); // unbalanced — leave it for later stages
}

/** Remove // line comments and block comments that appear outside of strings. */
export function stripComments(text: string): string {
  let out = '';
  let inString = false;
  let escape = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (inString) {
      out += ch;
      if (escape) escape = false;
      else if (ch === '\\') escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }
    if (ch === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      if (i < text.length) out += text[i]; // keep the newline
      continue;
    }
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i++; // skip the closing '/'
      continue;
    }
    out += ch;
  }
  return out;
}

/** Remove trailing commas before a closing } or ]. */
export function removeTrailingCommas(text: string): string {
  return text.replace(/,(\s*[}\]])/g, '$1');
}

/** Normalize typographic (smart) quotes to straight quotes. */
export function normalizeSmartQuotes(text: string): string {
  return text
    .replace(/[“”„‟″‶]/g, '"')
    .replace(/[‘’‚‛′‵]/g, "'");
}

/**
 * Escape raw control characters (literal newlines, tabs, carriage returns) that
 * appear INSIDE a JSON string value — a very common LLM defect where a
 * multi-line value is emitted verbatim instead of with \n. Only characters
 * inside string literals are touched; structural whitespace is preserved.
 */
export function escapeControlCharsInStrings(text: string): string {
  let out = '';
  let inString = false;
  let escape = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const code = text.charCodeAt(i);
    if (inString) {
      if (escape) {
        out += ch;
        escape = false;
        continue;
      }
      if (ch === '\\') {
        out += ch;
        escape = true;
        continue;
      }
      if (ch === '"') {
        out += ch;
        inString = false;
        continue;
      }
      if (code < 0x20) {
        // Raw control char inside a string — escape it.
        if (ch === '\n') out += '\\n';
        else if (ch === '\r') out += '\\r';
        else if (ch === '\t') out += '\\t';
        else if (ch === '\b') out += '\\b';
        else if (ch === '\f') out += '\\f';
        else out += '\\u' + code.toString(16).padStart(4, '0');
        continue;
      }
      out += ch;
      continue;
    }
    if (ch === '"') inString = true;
    out += ch;
  }
  return out;
}

/**
 * Progressive-repair JSON parser. Tries the cheapest interpretation first and
 * escalates only as needed, returning the first parseable result. Returns
 * `undefined` only when even the most aggressive repair cannot parse — that is
 * the caller's signal to re-prompt the model.
 */
export function parseJsonTolerant(text: string | null | undefined): JsonParseResult | undefined {
  if (!text) return undefined;
  const raw = text.trim();
  if (!raw) return undefined;

  // 0. Fast path — already valid JSON (preserves prior behavior exactly).
  const direct = tryParse(raw);
  if (direct !== undefined) return { value: direct, repaired: false, stage: 'direct' };

  // Narrow to the most JSON-looking slice: strip fence, then take the outermost
  // balanced value. Both are safe no-ops when not applicable.
  const base = extractBalanced(stripCodeFence(raw));

  // 1. Escalating repair stages. Each is cumulative with the ones before it, so
  // the last stage is the fully-repaired candidate.
  const stages: Array<{ name: string; fn: (s: string) => string }> = [
    { name: 'extracted', fn: (s) => s },
    { name: 'comments', fn: stripComments },
    { name: 'trailing-commas', fn: (s) => removeTrailingCommas(stripComments(s)) },
    { name: 'smart-quotes', fn: (s) => removeTrailingCommas(stripComments(normalizeSmartQuotes(s))) },
    {
      name: 'control-chars',
      fn: (s) => escapeControlCharsInStrings(removeTrailingCommas(stripComments(normalizeSmartQuotes(s)))),
    },
  ];

  for (const stage of stages) {
    const parsed = tryParse(stage.fn(base));
    if (parsed !== undefined) return { value: parsed, repaired: true, stage: stage.name };
  }
  return undefined;
}
