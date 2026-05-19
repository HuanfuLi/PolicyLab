import OpenAI from 'openai';
import type { LLMProvider, LLMMessage, LLMOptions, TestConnectionResult } from './types.js';

export class OpenAIProvider implements LLMProvider {
  private client: OpenAI;
  private defaultModel: string;
  private baseURL: string;

  constructor(apiKey: string, defaultModel: string = 'gpt-4o') {
    this.baseURL = 'https://api.openai.com/v1';
    this.client = new OpenAI({ apiKey, baseURL: this.baseURL });
    this.defaultModel = defaultModel;
  }

  async chat(messages: LLMMessage[], options: LLMOptions = {}): Promise<string> {
    const params: Record<string, unknown> = {
      model: options.model ?? this.defaultModel,
      max_completion_tokens: options.maxTokens ?? 65536,
      messages: messages.map(m => ({
        role: m.role as any,
        content: typeof m.content === 'string' ? m.content : m.content.map(b => b.text).join('\n'),
      })),
    };

    if (options.jsonSchema) {
      params.response_format = {
        type: 'json_schema',
        json_schema: {
          name: options.jsonSchema.name,
          strict: options.jsonSchema.strict ?? true,
          schema: options.jsonSchema.schema,
        },
      };
    }

    const response = await this.client.chat.completions.create(params as any);

    const content = response.choices[0]?.message?.content ?? '';
    if (response.choices[0]?.finish_reason === 'length') {
      throw new Error('LLM response truncated (hit max_completion_tokens). Respond more concisely.');
    }
    if (!content.trim()) {
      throw new Error(`LLM returned empty response (finish_reason: ${response.choices[0]?.finish_reason ?? 'unknown'})`);
    }
    return content;
  }

