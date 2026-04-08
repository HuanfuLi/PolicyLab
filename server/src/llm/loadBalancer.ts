import type {
  LLMMessage,
  LLMOptions,
  LLMProvider,
  TestConnectionResult,
} from './types.js';

const TOKEN_POLL_MS = 10;

export class TokenBucket {
  private tokens: number;
  private lastRefill: number;

  constructor(
    private readonly ratePerSecond: number,
    private readonly capacity: number,
  ) {
    if (ratePerSecond <= 0) {
      throw new Error('TokenBucket ratePerSecond must be greater than 0');
    }
    if (capacity <= 0) {
      throw new Error('TokenBucket capacity must be greater than 0');
    }

    this.tokens = capacity;
    this.lastRefill = Date.now();
  }

  tryConsume(): boolean {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }

  async waitForToken(): Promise<void> {
    while (!this.tryConsume()) {
      await new Promise((resolve) => setTimeout(resolve, TOKEN_POLL_MS));
    }
  }

  private refill(): void {
    const now = Date.now();
    const elapsedSeconds = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(this.capacity, this.tokens + elapsedSeconds * this.ratePerSecond);
    this.lastRefill = now;
  }
}

interface ProviderSlot {
  provider: LLMProvider;
  label: string;
  bucket: TokenBucket | null;
  inflight: number;
}

export interface LoadBalancerSlotConfig {
  provider: LLMProvider;
  label: string;
  rateLimit?: number | null;
}

export class LoadBalancer implements LLMProvider {
  private readonly slots: ProviderSlot[];
  private index = 0;

  constructor(slots: LoadBalancerSlotConfig[]) {
    if (slots.length === 0) {
      throw new Error('LoadBalancer requires at least one provider');
    }

    this.slots = slots.map((slot) => ({
      provider: slot.provider,
      label: slot.label,
      bucket: this.createBucket(slot.rateLimit),
      inflight: 0,
    }));
  }

  async chat(messages: LLMMessage[], options?: LLMOptions): Promise<string> {
    const slot = await this.acquireSlot();
    slot.inflight += 1;
    try {
      return await slot.provider.chat(messages, options);
    } finally {
      slot.inflight -= 1;
    }
  }

  async *chatStream(messages: LLMMessage[], options?: LLMOptions): AsyncIterable<string> {
    const slot = await this.acquireSlot();
    slot.inflight += 1;
    try {
      yield* slot.provider.chatStream(messages, options);
    } finally {
      slot.inflight -= 1;
    }
  }

  async testConnection(): Promise<TestConnectionResult> {
    return this.slots[0].provider.testConnection();
  }

  private createBucket(rateLimit?: number | null): TokenBucket | null {
    if (rateLimit == null) {
      return null;
    }
    return new TokenBucket(rateLimit / 60, Math.max(1, Math.ceil(rateLimit / 60)));
  }

  private async acquireSlot(): Promise<ProviderSlot> {
    for (let attempt = 0; attempt < this.slots.length; attempt += 1) {
      const slot = this.nextSlot();
      if (!slot.bucket || slot.bucket.tryConsume()) {
        return slot;
      }
    }

    const slot = this.nextSlot();
    if (slot.bucket) {
      await slot.bucket.waitForToken();
    }
    return slot;
  }

  private nextSlot(): ProviderSlot {
    const slot = this.slots[this.index % this.slots.length];
    this.index = (this.index + 1) % Number.MAX_SAFE_INTEGER;
    return slot;
  }
}
