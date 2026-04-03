import { describe, it, expect } from 'vitest';
import { distributeWealth, computeGini } from '../giniDistribution.js';

describe('giniDistribution', () => {
  describe('distributeWealth', () => {
    it('returns equal distribution for Gini=0', () => {
      const result = distributeWealth(5, 100, 0);
      expect(result).toEqual([100, 100, 100, 100, 100]);
    });

    it('returns array of N numbers summing to N*baseFiat', () => {
      const result = distributeWealth(10, 100, 0.4, 42);
      expect(result).toHaveLength(10);
      const sum = result.reduce((a, b) => a + b, 0);
      expect(sum).toBe(1000); // 10 * 100
    });

    it('produces computed Gini within 0.10 of target for Gini=0.4 with 50 agents', () => {
      const result = distributeWealth(50, 100, 0.4, 42);
      const actualGini = computeGini(result);
      expect(actualGini).toBeGreaterThanOrEqual(0.30);
      expect(actualGini).toBeLessThanOrEqual(0.50);
    });

    it('produces computed Gini within 0.15 of target for Gini=0.65 with 100 agents', () => {
      const result = distributeWealth(100, 100, 0.65, 123);
      const actualGini = computeGini(result);
      // With integer rounding and finite N, tolerance is 0.15
      expect(actualGini).toBeGreaterThanOrEqual(0.50);
      expect(actualGini).toBeLessThanOrEqual(0.80);
    });

    it('returns all positive values (no negative wealth)', () => {
      const result = distributeWealth(50, 100, 0.8, 99);
      for (const v of result) {
        expect(v).toBeGreaterThan(0);
      }
    });

    it('handles World Bank scale Gini by expecting 0-1 input (document only)', () => {
      // World Bank Gini is 0-100 (e.g., 48.9 for Brazil).
      // distributeWealth expects 0-1 scale. Callers must divide by 100.
      // Passing 48.9 raw would be clamped to 0.95 max.
      const result = distributeWealth(10, 100, 48.9 / 100, 42);
      expect(result).toHaveLength(10);
      const sum = result.reduce((a, b) => a + b, 0);
      expect(sum).toBe(1000);
      const actualGini = computeGini(result);
      // 0.489 target — with only 10 agents, integer rounding creates larger
      // deviation. Tolerance is 0.20 for small N.
      expect(actualGini).toBeGreaterThanOrEqual(0.28);
      expect(actualGini).toBeLessThanOrEqual(0.69);
    });
  });

  describe('computeGini', () => {
    it('returns 0 for perfectly equal distribution', () => {
      const gini = computeGini([100, 100, 100, 100]);
      expect(gini).toBe(0);
    });

    it('returns close to 1 for maximally unequal distribution', () => {
      // One person has everything
      const values = [10000, ...Array(99).fill(1)];
      const gini = computeGini(values);
      expect(gini).toBeGreaterThan(0.9);
    });
  });
});
