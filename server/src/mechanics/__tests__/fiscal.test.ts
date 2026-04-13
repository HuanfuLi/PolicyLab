/**
 * Fiscal Engine Tests — TDD Red/Green
 *
 * Tests for executeBudget and updatePublicGoodsQuality in fiscalEngine.ts
 */

import { describe, it, expect } from 'vitest';
import {
  executeBudget,
  updatePublicGoodsQuality,
  getMultiplierEffects,
  computeIncomeTax,
} from '../fiscalEngine.js';
import type { BudgetAllocation, EconomyConfig, PublicGoodsState } from '@policylab/shared';

// ── Shared fixtures ──────────────────────────────────────────────────────────

const EQUAL_ALLOCATION: BudgetAllocation = {
  infrastructure: 0.25,
  education: 0.25,
  defense: 0.25,
  welfare: 0.25,
};

const DEFAULT_CONFIG: EconomyConfig = {
  bankingEnabled: true,
  reserveRequirement: 0.10,
  baseLoanInterestRate: 0.005,
  defaultLoanTermIterations: 20,
  defaultThresholdIterations: 3,
  depositInterestRate: 0.002,
  budgetSpendingRate: 0.10,
  infrastructureMultiplier: 0.005,
  educationMultiplier: 0.005,
  defenseMultiplier: 0.003,
  welfareMultiplier: 0.002,
  publicGoodsDecayRate: 0.5,
  publicGoodsGainDiminishing: 0.7,
};

const BASE_PUBLIC_GOODS: Omit<PublicGoodsState, 'id' | 'sessionId'> = {
  iterationNumber: 1,
  infrastructureQuality: 50,
  educationQuality: 50,
  defenseQuality: 50,
  welfareQuality: 50,
};

// Agent IDs for test
const AGENT_IDS = ['agent-1', 'agent-2', 'agent-3', 'agent-4'];

// ── Test suite ───────────────────────────────────────────────────────────────

