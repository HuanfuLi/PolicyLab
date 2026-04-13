/**
 * SFC Escrow Tests — Phase 11 D-10, D-11
 *
 * Verifies that only welfare distributes to citizens; infrastructure / education /
 * defense fiat accumulates in publicGoodsEscrow and is counted in
 * computeSystemFiatTotal so M0 stays constant (SFC-neutral).
 */
import { describe, it, expect } from 'vitest';
import type { BudgetAllocation, EconomyConfig, PublicGoodsState } from '@policylab/shared';
import { executeBudget } from '../mechanics/fiscalEngine.js';
import { computeSystemFiatTotal } from '../orchestration/helpers/sfcAudit.js';
import type { Agent } from '@policylab/shared';

// ── Test helpers ──────────────────────────────────────────────────────────────

function makeEconomyConfig(overrides: Partial<EconomyConfig> = {}): EconomyConfig {
  return {
    bankingEnabled: false,
    reserveRequirement: 0.1,
    baseLoanInterestRate: 0.005,
    defaultLoanTermIterations: 20,
    defaultThresholdIterations: 3,
    depositInterestRate: 0.002,
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

function makePublicGoods(quality = 50): Omit<PublicGoodsState, 'id' | 'sessionId'> {
  return {
    iterationNumber: 0,
    infrastructureQuality: quality,
    educationQuality: quality,
    defenseQuality: quality,
    welfareQuality: quality,
  };
}

function makeAgent(id: string, wealth: number): Agent {
  return {
    id,
    sessionId: 'sess-escrow',
    name: id,
    age: 30,
    role: 'citizen',
    type: 'agent',
    isAlive: true,
    isCentralAgent: false,
    background: '',
    policyView: '',
    currentStats: {
      wealth,
      health: 80,
      happiness: 50,
      cortisol: 20,
      satiety: 60,
      education: 50,
      social: 50,
    } as Agent['currentStats'],
    relationships: [],
    memoryStream: [],
    iterationNumber: 0,
    sessionNumber: 0,
    allostaticStrain: 0,
    allostaticLoad: 0,
  } as unknown as Agent;
}

function sumEscrow(escrow: { infrastructure: number; education: number; defense: number }): number {
  return escrow.infrastructure + escrow.education + escrow.defense;
}

// ── D-10: welfare distributes to citizens; infra/edu/def park in escrow ─────

describe('fiscal escrow accounting (Phase 11 D-10, D-11)', () => {
  const agentIds = ['a1', 'a2', 'a3', 'a4'];

  it('welfare allocation distributes fiat to agents as direct transfers', () => {
    const delta = executeBudget({
      treasuryBalance: 1000,
      budgetAllocation: { infrastructure: 0, education: 0, defense: 0, welfare: 1.0 },
      economyConfig: makeEconomyConfig(),
      currentPublicGoods: makePublicGoods(50),
      aliveAgentIds: agentIds,
      iterationNumber: 1,
    });
    // 1000 * 0.1 = 100 total; all 100 distributed to 4 agents = 25 each
    for (const id of agentIds) {
      expect(delta.agentPayments.get(id)).toBeCloseTo(25, 5);
    }
    expect(delta.escrowDeltas.infrastructure).toBe(0);
    expect(delta.escrowDeltas.education).toBe(0);
    expect(delta.escrowDeltas.defense).toBe(0);
  });

  it('infrastructure allocation accumulates in escrowDeltas.infrastructure (not agents)', () => {
    const delta = executeBudget({
      treasuryBalance: 1000,
      budgetAllocation: { infrastructure: 1.0, education: 0, defense: 0, welfare: 0 },
      economyConfig: makeEconomyConfig(),
      currentPublicGoods: makePublicGoods(50),
      aliveAgentIds: agentIds,
      iterationNumber: 1,
    });
    // Agents get nothing from infra-only allocation
    const totalPayments = [...delta.agentPayments.values()].reduce((s, v) => s + v, 0);
    expect(totalPayments).toBeCloseTo(0, 5);
    expect(delta.escrowDeltas.infrastructure).toBeCloseTo(100, 5);
    expect(delta.escrowDeltas.education).toBe(0);
    expect(delta.escrowDeltas.defense).toBe(0);
  });

  it('education allocation accumulates in escrowDeltas.education', () => {
    const delta = executeBudget({
      treasuryBalance: 1000,
      budgetAllocation: { infrastructure: 0, education: 1.0, defense: 0, welfare: 0 },
      economyConfig: makeEconomyConfig(),
      currentPublicGoods: makePublicGoods(50),
      aliveAgentIds: agentIds,
      iterationNumber: 1,
    });
    expect(delta.escrowDeltas.infrastructure).toBe(0);
    expect(delta.escrowDeltas.education).toBeCloseTo(100, 5);
    expect(delta.escrowDeltas.defense).toBe(0);
  });

  it('defense allocation accumulates in escrowDeltas.defense', () => {
    const delta = executeBudget({
      treasuryBalance: 1000,
      budgetAllocation: { infrastructure: 0, education: 0, defense: 1.0, welfare: 0 },
      economyConfig: makeEconomyConfig(),
      currentPublicGoods: makePublicGoods(50),
      aliveAgentIds: agentIds,
      iterationNumber: 1,
    });
    expect(delta.escrowDeltas.infrastructure).toBe(0);
    expect(delta.escrowDeltas.education).toBe(0);
    expect(delta.escrowDeltas.defense).toBeCloseTo(100, 5);
  });

  it('SFC conservation: treasuryDelta + sum(agentPayments) + sum(escrowDeltas) === 0 for 4 allocations', () => {
    const allocations: BudgetAllocation[] = [
      { infrastructure: 0.25, education: 0.25, defense: 0.25, welfare: 0.25 },
      { infrastructure: 0.40, education: 0.30, defense: 0.20, welfare: 0.10 },
      { infrastructure: 0, education: 0, defense: 0, welfare: 1.0 },
      { infrastructure: 1 / 3, education: 1 / 3, defense: 1 / 3, welfare: 0 },
    ];
    for (const alloc of allocations) {
      const delta = executeBudget({
        treasuryBalance: 1000,
        budgetAllocation: alloc,
        economyConfig: makeEconomyConfig(),
        currentPublicGoods: makePublicGoods(50),
        aliveAgentIds: agentIds,
        iterationNumber: 1,
      });
      const totalPayments = [...delta.agentPayments.values()].reduce((s, v) => s + v, 0);
      expect(delta.treasuryDelta + totalPayments + sumEscrow(delta.escrowDeltas)).toBeCloseTo(0, 8);
    }
  });

  it('M0 conservation: computeSystemFiatTotal with escrow sum equals pre-spending M0', () => {
    // Pre-tick: 4 agents × 100 wealth + treasury 1000 = 1400 M0 (no AMMs, no deposits)
    const agents = agentIds.map(id => makeAgent(id, 100));
    const preTreasury = 1000;
    const preEscrowTotal = 0;
    const m0Before = computeSystemFiatTotal(
      agents,
      undefined,
      undefined,
      preTreasury,
      undefined,
      0,
      0,
      preEscrowTotal,
    );
    expect(m0Before).toBe(1400);

    // Execute budget: 1000 treasury * 0.1 = 100 spent, mixed allocation
    const delta = executeBudget({
      treasuryBalance: preTreasury,
      budgetAllocation: { infrastructure: 0.25, education: 0.25, defense: 0.25, welfare: 0.25 },
      economyConfig: makeEconomyConfig(),
      currentPublicGoods: makePublicGoods(50),
      aliveAgentIds: agentIds,
      iterationNumber: 1,
    });

    // Post-tick: apply wealth deltas, treasury delta, escrow credit
    const wealthOverrides = new Map<string, number>();
    for (const agent of agents) {
      const payment = delta.agentPayments.get(agent.id) ?? 0;
      wealthOverrides.set(agent.id, agent.currentStats.wealth + payment);
    }
    const postTreasury = preTreasury + delta.treasuryDelta;
    const postEscrow = sumEscrow(delta.escrowDeltas);

    const m0After = computeSystemFiatTotal(
      agents,
      undefined,
      undefined,
      postTreasury,
      wealthOverrides,
      0,
      0,
      postEscrow,
    );

    // M0 stays constant within FP precision — escrow keeps non-welfare fiat inside SFC perimeter
    expect(m0After).toBeCloseTo(m0Before, 6);
  });

  it('quality-score side effects (productivity, skill, enforcement) still fire from updatedPublicGoods', () => {
    const delta = executeBudget({
      treasuryBalance: 1000,
      budgetAllocation: { infrastructure: 0.25, education: 0.25, defense: 0.25, welfare: 0.25 },
      economyConfig: makeEconomyConfig(),
      currentPublicGoods: makePublicGoods(50),
      aliveAgentIds: agentIds,
      iterationNumber: 1,
    });
    // Quality pipeline unchanged: all categories gain from spending
    expect(delta.updatedPublicGoods.infrastructureQuality).toBeGreaterThan(50);
    expect(delta.updatedPublicGoods.educationQuality).toBeGreaterThan(50);
    expect(delta.updatedPublicGoods.defenseQuality).toBeGreaterThan(50);
    // Multipliers still derive from quality
    expect(delta.multiplierEffects.productivityBonus).toBeGreaterThan(0);
    expect(delta.multiplierEffects.skillGainBonus).toBeGreaterThan(0);
    expect(delta.multiplierEffects.enforcementBonus).toBeGreaterThan(0);
  });

  it('M0 constant ±0.001 over 5 iterations with session-level escrow accumulation', () => {
    // Replay the runner contract: apply treasury delta + wealth deltas + escrow credit
    // per iteration and verify computeSystemFiatTotal stays flat. Simulates the
    // runner's per-tick flow minus DB writes.
    const agents = agentIds.map(id => makeAgent(id, 250));
    let treasury = 5000;
    const escrow = { infrastructure: 0, education: 0, defense: 0 };
    const initialPublicGoods = makePublicGoods(50);

    const m0Initial = computeSystemFiatTotal(
      agents,
      undefined,
      undefined,
      treasury,
      undefined,
      0,
      0,
      0,
    );

    let publicGoods = initialPublicGoods;
    const wealthByAgent = new Map(agents.map(a => [a.id, a.currentStats.wealth]));

    for (let iter = 1; iter <= 5; iter++) {
      const delta = executeBudget({
        treasuryBalance: treasury,
        budgetAllocation: { infrastructure: 0.3, education: 0.3, defense: 0.2, welfare: 0.2 },
        economyConfig: makeEconomyConfig(),
        currentPublicGoods: publicGoods,
        aliveAgentIds: agentIds,
        iterationNumber: iter,
      });

      // Apply runner-style updates
      treasury += delta.treasuryDelta;
      for (const [id, payment] of delta.agentPayments) {
        wealthByAgent.set(id, (wealthByAgent.get(id) ?? 0) + payment);
      }
      escrow.infrastructure += delta.escrowDeltas.infrastructure;
      escrow.education += delta.escrowDeltas.education;
      escrow.defense += delta.escrowDeltas.defense;
      publicGoods = delta.updatedPublicGoods;

      // Assert M0 stays constant every iteration
      const m0After = computeSystemFiatTotal(
        agents,
        undefined,
        undefined,
        treasury,
        wealthByAgent,
        0,
        0,
        escrow.infrastructure + escrow.education + escrow.defense,
      );
      expect(m0After).toBeCloseTo(m0Initial, 3);
    }

    // After 5 iterations, escrow strictly positive in all 3 categories
    expect(escrow.infrastructure).toBeGreaterThan(0);
    expect(escrow.education).toBeGreaterThan(0);
    expect(escrow.defense).toBeGreaterThan(0);
  });

  it('multiple consecutive ticks: escrowDeltas are per-tick (accumulation happens at caller)', () => {
    // fiscalEngine returns per-tick escrow deltas; the session-level accumulation
    // is handled by simulationRunner. Verify deltas match spending this tick.
    const tick1 = executeBudget({
      treasuryBalance: 1000,
      budgetAllocation: { infrastructure: 0.5, education: 0.5, defense: 0, welfare: 0 },
      economyConfig: makeEconomyConfig(),
      currentPublicGoods: makePublicGoods(50),
      aliveAgentIds: agentIds,
      iterationNumber: 1,
    });
    // 1000 * 0.1 = 100 total; 50 infra + 50 edu
    expect(tick1.escrowDeltas.infrastructure).toBeCloseTo(50, 5);
    expect(tick1.escrowDeltas.education).toBeCloseTo(50, 5);
    expect(tick1.escrowDeltas.defense).toBe(0);

    // Second tick with reduced treasury (simulating accumulated spending)
    const tick2 = executeBudget({
      treasuryBalance: 900, // after 100 spent
      budgetAllocation: { infrastructure: 0.5, education: 0.5, defense: 0, welfare: 0 },
      economyConfig: makeEconomyConfig(),
      currentPublicGoods: tick1.updatedPublicGoods,
      aliveAgentIds: agentIds,
      iterationNumber: 2,
    });
    // 900 * 0.1 = 90 total; 45 infra + 45 edu
    expect(tick2.escrowDeltas.infrastructure).toBeCloseTo(45, 5);
    expect(tick2.escrowDeltas.education).toBeCloseTo(45, 5);
  });
});
