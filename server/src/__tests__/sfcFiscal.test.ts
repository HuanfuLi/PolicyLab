/**
 * SFC Fiscal Integration Tests — verifies stock-flow consistency invariants
 * for all fiscal policy operations.
 *
 * SFC Model (Fiscal Policy):
 *
 *  Budget execution is SFC-neutral within the perimeter:
 *  - treasuryDelta + sum(agentPayments) === 0 (spending is a treasury-to-agent transfer)
 *  - Treasury never goes negative (proportional scaling caps at available balance)
 *  - Public goods quality scores are side effects of spending, not stores of value
 *  - All four budget categories distribute fiat to agents (employment + transfers model)
 *
 * FISC requirements tested:
 *  - FISC-04: proportional scaling when treasury is insufficient
 */
import { describe, it, expect } from 'vitest';
import type { BudgetAllocation, EconomyConfig, PublicGoodsState } from '@policylab/shared';
import {
  executeBudget,
  updatePublicGoodsQuality,
  getMultiplierEffects,
  type MultiplierEffects,
} from '../mechanics/fiscalEngine.js';

// ── Test Helpers ──────────────────────────────────────────────────────────────

const SESSION = 'test-fiscal-session';

function makeEconomyConfig(overrides: Partial<EconomyConfig> = {}): EconomyConfig {
  return {
    // Required EconomyConfig fields (banking foundation)
    bankingEnabled: false,
    reserveRequirement: 0.1,
    baseLoanInterestRate: 0.005,
    defaultLoanTermIterations: 20,
    defaultThresholdIterations: 3,
    depositInterestRate: 0.002,
    // Optional fiscal fields
    capitalMarketsEnabled: false,
    fiscalEnabled: true,
    budgetSpendingRate: 0.1,
    publicGoodsDecayRate: 0.5,
    publicGoodsGainDiminishing: 0.7,
    infrastructureMultiplier: 0.005,
    educationMultiplier: 0.005,
    defenseMultiplier: 0.003,
    ...overrides,
  };
}

function makeDefaultBudget(): BudgetAllocation {
  return {
    infrastructure: 0.25,
    education: 0.25,
    defense: 0.25,
    welfare: 0.25,
  };
}

function makePublicGoods(quality = 50): Omit<PublicGoodsState, 'id' | 'sessionId'> {
  return {
    iterationNumber: 0,
    infrastructureQuality: quality,
    educationQuality: quality,
    defenseQuality: quality,
    welfareQuality: quality,
  };
}

function makeAgentIds(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `agent-${i}`);
}

// ── SFC Core Invariant Tests ─────────────────────────────────────────────────

describe('SFC Fiscal: treasuryDelta + sum(agentPayments) === 0', () => {
  it('maintains SFC invariant with normal treasury and multiple agents', () => {
    const agentIds = makeAgentIds(5);
    const result = executeBudget({
      treasuryBalance: 1000,
      budgetAllocation: makeDefaultBudget(),
      economyConfig: makeEconomyConfig(),
      currentPublicGoods: makePublicGoods(50),
      aliveAgentIds: agentIds,
      iterationNumber: 1,
    });

    const totalPayments = [...result.agentPayments.values()].reduce((s, v) => s + v, 0);
    // SFC invariant: treasury delta + agent payments = 0
    expect(result.treasuryDelta + totalPayments).toBeCloseTo(0, 8);
  });

  it('maintains SFC invariant with unequal budget allocation', () => {
    const agentIds = makeAgentIds(10);
    const budget: BudgetAllocation = {
      infrastructure: 0.40,
      education: 0.30,
      defense: 0.20,
      welfare: 0.10,
    };
    const result = executeBudget({
      treasuryBalance: 500,
      budgetAllocation: budget,
      economyConfig: makeEconomyConfig(),
      currentPublicGoods: makePublicGoods(30),
      aliveAgentIds: agentIds,
      iterationNumber: 5,
    });

    const totalPayments = [...result.agentPayments.values()].reduce((s, v) => s + v, 0);
    expect(result.treasuryDelta + totalPayments).toBeCloseTo(0, 8);
  });

  it('maintains SFC invariant with a single agent', () => {
    const result = executeBudget({
      treasuryBalance: 200,
      budgetAllocation: makeDefaultBudget(),
      economyConfig: makeEconomyConfig(),
      currentPublicGoods: makePublicGoods(50),
      aliveAgentIds: ['solo-agent'],
      iterationNumber: 1,
    });

    const totalPayments = [...result.agentPayments.values()].reduce((s, v) => s + v, 0);
    expect(result.treasuryDelta + totalPayments).toBeCloseTo(0, 8);
  });

  it('distributes equal payments to all agents', () => {
    const agentIds = makeAgentIds(4);
    const result = executeBudget({
      treasuryBalance: 400,
      budgetAllocation: makeDefaultBudget(),
      economyConfig: makeEconomyConfig({ budgetSpendingRate: 0.1 }),
      currentPublicGoods: makePublicGoods(50),
      aliveAgentIds: agentIds,
      iterationNumber: 1,
    });

    // Each agent gets exactly equal share
    const payments = [...result.agentPayments.values()];
    expect(payments.length).toBe(4);
    const firstPayment = payments[0];
    for (const p of payments) {
      expect(p).toBeCloseTo(firstPayment, 8);
    }
  });
});