describe('executeBudget', () => {
  it('returns zero treasury delta when treasury is 0', () => {
    const delta = executeBudget({
      treasuryBalance: 0,
      budgetAllocation: EQUAL_ALLOCATION,
      economyConfig: DEFAULT_CONFIG,
      currentPublicGoods: BASE_PUBLIC_GOODS,
      aliveAgentIds: AGENT_IDS,
      iterationNumber: 2,
    });

    expect(delta.treasuryDelta).toBe(0);
    expect(delta.agentPayments.size).toBe(0);
    // Quality should still decay when treasury is 0
    expect(delta.updatedPublicGoods.infrastructureQuality).toBeLessThan(50);
  });

  it('deducts correct treasury amount with normal budget (1000 treasury, 10% rate)', () => {
    const delta = executeBudget({
      treasuryBalance: 1000,
      budgetAllocation: EQUAL_ALLOCATION,
      economyConfig: DEFAULT_CONFIG,
      currentPublicGoods: BASE_PUBLIC_GOODS,
      aliveAgentIds: AGENT_IDS,
      iterationNumber: 2,
    });

    // 1000 * 0.10 = 100 total spending
    expect(delta.treasuryDelta).toBeCloseTo(-100, 5);
  });

  it('distributes welfare portion only to agents; infra/edu/def park in escrow (Phase 11 D-10)', () => {
    const delta = executeBudget({
      treasuryBalance: 1000,
      budgetAllocation: EQUAL_ALLOCATION,
      economyConfig: DEFAULT_CONFIG,
      currentPublicGoods: BASE_PUBLIC_GOODS,
      aliveAgentIds: AGENT_IDS,
      iterationNumber: 2,
    });

    // Welfare share = 100 * 0.25 = 25, distributed across 4 agents = 6.25 each
    expect(delta.agentPayments.size).toBe(4);
    for (const agentId of AGENT_IDS) {
      expect(delta.agentPayments.get(agentId)).toBeCloseTo(6.25, 5);
    }
    // Infra/edu/def each = 100 * 0.25 = 25 parked in escrow
    expect(delta.escrowDeltas.infrastructure).toBeCloseTo(25, 5);
    expect(delta.escrowDeltas.education).toBeCloseTo(25, 5);
    expect(delta.escrowDeltas.defense).toBeCloseTo(25, 5);
  });

  it('satisfies SFC invariant: treasuryDelta + sum(agentPayments) + sum(escrowDeltas) === 0 (Phase 11 D-11)', () => {
    const delta = executeBudget({
      treasuryBalance: 1000,
      budgetAllocation: EQUAL_ALLOCATION,
      economyConfig: DEFAULT_CONFIG,
      currentPublicGoods: BASE_PUBLIC_GOODS,
      aliveAgentIds: AGENT_IDS,
      iterationNumber: 2,
    });

    const totalPayments = Array.from(delta.agentPayments.values()).reduce((a, b) => a + b, 0);
    const totalEscrow = delta.escrowDeltas.infrastructure
      + delta.escrowDeltas.education
      + delta.escrowDeltas.defense;
    expect(delta.treasuryDelta + totalPayments + totalEscrow).toBeCloseTo(0, 8);
  });

  it('welfare=1.0 allocation distributes all spending to agents; escrow all 0 (Phase 11 D-10)', () => {
    const welfareOnly: BudgetAllocation = {
      infrastructure: 0,
      education: 0,
      defense: 0,
      welfare: 1.0,
    };
    const delta = executeBudget({
      treasuryBalance: 1000,
      budgetAllocation: welfareOnly,
      economyConfig: DEFAULT_CONFIG,
      currentPublicGoods: BASE_PUBLIC_GOODS,
      aliveAgentIds: AGENT_IDS,
      iterationNumber: 2,
    });
    // All 100 fiat distributed across 4 agents = 25 each
    for (const agentId of AGENT_IDS) {
      expect(delta.agentPayments.get(agentId)).toBeCloseTo(25, 5);
    }
    expect(delta.escrowDeltas.infrastructure).toBe(0);
    expect(delta.escrowDeltas.education).toBe(0);
    expect(delta.escrowDeltas.defense).toBe(0);
  });

  it('welfare=0 allocation parks 100% in escrow; no agent payments (Phase 11 D-10)', () => {
    const nonWelfare: BudgetAllocation = {
      infrastructure: 1 / 3,
      education: 1 / 3,
      defense: 1 / 3,
      welfare: 0,
    };
    const delta = executeBudget({
      treasuryBalance: 1000,
      budgetAllocation: nonWelfare,
      economyConfig: DEFAULT_CONFIG,
      currentPublicGoods: BASE_PUBLIC_GOODS,
      aliveAgentIds: AGENT_IDS,
      iterationNumber: 2,
    });
    // Agents get welfare share = 0 (still zero payments recorded since 0 agents with actual wealth delta)
    const totalPayments = Array.from(delta.agentPayments.values()).reduce((a, b) => a + b, 0);
    expect(totalPayments).toBeCloseTo(0, 5);
    const totalEscrow = delta.escrowDeltas.infrastructure
      + delta.escrowDeltas.education
      + delta.escrowDeltas.defense;
    expect(totalEscrow).toBeCloseTo(100, 5);
  });

  it('scales spending down proportionally when treasury is below expected spend (FISC-04)', () => {
    // Treasury 50, rate 0.10 → would spend 5 (treasury stays >=0, no problem)
    const delta = executeBudget({
      treasuryBalance: 50,
      budgetAllocation: EQUAL_ALLOCATION,
      economyConfig: DEFAULT_CONFIG,
      currentPublicGoods: BASE_PUBLIC_GOODS,
      aliveAgentIds: AGENT_IDS,
      iterationNumber: 2,
    });

    // 50 * 0.10 = 5 total spending
    expect(delta.treasuryDelta).toBeCloseTo(-5, 5);
    // Treasury never goes negative: 50 - 5 = 45 >= 0
    expect(50 + delta.treasuryDelta).toBeGreaterThanOrEqual(0);
  });

  it('treasury never goes negative even with edge-case config', () => {
    // Test with spending rate = 2.0 (abnormally high — should be capped to available)
    const highRateConfig: EconomyConfig = { ...DEFAULT_CONFIG, budgetSpendingRate: 2.0 };

    const delta = executeBudget({
      treasuryBalance: 100,
      budgetAllocation: EQUAL_ALLOCATION,
      economyConfig: highRateConfig,
      currentPublicGoods: BASE_PUBLIC_GOODS,
      aliveAgentIds: AGENT_IDS,
      iterationNumber: 2,
    });

    expect(100 + delta.treasuryDelta).toBeGreaterThanOrEqual(0);
    // Should not spend more than the available treasury
    expect(Math.abs(delta.treasuryDelta)).toBeLessThanOrEqual(100);
  });

  it('increases quality for categories with positive spending', () => {
    const delta = executeBudget({
      treasuryBalance: 1000,
      budgetAllocation: EQUAL_ALLOCATION,
      economyConfig: DEFAULT_CONFIG,
      currentPublicGoods: BASE_PUBLIC_GOODS,
      aliveAgentIds: AGENT_IDS,
      iterationNumber: 2,
    });

    // With equal allocation and spending, all qualities should increase
    expect(delta.updatedPublicGoods.infrastructureQuality).toBeGreaterThan(50);
    expect(delta.updatedPublicGoods.educationQuality).toBeGreaterThan(50);
    expect(delta.updatedPublicGoods.defenseQuality).toBeGreaterThan(50);
  });

  it('decays quality for category with zero allocation', () => {
    const infraOnlyAllocation: BudgetAllocation = {
      infrastructure: 1.0,
      education: 0,
      defense: 0,
      welfare: 0,
    };

    const delta = executeBudget({
      treasuryBalance: 1000,
      budgetAllocation: infraOnlyAllocation,
      economyConfig: DEFAULT_CONFIG,
      currentPublicGoods: BASE_PUBLIC_GOODS,
      aliveAgentIds: AGENT_IDS,
      iterationNumber: 2,
    });

    // Education and defense get zero spending → should decay
    expect(delta.updatedPublicGoods.educationQuality).toBeLessThan(50);
    expect(delta.updatedPublicGoods.defenseQuality).toBeLessThan(50);
    // Infrastructure gets all spending → should increase
    expect(delta.updatedPublicGoods.infrastructureQuality).toBeGreaterThan(50);
  });

  it('clamps quality to [0, 100] range', () => {
    const highQualityGoods: Omit<PublicGoodsState, 'id' | 'sessionId'> = {
      iterationNumber: 1,
      infrastructureQuality: 99,
      educationQuality: 99,
      defenseQuality: 99,
      welfareQuality: 0.1,
    };

    const zeroAllocation: BudgetAllocation = {
      infrastructure: 0,
      education: 0,
      defense: 0,
      welfare: 0,
    };

    // Force decay on near-max qualities, near-zero should not go below 0
    const delta = executeBudget({
      treasuryBalance: 0,
      budgetAllocation: zeroAllocation,
      economyConfig: DEFAULT_CONFIG,
      currentPublicGoods: highQualityGoods,
      aliveAgentIds: AGENT_IDS,
      iterationNumber: 2,
    });

    expect(delta.updatedPublicGoods.welfareQuality).toBeGreaterThanOrEqual(0);
    expect(delta.updatedPublicGoods.infrastructureQuality).toBeLessThanOrEqual(100);
  });

  it('shows diminishing returns: spending 100 does not give 4x gain vs spending 25', () => {
    // Test with 100% infrastructure allocation and two treasury sizes to compare gains
    const infraAllocation: BudgetAllocation = {
      infrastructure: 1.0,
      education: 0,
      defense: 0,
      welfare: 0,
    };

    const zeroQualityGoods: Omit<PublicGoodsState, 'id' | 'sessionId'> = {
      iterationNumber: 1,
      infrastructureQuality: 0,
      educationQuality: 0,
      defenseQuality: 0,
      welfareQuality: 0,
    };

    // Low spending: 25 per iteration
    const lowDelta = executeBudget({
      treasuryBalance: 250,  // 250 * 0.10 = 25 spending
      budgetAllocation: infraAllocation,
      economyConfig: DEFAULT_CONFIG,
      currentPublicGoods: zeroQualityGoods,
      aliveAgentIds: AGENT_IDS,
      iterationNumber: 2,
    });

    // High spending: 100 per iteration
    const highDelta = executeBudget({
      treasuryBalance: 1000,  // 1000 * 0.10 = 100 spending
      budgetAllocation: infraAllocation,
      economyConfig: DEFAULT_CONFIG,
      currentPublicGoods: zeroQualityGoods,
      aliveAgentIds: AGENT_IDS,
      iterationNumber: 2,
    });

    const lowGain = lowDelta.updatedPublicGoods.infrastructureQuality;  // from 0
    const highGain = highDelta.updatedPublicGoods.infrastructureQuality;  // from 0

    // Diminishing returns: 4x spending should produce less than 4x quality gain
    expect(highGain).toBeLessThan(lowGain * 4);
    // But should produce some gain (more than 1x)
    expect(highGain).toBeGreaterThan(lowGain);
  });

  it('computes multiplier effects from updated quality scores', () => {
    const delta = executeBudget({
      treasuryBalance: 1000,
      budgetAllocation: EQUAL_ALLOCATION,
      economyConfig: DEFAULT_CONFIG,
      currentPublicGoods: BASE_PUBLIC_GOODS,
      aliveAgentIds: AGENT_IDS,
      iterationNumber: 2,
    });

    // Multipliers should be positive (quality > 0)
    expect(delta.multiplierEffects.productivityBonus).toBeGreaterThan(0);
    expect(delta.multiplierEffects.skillGainBonus).toBeGreaterThan(0);
    expect(delta.multiplierEffects.enforcementBonus).toBeGreaterThan(0);
    expect(delta.multiplierEffects.welfarePerAgent).toBeGreaterThan(0);

    // productivityBonus should be infrastructureQuality * infrastructureMultiplier
    const expectedProductivity =
      delta.updatedPublicGoods.infrastructureQuality * (DEFAULT_CONFIG.infrastructureMultiplier ?? 0.005);
    expect(delta.multiplierEffects.productivityBonus).toBeCloseTo(expectedProductivity, 8);
  });

  it('produces trace strings documenting spending actions', () => {
    const delta = executeBudget({
      treasuryBalance: 1000,
      budgetAllocation: EQUAL_ALLOCATION,
      economyConfig: DEFAULT_CONFIG,
      currentPublicGoods: BASE_PUBLIC_GOODS,
      aliveAgentIds: AGENT_IDS,
      iterationNumber: 2,
    });

    expect(delta.trace.length).toBeGreaterThan(0);
    // At least one trace per category
    expect(delta.trace.some((t) => /infrastructure/i.test(t))).toBe(true);
    expect(delta.trace.some((t) => /education/i.test(t))).toBe(true);
  });

  it('handles empty agent list gracefully (no division by zero)', () => {
    const delta = executeBudget({
      treasuryBalance: 1000,
      budgetAllocation: EQUAL_ALLOCATION,
      economyConfig: DEFAULT_CONFIG,
      currentPublicGoods: BASE_PUBLIC_GOODS,
      aliveAgentIds: [],
      iterationNumber: 2,
    });

    // No agents — no payments, treasury still decrements (consumed by public goods)
    // Or: with no agents, no spending at all
    expect(delta.agentPayments.size).toBe(0);
    // Should not throw
  });
});

