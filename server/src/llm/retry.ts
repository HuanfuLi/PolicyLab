/**
 * Retry helper for LLM calls.
 * Uses linear backoff: attempt 1 → immediate, 2 → 1 s, 3 → 2 s.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts: number = 3,
  baseDelayMs: number = 1000
): Promise<T> {
  let lastError: Error = new Error('Unknown error');
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < maxAttempts) {
        const delay = baseDelayMs * (attempt - 1); // 0 ms, 1 s, 2 s
        if (delay > 0) await new Promise(r => setTimeout(r, delay));
        console.warn(`[retry] Attempt ${attempt} failed (${lastError.message}). Retrying…`);
      }
    }
  }
  throw lastError;
}
