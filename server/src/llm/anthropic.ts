import Anthropic from '@anthropic-ai/sdk';
import type { LLMProvider, LLMMessage, LLMOptions, TestConnectionResult, ContentBlock } from './types.js';

/** Extract system parameter from messages, supporting ContentBlock[] for prompt caching */
function extractSystem(messages: LLMMessage[]): string | Anthropic.TextBlockParam[] | undefined {
  const systemMsgs = messages.filter(m => m.role === 'system');
  if (systemMsgs.length === 0) return undefined;

  // If any system message uses ContentBlock[], pass as array of text blocks
  const hasBlocks = systemMsgs.some(m => Array.isArray(m.content));
  if (hasBlocks) {
    const blocks: Anthropic.TextBlockParam[] = [];
    for (const msg of systemMsgs) {
      if (Array.isArray(msg.content)) {
        for (const block of msg.content as ContentBlock[]) {
          blocks.push({
            type: 'text' as const,
            text: block.text,
            ...(block.cache_control ? { cache_control: block.cache_control } : {}),
          });
        }
      } else {
        blocks.push({ type: 'text' as const, text: msg.content });
      }
    }
    return blocks;
  }

  // All string content — join into a single string
  return systemMsgs.map(m => m.content as string).join('\n') || undefined;
}

export class AnthropicProvider implements LLMProvider {
  private client: Anthropic;
  private defaultModel: string;

  constructor(apiKey: string, defaultModel: string = 'claude-sonnet-4-6') {
    this.client = new Anthropic({ apiKey });
    this.defaultModel = defaultModel;
  }

  async chat(messages: LLMMessage[], options: LLMOptions = {}): Promise<string> {
    const chatMessages = messages.filter(m => m.role !== 'system');
    const system = extractSystem(messages);

    const mapped = chatMessages.map(m => ({
      role: m.role as 'user' | 'assistant',
      content: typeof m.content === 'string' ? m.content : m.content.map(b => b.text).join('\n'),
    }));

    // Structured output: use tool_use to constrain JSON output
    if (options.jsonSchema) {
      const response = await this.client.messages.create({
        model: options.model ?? this.defaultModel,
        max_tokens: options.maxTokens ?? 16384,
        system,
        messages: mapped,
        tools: [{
          name: options.jsonSchema.name,
          description: `Generate structured output matching the ${options.jsonSchema.name} schema.`,
          input_schema: options.jsonSchema.schema as Anthropic.Tool.InputSchema,
        }],
        tool_choice: { type: 'tool' as const, name: options.jsonSchema.name },
      });

      if (response.stop_reason === 'max_tokens') {
        throw new Error('LLM response truncated (hit max_tokens). Respond more concisely.');
      }
      const toolBlock = response.content.find(b => b.type === 'tool_use');
      if (!toolBlock || toolBlock.type !== 'tool_use') {
        throw new Error('Expected tool_use response for structured output');
      }
      return JSON.stringify(toolBlock.input);
    }

    const response = await this.client.messages.create({
      model: options.model ?? this.defaultModel,
      max_tokens: options.maxTokens ?? 16384,
      system,
      messages: mapped,
    });

    if (response.stop_reason === 'max_tokens') {
      throw new Error('LLM response truncated (hit max_tokens). Respond more concisely.');
    }
    const block = response.content[0];
    if (block.type !== 'text') throw new Error('Unexpected response type');
    return block.text;
  }

  async *chatStream(messages: LLMMessage[], options: LLMOptions = {}): AsyncIterable<string> {
    const chatMessages = messages.filter(m => m.role !== 'system');
    const system = extractSystem(messages);

    const stream = this.client.messages.stream({
      model: options.model ?? this.defaultModel,
      max_tokens: options.maxTokens ?? 16384,
      system,
      messages: chatMessages.map(m => ({
        role: m.role as 'user' | 'assistant',
        content: typeof m.content === 'string' ? m.content : m.content.map(b => b.text).join('\n'),
      })),
    });

    for await (const event of stream) {
      if (
        event.type === 'content_block_delta' &&
        event.delta.type === 'text_delta'
      ) {
        yield event.delta.text;
      }
    }
  }

  async testConnection(): Promise<TestConnectionResult> {
    const start = Date.now();
    try {
      const response = await this.client.messages.create({
        model: this.defaultModel,
        max_tokens: 10,
        messages: [{ role: 'user', content: 'Hi' }],
      });
      const latencyMs = Date.now() - start;
      return { ok: true, model: response.model, latencyMs };
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
