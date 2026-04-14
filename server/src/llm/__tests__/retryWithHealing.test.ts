import { describe, expect, it, vi } from 'vitest';
import type { LLMMessage, LLMOptions, LLMProvider, TestConnectionResult } from '../types.js';
import { retryWithHealing } from '../retryWithHealing.js';

type MockProvider = LLMProvider & {
  chat: ReturnType<typeof vi.fn<[LLMMessage[], LLMOptions?], Promise<string>>>;
  chatStream: ReturnType<typeof vi.fn<[LLMMessage[], LLMOptions?], AsyncIterable<string>>>;
  testConnection: ReturnType<typeof vi.fn<[], Promise<TestConnectionResult>>>;
};

function createMockProvider(
  impl: (messages: LLMMessage[], options?: LLMOptions) => Promise<string>,
): MockProvider {
  return {
    chat: vi.fn<[LLMMessage[], LLMOptions?], Promise<string>>(impl),
    chatStream: vi.fn<[LLMMessage[], LLMOptions?], AsyncIterable<string>>(async function* () {}),
    testConnection: vi.fn<[], Promise<TestConnectionResult>>(async () => ({
      ok: true,
      model: 'mock',
      latencyMs: 1,
    })),
  };
}

describe('retryWithHealing', () => {
  it('throws immediately on request-too-large errors without appending healing prompts', async () => {
    const provider = createMockProvider(async () => {
      throw new Error('400 "Context length exceeded for model context window"');
    });

    await expect(retryWithHealing({
      provider,
      messages: [
        { role: 'system', content: 'You are a coordinator resolving a sub-group.' },
        { role: 'user', content: 'Resolve iteration 3 for this sub-group.' },
      ],
      parse: (raw) => raw,
      fallback: '',
      label: 'resolution',
      throwOnExhaustion: true,
    })).rejects.toThrow(/context length exceeded/i);

    expect(provider.chat).toHaveBeenCalledTimes(1);
    expect(provider.chat.mock.calls[0]?.[0]).toHaveLength(2);
  });

  it('still retries connection errors on the original conversation', async () => {
    let calls = 0;
    const provider = createMockProvider(async () => {
      calls += 1;
      if (calls < 3) throw new Error('Channel Error');
      return '{"ok":true}';
    });

    const result = await retryWithHealing({
      provider,
      messages: [{ role: 'user', content: 'Ping' }],
      parse: (raw) => JSON.parse(raw) as { ok: boolean },
      fallback: { ok: false },
      label: 'connection-check',
      throwOnExhaustion: true,
    });

    expect(result.ok).toBe(true);
    expect(provider.chat).toHaveBeenCalledTimes(3);
    for (const call of provider.chat.mock.calls) {
      expect(call[0]).toHaveLength(1);
    }
  });
});
