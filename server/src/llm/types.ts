export interface ContentBlock {
  type: 'text';
  text: string;
  cache_control?: { type: 'ephemeral' };
}

export interface LLMMessage {
  role: 'user' | 'assistant' | 'system';
  content: string | ContentBlock[];
}

/**
 * JSON Schema definition for structured output.
 * When provided, the LLM is constrained to produce valid JSON matching this schema.
 * Provider support:
 *  - OpenAI: native response_format with json_schema
 *  - Anthropic: tool_use with input_schema
 *  - Gemini/Vertex: response_mime_type + response_schema
 *  - OpenAI-Compatible (local): best-effort (may not support structured output)
 */
export interface JsonSchemaParam {
  /** Schema name (required by OpenAI's response_format). */
  name: string;
  /** JSON Schema object describing the expected output shape. */
  schema: Record<string, unknown>;
}

export interface LLMOptions {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  /** When set, constrain output to match this JSON schema. */
  jsonSchema?: JsonSchemaParam;
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