// ── FISC-04: Proportional Scaling (Treasury Insufficient) ────────────────────

describe('FISC-04: Treasury never goes negative', () => {
  it('caps spending at available treasury when budgetSpendingRate > 1', () => {
    const agentIds = makeAgentIds(3);
    // Extreme spending rate that would exceed treasury
    const result = executeBudget({
      treasuryBalance: 100,
      budgetAllocation: makeDefaultBudget(),
      economyConfig: makeEconomyConfig({ budgetSpendingRate: 2.0 }),
      currentPublicGoods: makePublicGoods(50),
      aliveAgentIds: agentIds,
      iterationNumber: 1,
    });

    // Treasury delta must not make treasury go below 0
    expect(result.treasuryDelta).toBeGreaterThanOrEqual(-100);
    expect(100 + result.treasuryDelta).toBeGreaterThanOrEqual(0);
  });

  it('returns zero delta for empty treasury', () => {
    const result = executeBudget({
      treasuryBalance: 0,
      budgetAllocation: makeDefaultBudget(),
      economyConfig: makeEconomyConfig(),
      currentPublicGoods: makePublicGoods(50),
      aliveAgentIds: makeAgentIds(5),
      iterationNumber: 1,
    });

    expect(result.treasuryDelta).toBe(0);
    expect(result.agentPayments.size).toBe(0);
  });

  it('returns zero delta for negative treasury (edge case)', () => {
    const result = executeBudget({
      treasuryBalance: -10,
      budgetAllocation: makeDefaultBudget(),
      economyConfig: makeEconomyConfig(),
      currentPublicGoods: makePublicGoods(50),
      aliveAgentIds: makeAgentIds(5),
      iterationNumber: 1,
    });

    expect(result.treasuryDelta).toBe(0);
    expect(result.agentPayments.size).toBe(0);
  });
});

// ── Public Goods Quality Tests ────────────────────────────────────────────────

describe('Public goods quality: decay without spending', () => {
  it('decays quality when no spending occurs (zero treasury)', () => {
    const initialQuality = 60;
    const decayRate = 0.5;
    const result = executeBudget({
      treasuryBalance: 0,
      budgetAllocation: makeDefaultBudget(),
      economyConfig: makeEconomyConfig({ publicGoodsDecayRate: decayRate }),
      currentPublicGoods: {
        iterationNumber: 0,
        infrastructureQuality: initialQuality,
        educationQuality: initialQuality,
        defenseQuality: initialQuality,
        welfareQuality: initialQuality,
      },
      aliveAgentIds: makeAgentIds(3),
      iterationNumber: 1,
    });

    expect(result.updatedPublicGoods.infrastructureQuality).toBeCloseTo(initialQuality - decayRate, 5);
    expect(result.updatedPublicGoods.educationQuality).toBeCloseTo(initialQuality - decayRate, 5);
    expect(result.updatedPublicGoods.defenseQuality).toBeCloseTo(initialQuality - decayRate, 5);
  });

  it('does not let quality decay below 0', () => {
    const result = executeBudget({
      treasuryBalance: 0,
      budgetAllocation: makeDefaultBudget(),
      economyConfig: makeEconomyConfig({ publicGoodsDecayRate: 10 }),
      currentPublicGoods: {
        iterationNumber: 0,
        infrastructureQuality: 0.3,  // less than decayRate
        educationQuality: 0.3,
        defenseQuality: 0.3,
        welfareQuality: 0.3,
      },
      aliveAgentIds: makeAgentIds(3),
      iterationNumber: 1,
    });

    expect(result.updatedPublicGoods.infrastructureQuality).toBe(0);
    expect(result.updatedPublicGoods.educationQuality).toBe(0);
  });
});

