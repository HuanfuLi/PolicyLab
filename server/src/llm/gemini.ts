import OpenAI from 'openai';
import type { LLMProvider, LLMMessage, LLMOptions, TestConnectionResult } from './types.js';

/**
 * Extract a human-readable error message from Gemini's non-standard error responses.
 */
function extractGeminiError(err: unknown): string {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes('(no body)')) return msg;
    return `Gemini API error (${msg.replace(' (no body)', '')}). ` +
        'This usually means an invalid API key or unsupported model. ' +
        'Verify your API key at aistudio.google.com and check the model name.';
}

export class GeminiProvider implements LLMProvider {
    private client: OpenAI;
    private defaultModel: string;
    private baseURL: string;

    constructor(apiKey: string, defaultModel: string = 'gemini-2.5-flash') {
        this.baseURL = 'https://generativelanguage.googleapis.com/v1beta/openai/';
        this.client = new OpenAI({ apiKey, baseURL: this.baseURL });
        this.defaultModel = defaultModel;
    }

    async chat(messages: LLMMessage[], options: LLMOptions = {}): Promise<string> {
        try {
            const response = await this.client.chat.completions.create({
                model: options.model ?? this.defaultModel,
                max_tokens: options.maxTokens ?? 4096,
                messages: messages.map(m => ({
                    role: m.role as any,
                    content: typeof m.content === 'string' ? m.content : m.content.map(b => b.text).join('\n'),
                })),
            });

            return response.choices[0]?.message?.content ?? '';
        } catch (err) {
            throw new Error(extractGeminiError(err));
        }
    }

    async *chatStream(messages: LLMMessage[], options: LLMOptions = {}): AsyncIterable<string> {
        try {
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
        } catch (err) {
            throw new Error(extractGeminiError(err));
        }
    }

    async testConnection(): Promise<TestConnectionResult> {
        const start = Date.now();
        const url = `${this.baseURL.replace(/\/+$/, '')}/chat/completions`;
        const apiKey = (this.client as unknown as { apiKey: string }).apiKey;

        try {
            const resp = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`,
                },
                body: JSON.stringify({
                    model: this.defaultModel,
                    max_tokens: 10,
                    messages: [{ role: 'user', content: 'Say hi' }],
                }),
            });

            const text = await resp.text();
            const latencyMs = Date.now() - start;

            if (!resp.ok) {
                let errorMsg = `HTTP ${resp.status}`;
                try {
                    const parsed = JSON.parse(text);
                    const errObj = Array.isArray(parsed) ? parsed[0] : parsed;
                    if (errObj?.error?.message) {
                        errorMsg = errObj.error.message;
                    }
                } catch { /* use generic message */ }
                return { ok: false, model: this.defaultModel, latencyMs, error: errorMsg };
            }

            let model = this.defaultModel;
            try {
                const parsed = JSON.parse(text);
                model = parsed.model ?? this.defaultModel;
            } catch { /* keep default */ }

            return { ok: true, model, latencyMs };
        } catch (err) {
            return {
                ok: false,
                model: this.defaultModel,
                latencyMs: Date.now() - start,
                error: extractGeminiError(err),
            };
        }
    }
}
