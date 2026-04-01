import { execSync } from 'child_process';
import type { LLMProvider, LLMMessage, LLMOptions, TestConnectionResult } from './types.js';

export class VertexProvider implements LLMProvider {
    private defaultModel: string;
    private location: string;
    private projectId: string;

    constructor(
        projectId: string,
        location: string,
        defaultModel: string = 'gemini-1.5-flash-001',
    ) {
        this.projectId = projectId || process.env.GOOGLE_CLOUD_PROJECT || '';
        this.location = location || process.env.GOOGLE_CLOUD_LOCATION || 'us-central1';
        this.defaultModel = defaultModel;
    }

    private getAccessToken(): string {
        try {
            return execSync('gcloud auth application-default print-access-token', { encoding: 'utf8' }).trim();
        } catch (err) {
            throw new Error('Failed to get GCP access token. Have you run `gcloud auth application-default login`?');
        }
    }

    private getBaseUrl(model: string, stream: boolean = false): string {
        if (!this.projectId) throw new Error('Vertex Project ID is not configured (and GOOGLE_CLOUD_PROJECT not set).');
        const endpoint = `${this.location}-aiplatform.googleapis.com`;
        const action = stream ? 'streamGenerateContent?alt=sse' : 'generateContent';
        return `https://${endpoint}/v1/projects/${this.projectId}/locations/${this.location}/publishers/google/models/${model}:${action}`;
    }

    private prepareRequest(messages: LLMMessage[], options: LLMOptions) {
        let systemInstruction = undefined;
        const mappedContents = [];

        for (const m of messages) {
            if (m.role === 'system') {
                systemInstruction = {
                    role: 'system',
                    parts: [{ text: typeof m.content === 'string' ? m.content : m.content.map(b => b.text).join('\n') }]
                };
                continue;
            }
            mappedContents.push({
                role: m.role === 'assistant' ? 'model' : 'user',
                parts: [{ text: typeof m.content === 'string' ? m.content : m.content.map(b => b.text).join('\n') }]
            });
        }

        return {
            contents: mappedContents,
            systemInstruction,
            generationConfig: {
                maxOutputTokens: options.maxTokens ?? 4096,
                temperature: options.temperature,
            }
        };
    }

    async chat(messages: LLMMessage[], options: LLMOptions = {}): Promise<string> {
        const token = this.getAccessToken();
        const model = options.model ?? this.defaultModel;
        const url = this.getBaseUrl(model, false);
        const body = this.prepareRequest(messages, options);

        const res = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body)
        });

        if (!res.ok) {
            const errBody = await res.text();
            throw new Error(`Vertex API error (${res.status}): ${errBody}`);
        }

        const data = await res.json() as any;
        return data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    }

    async *chatStream(messages: LLMMessage[], options: LLMOptions = {}): AsyncIterable<string> {
        const token = this.getAccessToken();
        const model = options.model ?? this.defaultModel;
        const url = this.getBaseUrl(model, true);
        const body = this.prepareRequest(messages, options);

        const res = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body)
        });

        if (!res.ok) {
            const errBody = await res.text();
            throw new Error(`Vertex API error (${res.status}): ${errBody}`);
        }

        if (!res.body) return;

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() ?? '';

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const dataStr = line.slice(6).trim();
                        if (dataStr === '[DONE]') continue;
                        try {
                            const parsed = JSON.parse(dataStr);
                            const text = parsed?.candidates?.[0]?.content?.parts?.[0]?.text;
                            if (text) yield text;
                        } catch (e) {
                            // ignore fragment parse error
                        }
                    }
                }
            }
        } finally {
            reader.releaseLock();
        }
    }

    async testConnection(): Promise<TestConnectionResult> {
        const start = Date.now();
        try {
            if (!this.projectId) throw new Error('Vertex Project ID is not configured.');
            this.getAccessToken(); // Assert ADC config is valid

            await this.chat([{ role: 'user', content: 'Say hi' }], { maxTokens: 10 });
            return {
                ok: true,
                model: this.defaultModel,
                latencyMs: Date.now() - start
            };
        } catch (err) {
            return {
                ok: false,
                model: this.defaultModel,
                latencyMs: Date.now() - start,
                error: `Vertex AI test failed: ${err instanceof Error ? err.message : String(err)}`
            };
        }
    }
}
