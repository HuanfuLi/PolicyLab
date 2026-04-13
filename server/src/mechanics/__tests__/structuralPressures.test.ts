import { describe, it, expect, beforeEach } from 'vitest';
import type { Agent } from '@policylab/shared';
import {
  applyStructuralPressures,
  type StructuralPressureContext,
} from '../../orchestration/helpers/structuralPressures.js';
import type { AgentWeekState } from '../../orchestration/helpers/weekState.js';
import { createAgentWeekState } from '../../orchestration/helpers/weekState.js';
import { getPhysicsConfig, updatePhysicsConfig, resetPhysicsConfig } from '../physicsConfig.js';

// Phase 11 D-02, D-07 — continuous per-tick structural cortisol & happiness
// pressures applied to every alive citizen (not bank/central_bank).

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
  agents: Agent[],
  opts: {
    giniCoefficient?: number;
    inflation?: { rate: number; expect: number } | null;
    pg?: { infra: number; edu: number; welfare: number; defense: number } | null;
    employed?: string[];
    deaths?: string[];
    wealthByAgent?: Record<string, number>;
  } = {},
): StructuralPressureContext {
  const weekStateMap = new Map<string, AgentWeekState>(agents.map(a => [a.id, createAgentWeekState()]));
  const statUpdates = agents.map(a => ({
    id: a.id,
    wealth: opts.wealthByAgent?.[a.id] ?? a.currentStats.wealth,
    health: a.currentStats.health,
    happiness: a.currentStats.happiness,
    cortisol: a.currentStats.cortisol ?? 20,
  }));
  return {
    aliveAgents: agents,
    weekStateMap,
    statUpdates,
    employmentRegistry: new Set(opts.employed ?? agents.map(a => a.id)),
    giniCoefficient: opts.giniCoefficient ?? 0,
    inflationSignal: opts.inflation
      ? { inflationRate: opts.inflation.rate, inflationExpectations: opts.inflation.expect }
      : null,
    publicGoodsQuality: opts.pg
      ? {
          infrastructureQuality: opts.pg.infra,
          educationQuality: opts.pg.edu,
          welfareQuality: opts.pg.welfare,
          defenseQuality: opts.pg.defense,
        }
      : null,
    lifecycleEvents: (opts.deaths ?? []).map(id => ({ type: 'death', agentId: id })),
  };
}

describe('structural pressures: coefficient presence (Phase 11 D-02, D-07)', () => {
  it('physicsConfig exposes all 9 structural pressure coefficients', () => {
    const cfg = getPhysicsConfig();
    expect(cfg.k_inflation_cor).toBeTypeOf('number');
    expect(cfg.k_gini_cor).toBeTypeOf('number');
    expect(cfg.k_unemp_cor).toBeTypeOf('number');
    expect(cfg.k_pg_cor).toBeTypeOf('number');
    expect(cfg.k_peer_death_hap).toBeTypeOf('number');
    expect(cfg.k_gini_hap).toBeTypeOf('number');
    expect(cfg.k_unemp_hap).toBeTypeOf('number');
    expect(cfg.k_welfare_hap).toBeTypeOf('number');
    expect(cfg.k_inflation_hap).toBeTypeOf('number');
  });
});