describe('updatePublicGoodsQuality', () => {
  it('increases quality proportionally to spending with diminishing returns', () => {
    const result = updatePublicGoodsQuality({
      currentQuality: 0,
      spendAmount: 25,
      decayRate: 0.5,
      diminishingExponent: 0.7,
    });

    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThanOrEqual(100);
  });

  it('decays quality when spend amount is 0', () => {
    const result = updatePublicGoodsQuality({
      currentQuality: 50,
      spendAmount: 0,
      decayRate: 0.5,
      diminishingExponent: 0.7,
    });

    expect(result).toBeCloseTo(49.5, 5);
  });

  it('clamps result to [0, 100]', () => {
    // Near max with gain
    const highResult = updatePublicGoodsQuality({
      currentQuality: 99.9,
      spendAmount: 1000,
      decayRate: 0.5,
      diminishingExponent: 0.7,
    });
    expect(highResult).toBeLessThanOrEqual(100);

    // Near zero with decay
    const zeroResult = updatePublicGoodsQuality({
      currentQuality: 0.2,
      spendAmount: 0,
      decayRate: 0.5,
      diminishingExponent: 0.7,
    });
    expect(zeroResult).toBeGreaterThanOrEqual(0);
  });
});

describe('getMultiplierEffects', () => {
  it('returns correct multiplier effects from quality scores', () => {
    const publicGoods: Omit<PublicGoodsState, 'id' | 'sessionId'> = {
      iterationNumber: 5,
      infrastructureQuality: 60,
      educationQuality: 40,
      defenseQuality: 70,
      welfareQuality: 30,
    };

    const effects = getMultiplierEffects({ publicGoods, economyConfig: DEFAULT_CONFIG, welfarePerAgent: 5 });

    expect(effects.productivityBonus).toBeCloseTo(60 * 0.005, 8);
    expect(effects.skillGainBonus).toBeCloseTo(40 * 0.005, 8);
    expect(effects.enforcementBonus).toBeCloseTo(70 * 0.003, 8);
    expect(effects.welfarePerAgent).toBeCloseTo(5, 8);
  });

  it('returns zero bonuses when quality is 0', () => {
    const zeroGoods: Omit<PublicGoodsState, 'id' | 'sessionId'> = {
      iterationNumber: 1,
      infrastructureQuality: 0,
      educationQuality: 0,
      defenseQuality: 0,
      welfareQuality: 0,
    };

    const effects = getMultiplierEffects({ publicGoods: zeroGoods, economyConfig: DEFAULT_CONFIG, welfarePerAgent: 0 });

    expect(effects.productivityBonus).toBe(0);
    expect(effects.skillGainBonus).toBe(0);
    expect(effects.enforcementBonus).toBe(0);
    expect(effects.welfarePerAgent).toBe(0);
  });
});

