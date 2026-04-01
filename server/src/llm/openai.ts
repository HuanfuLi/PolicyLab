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
    const response = await this.client.chat.completions.create({
      model: options.model ?? this.defaultModel,
      max_completion_tokens: options.maxTokens ?? 4096,
      messages: messages.map(m => ({
        role: m.role as any,
        content: typeof m.content === 'string' ? m.content : m.content.map(b => b.text).join('\n'),
      })),
    });

    return response.choices[0]?.message?.content ?? '';
  }

  async *chatStream(messages: LLMMessage[], options: LLMOptions = {}): AsyncIterable<string> {
    // Note: o1 models might not support stream depending on the exact version, but this implements standard OpenAI stream
    const stream = await this.client.chat.completions.create({
      model: options.model ?? this.defaultModel,
      max_completion_tokens: options.maxTokens ?? 4096,
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

  async chat(messages: LLMMessage[], options: LLMOptions = {}): Promise<string> {
    const MAX_CONN_RETRIES = 3;
    const mapped = messages.map(m => ({
      role: m.role as 'system' | 'user' | 'assistant',
      content: typeof m.content === 'string' ? m.content : m.content.map(b => b.text).join('\n'),
    }));

    for (let attempt = 0; attempt < MAX_CONN_RETRIES; attempt++) {
      try {
        const response = await this.client.chat.completions.create({
          model: options.model ?? this.defaultModel,
          max_tokens: options.maxTokens ?? 4096,
          messages: mapped,
        });
        return response.choices[0]?.message?.content ?? '';
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
    const stream = await this.client.chat.completions.create({
      model: options.model ?? this.defaultModel,
      max_tokens: options.maxTokens ?? 4096,
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
        max_tokens: 10,
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
