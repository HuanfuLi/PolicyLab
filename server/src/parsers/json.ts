/**
 * C6: LLM response parsers (spec §2, component C6).
 *
 * Robust JSON extraction from LLM output that may include markdown fences,
 * leading prose, or trailing commentary.
 */

/**
 * Extract and parse JSON from raw LLM text using four fallback strategies:
 *  1. Direct JSON.parse
 *  2. Extract from ```json ... ``` code fence
 *  3. Slice from first { to last }
 *  4. Throw with a descriptive error
 */
export function parseJSON<T>(text: string): T {
  const trimmed = text.trim();

  // Strategy 1: direct parse
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    // continue
  }

  // Strategy 2: extract from ```json ... ``` code fence
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    try {
      return JSON.parse(fenceMatch[1].trim()) as T;
    } catch {
      // continue
    }
  }

  // Strategy 3: slice from first { to last }
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    try {
      return JSON.parse(trimmed.slice(start, end + 1)) as T;
    } catch {
      // continue
    }
  }

  // Strategy 4: slice from first [ to last ]
  const arrStart = trimmed.indexOf('[');
  const arrEnd = trimmed.lastIndexOf(']');
  if (arrStart !== -1 && arrEnd !== -1 && arrEnd > arrStart) {
    try {
      return JSON.parse(trimmed.slice(arrStart, arrEnd + 1)) as T;
    } catch {
      // continue
    }
  }

  throw new Error('parseJSON failed: ' + trimmed.slice(0, 200));
}