// ── Income Tax Tests ────────────────────────────────────────────────────────

describe('computeIncomeTax', () => {
  it('collects 15% tax from 3 agents earning 100, 200, 300 → total 90', () => {
    const result = computeIncomeTax({
      agentIncomes: [
        { agentId: 'a1', income: 100 },
        { agentId: 'a2', income: 200 },
        { agentId: 'a3', income: 300 },
      ],
      taxRate: 0.15,
    });

    expect(result.totalRevenue).toBeCloseTo(90, 5);
    expect(result.perAgentTax).toHaveLength(3);
    expect(result.perAgentTax.find(t => t.agentId === 'a1')?.taxAmount).toBeCloseTo(15, 5);
    expect(result.perAgentTax.find(t => t.agentId === 'a2')?.taxAmount).toBeCloseTo(30, 5);
    expect(result.perAgentTax.find(t => t.agentId === 'a3')?.taxAmount).toBeCloseTo(45, 5);
  });

  it('collects 0 tax with 0% rate', () => {
    const result = computeIncomeTax({
      agentIncomes: [
        { agentId: 'a1', income: 100 },
        { agentId: 'a2', income: 200 },
      ],
      taxRate: 0,
    });

    expect(result.totalRevenue).toBe(0);
    expect(result.perAgentTax).toHaveLength(0);
  });

  it('skips agents with zero income', () => {
    const result = computeIncomeTax({
      agentIncomes: [
        { agentId: 'a1', income: 0 },
        { agentId: 'a2', income: 50 },
        { agentId: 'a3', income: -10 },
      ],
      taxRate: 0.15,
    });

    expect(result.totalRevenue).toBeCloseTo(7.5, 5);
    expect(result.perAgentTax).toHaveLength(1);
    expect(result.perAgentTax[0].agentId).toBe('a2');
  });

  it('produces trace describing tax collection', () => {
    const result = computeIncomeTax({
      agentIncomes: [{ agentId: 'a1', income: 100 }],
      taxRate: 0.10,
    });

    expect(result.trace.length).toBeGreaterThan(0);
    expect(result.trace[0]).toContain('Income tax');
  });

  it('handles empty agent list', () => {
    const result = computeIncomeTax({
      agentIncomes: [],
      taxRate: 0.15,
    });

    expect(result.totalRevenue).toBe(0);
    expect(result.perAgentTax).toHaveLength(0);
  });
});