  async *chatStream(messages: LLMMessage[], options: LLMOptions = {}): AsyncIterable<string> {
    // Note: o1 models might not support stream depending on the exact version, but this implements standard OpenAI stream
    const stream = await this.client.chat.completions.create({
      model: options.model ?? this.defaultModel,
      max_completion_tokens: options.maxTokens ?? 65536,
      messages: messages.map(m => ({
        role: m.role as any,
        content: typeof m.content === 'string' ? m.content : m.content.map(b => b.text).join('\n'),
      })),
      stream: true,
    });

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) yield delta;
    }
  }

  async testConnection(): Promise<TestConnectionResult> {
    const start = Date.now();
    try {
      const response = await this.client.chat.completions.create({
        model: this.defaultModel,
        max_completion_tokens: 10,
        messages: [{ role: 'user', content: 'Hi' }],
      });
      const latencyMs = Date.now() - start;
      const model = response.model ?? this.defaultModel;
      return { ok: true, model, latencyMs };
    } catch (err) {
      return {
        ok: false,
        model: this.defaultModel,
        latencyMs: Date.now() - start,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}

/** Connection error patterns that warrant a client re-creation.
 *  "request timed out" matches the OpenAI SDK's APIConnectionTimeoutError thrown
 *  when LOCAL_CHAT_TIMEOUT_MS elapses against a hung local provider. */
const CONN_ERROR_RE = /channel error|econnreset|econnrefused|socket hang up|network error|fetch failed|connection reset|etimedout|epipe|request timed out|connection timeout/i;

/**
 * Per-request timeout for local LLM calls. Without this, the OpenAI SDK uses
 * its 10-minute default — if LM Studio / Ollama dies mid-request the simulation
 * runner is wedged for 10 minutes per attempt with no way to interrupt
 * (provider.chat does not yet honor an AbortSignal). 180 s is generous enough
 * for slow local models on long prompts but cuts off true hangs quickly enough
 * that the SimulationPausedError → handlePause path can fire.
 */
const LOCAL_CHAT_TIMEOUT_MS = 180_000;

/**
 * For local LM Studio, Ollama, and generic OpenAI-compatible APIs.
 * Uses max_tokens as max_completion_tokens is specific to recent OpenAI endpoints.
 *
 * Connection resilience: on channel/network errors the underlying OpenAI client is
 * recreated so its HTTP connection pool is reset before retrying. This fixes the
 * LM Studio "Channel Error" that occurs when the local gRPC channel goes stale after
 * a burst of concurrent citizen-agent requests.
 */
export class OpenAICompatibleProvider implements LLMProvider {
  private client: OpenAI;
  private defaultModel: string;
  private baseURL: string;
  private apiKey: string;

  constructor(baseURL: string, apiKey: string = 'not-needed', defaultModel: string = 'local-model') {
    this.baseURL = baseURL;
    this.apiKey = apiKey;
    this.client = new OpenAI({ apiKey, baseURL, timeout: LOCAL_CHAT_TIMEOUT_MS, maxRetries: 0 });
    this.defaultModel = defaultModel;
  }

  /** Create a fresh OpenAI client instance (resets the HTTP connection pool). */
  private resetClient(): void {
    this.client = new OpenAI({ apiKey: this.apiKey, baseURL: this.baseURL, timeout: LOCAL_CHAT_TIMEOUT_MS, maxRetries: 0 });
  }

  async chat(messages: LLMMessage[], options: LLMOptions = {}): Promise<string> {
    const MAX_CONN_RETRIES = 3;
    const mapped = messages.map(m => ({
      role: m.role as 'system' | 'user' | 'assistant',
      content: typeof m.content === 'string' ? m.content : m.content.map(b => b.text).join('\n'),
    }));

    for (let attempt = 0; attempt < MAX_CONN_RETRIES; attempt++) {
      try {
        const params: Record<string, unknown> = {
          model: options.model ?? this.defaultModel,
          messages: mapped,
        };

        // Only set max_tokens if explicitly provided — local models have variable
        // context limits and setting a value too high causes API errors.
        if (options.maxTokens) {
          params.max_tokens = options.maxTokens;
        }

        // Structured output via JSON Schema (OpenAI-compatible endpoints, e.g. LM Studio).
        if (options.jsonSchema) {
          params.response_format = {
            type: 'json_schema',
            json_schema: {
              name: options.jsonSchema.name,
              strict: options.jsonSchema.strict ?? true,
              schema: options.jsonSchema.schema,
            },
          };
        }

        const response = await this.client.chat.completions.create(params as any);
        const content = response.choices[0]?.message?.content ?? '';
        if (response.choices[0]?.finish_reason === 'length') {
          throw new Error('LLM response truncated (hit max_tokens). Respond more concisely.');
        }
        if (!content.trim()) {
          throw new Error(`LLM returned empty response (finish_reason: ${response.choices[0]?.finish_reason ?? 'unknown'})`);
        }
        return content;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const isConnErr = CONN_ERROR_RE.test(msg);

        if (isConnErr && attempt < MAX_CONN_RETRIES - 1) {
          console.warn(`[OpenAICompatibleProvider] Connection error on attempt ${attempt + 1}, recreating client: ${msg.slice(0, 100)}`);
          this.resetClient();
          // Brief back-off before retry: 1s, 2s
          await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
          continue;
        }
        throw err;
      }
    }

    // Unreachable — loop always returns or throws
    throw new Error('OpenAICompatibleProvider: max connection retries exceeded');
  }

  async *chatStream(messages: LLMMessage[], options: LLMOptions = {}): AsyncIterable<string> {
    const params: Record<string, unknown> = {
      model: options.model ?? this.defaultModel,
      messages: messages.map(m => ({
        role: m.role as any,
        content: typeof m.content === 'string' ? m.content : m.content.map(b => b.text).join('\n'),
      })),
      stream: true,
    };
    if (options.maxTokens) {
      params.max_tokens = options.maxTokens;
    }
    const stream = await this.client.chat.completions.create(params as any) as unknown as AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>;

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) yield delta;
    }
  }

  async testConnection(): Promise<TestConnectionResult> {
    const start = Date.now();

    // Step 1: Query /v1/models to verify connectivity and discover loaded models.
    // We treat this as a best-effort discovery, as custom providers might not support it.
    let availableModels: string[] = [];
    let modelListError: string | null = null;
    try {
      const modelList = await this.client.models.list();
      for await (const m of modelList) {
        availableModels.push(m.id);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isConn = CONN_ERROR_RE.test(msg);
      if (isConn) {
        return {
          ok: false,
          model: this.defaultModel || '(none)',
          latencyMs: Date.now() - start,
          error: `Cannot reach ${this.baseURL} — is LM Studio / Ollama running?`,
        };
      }
      modelListError = msg;
    }

    // Step 2: Pick the model to test with. Prefer the configured model if it
    // matches one of the loaded models; otherwise fall back to the first
    // available model. If no models are known, try the default model anyway.
    let testModel = this.defaultModel || 'unknown';
    if (availableModels.length > 0) {
      testModel = (this.defaultModel && availableModels.includes(this.defaultModel))
        ? this.defaultModel
        : availableModels[0]!;
    }

    try {
      const response = await this.client.chat.completions.create({
        model: testModel,
        max_tokens: 10,
        messages: [{ role: 'user', content: 'Hi' }],
      });
      const latencyMs = Date.now() - start;
      const model = response.model ?? testModel;
      return { ok: true, model, latencyMs };
    } catch (err) {
      const chatErr = err instanceof Error ? err.message : String(err);
      let errorDesc = chatErr;
      
      if (!modelListError && availableModels.length === 0) {
        errorDesc = `Connected to the server, but chat failed (${chatErr}). If using LM Studio / Ollama, ensure a model is loaded.`;
      } else if (modelListError) {
        errorDesc = `Chat failed (${chatErr}). Model listing also failed earlier: ${modelListError}`;
      }

      return {
        ok: false,
        model: testModel,
        latencyMs: Date.now() - start,
        error: errorDesc,
      };
    }
  }
}
