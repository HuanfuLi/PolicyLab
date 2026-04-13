/**
 * Phase 11 D-02 / D-07: Structural pressure injection.
 *
 * Eliminates utopia bias by making cortisol and happiness respond to
 * macro conditions (inflation, inequality, unemployment, public goods
 * quality, peer deaths) rather than to routine agent activity.
 *
 * Applied each iteration AFTER the inflation tick and BEFORE final stat
 * commit (via post-hoc mutation of statUpdates cortisol/happiness fields).
 *
 * Bank and central_bank agents are excluded — they are institutional and
 * do not experience organic stress.
 *
 * See .planning/phases/11-.../11-CONTEXT.md D-01 through D-09
 * See .planning/phases/11-.../11-RESEARCH.md section 2 and Example 1
 */
import type { Agent } from '@policylab/shared';
import { physicsConfig } from '../../mechanics/physicsConfig.js';
import type { AgentWeekState } from './weekState.js';

export interface PublicGoodsQuality {
  infrastructureQuality: number;
  educationQuality: number;
  defenseQuality: number;
  welfareQuality: number;
}

export interface InflationSignal {
  inflationRate: number;
  inflationExpectations: number;
}

export interface LifecycleEvent {
  type: string;
  agentId?: string;
  detail?: string;
}

export interface StructuralPressureContext {
  /** Alive agents including bank/central_bank (filtered internally per D-02 Pitfall 2). */
  aliveAgents: Agent[];
  /** Mutable per-agent accumulator for this iteration. */
  weekStateMap: Map<string, AgentWeekState>;
  /** Mutable final stat snapshot already built by runner (pre-structural-pressure). */
  statUpdates: Array<{ id: string; wealth: number; health: number; happiness: number; cortisol: number }>;
  /** Agents with active employment — absence signals unemployment. */
  employmentRegistry: Map<string, unknown> | Set<string>;
  /** Gini coefficient computed at current iteration (inequality pressure input). */
  giniCoefficient: number;
  /** Inflation tick output — null when inflation disabled. */
  inflationSignal: InflationSignal | null;
  /** Fiscal tick output — null when fiscal disabled. */
  publicGoodsQuality: PublicGoodsQuality | null;
  /** Resolution lifecycle events (source of peer-death signal). */
  lifecycleEvents: LifecycleEvent[];
}

export interface StructuralPressureResult {
  /** Number of citizens that received any pressure (bank/central excluded). */
  citizensAffected: number;
  /** Death count used for peer-death happiness penalty. */
  deathsThisTick: number;
  /** Cumulative cortisol pressure applied this tick (for telemetry). */
  totalCortisolPressure: number;
  /** Cumulative (negative) happiness pressure applied this tick. */
  totalHappinessPressure: number;
}

/**
 * Apply four cortisol pressures (inflation surprise, Gini bottom-quintile,
 * unemployment+low-wealth, underfunded public goods) and five happiness
 * pressures (peer death, Gini, unemployment, welfare underfunding, inflation
 * surprise) to every alive citizen.
 *
 * Mutates both `weekStateMap` deltas AND the already-built `statUpdates`
 * snapshot so downstream telemetry + cognition reads the post-pressure values.
 * Final [3,95] / [5,95] clamps are re-applied to `statUpdates`.
 */
export function applyStructuralPressures(ctx: StructuralPressureContext): StructuralPressureResult {
  const surprise = ctx.inflationSignal
    ? Math.max(0, ctx.inflationSignal.inflationRate - ctx.inflationSignal.inflationExpectations)
    : 0;
  const giniExcess = Math.max(0, ctx.giniCoefficient - physicsConfig.giniStressThreshold);
  const deathsThisTick = ctx.lifecycleEvents.filter(e => e.type === 'death').length;

  const sortedWealth = [...ctx.statUpdates].sort((a, b) => a.wealth - b.wealth);
  const bottomQuintileCutoff =
    sortedWealth.length > 0
      ? sortedWealth[Math.floor(sortedWealth.length * 0.2)]?.wealth ?? 0
      : 0;

  const pg = ctx.publicGoodsQuality;
  const pgPressure = pg
    ? 1 -
      Math.min(pg.infrastructureQuality, pg.educationQuality, pg.welfareQuality) / 50
    : 1;
  const pgPressureClamped = Math.max(0, Math.min(1, pgPressure));

  const statMap = new Map(ctx.statUpdates.map(u => [u.id, u]));

  let citizensAffected = 0;
  let totalCortisolPressure = 0;
  let totalHappinessPressure = 0;

  const employmentHas = (id: string): boolean => {
    if (ctx.employmentRegistry instanceof Set) return ctx.employmentRegistry.has(id);
    return ctx.employmentRegistry.has(id);
  };

  for (const agent of ctx.aliveAgents) {
    // D-02/D-07 exclude bank and central_bank agents (Pitfall 2 — institutional
    // agents do not experience organic stress).
    if (agent.type === 'bank') continue;
    if (agent.role?.toLowerCase() === 'central_bank') continue;

    const weekState = ctx.weekStateMap.get(agent.id);
    const statUpdate = statMap.get(agent.id);
    if (!weekState || !statUpdate) continue;

    const isBottomQuintile = statUpdate.wealth <= bottomQuintileCutoff;
    const isUnemployed = !employmentHas(agent.id);
    const lowWealth = statUpdate.wealth < physicsConfig.lowWealthThreshold;

    let corPressure = 0;
    let hapPressure = 0;

    // ── Cortisol pressures (D-02) ─────────────────────────────────────
    corPressure += physicsConfig.k_inflation_cor * surprise;
    if (isBottomQuintile) {
      corPressure += physicsConfig.k_gini_cor * giniExcess;
    }
    if (isUnemployed && lowWealth) {
      corPressure += physicsConfig.k_unemp_cor;
    }
    corPressure += physicsConfig.k_pg_cor * pgPressureClamped;

    // ── Happiness pressures (D-07; always negative — "pressures") ─────
    hapPressure -= physicsConfig.k_peer_death_hap * deathsThisTick;
    if (isBottomQuintile) {
      hapPressure -= physicsConfig.k_gini_hap * giniExcess;
    }
    if (isUnemployed && lowWealth) {
      hapPressure -= physicsConfig.k_unemp_hap;
    }
    if (pg) {
      hapPressure -= physicsConfig.k_welfare_hap * Math.max(0, 1 - pg.welfareQuality / 50);
    }
    hapPressure -= physicsConfig.k_inflation_hap * surprise;

    // ── Accumulate into weekState (post-cognition memories read these) ─
    weekState.cortisolDelta += corPressure;
    weekState.happinessDelta += hapPressure;

    // ── Re-commit statUpdates with Phase 11 clamps [3,95] / [5,95] ─────
    statUpdate.cortisol = Math.max(
      physicsConfig.cortisolFloor,
      Math.min(physicsConfig.cortisolCeiling, statUpdate.cortisol + corPressure),
    );
    statUpdate.happiness = Math.max(
      physicsConfig.happinessFloor,
      Math.min(physicsConfig.happinessCeiling, statUpdate.happiness + hapPressure),
    );

    citizensAffected++;
    totalCortisolPressure += corPressure;
    totalHappinessPressure += hapPressure;
  }

  return {
    citizensAffected,
    deathsThisTick,
    totalCortisolPressure,
    totalHappinessPressure,
  };
}