// ── GDP-Scaled Public Goods Quality Tests ──────────────────────────────────

describe('executeBudget with GDP-scaled public goods', () => {
  const GDP_SCALED_CONFIG: EconomyConfig = {
    ...DEFAULT_CONFIG,
    publicGoodsSpendingToGdpScaling: true,
  };

  const ZERO_QUALITY: Omit<PublicGoodsState, 'id' | 'sessionId'> = {
    iterationNumber: 1,
    infrastructureQuality: 0,
    educationQuality: 0,
    defenseQuality: 0,
    welfareQuality: 0,
  };

  it('trivial spending (<1% GDP) produces low quality (~10-15%), NOT 100%', () => {
    // 84000 economy, 750 spending total, infra gets 25% = 187.5
    // 187.5 / 84000 = ~0.22% of GDP → should produce low quality
    const delta = executeBudget({
      treasuryBalance: 7500, // 7500 * 0.10 = 750 total spending
      budgetAllocation: EQUAL_ALLOCATION,
      economyConfig: GDP_SCALED_CONFIG,
      currentPublicGoods: ZERO_QUALITY,
      aliveAgentIds: AGENT_IDS,
      iterationNumber: 2,
      totalEconomyFiat: 84000,
    });

    // With GDP scaling, trivial spending should NOT max quality
    expect(delta.updatedPublicGoods.infrastructureQuality).toBeLessThan(20);
    expect(delta.updatedPublicGoods.infrastructureQuality).toBeGreaterThan(0);
  });

  it('spending 10% of GDP produces ~6 quality points per iteration (calibrated max)', () => {
    // Each category gets 25% of spending, so allocate 100% to infra and spend 10% GDP.
    const infraOnly: BudgetAllocation = {
      infrastructure: 1.0,
      education: 0,
      defense: 0,
      welfare: 0,
    };

    // 10% of 10000 GDP = 1000 spending on infra
    // ratioEffect = 1.0, diminishedEffect = 1.0, gain = 6 pts (from 0: result = 6)
    const delta = executeBudget({
      treasuryBalance: 10000, // 10000 * 0.10 = 1000 spending, all to infra
      budgetAllocation: infraOnly,
      economyConfig: GDP_SCALED_CONFIG,
      currentPublicGoods: ZERO_QUALITY,
      aliveAgentIds: AGENT_IDS,
      iterationNumber: 2,
      totalEconomyFiat: 10000,
    });

    // 1000 / 10000 = 10% GDP → full target → gain = 6 pts/iter (calibrated max)
    // Quality does NOT saturate in a single iteration — requires sustained spending
    expect(delta.updatedPublicGoods.infrastructureQuality).toBeGreaterThan(0);
    expect(delta.updatedPublicGoods.infrastructureQuality).toBeLessThan(20);
  });

  it('spending 25%+ of GDP still caps at 6 quality points (ratioEffect capped at 1.0)', () => {
    const infraOnly: BudgetAllocation = {
      infrastructure: 1.0,
      education: 0,
      defense: 0,
      welfare: 0,
    };

    // Want 25% of GDP on infra. Treasury 50000, rate 0.10 = 5000 spending. GDP = 20000.
    // 5000/20000 = 25% → ratioEffect capped at 1.0 → gain = 6 pts (same as 10% GDP)
    const delta = executeBudget({
      treasuryBalance: 50000,
      budgetAllocation: infraOnly,
      economyConfig: GDP_SCALED_CONFIG,
      currentPublicGoods: ZERO_QUALITY,
      aliveAgentIds: AGENT_IDS,
      iterationNumber: 2,
      totalEconomyFiat: 20000,
    });

    // Overspending above target ratio still only yields 6 pts max (ratioEffect capped at 1.0)
    expect(delta.updatedPublicGoods.infrastructureQuality).toBeGreaterThan(0);
    expect(delta.updatedPublicGoods.infrastructureQuality).toBeLessThanOrEqual(6.1);
  });

  it('backward compat: old formula when publicGoodsSpendingToGdpScaling is false', () => {
    // Without GDP scaling, should behave exactly as before
    const noScalingConfig: EconomyConfig = {
      ...DEFAULT_CONFIG,
      publicGoodsSpendingToGdpScaling: false,
    };

    const deltaOld = executeBudget({
      treasuryBalance: 1000,
      budgetAllocation: EQUAL_ALLOCATION,
      economyConfig: noScalingConfig,
      currentPublicGoods: ZERO_QUALITY,
      aliveAgentIds: AGENT_IDS,
      iterationNumber: 2,
    });

    const deltaDefault = executeBudget({
      treasuryBalance: 1000,
      budgetAllocation: EQUAL_ALLOCATION,
      economyConfig: DEFAULT_CONFIG,
      currentPublicGoods: ZERO_QUALITY,
      aliveAgentIds: AGENT_IDS,
      iterationNumber: 2,
    });

    // Both should produce same result (backward compat)
    expect(deltaOld.updatedPublicGoods.infrastructureQuality)
      .toBeCloseTo(deltaDefault.updatedPublicGoods.infrastructureQuality, 5);
  });

  it('quality still decays when spending is absent with GDP scaling', () => {
    const delta = executeBudget({
      treasuryBalance: 0,
      budgetAllocation: EQUAL_ALLOCATION,
      economyConfig: GDP_SCALED_CONFIG,
      currentPublicGoods: BASE_PUBLIC_GOODS,
      aliveAgentIds: AGENT_IDS,
      iterationNumber: 2,
      totalEconomyFiat: 10000,
    });

    expect(delta.updatedPublicGoods.infrastructureQuality).toBeLessThan(50);
  });
});

