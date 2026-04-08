import { describe, expect, it, vi } from 'vitest';
import type { LLMMessage, LLMOptions, LLMProvider, TestConnectionResult } from '../types.js';
import { LoadBalancer, TokenBucket } from '../loadBalancer.js';

type MockProvider = LLMProvider & {
  chat: ReturnType<typeof vi.fn<[LLMMessage[], LLMOptions?], Promise<string>>>;
  chatStream: ReturnType<typeof vi.fn<[LLMMessage[], LLMOptions?], AsyncIterable<string>>>;
  testConnection: ReturnType<typeof vi.fn<[], Promise<TestConnectionResult>>>;
};

function createMockProvider(label: string, suffix = label): MockProvider {
  const provider: MockProvider = {
    chat: vi.fn<[LLMMessage[], LLMOptions?], Promise<string>>(async (_messages: LLMMessage[], _options?: LLMOptions) => `${suffix}-chat`),
    chatStream: vi.fn<[LLMMessage[], LLMOptions?], AsyncIterable<string>>(async function* () {
      yield `${suffix}-stream-1`;
      yield `${suffix}-stream-2`;
    }),
    testConnection: vi.fn<[], Promise<TestConnectionResult>>(async (): Promise<TestConnectionResult> => ({
      ok: true,
      model: `${label}-model`,
      latencyMs: 5,
    })),
  };

  return provider;
}

describe('TokenBucket', () => {
  it('returns false when empty, then refills after elapsed time', async () => {
    const bucket = new TokenBucket(10, 1);

    expect(bucket.tryConsume()).toBe(true);
    expect(bucket.tryConsume()).toBe(false);

    await new Promise((resolve) => setTimeout(resolve, 120));

    expect(bucket.tryConsume()).toBe(true);
  });

  it('waits until a token becomes available', async () => {
    const bucket = new TokenBucket(10, 1);

    expect(bucket.tryConsume()).toBe(true);

    const started = Date.now();
    await bucket.waitForToken();
    const elapsed = Date.now() - started;

    expect(elapsed).toBeGreaterThanOrEqual(90);
  });
});

describe('LoadBalancer', () => {
  it('distributes chat calls round-robin across providers', async () => {
    const provider0 = createMockProvider('provider0');
    const provider1 = createMockProvider('provider1');
    const balancer = new LoadBalancer([
      { provider: provider0, label: 'provider0', rateLimit: null },
      { provider: provider1, label: 'provider1', rateLimit: null },
    ]);

    const results = await Promise.all([
      balancer.chat([]),
      balancer.chat([]),
      balancer.chat([]),
      balancer.chat([]),
    ]);

    expect(results).toEqual([
      'provider0-chat',
      'provider1-chat',
      'provider0-chat',
      'provider1-chat',
    ]);
    expect(provider0.chat).toHaveBeenCalledTimes(2);
    expect(provider1.chat).toHaveBeenCalledTimes(2);
  });

  it('skips rate-limited providers and uses the next available provider', async () => {
    const provider0 = createMockProvider('provider0');
    const provider1 = createMockProvider('provider1');
    const balancer = new LoadBalancer([
      { provider: provider0, label: 'provider0', rateLimit: 1 },
      { provider: provider1, label: 'provider1', rateLimit: null },
    ]);

    expect(await balancer.chat([])).toBe('provider0-chat');
    expect(await balancer.chat([])).toBe('provider1-chat');
    expect(await balancer.chat([])).toBe('provider1-chat');

    expect(provider0.chat).toHaveBeenCalledTimes(1);
    expect(provider1.chat).toHaveBeenCalledTimes(2);
  });

  it('treats null rate limits as unlimited local providers', async () => {
    const provider0 = createMockProvider('provider0');
    const provider1 = createMockProvider('provider1');
    const balancer = new LoadBalancer([
      { provider: provider0, label: 'provider0', rateLimit: null },
      { provider: provider1, label: 'provider1', rateLimit: 1 },
    ]);

    const results = [];
    for (let index = 0; index < 5; index += 1) {
      results.push(await balancer.chat([]));
    }

    expect(results).toEqual([
      'provider0-chat',
      'provider1-chat',
      'provider0-chat',
      'provider0-chat',
      'provider0-chat',
    ]);
    expect(provider0.chat).toHaveBeenCalledTimes(4);
    expect(provider1.chat).toHaveBeenCalledTimes(1);
  });

  it('waits for refill when all providers are rate-limited', async () => {
    const provider0 = createMockProvider('provider0');
    const balancer = new LoadBalancer([
      { provider: provider0, label: 'provider0', rateLimit: 600 },
    ]);

    for (let index = 0; index < 10; index += 1) {
      await balancer.chat([]);
    }

    const started = Date.now();
    expect(await balancer.chat([])).toBe('provider0-chat');
    const elapsed = Date.now() - started;

    expect(elapsed).toBeGreaterThanOrEqual(90);
    expect(provider0.chat).toHaveBeenCalledTimes(11);
  });

  it('delegates chatStream to the selected provider', async () => {
    const provider0 = createMockProvider('provider0', 'alpha');
    const provider1 = createMockProvider('provider1', 'beta');
    const balancer = new LoadBalancer([
      { provider: provider0, label: 'provider0', rateLimit: null },
      { provider: provider1, label: 'provider1', rateLimit: null },
    ]);

    const chunks: string[] = [];
    for await (const chunk of balancer.chatStream([])) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual(['alpha-stream-1', 'alpha-stream-2']);
    expect(provider0.chatStream).toHaveBeenCalledTimes(1);
    expect(provider1.chatStream).not.toHaveBeenCalled();
  });
});
