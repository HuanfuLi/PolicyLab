/**
 * Autonomous Try-Heal-Retry loop for LLM calls.
 *
 * Wraps an LLM chat call + parser in a retry loop. If the parser throws
 * (e.g. broken JSON, hallucinated formatting), the exact error is appended
 * to the prompt and the LLM is asked to fix its output. After MAX_RETRIES
 * failures, falls back to a caller-provided safe default.
 */
import type { LLMMessage, LLMOptions, LLMProvider } from './types.js';

const MAX_RETRIES = 2;

interface RetryWithHealingOptions<T> {
  /** The LLM provider to call */
  provider: LLMProvider;
  /** The original messages to send */
  messages: LLMMessage[];
  /** LLM options (model, temperature, etc.) */
  options?: LLMOptions;
  /** Parser function that converts raw LLM text to the desired type. Throws on failure. */
  parse: (raw: string) => T;
  /** Safe fallback value returned after all retries are exhausted (unused when throwOnExhaustion is true) */
  fallback: T;
  /** Optional label for logging */
  label?: string;
  /**
   * When true, throw the last error instead of returning fallback after all retries.
   * Use this when the caller needs to handle exhaustion explicitly (e.g. to pause the simulation).
   */
  throwOnExhaustion?: boolean;
}

/** Patterns that indicate a network/transport failure rather than a bad LLM response. */
const CONNECTION_ERROR_RE = /channel error|econnreset|econnrefused|socket hang up|network error|fetch failed|connection reset|etimedout|epipe/i;

/**
 * Calls the LLM, parses the result. On parse failure, appends the error
 * to the conversation and retries up to MAX_RETRIES times.
 *
 * Network/connection errors are retried immediately on the original conversation
 * without appending healing context (they are not JSON failures — the LLM never
 * responded, so injecting a healing message would corrupt the conversation).
 */
export async function retryWithHealing<T>({
  provider,
  messages,
  options,
  parse,
  fallback,
  label,
  throwOnExhaustion,
}: RetryWithHealingOptions<T>): Promise<T> {
  let lastRaw = '';
  // Build a mutable copy of the conversation for JSON-healing rounds only
  const conversation = [...messages];

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    let chatError: Error | null = null;

    // ── Step 1: call the LLM ───────────────────────────────────────────────
    try {
      lastRaw = await provider.chat(conversation, options);
    } catch (err) {
      chatError = err instanceof Error ? err : new Error(String(err));
    }

    if (chatError) {
      const errorMsg = chatError.message;
      const isConnErr = CONNECTION_ERROR_RE.test(errorMsg);

      if (label) {
        console.warn(`[retryWithHealing] ${label} attempt ${attempt + 1} — ${isConnErr ? 'connection' : 'chat'} error: ${errorMsg.slice(0, 120)}`);
      }

      if (attempt < MAX_RETRIES) {
        if (isConnErr) {
          // Network error: do NOT touch the conversation. Wait briefly and retry
          // the original messages so the provider can establish a fresh connection.
          await new Promise(resolve => setTimeout(resolve, 800 * (attempt + 1)));
        } else {
          // Non-network chat error (unusual). Treat like a parse failure.
          conversation.push({ role: 'assistant', content: lastRaw });
          conversation.push({
            role: 'user',
            content: `Your previous response caused an error: ${errorMsg}\n\nPlease respond with valid JSON following the exact schema specified above.`,
          });
        }
        continue;
      }

      // All retries exhausted
      console.warn(`[retryWithHealing] ${label} all ${MAX_RETRIES + 1} attempts failed, ${throwOnExhaustion ? 'throwing' : 'using fallback'}.`);
      if (throwOnExhaustion) throw chatError;
      return fallback;
    }

    // ── Step 2: parse the response ─────────────────────────────────────────
    try {
      return parse(lastRaw);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);

      if (attempt < MAX_RETRIES) {
        // JSON/parse failure: append healing context so the LLM can correct itself
        conversation.push({ role: 'assistant', content: lastRaw });
        conversation.push({
          role: 'user',
          content: `Your previous response could not be parsed. Error: ${errorMsg}\n\nPlease rewrite your response as valid JSON following the exact schema specified above. Output ONLY the JSON object, no markdown fences, no preamble.`,
        });

        if (label) {
          console.warn(`[retryWithHealing] ${label} attempt ${attempt + 1} parse failed: ${errorMsg.slice(0, 120)}`);
        }
      } else {
        if (label) {
          console.warn(`[retryWithHealing] ${label} all ${MAX_RETRIES + 1} attempts failed, ${throwOnExhaustion ? 'throwing' : 'using fallback'}. Last error: ${errorMsg.slice(0, 120)}`);
        }
        if (throwOnExhaustion) throw err;
        return fallback;
      }
    }
  }

  // Should not reach here, but TypeScript needs it
  return fallback;
}