// ── GDP-Scaled Quality Calibration Tests ────────────────────────────────────
// These tests verify the GDP_SCALED_MAX_GAIN_PER_ITER = 6 calibration goal:
// public goods quality must require sustained fiscal commitment to improve.

describe('GDP-scaled quality calibration', () => {
  it('produces ~6 quality points at full 10% GDP spending', () => {
    // spendAmount = 1000, totalEconomyFiat = 10000 → spendingRatio = 0.10 (full target)
    // ratioEffect = 1.0, diminishedEffect = 1.0, gain = 6.0
    const result = updatePublicGoodsQuality({
      currentQuality: 50,
      spendAmount: 1000,
      decayRate: 0.5,
      diminishingExponent: 0.7,
      gdpScaling: true,
      totalEconomyFiat: 10000,
    });
    expect(result).toBeCloseTo(56, 0);  // 50 + 6 = 56
  });

  it('produces less than 1.5 quality points at 1% GDP spending', () => {
    // spendAmount = 100, totalEconomyFiat = 10000 → spendingRatio = 0.01 (10% of target)
    // ratioEffect = 0.1, diminishedEffect = 0.1^0.7 ≈ 0.2, gain = 6 × 0.2 = 1.2
    const result = updatePublicGoodsQuality({
      currentQuality: 50,
      spendAmount: 100,
      decayRate: 0.5,
      diminishingExponent: 0.7,
      gdpScaling: true,
      totalEconomyFiat: 10000,
    });
    expect(result - 50).toBeLessThan(1.5);
    expect(result - 50).toBeGreaterThan(0);
  });

  it('clamps to 100 when quality is near max even at full spending', () => {
    // 95 + 6 = 101 → clamped to 100
    const result = updatePublicGoodsQuality({
      currentQuality: 95,
      spendAmount: 1000,
      decayRate: 0.5,
      diminishingExponent: 0.7,
      gdpScaling: true,
      totalEconomyFiat: 10000,  // 10% GDP spending → 6 pts
    });
    expect(result).toBe(100);
  });
});
