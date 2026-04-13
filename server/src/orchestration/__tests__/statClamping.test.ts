import { describe, it, expect, beforeEach } from 'vitest';
import type { Agent } from '@policylab/shared';
import {
  applyStructuralPressures,
  type StructuralPressureContext,
} from '../helpers/structuralPressures.js';
import { createAgentWeekState, type AgentWeekState } from '../helpers/weekState.js';
import { getPhysicsConfig, resetPhysicsConfig, updatePhysicsConfig } from '../../mechanics/physicsConfig.js';

// Phase 11 D-03, D-08 — cortisol clamped to [3, 95]; happiness clamped to [5, 95]
// at stat commit sites only (not on runningCortisol accumulator, per Phase 10 GC3).

function makeAgent(id: string, overrides: Partial<Agent> = {}): Agent {
  return {
    id,
    sessionId: 'session1',
    name: `Agent ${id}`,
    role: 'farmer',
    background: '',
    initialStats: { wealth: 100, health: 100, happiness: 50, cortisol: 20 },
    currentStats: { wealth: 100, health: 100, happiness: 50, cortisol: 20 },
    isAlive: true,
    status: 'alive',
    type: 'citizen',
    bornAtIteration: 0,
    diedAtIteration: null,
    ...overrides,
  };
}

function buildContext(
  statUpdate: { cortisol: number; happiness: number },
  opts: { inflation?: { rate: number; expect: number } } = {},
): StructuralPressureContext {
  const agents = [makeAgent('a1')];
  const weekStateMap = new Map<string, AgentWeekState>([['a1', createAgentWeekState()]]);
  const statUpdates = [{
    id: 'a1',
    wealth: 100,
    health: 100,
    cortisol: statUpdate.cortisol,
    happiness: statUpdate.happiness,
  }];
  return {
    aliveAgents: agents,
    weekStateMap,
    statUpdates,
    employmentRegistry: new Set(['a1']),
    giniCoefficient: 0,
    inflationSignal: opts.inflation
      ? { inflationRate: opts.inflation.rate, inflationExpectations: opts.inflation.expect }
      : null,
    publicGoodsQuality: null,
    lifecycleEvents: [],
  };
}

describe('stat clamping at commit sites (Phase 11 D-03, D-08)', () => {
  beforeEach(() => { resetPhysicsConfig(); });

  it('cortisol clamped to [cortisolFloor, cortisolCeiling] = [3, 95] at stat commit', () => {
    const cfg = getPhysicsConfig();
    expect(cfg.cortisolFloor).toBe(3);
    expect(cfg.cortisolCeiling).toBe(95);
  });

  it('happiness clamped to [happinessFloor, happinessCeiling] = [5, 95] at stat commit', () => {
    const cfg = getPhysicsConfig();
    expect(cfg.happinessFloor).toBe(5);
    expect(cfg.happinessCeiling).toBe(95);
  });

  it('runningCortisol accumulator is NOT clamped mid-iteration (weekState.cortisolDelta raw)', () => {
    // Applying a huge pressure increments weekState.cortisolDelta without clamping.
    updatePhysicsConfig({
      k_gini_cor: 0,
      k_unemp_cor: 0,
      k_pg_cor: 0,
      k_peer_death_hap: 0,
      k_gini_hap: 0,
      k_unemp_hap: 0,
      k_welfare_hap: 0,
      k_inflation_hap: 0,
      k_inflation_cor: 100, // extreme coefficient
    });
    const ctx = buildContext({ cortisol: 50, happiness: 50 }, { inflation: { rate: 10, expect: 0 } });
    applyStructuralPressures(ctx);
    // Raw weekState.cortisolDelta = 100 * 10 = 1000 (no mid-iteration clamp).
    expect(ctx.weekStateMap.get('a1')!.cortisolDelta).toBeCloseTo(1000, 0);
  });

  it('structural pressure that would push cortisol past 95 saturates at 95, not beyond', () => {
    updatePhysicsConfig({
      k_gini_cor: 0,
      k_unemp_cor: 0,
      k_pg_cor: 0,
      k_peer_death_hap: 0,
      k_gini_hap: 0,
      k_unemp_hap: 0,
      k_welfare_hap: 0,
      k_inflation_hap: 0,
      k_inflation_cor: 100,
    });
    const ctx = buildContext({ cortisol: 50, happiness: 50 }, { inflation: { rate: 10, expect: 0 } });
    applyStructuralPressures(ctx);
    expect(ctx.statUpdates[0].cortisol).toBe(95);
  });

  it('structural pressure that would push happiness below 5 saturates at 5', () => {
    updatePhysicsConfig({
      k_inflation_cor: 0,
      k_gini_cor: 0,
      k_unemp_cor: 0,
      k_pg_cor: 0,
      k_peer_death_hap: 0,
      k_gini_hap: 0,
      k_unemp_hap: 0,
      k_welfare_hap: 0,
      k_inflation_hap: 100, // extreme coefficient
    });
    const ctx = buildContext({ cortisol: 50, happiness: 50 }, { inflation: { rate: 10, expect: 0 } });
    applyStructuralPressures(ctx);
    expect(ctx.statUpdates[0].happiness).toBe(5);
  });

  it('cortisol floor 3 enforced even if pressures are zero and input was lower', () => {
    const ctx = buildContext({ cortisol: 0, happiness: 50 });
    applyStructuralPressures(ctx);
    expect(ctx.statUpdates[0].cortisol).toBe(3);
  });
});
