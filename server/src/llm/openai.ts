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

    // Structured output: guarantee valid JSON matching the schema
    if (options.jsonSchema) {
      params.response_format = {
        type: 'json_schema',
        json_schema: {
          name: options.jsonSchema.name,
          strict: true,
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

/** Connection error patterns that warrant a client re-creation. */
const CONN_ERROR_RE = /channel error|econnreset|econnrefused|socket hang up|network error|fetch failed|connection reset|etimedout|epipe/i;

/** Error patterns indicating the server does not support json_schema response_format. */
const JSON_SCHEMA_UNSUPPORTED_RE = /response_format|json_schema|structured.?output|unsupported.*format|unknown.*parameter|invalid.*response_format|not.*supported/i;

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
    this.client = new OpenAI({ apiKey, baseURL });
    this.defaultModel = defaultModel;
  }

  /** Create a fresh OpenAI client instance (resets the HTTP connection pool). */
  private resetClient(): void {
    this.client = new OpenAI({ apiKey: this.apiKey, baseURL: this.baseURL });
  }

  /**
   * Local/OpenAI-compatible servers: skip json_schema entirely, use json_object.
   * json_schema causes extreme slowdowns on local models (LM Studio + gemma) —
   * the server accepts the parameter but processes tokens 10x slower. Since the
   * server doesn't reject it, error-based auto-degradation never triggers.
   * json_object mode ensures valid JSON output without the schema overhead.
   */
  private jsonSchemaUnsupported = true;

  async chat(messages: LLMMessage[], options: LLMOptions = {}): Promise<string> {
    const MAX_CONN_RETRIES = 3;
    const mapped = messages.map(m => ({
      role: m.role as 'system' | 'user' | 'assistant',
      content: typeof m.content === 'string' ? m.content : m.content.map(b => b.text).join('\n'),
    }));

    // If this server previously rejected json_schema, don't attempt it again.
    const useJsonSchema = options.jsonSchema && !this.jsonSchemaUnsupported;

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

        // Structured output: many OpenAI-compatible servers (LM Studio, vLLM) support json_schema.
        // If the server previously rejected it, fall back to { type: 'json_object' } which has
        // broader support and at least enforces valid JSON output (though not schema-strict).
        if (useJsonSchema) {
          params.response_format = {
            type: 'json_schema',
            json_schema: {
              name: options.jsonSchema!.name,
              strict: true,
              schema: options.jsonSchema!.schema,
            },
          };
        } else if (options.jsonSchema) {
          // Server doesn't support json_schema — use basic json_object mode
          params.response_format = { type: 'json_object' };
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

        // If json_schema was rejected, mark it as unsupported and retry immediately
        // without it. This auto-degrades gracefully for servers that don't support
        // strict structured output (e.g., older LM Studio versions).
        if (useJsonSchema && JSON_SCHEMA_UNSUPPORTED_RE.test(msg) && !isConnErr) {
          console.warn(`[OpenAICompatibleProvider] json_schema not supported, falling back to json_object: ${msg.slice(0, 120)}`);
          this.jsonSchemaUnsupported = true;
          // Retry immediately with the same attempt counter (don't burn a retry)
          return this.chat(messages, options);
        }

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
    // This is a lightweight GET that succeeds even when no model is loaded,
    // letting us distinguish "server unreachable" from "no model loaded".
    let availableModels: string[] = [];
    try {
      const modelList = await this.client.models.list();
      for await (const m of modelList) {
        availableModels.push(m.id);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isConn = CONN_ERROR_RE.test(msg);
      return {
        ok: false,
        model: this.defaultModel || '(none)',
        latencyMs: Date.now() - start,
        error: isConn
          ? `Cannot reach ${this.baseURL} — is LM Studio / Ollama running?`
          : `Server responded but model listing failed: ${msg}`,
      };
    }

    if (availableModels.length === 0) {
      return {
        ok: false,
        model: '(none)',
        latencyMs: Date.now() - start,
        error: 'Connected to the server, but no models are loaded. Load a model in LM Studio / Ollama and try again.',
      };
    }

    // Step 2: Pick the model to test with.  Prefer the configured model if it
    // matches one of the loaded models; otherwise fall back to the first
    // available model so the health-check can still succeed.
    const testModel = (this.defaultModel && availableModels.includes(this.defaultModel))
      ? this.defaultModel
      : availableModels[0]!;

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
      return {
        ok: false,
        model: testModel,
        latencyMs: Date.now() - start,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
