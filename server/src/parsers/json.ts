/**
 * C6: LLM response parsers (spec §2, component C6).
 *
 * Robust JSON extraction from LLM output that may include markdown fences,
 * leading prose, or trailing commentary.
 */

/**
 * Sanitize common LLM JSON errors that cause JSON.parse to reject
 * otherwise-valid structured output:
 *  - Trailing commas before } or ] (most frequent LLM error)
 *  - Single-line // comments
 *  - Control characters inside string values
 */
function sanitizeLLMJson(json: string): string {
  // Remove single-line comments (outside of strings — simplified heuristic:
  // only remove // that appear after a comma, brace, bracket, or start of line)
  let s = json.replace(/(?<=[\s,{[\]}])\/\/[^\n]*/g, '');

  // Remove trailing commas before } or ] (handles nested cases)
  // Repeat to catch multi-level nesting like ,\n  ,\n}
  for (let i = 0; i < 3; i++) {
    s = s.replace(/,\s*([}\]])/g, '$1');
  }

  // Strip control chars that sneak into LLM output (except \n \r \t)
  s = s.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');

  return s;
}

/**
 * Try JSON.parse on the raw input first, then on the sanitized version.
 * Returns the parsed result or null if both fail.
 */
function tryParse<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    // continue
  }
  try {
    return JSON.parse(sanitizeLLMJson(text)) as T;
  } catch {
    return null;
  }
}

/**
 * Extract and parse JSON from raw LLM text using four fallback strategies,
 * each attempted with both raw and sanitized (trailing-comma-stripped) input:
 *  1. Direct JSON.parse
 *  2. Extract from ```json ... ``` code fence
 *  3. Slice from first { to last }
 *  4. Slice from first [ to last ]
 *  5. Throw with a descriptive error
 */
export function parseJSON<T>(text: string): T {
  const trimmed = text.trim();

  // Strategy 1: direct parse (raw then sanitized)
  const direct = tryParse<T>(trimmed);
  if (direct !== null) return direct;

  // Strategy 2: extract from ```json ... ``` code fence
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    const fenced = tryParse<T>(fenceMatch[1].trim());
    if (fenced !== null) return fenced;
  }

  // Strategy 3: slice from first { to last }
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    const sliced = tryParse<T>(trimmed.slice(start, end + 1));
    if (sliced !== null) return sliced;
  }

  // Strategy 4: slice from first [ to last ]
  const arrStart = trimmed.indexOf('[');
  const arrEnd = trimmed.lastIndexOf(']');
  if (arrStart !== -1 && arrEnd !== -1 && arrEnd > arrStart) {
    const arrSliced = tryParse<T>(trimmed.slice(arrStart, arrEnd + 1));
    if (arrSliced !== null) return arrSliced;
  }

  throw new Error('parseJSON failed: ' + trimmed.slice(0, 200));
}
