import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Will import once implemented
// import { fetchIndicator, fetchIndicatorBatch } from '../worldBankApi.js';

describe('worldBankApi', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.useFakeTimers();
    // Set current date to 2024-01-15 for confidence tests
    vi.setSystemTime(new Date('2024-01-15'));
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
  });

  describe('fetchIndicator', () => {
    it('returns typed IndicatorResult for valid response', async () => {
      const { fetchIndicator } = await import('../worldBankApi.js');

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve([
          { page: 1, pages: 1, per_page: 10, total: 1 },
          [{ indicator: { id: 'SP.POP.TOTL' }, country: { id: 'BR' }, date: '2023', value: 214000000 }],
        ]),
      }) as any;

      const result = await fetchIndicator('BR', 'SP.POP.TOTL');
      expect(result).not.toBeNull();
      expect(result!.indicatorCode).toBe('SP.POP.TOTL');
      expect(result!.value).toBe(214000000);
      expect(result!.year).toBe(2023);
      expect(result!.confidence).toBe('high');
    });

    it('returns null when API returns empty data array', async () => {
      const { fetchIndicator } = await import('../worldBankApi.js');

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve([
          { page: 1, pages: 1, per_page: 10, total: 0 },
          [],
        ]),
      }) as any;

      const result = await fetchIndicator('XX', 'SP.POP.TOTL');
      expect(result).toBeNull();
    });

    it('returns null when data value is null', async () => {
      const { fetchIndicator } = await import('../worldBankApi.js');

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve([
          { page: 1, pages: 1, per_page: 10, total: 1 },
          [{ indicator: { id: 'SI.POV.GINI' }, country: { id: 'US' }, date: '2023', value: null }],
        ]),
      }) as any;

      const result = await fetchIndicator('US', 'SI.POV.GINI');
      expect(result).toBeNull();
    });

    it('returns null when data array is null', async () => {
      const { fetchIndicator } = await import('../worldBankApi.js');

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve([
          { page: 1, pages: 0, per_page: 10, total: 0 },
          null,
        ]),
      }) as any;

      const result = await fetchIndicator('ZZ', 'SP.POP.TOTL');
      expect(result).toBeNull();
    });
  });

  describe('fetchIndicatorBatch', () => {
    it('parses multi-indicator response into array of IndicatorResult', async () => {
      const { fetchIndicatorBatch } = await import('../worldBankApi.js');

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve([
          { page: 1, pages: 1, per_page: 100, total: 2 },
          [
            { indicator: { id: 'SP.POP.TOTL' }, country: { id: 'BR' }, date: '2023', value: 214000000 },
            { indicator: { id: 'NY.GDP.PCAP.CD' }, country: { id: 'BR' }, date: '2023', value: 8917 },
          ],
        ]),
      }) as any;

      const results = await fetchIndicatorBatch('BR', ['SP.POP.TOTL', 'NY.GDP.PCAP.CD']);
      expect(results).toHaveLength(2);
      expect(results[0].indicatorCode).toBe('SP.POP.TOTL');
      expect(results[1].indicatorCode).toBe('NY.GDP.PCAP.CD');
    });

    it('marks confidence medium for data >2 years old', async () => {
      const { fetchIndicatorBatch } = await import('../worldBankApi.js');

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve([
          { page: 1, pages: 1, per_page: 100, total: 1 },
          [
            { indicator: { id: 'SI.POV.GINI' }, country: { id: 'BR' }, date: '2021', value: 48.9 },
          ],
        ]),
      }) as any;

      const results = await fetchIndicatorBatch('BR', ['SI.POV.GINI']);
      expect(results).toHaveLength(1);
      // 2024 - 2021 = 3 years old -> medium
      expect(results[0].confidence).toBe('medium');
    });

    it('marks confidence low for data >4 years old', async () => {
      const { fetchIndicatorBatch } = await import('../worldBankApi.js');

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve([
          { page: 1, pages: 1, per_page: 100, total: 1 },
          [
            { indicator: { id: 'SI.POV.GINI' }, country: { id: 'IN' }, date: '2019', value: 35.7 },
          ],
        ]),
      }) as any;

      const results = await fetchIndicatorBatch('IN', ['SI.POV.GINI']);
      expect(results).toHaveLength(1);
      // 2024 - 2019 = 5 years old -> low
      expect(results[0].confidence).toBe('low');
    });
  });
});
