/**
 * Autonomous Try-Heal-Retry loop for LLM calls.
 *
 * Wraps an LLM chat call + parser in a retry loop. If the parser throws
 * (e.g. broken JSON, hallucinated formatting), the exact error is appended
 * to the prompt and the LLM is asked to fix its output. After MAX_RETRIES
 * failures, falls back to a caller-provided safe default.
 */
import type { LLMMessage, LLMOptions, LLMProvider } from './types.js';

const MAX_RETRIES = 3;

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
  /**
   * Optional callback checked before each retry attempt. When it returns true,
   * the retry loop exits immediately with the fallback (or throws if throwOnExhaustion).
   * Use this to stop wasting LLM tokens when the simulation has been paused or aborted.
   */
  shouldAbort?: () => boolean;
}

/** Patterns that indicate a network/transport failure rather than a bad LLM response. */
const CONNECTION_ERROR_RE = /channel error|econnreset|econnrefused|socket hang up|network error|fetch failed|connection reset|etimedout|epipe/i;

/** Patterns that indicate the LLM response was truncated (hit token limit). */
const TRUNCATION_RE = /truncated|hit max_tokens|hit max_completion_tokens|hit maxOutputTokens/i;

/** Patterns that indicate the request itself is too large for the provider context window. */
const REQUEST_TOO_LARGE_RE = /context.?length|maximum.?context|maximum.?token|token.?limit|too.?long|exceeds.?context|context.?window|context_length_exceeded|content.?too.?large|request.?too.?large|prompt.?too.?long/i;

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
  shouldAbort,
}: RetryWithHealingOptions<T>): Promise<T> {
  let lastRaw = '';
  // Build a mutable copy of the conversation for JSON-healing rounds only
  const conversation = [...messages];

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    // Check abort before each attempt (including the first) to avoid wasting LLM tokens
    // when the simulation has been paused/aborted while other agents were being processed.
    if (attempt > 0 && shouldAbort?.()) {
      if (label) console.warn(`[retryWithHealing] ${label} aborting retries — simulation paused/aborted`);
      if (throwOnExhaustion) throw new Error('Retry aborted: simulation paused or aborted');
      return fallback;
    }

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
      const isRequestTooLarge = REQUEST_TOO_LARGE_RE.test(errorMsg);

      if (label) {
        const kind = isConnErr ? 'connection' : isRequestTooLarge ? 'request-too-large' : 'chat';
        console.warn(`[retryWithHealing] ${label} attempt ${attempt + 1} — ${kind} error: ${errorMsg.slice(0, 120)}`);
      }

      // Request-side context overflow cannot be fixed by asking the model to
      // rewrite JSON. Retrying with extra healing messages only makes the
      // payload larger and can destabilize local providers like LM Studio.
      if (isRequestTooLarge) {
        throw chatError;
      }

      if (attempt < MAX_RETRIES) {
        if (isConnErr) {
          // Network error: do NOT touch the conversation. Wait briefly and retry
          // the original messages so the provider can establish a fresh connection.
          await new Promise(resolve => setTimeout(resolve, 800 * (attempt + 1)));
        } else if (TRUNCATION_RE.test(errorMsg)) {
          // Truncation: do NOT append the broken response — it wastes context and
          // makes truncation more likely on the next attempt. Ask for concise output.
          conversation.push({
            role: 'user',
            content: 'Your previous response was too long and got cut off before the JSON was complete. Please respond with ONLY the JSON object — no prose, no markdown fences. Use shorter text values (keep narratives under 100 words). Output valid, complete JSON.',
          });
        } else {
          // Non-network chat error (unusual). Treat like a parse failure.
          // Only append assistant content if we actually got a response
          if (lastRaw) {
            conversation.push({ role: 'assistant', content: lastRaw });
          }
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