describe('structural pressures: cortisol mechanics (Phase 11 D-02)', () => {
  beforeEach(() => { resetPhysicsConfig(); });

  it('inflation surprise raises cortisol by k_inflation_cor × max(0, actualCPI - expected)', () => {
    // Isolate inflation: zero out all other coefficients.
    updatePhysicsConfig({
      k_gini_cor: 0,
      k_unemp_cor: 0,
      k_pg_cor: 0,
      k_peer_death_hap: 0,
      k_gini_hap: 0,
      k_unemp_hap: 0,
      k_welfare_hap: 0,
      k_inflation_hap: 0,
    });
    const k = getPhysicsConfig().k_inflation_cor;
    const agents = [makeAgent('a1')];
    const ctx = buildContext(agents, {
      inflation: { rate: 5, expect: 0 }, // surprise = 5
    });
    applyStructuralPressures(ctx);
    const expected = k * 5;
    expect(ctx.weekStateMap.get('a1')!.cortisolDelta).toBeCloseTo(expected, 5);
  });

  it('bottom-quintile citizen receives k_gini_cor × max(0, Gini - giniStressThreshold)', () => {
    updatePhysicsConfig({
      k_inflation_cor: 0,
      k_unemp_cor: 0,
      k_pg_cor: 0,
      k_peer_death_hap: 0,
      k_gini_hap: 0,
      k_unemp_hap: 0,
      k_welfare_hap: 0,
      k_inflation_hap: 0,
    });
    const { k_gini_cor, giniStressThreshold } = getPhysicsConfig();
    // 10 agents with wealths 10..100 → bottom 20% = cutoff at index 2 (wealth=30).
    const agents = Array.from({ length: 10 }, (_, i) => makeAgent(`a${i}`));
    const wealthByAgent = Object.fromEntries(agents.map((a, i) => [a.id, (i + 1) * 10]));
    const ctx = buildContext(agents, { giniCoefficient: 0.5, wealthByAgent });
    applyStructuralPressures(ctx);
    const expected = k_gini_cor * (0.5 - giniStressThreshold);
    // Bottom quintile = agents with wealth <= cutoff (wealth ≤ 30 → a0 and a1).
    expect(ctx.weekStateMap.get('a0')!.cortisolDelta).toBeCloseTo(expected, 5);
    expect(ctx.weekStateMap.get('a1')!.cortisolDelta).toBeCloseTo(expected, 5);
  });

  it('top-quintile citizen receives zero Gini pressure', () => {
    updatePhysicsConfig({
      k_inflation_cor: 0,
      k_unemp_cor: 0,
      k_pg_cor: 0,
      k_peer_death_hap: 0,
      k_gini_hap: 0,
      k_unemp_hap: 0,
      k_welfare_hap: 0,
      k_inflation_hap: 0,
    });
    const agents = Array.from({ length: 10 }, (_, i) => makeAgent(`a${i}`));
    const wealthByAgent = Object.fromEntries(agents.map((a, i) => [a.id, (i + 1) * 10]));
    const ctx = buildContext(agents, { giniCoefficient: 0.5, wealthByAgent });
    applyStructuralPressures(ctx);
    expect(ctx.weekStateMap.get('a9')!.cortisolDelta).toBe(0);
  });

  it('unemployed agent with wealth < lowWealthThreshold receives k_unemp_cor/tick', () => {
    updatePhysicsConfig({
      k_inflation_cor: 0,
      k_gini_cor: 0,
      k_pg_cor: 0,
      k_peer_death_hap: 0,
      k_gini_hap: 0,
      k_unemp_hap: 0,
      k_welfare_hap: 0,
      k_inflation_hap: 0,
    });
    const { k_unemp_cor } = getPhysicsConfig();
    const agents = [makeAgent('poor'), makeAgent('rich')];
    const ctx = buildContext(agents, {
      employed: [], // both unemployed
      wealthByAgent: { poor: 10, rich: 500 },
    });
    applyStructuralPressures(ctx);
    expect(ctx.weekStateMap.get('poor')!.cortisolDelta).toBeCloseTo(k_unemp_cor, 5);
    // rich is unemployed but wealth ≥ lowWealthThreshold → no penalty
    expect(ctx.weekStateMap.get('rich')!.cortisolDelta).toBe(0);
  });

  it('underfunded public goods applies k_pg_cor × (1 - min/50) to every citizen', () => {
    updatePhysicsConfig({
      k_inflation_cor: 0,
      k_gini_cor: 0,
      k_unemp_cor: 0,
      k_peer_death_hap: 0,
      k_gini_hap: 0,
      k_unemp_hap: 0,
      k_welfare_hap: 0,
      k_inflation_hap: 0,
    });
    const { k_pg_cor } = getPhysicsConfig();
    const agents = [makeAgent('a1')];
    const ctx = buildContext(agents, {
      pg: { infra: 10, edu: 20, welfare: 5, defense: 100 }, // min = welfare 5
    });
    applyStructuralPressures(ctx);
    const expected = k_pg_cor * (1 - 5 / 50);
    expect(ctx.weekStateMap.get('a1')!.cortisolDelta).toBeCloseTo(expected, 5);
  });

  it('bank agent receives zero structural cortisol pressure (D-02 Pitfall 2)', () => {
    const agents = [
      makeAgent('citizen'),
      makeAgent('bank1', { type: 'bank', role: 'bank' }),
    ];
    const ctx = buildContext(agents, {
      inflation: { rate: 10, expect: 0 },
      pg: { infra: 5, edu: 5, welfare: 5, defense: 5 },
    });
    applyStructuralPressures(ctx);
    expect(ctx.weekStateMap.get('bank1')!.cortisolDelta).toBe(0);
    expect(ctx.weekStateMap.get('citizen')!.cortisolDelta).toBeGreaterThan(0);
  });

  it('central_bank agent receives zero structural cortisol pressure (D-02 Pitfall 2)', () => {
    const agents = [
      makeAgent('citizen'),
      makeAgent('cb', { role: 'central_bank' }),
    ];
    const ctx = buildContext(agents, {
      inflation: { rate: 10, expect: 0 },
      pg: { infra: 5, edu: 5, welfare: 5, defense: 5 },
    });
    applyStructuralPressures(ctx);
    expect(ctx.weekStateMap.get('cb')!.cortisolDelta).toBe(0);
  });

  it('hot-swap k_inflation_cor=0 disables inflation-surprise pressure', () => {
    updatePhysicsConfig({
      k_inflation_cor: 0,
      k_gini_cor: 0,
      k_unemp_cor: 0,
      k_pg_cor: 0,
      k_peer_death_hap: 0,
      k_gini_hap: 0,
      k_unemp_hap: 0,
      k_welfare_hap: 0,
      k_inflation_hap: 0,
    });
    const agents = [makeAgent('a1')];
    const ctx = buildContext(agents, { inflation: { rate: 10, expect: 0 } });
    applyStructuralPressures(ctx);
    expect(ctx.weekStateMap.get('a1')!.cortisolDelta).toBe(0);
  });
});

