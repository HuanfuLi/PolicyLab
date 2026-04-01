export interface ContentBlock {
  type: 'text';
  text: string;
  cache_control?: { type: 'ephemeral' };
}

export interface LLMMessage {
  role: 'user' | 'assistant' | 'system';
  content: string | ContentBlock[];
}

export interface LLMOptions {
  model?: string;
  maxTokens?: number;
  temperature?: number;
}

export interface TestConnectionResult {
  ok: boolean;
  model: string;
  latencyMs: number;
  error?: string;
}

/** Provider-agnostic LLM interface (spec §5.4). */
export interface LLMProvider {
  chat(messages: LLMMessage[], options?: LLMOptions): Promise<string>;
  chatStream(messages: LLMMessage[], options?: LLMOptions): AsyncIterable<string>;
  testConnection(): Promise<TestConnectionResult>;
}

/** @alias LLMProvider — spec name */
export type LLMGateway = LLMProvider;