describe('Public goods quality: gain with spending (diminishing returns)', () => {
  it('increases quality with spending', () => {
    const initialQuality = 50;
    const result = executeBudget({
      treasuryBalance: 1000,
      budgetAllocation: makeDefaultBudget(),
      economyConfig: makeEconomyConfig({ budgetSpendingRate: 0.1 }),
      currentPublicGoods: makePublicGoods(initialQuality),
      aliveAgentIds: makeAgentIds(5),
      iterationNumber: 1,
    });

    expect(result.updatedPublicGoods.infrastructureQuality).toBeGreaterThan(initialQuality);
    expect(result.updatedPublicGoods.educationQuality).toBeGreaterThan(initialQuality);
  });

  it('quality does not exceed 100', () => {
    const result = executeBudget({
      treasuryBalance: 100000,  // massive treasury
      budgetAllocation: makeDefaultBudget(),
      economyConfig: makeEconomyConfig({ budgetSpendingRate: 0.5 }),
      currentPublicGoods: makePublicGoods(99),  // near cap
      aliveAgentIds: makeAgentIds(5),
      iterationNumber: 1,
    });

    expect(result.updatedPublicGoods.infrastructureQuality).toBeLessThanOrEqual(100);
    expect(result.updatedPublicGoods.educationQuality).toBeLessThanOrEqual(100);
    expect(result.updatedPublicGoods.defenseQuality).toBeLessThanOrEqual(100);
    expect(result.updatedPublicGoods.welfareQuality).toBeLessThanOrEqual(100);
  });

  it('higher spending yields more quality gain (within same session)', () => {
    const lowSpendResult = updatePublicGoodsQuality({
      currentQuality: 50,
      spendAmount: 10,
      decayRate: 0.5,
      diminishingExponent: 0.7,
    });
    const highSpendResult = updatePublicGoodsQuality({
      currentQuality: 50,
      spendAmount: 100,
      decayRate: 0.5,
      diminishingExponent: 0.7,
    });
    expect(highSpendResult).toBeGreaterThan(lowSpendResult);
  });

  it('exhibits diminishing returns: doubling spend does not double quality gain', () => {
    const baseQuality = 0; // start from zero for pure gain measurement
    const gain10 = updatePublicGoodsQuality({ currentQuality: baseQuality, spendAmount: 10, decayRate: 0, diminishingExponent: 0.7 }) - baseQuality;
    const gain20 = updatePublicGoodsQuality({ currentQuality: baseQuality, spendAmount: 20, decayRate: 0, diminishingExponent: 0.7 }) - baseQuality;
    // Doubling spend should give less than double the gain (diminishing returns)
    expect(gain20).toBeLessThan(gain10 * 2);
  });
});

// ── Multiplier Effects Tests ──────────────────────────────────────────────────

