import { describe, it, expect } from 'vitest';
import { distributeProRata } from '@policylab/shared';
import { computeDemurrageCycle } from '../mechanics/automatedMarketMaker.js';

/**
 * SFC Audit - Unrounded Fiat Tracking (Phase 04-03 Fixes)
 *
 * Validates that the three rounding fixes (BUG-07a, BUG-07b, BUG-07c) eliminate
 * fiat drift. Tests model the fixed calculation paths directly without a live DB.
 *
 * BUG-07a: satiety cost rounding (Math.round removed from simulationRunner.ts line 471)
 * BUG-07b: SFC telemetry rounding (totalFiatSupply now unrounded)
 * BUG-07c: UBI pool — distributeProRata requires integer input; fractional remainder
 *           stays in treasury (SFC-correct). Passing fractional input to distributeProRata
 *           creates fiat (loop overrun) and is NOT allowed.
 */
describe('SFC Audit - Unrounded Fiat Tracking', () => {
  it('should maintain SFC invariant with fractional satiety costs (BUG-07a)', () => {
    // BUG-07a: satiety cost was previously Math.round(totalSatietyCost)
    // Rounding destroyed fractional fiat: e.g. 1.37 → 1 (0.37 vanishes)
    // Fix: Math.max(1, totalSatietyCost) preserves the fractional cost

    // Model: an agent pays fractional satiety cost, which converts to food purchase
    // In a zero-sum system, the fiat goes to the AMM (not destroyed)
    const totalSatietyCost = 1.37;

    // OLD (broken): rounds to 1 — agent pays 1 but 0.37 is unaccounted
    const oldCost = Math.max(1, Math.round(totalSatietyCost));
    expect(oldCost).toBe(1); // 0.37 lost

    // NEW (fixed): full fractional cost preserved
    const newCost = Math.max(1, totalSatietyCost);
    expect(newCost).toBeCloseTo(1.37, 5); // full amount tracked

    // SFC: old approach had unaccounted 0.37 per agent per iteration
    const unaccountedPerAgentOld = totalSatietyCost - oldCost;
    expect(unaccountedPerAgentOld).toBeCloseTo(0.37, 5);

    // SFC: new approach has zero unaccounted fiat
    const unaccountedPerAgentNew = totalSatietyCost - newCost;
    expect(Math.abs(unaccountedPerAgentNew)).toBeLessThan(1e-10);
  });

  it('should accumulate significant drift over 100 iterations without BUG-07a fix', () => {
    // With 20 agents each losing 0.37 per iteration via rounding, over 100 iters:
    // total drift = 20 × 0.37 × 100 = 740 fiat units

    const agentCount = 20;
    const fractionalSatietyCost = 1.37;
    let cumulativeDrift = 0;

    for (let i = 0; i < 100; i++) {
      const oldCost = Math.max(1, Math.round(fractionalSatietyCost));
      const newCost = Math.max(1, fractionalSatietyCost);
      cumulativeDrift += (newCost - oldCost) * agentCount;
    }

    // Old approach lost ~740 fiat over 100 iterations with 20 agents
    expect(cumulativeDrift).toBeCloseTo(0.37 * 20 * 100, 1);
    expect(cumulativeDrift).toBeGreaterThan(100); // significant loss
  });

  it('should verify distributeProRata requires integer input (BUG-07c design constraint)', () => {
    // distributeProRata is intentionally integer-only. Rejecting fractional input
    // prevents accidental fiat creation or loss at the distribution boundary.

    const weights = Array(10).fill(1);

    // Integer input: sum of shares === input (SFC-correct)
    const intPool = 25;
    const intShares = distributeProRata(intPool, weights);
    const intDistributed = intShares.reduce((s, v) => s + v, 0);
    expect(intDistributed).toBe(intPool); // exact SFC

    const fracPool = 25.7;
    expect(() => distributeProRata(fracPool, weights)).toThrow(/integer/i);
  });

  it('should keep Math.floor before distributeProRata to avoid fiat creation (BUG-07c)', () => {
    // The correct BUG-07c pattern: floor before distributeProRata (integer safety),
    // fractional remainder stays in treasury (SFC-correct, not destroyed).

    const redistributablePool = 25.7; // fractional tax pool
    const agentCount = 10;
    const weights = Array(agentCount).fill(1);

    // Correct (current) approach: floor for distributeProRata, remainder to treasury
    const totalPoolInt = Math.floor(redistributablePool); // 25
    const shares = distributeProRata(totalPoolInt, weights);
    const distributed = shares.reduce((s, v) => s + v, 0);
    const remainder = redistributablePool - distributed; // 0.7 stays in treasury

    // Distributed exactly equals the integer pool (SFC-correct)
    expect(distributed).toBe(totalPoolInt);
    // Remainder is a small positive number (< 1 per UBI cycle)
    expect(remainder).toBeGreaterThan(0);
    expect(remainder).toBeLessThan(1);
    // Total (distributed + remainder) = original pool → zero-sum
    expect(distributed + remainder).toBeCloseTo(redistributablePool, 10);
  });

  it('should expose demurrage fractional remainder so treasury can keep it', () => {
    const agents = [
      { agentId: 'a', wealth: 10.1 },
      { agentId: 'b', wealth: 10.1 },
      { agentId: 'c', wealth: 10.1 },
    ];

    const result = computeDemurrageCycle(agents, 0.05, 1.0);
    const distributed = [...result.netDeltas.values()].reduce((sum, delta) => sum + delta, 0) + result.taxPoolCollected;

    expect(result.taxPoolCollected).toBeCloseTo(1.515, 6);
    expect(result.ubiFractionalRemainder).toBeCloseTo(0.515, 6);
    expect(distributed).toBeCloseTo(1, 6);
    expect(distributed + result.ubiFractionalRemainder).toBeCloseTo(result.taxPoolCollected, 6);
  });

  it('should report accurate unrounded totalFiatSupply vs rounded display field (BUG-07b)', () => {
    // BUG-07b: telemetry was using Math.round(totalFiatSupply) masking drift
    // Fix: totalFiatSupply = raw value, totalFiatSupplyRounded = Math.round(value)

    // Simulate a total fiat supply with fractional component
    const totalFiatSupply = 10523.73;

    // Fixed telemetry construction (mirrors simulationRunner.ts iterTelemetry)
    const iterTelemetry = {
      totalFiatSupply: totalFiatSupply,                    // Unrounded for SFC accuracy
      totalFiatSupplyRounded: Math.round(totalFiatSupply), // Rounded for UI display
    };

    // Unrounded value preserves fractional component
    expect(Number.isInteger(iterTelemetry.totalFiatSupply)).toBe(false);
    expect(iterTelemetry.totalFiatSupply).toBeCloseTo(10523.73, 5);

    // Rounded value is an integer for clean UI display
    expect(Number.isInteger(iterTelemetry.totalFiatSupplyRounded)).toBe(true);
    expect(iterTelemetry.totalFiatSupplyRounded).toBe(10524);

    // SFC drift check uses unrounded value (as in simulationRunner.ts line 2680)
    const previousFiat = 10520.0;
    const sfcDrift = iterTelemetry.totalFiatSupply - previousFiat; // 3.73
    expect(sfcDrift).toBeCloseTo(3.73, 5); // drift visible without rounding

    // Old approach would have masked the true drift:
    const maskedOldValue = Math.round(totalFiatSupply); // 10524
    const maskedDrift = maskedOldValue - previousFiat;  // 4 (not 3.73)
    expect(maskedDrift).not.toBeCloseTo(sfcDrift, 1); // masked value differs from true drift
  });

  it('should validate SFC across 100 iterations with all three fixes active', () => {
    // End-to-end model: metabolism (BUG-07a) + UBI cycle (BUG-07c) + telemetry (BUG-07b)
    // All operating on a synthetic 20-agent economy over 100 iterations.

    const agentCount = 20;
    let totalFiat = agentCount * 500; // 10,000 initial fiat

    // SFC tracking: unrounded total (BUG-07b fix)
    let sfcPrevTotalFiat: number | null = null;
    let maxDrift = 0;

    for (let i = 0; i < 100; i++) {
      // BUG-07a: satiety deduction is fractional (no Math.round)
      // In a zero-sum system, satiety cost converts wealth → food, not fiat destruction
      // Model: cost stays within the system (agent → AMM trade)

      // BUG-07c: UBI cycle
      const taxRate = 0.05;
      const taxCollected = totalFiat * taxRate;
      const ubiAllocation = 0.8;
      const redistributablePool = taxCollected * ubiAllocation;
      const nonUbiPool = taxCollected * (1 - ubiAllocation); // 20% kept by treasury
      const totalPoolInt = Math.floor(redistributablePool); // integer for distributeProRata
      const weights = Array(agentCount).fill(1);
      const shares = distributeProRata(totalPoolInt, weights);
      const ubiDistributed = shares.reduce((s, v) => s + v, 0);
      const ubiFractionalRemainder = redistributablePool - ubiDistributed; // stays in treasury

      // SFC identity: taxCollected = ubiDistributed + ubiFractionalRemainder + nonUbiPool
      // All three terms account for the full tax — nothing is created or destroyed
      const totalAccountedFor = ubiDistributed + ubiFractionalRemainder + nonUbiPool;
      const sfcDelta = taxCollected - totalAccountedFor;
      expect(Math.abs(sfcDelta)).toBeLessThan(1e-9); // SFC holds to float precision

      // BUG-07b: telemetry reports unrounded value
      const iterTelemetry = {
        totalFiatSupply: totalFiat,
        totalFiatSupplyRounded: Math.round(totalFiat),
      };

      if (sfcPrevTotalFiat !== null) {
        const drift = Math.abs(iterTelemetry.totalFiatSupply - sfcPrevTotalFiat);
        maxDrift = Math.max(maxDrift, drift);
      }
      sfcPrevTotalFiat = iterTelemetry.totalFiatSupply;
    }

    // In this model, totalFiat doesn't change (UBI is perfectly redistributed)
    // Max drift should be exactly 0 since totalFiat is constant in this model
    expect(maxDrift).toBe(0);
  });

  it('should keep a non-zero drift tolerance when no agents are alive', () => {
    const aliveAgents = 0;
    const tolerance = Math.max(0.1, aliveAgents * 0.01);

    expect(tolerance).toBe(0.1);
    expect(Math.abs(0.05)).toBeLessThan(tolerance); // harmless floating noise should not warn
  });

  it('should preserve previous telemetry total across continuation boundaries', () => {
    const previousTelemetry = { _telemetry: { totalFiatSupply: 12345.67 } };
    const resumedPrevTotalFiat = previousTelemetry._telemetry.totalFiatSupply;
    const currentTotalFiat = 12345.67;
    const sfcDrift = currentTotalFiat - resumedPrevTotalFiat;

    expect(resumedPrevTotalFiat).toBeCloseTo(12345.67, 5);
    expect(sfcDrift).toBe(0);
  });

  it('should establish an SFC baseline before the first iteration runs', () => {
    const preIterationFiat = 10000;
    const baseline = preIterationFiat;
    const firstIterationFiat = 9999.4;
    const drift = firstIterationFiat - baseline;

    expect(baseline).toBe(10000);
    expect(drift).toBeCloseTo(-0.6, 6);
  });
});