describe('structural pressures: happiness mechanics (Phase 11 D-07)', () => {
  beforeEach(() => { resetPhysicsConfig(); });

  it('deaths this tick reduce all citizens happiness by k_peer_death_hap × count', () => {
    updatePhysicsConfig({
      k_inflation_cor: 0,
      k_gini_cor: 0,
      k_unemp_cor: 0,
      k_pg_cor: 0,
      k_gini_hap: 0,
      k_unemp_hap: 0,
      k_welfare_hap: 0,
      k_inflation_hap: 0,
    });
    const { k_peer_death_hap } = getPhysicsConfig();
    const agents = [makeAgent('alive1'), makeAgent('alive2')];
    const ctx = buildContext(agents, { deaths: ['dead1', 'dead2'] });
    applyStructuralPressures(ctx);
    const expected = -2 * k_peer_death_hap;
    expect(ctx.weekStateMap.get('alive1')!.happinessDelta).toBeCloseTo(expected, 5);
    expect(ctx.weekStateMap.get('alive2')!.happinessDelta).toBeCloseTo(expected, 5);
  });

  it('bottom-quintile citizen receives -k_gini_hap × (Gini - threshold) happiness', () => {
    updatePhysicsConfig({
      k_inflation_cor: 0,
      k_gini_cor: 0,
      k_unemp_cor: 0,
      k_pg_cor: 0,
      k_peer_death_hap: 0,
      k_unemp_hap: 0,
      k_welfare_hap: 0,
      k_inflation_hap: 0,
    });
    const { k_gini_hap, giniStressThreshold } = getPhysicsConfig();
    const agents = Array.from({ length: 10 }, (_, i) => makeAgent(`a${i}`));
    const wealthByAgent = Object.fromEntries(agents.map((a, i) => [a.id, (i + 1) * 10]));
    const ctx = buildContext(agents, { giniCoefficient: 0.5, wealthByAgent });
    applyStructuralPressures(ctx);
    const expected = -k_gini_hap * (0.5 - giniStressThreshold);
    expect(ctx.weekStateMap.get('a0')!.happinessDelta).toBeCloseTo(expected, 5);
  });

  it('unemployed + low wealth receives -k_unemp_hap happiness/tick', () => {
    updatePhysicsConfig({
      k_inflation_cor: 0,
      k_gini_cor: 0,
      k_unemp_cor: 0,
      k_pg_cor: 0,
      k_peer_death_hap: 0,
      k_gini_hap: 0,
      k_welfare_hap: 0,
      k_inflation_hap: 0,
    });
    const { k_unemp_hap } = getPhysicsConfig();
    const agents = [makeAgent('poor')];
    const ctx = buildContext(agents, { employed: [], wealthByAgent: { poor: 10 } });
    applyStructuralPressures(ctx);
    expect(ctx.weekStateMap.get('poor')!.happinessDelta).toBeCloseTo(-k_unemp_hap, 5);
  });

  it('welfareQuality under 50 applies -k_welfare_hap × (1 - quality/50)', () => {
    updatePhysicsConfig({
      k_inflation_cor: 0,
      k_gini_cor: 0,
      k_unemp_cor: 0,
      k_pg_cor: 0,
      k_peer_death_hap: 0,
      k_gini_hap: 0,
      k_unemp_hap: 0,
      k_inflation_hap: 0,
    });
    const { k_welfare_hap } = getPhysicsConfig();
    const agents = [makeAgent('a1')];
    const ctx = buildContext(agents, {
      pg: { infra: 100, edu: 100, welfare: 10, defense: 100 },
    });
    applyStructuralPressures(ctx);
    const expected = -k_welfare_hap * (1 - 10 / 50);
    expect(ctx.weekStateMap.get('a1')!.happinessDelta).toBeCloseTo(expected, 5);
  });

  it('inflation surprise subtracts k_inflation_hap × surprise from happiness', () => {
    updatePhysicsConfig({
      k_inflation_cor: 0,
      k_gini_cor: 0,
      k_unemp_cor: 0,
      k_pg_cor: 0,
      k_peer_death_hap: 0,
      k_gini_hap: 0,
      k_unemp_hap: 0,
      k_welfare_hap: 0,
    });
    const { k_inflation_hap } = getPhysicsConfig();
    const agents = [makeAgent('a1')];
    const ctx = buildContext(agents, { inflation: { rate: 8, expect: 2 } });
    applyStructuralPressures(ctx);
    const expected = -k_inflation_hap * 6;
    expect(ctx.weekStateMap.get('a1')!.happinessDelta).toBeCloseTo(expected, 5);
  });

  it('bank agent receives zero structural happiness pressure', () => {
    const agents = [
      makeAgent('citizen'),
      makeAgent('bank1', { type: 'bank', role: 'bank' }),
    ];
    const ctx = buildContext(agents, { deaths: ['dead1', 'dead2'] });
    applyStructuralPressures(ctx);
    expect(ctx.weekStateMap.get('bank1')!.happinessDelta).toBe(0);
  });
});
