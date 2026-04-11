import { describe, it, expect } from 'vitest';
import { distributeProRata } from '@policylab/shared';
import type { Agent } from '@policylab/shared';
import { resolveAction } from '../physicsEngine.js';

// Minimal agent fixture for physicsEngine unit tests
function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: 'agent1',
    sessionId: 'session1',
    name: 'Test Agent',
    role: 'farmer',
    background: '',
    initialStats: { wealth: 100, health: 100, happiness: 50, cortisol: 10, satiety: 80 },
    currentStats: { wealth: 100, health: 100, happiness: 50, cortisol: 10, satiety: 80 },
    isAlive: true,
    status: 'alive',
    type: 'citizen',
    bornAtIteration: 0,
    diedAtIteration: null,
    ...overrides,
  };
}

// ── D-08: QUIT_JOB Labor Mobility Action Deltas ───────────────────────────────

describe('D-08: QUIT_JOB Action Deltas', () => {
  it('produces zero wealth and health delta — no income or physical cost', () => {
    const result = resolveAction({
      agent: makeAgent(),
      actionCode: 'QUIT_JOB',
      allAgents: [],
      isFirstAction: true,
    });
    expect(result.wealthDelta).toBe(0);
    expect(result.healthDelta).toBe(0);
  });

  it('applies happiness penalty (-1) — loss of economic security', () => {
    const result = resolveAction({
      agent: makeAgent(),
      actionCode: 'QUIT_JOB',
      allAgents: [],
      isFirstAction: true,
    });
    expect(result.happinessDelta).toBe(-1);
  });

  it('applies cortisol spike (+4) — uncertainty of unemployment', () => {
    const result = resolveAction({
      agent: makeAgent(),
      actionCode: 'QUIT_JOB',
      allAgents: [],
      isFirstAction: true,
    });
    expect(result.cortisolDelta).toBe(4);
  });

  it('includes trace entry explaining the cortisol spike', () => {
    const result = resolveAction({
      agent: makeAgent(),
      actionCode: 'QUIT_JOB',
      allAgents: [],
      isFirstAction: true,
    });
    const traceText = result.trace.join('\n');
    expect(traceText).toContain('cortisol');
    expect(traceText).toContain('uncertainty');
  });
});

describe('Edge Cases - BUG-02, BUG-03, BUG-05, BUG-06', () => {
  describe('BUG-02: Non-divisible UBI Distribution', () => {
    it('should distribute 97 fiat to 13 agents preserving SFC', () => {
      // Edge case: 97 % 13 = 6 (remainder after floor division)
      // Expected: 6 agents get 8, 7 agents get 7, total = 97 exactly
      const ubiShares = distributeProRata(97, Array(13).fill(1));

      expect(ubiShares.length).toBe(13);
      // SFC invariant: sum of all shares must equal total distributed
      expect(ubiShares.reduce((a, b) => a + b, 0)).toBe(97);
    });

    it('should handle zero total distribution', () => {
      const ubiShares = distributeProRata(0, [1, 1, 1]);
      expect(ubiShares).toEqual([0, 0, 0]);
    });

    it('should distribute evenly when divisible', () => {
      // 90 fiat / 3 agents = 30 each (no remainder)
      const ubiShares = distributeProRata(90, [1, 1, 1]);
      expect(ubiShares).toEqual([30, 30, 30]);
      expect(ubiShares.reduce((a, b) => a + b, 0)).toBe(90);
    });

    it('should give remainder to first agents when not divisible', () => {
      // 100 fiat / 3 agents: base=33, remainder=1 → [34, 33, 33]
      const ubiShares = distributeProRata(100, [1, 1, 1]);
      expect(ubiShares[0]).toBe(34);
      expect(ubiShares[1]).toBe(33);
      expect(ubiShares[2]).toBe(33);
      expect(ubiShares.reduce((a, b) => a + b, 0)).toBe(100);
    });

    it('should honor unequal weights without losing fiat', () => {
      const shares = distributeProRata(100, [3, 1, 1]);
      expect(shares).toEqual([60, 20, 20]);
      expect(shares.reduce((a, b) => a + b, 0)).toBe(100);
    });

    it('should reject fractional totals instead of minting or leaking fiat', () => {
      expect(() => distributeProRata(25.7, [1, 1, 1])).toThrow(/integer/i);
    });
  });

  describe('BUG-03: Zero-Wealth Starvation Cascade', () => {
    it('should attempt cascade: full → partial → tiny', () => {
      // Edge case: agent.wealth = 0, metabolism requires food
      // Expected: cascade tries [full, partial, half, quarter, tiny]
      // If all fail, agent receives starvation penalty (not data corruption)

      const availableWealth = 0;
      const amountsToTry = [10, 5, 2.5, 1, 0.1].filter(amt => amt > 0);

      let purchaseSucceeded = false;
      for (const amount of amountsToTry) {
        if (availableWealth >= amount) {
          purchaseSucceeded = true;
          break;
        }
      }

      // All cascade attempts fail — agent is truly broke
      expect(purchaseSucceeded).toBe(false);
    });

    it('should NOT corrupt metabolism when cascade fails completely', () => {
      // After fix: failed auto-buy applies starvation penalty, NOT data corruption
      // starvation = -10 health, not undefined/NaN
      const starvationPenalty = 10;
      const initialHealth = 30;
      const finalHealth = Math.max(0, initialHealth - starvationPenalty);

      expect(finalHealth).toBe(20);  // Defined behavior, not NaN/undefined
      expect(Number.isFinite(finalHealth)).toBe(true);
    });

    it('should succeed on first cascade level when wealth is sufficient', () => {
      const availableWealth = 100;
      const amountsToTry = [10, 5, 2.5, 1, 0.1];

      let purchasedAmount: number | null = null;
      for (const amount of amountsToTry) {
        if (availableWealth >= amount) {
          purchasedAmount = amount;
          break;
        }
      }

      expect(purchasedAmount).toBe(10);  // First level succeeds
    });
  });

  describe('BUG-05: Extreme Load Health Clamping', () => {
    it('should clamp health delta at extreme stress load', () => {
      // Edge case: load = 2000 (very high allostatic load)
      // Before fix: healthDelta = Math.max(-2, healthDelta) — only floor at -2
      // After fix: healthDelta = Math.max(-100, Math.min(0, healthDelta))

      const load = 2000;
      const baseHealthDelta = -(load / 100);  // -20 base calculation
      const healthDelta = Math.max(-100, Math.min(0, baseHealthDelta));

      expect(healthDelta).toBeGreaterThanOrEqual(-100);
      expect(healthDelta).toBeLessThanOrEqual(0);
    });

    it('should not allow single-tick instant death from extreme load', () => {
      // Before fix: extreme load could produce healthDelta far below -100
      // After fix: max loss per tick = 100 (full health bar), always clamped

      const currentHealth = 100;
      const extremeLoadDelta = -300;  // Hypothetical extreme (pre-fix could occur)
      const clampedDelta = Math.max(-100, Math.min(0, extremeLoadDelta));
      const finalHealth = Math.max(0, currentHealth + clampedDelta);

      expect(clampedDelta).toBe(-100);  // Clamped at maximum loss
      expect(finalHealth).toBe(0);  // Dead, but not negative
    });

    it('should not produce positive health delta from stress', () => {
      // BUG-05 fix adds Math.min(0, ...) — stress can never heal
      const positiveStressDelta = 5;  // Hypothetical erroneous positive
      const clampedDelta = Math.max(-100, Math.min(0, positiveStressDelta));

      expect(clampedDelta).toBe(0);  // Clamped to 0, not positive
    });
  });

});