describe('Multiplier effects: correctly computed from quality scores', () => {
  it('higher infrastructure quality produces larger productivityBonus', () => {
    const lowQuality = getMultiplierEffects({
      publicGoods: { ...makePublicGoods(20), iterationNumber: 1 },
      economyConfig: makeEconomyConfig(),
      welfarePerAgent: 0,
    });
    const highQuality = getMultiplierEffects({
      publicGoods: { ...makePublicGoods(80), iterationNumber: 1 },
      economyConfig: makeEconomyConfig(),
      welfarePerAgent: 0,
    });

    expect(highQuality.productivityBonus).toBeGreaterThan(lowQuality.productivityBonus);
  });

  it('higher education quality produces larger skillGainBonus', () => {
    const econCfg = makeEconomyConfig({ educationMultiplier: 0.005 });
    const lowEdu = getMultiplierEffects({
      publicGoods: {
        iterationNumber: 1,
        infrastructureQuality: 50,
        educationQuality: 10,
        defenseQuality: 50,
        welfareQuality: 50,
      },
      economyConfig: econCfg,
      welfarePerAgent: 0,
    });
    const highEdu = getMultiplierEffects({
      publicGoods: {
        iterationNumber: 1,
        infrastructureQuality: 50,
        educationQuality: 90,
        defenseQuality: 50,
        welfareQuality: 50,
      },
      economyConfig: econCfg,
      welfarePerAgent: 0,
    });

    expect(highEdu.skillGainBonus).toBeGreaterThan(lowEdu.skillGainBonus);
  });

  it('welfare quality tracked but welfarePerAgent comes from spending amount, not quality', () => {
    const result = executeBudget({
      treasuryBalance: 1000,
      budgetAllocation: { infrastructure: 0, education: 0, defense: 0, welfare: 1.0 },
      economyConfig: makeEconomyConfig({ budgetSpendingRate: 0.1 }),
      currentPublicGoods: makePublicGoods(50),
      aliveAgentIds: makeAgentIds(5),
      iterationNumber: 1,
    });

    // All spending is welfare, welfarePerAgent should equal totalSpending / agentCount
    const totalSpending = 1000 * 0.1;  // 100 fiat
    const expectedWelfare = totalSpending / 5;  // 20 fiat per agent
    expect(result.multiplierEffects.welfarePerAgent).toBeCloseTo(expectedWelfare, 5);
  });

  it('zero quality produces zero multiplier bonuses', () => {
    const effects = getMultiplierEffects({
      publicGoods: {
        iterationNumber: 1,
        infrastructureQuality: 0,
        educationQuality: 0,
        defenseQuality: 0,
        welfareQuality: 0,
      },
      economyConfig: makeEconomyConfig(),
      welfarePerAgent: 0,
    });

    expect(effects.productivityBonus).toBe(0);
    expect(effects.skillGainBonus).toBe(0);
    expect(effects.enforcementBonus).toBe(0);
    expect(effects.welfarePerAgent).toBe(0);
  });
});

// ── Trace Output Tests ────────────────────────────────────────────────────────

describe('Fiscal trace: provides physics trace log entries', () => {
  it('produces trace entries for normal execution', () => {
    const result = executeBudget({
      treasuryBalance: 1000,
      budgetAllocation: makeDefaultBudget(),
      economyConfig: makeEconomyConfig(),
      currentPublicGoods: makePublicGoods(50),
      aliveAgentIds: makeAgentIds(5),
      iterationNumber: 3,
    });

    expect(result.trace.length).toBeGreaterThan(0);
    expect(result.trace.some(t => t.includes('[Fiscal]'))).toBe(true);
  });

  it('produces decay trace when treasury is empty', () => {
    const result = executeBudget({
      treasuryBalance: 0,
      budgetAllocation: makeDefaultBudget(),
      economyConfig: makeEconomyConfig(),
      currentPublicGoods: makePublicGoods(50),
      aliveAgentIds: makeAgentIds(3),
      iterationNumber: 1,
    });

    expect(result.trace.some(t => t.includes('Treasury empty') || t.includes('decaying'))).toBe(true);
  });
});

// ── No-agent edge case ────────────────────────────────────────────────────────

describe('Edge case: no alive agents', () => {
  it('deducts from treasury but makes no agent payments when agents=0', () => {
    const result = executeBudget({
      treasuryBalance: 500,
      budgetAllocation: makeDefaultBudget(),
      economyConfig: makeEconomyConfig({ budgetSpendingRate: 0.1 }),
      currentPublicGoods: makePublicGoods(50),
      aliveAgentIds: [],
      iterationNumber: 1,
    });

    expect(result.agentPayments.size).toBe(0);
    // Treasury preserved when no agents exist (SFC: money cannot be destroyed)
    expect(result.treasuryDelta).toBe(0);
  });
});
