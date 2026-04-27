/**
 * Enterprise Engine — deterministic enterprise economics mechanics.
 *
 * Design: All functions receive data and return delta objects. No direct DB mutations.
 * The caller (simulationRunner in Plan 04) applies deltas in batch.
 *
 * SFC Accounting:
 *  - Wage payment: enterprise treasury -= wage, worker wealth += wage (net=0)
 *  - Liquidation: enterprise inventory → AMM sell orders (asset conversion, no fiat creation)
 *  - Idle fallback: creates food from nothing (subsistence, outside SFC perimeter)
 *  - Cost pass-through: adjusts sell price markup (informational, no fiat movement)
 */
import type { EconomyConfig, EnterpriseSector, EnterpriseCommodity } from '@policylab/shared';

// ── Return types ─────────────────────────────────────────────────────────────

export interface EnterpriseDelta {
  wagePayments: Array<{ fromEnterprise: string; toAgentId: string; amount: number }>;
  productionOutput: Array<{ enterpriseId: string; commodity: EnterpriseCommodity; quantity: number }>;
  insolvencyUpdates: Array<{ enterpriseId: string; consecutiveDeficits: number; isBankrupt: boolean }>;
  liquidations: Array<{ enterpriseId: string; commodity: EnterpriseCommodity; quantity: number }>;
  idleFallbackProduction: Array<{ agentId: string; commodity: 'food'; quantity: number }>;
  costPassThroughMarkup: Map<string, number>; // enterpriseId -> price markup factor
  trace: string[];
}

function emptyDelta(): EnterpriseDelta {
  return {
    wagePayments: [],
    productionOutput: [],
    insolvencyUpdates: [],
    liquidations: [],
    idleFallbackProduction: [],
    costPassThroughMarkup: new Map(),
    trace: [],
  };
}

// ── Enterprise input types (local to engine) ─────────────────────────────────

export interface EnterpriseInput {
  id: string;
  ownerId: string;
  wage: number;
  employees: Set<string>;
  treasury: number;
}

export interface ProductionInput {
  id: string;
  sector: EnterpriseSector;
  productionQuantity: number;
}

// ── sectorToCommodity ────────────────────────────────────────────────────────

/**
 * Maps an enterprise sector to its primary commodity output.
 * - agriculture -> food
 * - industry -> tools (primary), raw_materials (secondary at 50%)
 * - services -> luxury_goods
 * - government -> none (service enterprises)
 */
export function sectorToCommodity(sector: EnterpriseSector): EnterpriseCommodity {
  switch (sector) {
    case 'agriculture': return 'food';
    case 'industry': return 'tools';
    case 'services': return 'luxury_goods';
    case 'government': return 'none';
  }
}

// ── processEnterpriseWages ──────────────────────────────────────────────────

export function processEnterpriseWages(params: {
  enterprises: EnterpriseInput[];
  workedAgents: Set<string>;
  config: EconomyConfig;
  insolvencyCounters: Map<string, number>;
}): EnterpriseDelta {
  const { enterprises, workedAgents, config, insolvencyCounters } = params;
  const delta = emptyDelta();
  const minWage = config.minimumWage ?? 5;

  for (const ent of enterprises) {
    // Only pay workers who actually WORK'd this iteration
    const activeWorkers = [...ent.employees].filter(id => workedAgents.has(id));
    if (activeWorkers.length === 0) {
      // No workers worked — no wages, no insolvency change
      delta.insolvencyUpdates.push({
        enterpriseId: ent.id,
        consecutiveDeficits: insolvencyCounters.get(ent.id) ?? 0,
        isBankrupt: false,
      });
      continue;
    }

    const effectiveWage = Math.max(ent.wage, minWage);
    const totalWageBill = effectiveWage * activeWorkers.length;

    if (ent.treasury >= totalWageBill) {
      // Full pay — reset insolvency
      for (const workerId of activeWorkers) {
        delta.wagePayments.push({
          fromEnterprise: ent.id,
          toAgentId: workerId,
          amount: effectiveWage,
        });
      }
      delta.insolvencyUpdates.push({
        enterpriseId: ent.id,
        consecutiveDeficits: 0,
        isBankrupt: false,
      });
      delta.trace.push(
        `Enterprise ${ent.id}: paid ${activeWorkers.length} workers @${effectiveWage} each (total ${totalWageBill})`,
      );
    } else {
      // Partial pay — pro-rata distribution
      const ratio = ent.treasury / totalWageBill;
      for (const workerId of activeWorkers) {
        const partialPay = effectiveWage * ratio;
        delta.wagePayments.push({
          fromEnterprise: ent.id,
          toAgentId: workerId,
          amount: partialPay,
        });
      }
      const prevCount = insolvencyCounters.get(ent.id) ?? 0;
      const newCount = prevCount + 1;
      delta.insolvencyUpdates.push({
        enterpriseId: ent.id,
        consecutiveDeficits: newCount,
        isBankrupt: false,
      });
      delta.trace.push(
        `Enterprise ${ent.id}: insufficient treasury (${ent.treasury}/${totalWageBill}), pro-rata pay @${ratio.toFixed(2)}, insolvency=${newCount}`,
      );
    }
  }

  return delta;
}

// ── processEnterpriseInsolvency ──────────────────────────────────────────────

export function processEnterpriseInsolvency(params: {
  insolvencyCounters: Map<string, number>;
  enterprises: EnterpriseInput[];
  config: EconomyConfig;
}): EnterpriseDelta {
  const { insolvencyCounters, enterprises, config } = params;
  const delta = emptyDelta();
  const threshold = config.enterpriseInsolvencyThreshold ?? 3;

  for (const ent of enterprises) {
    const count = insolvencyCounters.get(ent.id) ?? 0;
    const isBankrupt = count >= threshold;

    delta.insolvencyUpdates.push({
      enterpriseId: ent.id,
      consecutiveDeficits: count,
      isBankrupt,
    });

    if (isBankrupt) {
      delta.trace.push(
        `Enterprise ${ent.id}: BANKRUPT after ${count} consecutive deficits (threshold=${threshold}). Employees released: ${[...ent.employees].join(', ')}`,
      );
    }
  }

  return delta;
}

// ── processIdleFallback ──────────────────────────────────────────────────────

const PRODUCTIVE_ACTIONS = new Set(['WORK', 'WORK_AT_ENTERPRISE', 'PRODUCE_AND_SELL', 'PRODUCE']);

export function processIdleFallback(params: {
  idleCounters: Map<string, number>;
  agentActions: Map<string, string[]>;
  config: EconomyConfig;
}): EnterpriseDelta {
  const { idleCounters, agentActions, config } = params;
  const delta = emptyDelta();
  const threshold = config.idleFallbackThreshold ?? 2;
  const production = config.idleFallbackProduction ?? 5;

  for (const [agentId, actions] of agentActions) {
    const didWork = actions.some(a => PRODUCTIVE_ACTIONS.has(a));

    if (didWork) {
      // Reset counter
      idleCounters.set(agentId, 0);
      continue;
    }

    const prevCount = idleCounters.get(agentId) ?? 0;
    const newCount = prevCount + 1;
    idleCounters.set(agentId, newCount);

    if (newCount >= threshold) {
      delta.idleFallbackProduction.push({
        agentId,
        commodity: 'food',
        quantity: production,
      });
      delta.trace.push(
        `Agent ${agentId}: idle for ${newCount} iterations, forced subsistence production of ${production} food`,
      );
    }
  }

  return delta;
}

// ── processEnterpriseProduction ──────────────────────────────────────────────

export function processEnterpriseProduction(params: {
  enterprises: ProductionInput[];
}): EnterpriseDelta {
  const delta = emptyDelta();

  for (const ent of params.enterprises) {
    const primaryCommodity = sectorToCommodity(ent.sector);
    if (primaryCommodity === 'none') {
      delta.trace.push(`Enterprise ${ent.id}: government sector, no commodity output`);
      continue;
    }

    delta.productionOutput.push({
      enterpriseId: ent.id,
      commodity: primaryCommodity,
      quantity: ent.productionQuantity,
    });

    // Industry produces secondary output: raw_materials at 50% rate
    if (ent.sector === 'industry') {
      const secondaryQuantity = Math.floor(ent.productionQuantity * 0.5);
      if (secondaryQuantity > 0) {
        delta.productionOutput.push({
          enterpriseId: ent.id,
          commodity: 'raw_materials',
          quantity: secondaryQuantity,
        });
      }
    }

    delta.trace.push(
      `Enterprise ${ent.id}: produced ${ent.productionQuantity} ${primaryCommodity}${ent.sector === 'industry' ? ` + ${Math.floor(ent.productionQuantity * 0.5)} raw_materials` : ''}`,
    );
  }

  return delta;
}

// ── processWageAdjustment ────────────────────────────────────────────────────

/**
 * D-01 Hybrid Wage Adjustment Rule — applied once per iteration BEFORE intent phase.
 *
 * Order (non-negotiable per 12-CONTEXT.md D-01):
 *   1. Base: ent.wage (current posted wage)
 *   2. Linear labor-market nudge: k × surplus/shortage ratio (clamped ±50%)
 *   3. Profit-share top-up: α × (P&L / workforce) when last-iter P&L > 0
 *   4. MRP ceiling: wage ≤ (ammSpotPrice × productionPerWorker) − perWorkerInputCost
 *      (skipped when spot price ≤ 0 or NaN — 12-RESEARCH §8 mitigation)
 *   5. Minimum floor: wage ≥ economyConfig.minimumWage
 *
 * SFC invariant: this function ONLY mutates ent.wage — no fiat movement whatsoever.
 */

export interface WageAdjustmentInput {
  enterprises: Array<{
    id: string;
    sector: EnterpriseSector;
    wage: number;
    lastApplicants: number;
    lastVacancies: number;
  }>;
  config: EconomyConfig;
  ammSpotPrices: Map<EnterpriseCommodity, number>;
  previousLedgers: Map<string, { totalRevenue: number; totalWages: number; workerCount: number }>;
}

export interface WageAdjustmentResult {
  trace: string[];
  wageChanges: Array<{
    enterpriseId: string;
    before: number;
    after: number;
    nudgeFactor: number;
    profitTopup: number;
    mrpClampApplied: boolean;
  }>;
}

/** Matches the hardcoded constant at simulationRunner.ts ~line 1905 */
const PRODUCTION_PER_WORKER = 10;
/** PLANNER DECISION (12-CONTEXT.md §Discretion): linear nudge, clamped ±50% per iteration */
const NUDGE_RATIO_CLAMP = 0.5;

export function processWageAdjustment(input: WageAdjustmentInput): WageAdjustmentResult {
  const { enterprises, config, ammSpotPrices, previousLedgers } = input;
  const k = config.laborWageNudgeK ?? 0.03;
  const alpha = config.laborWageProfitShareAlpha ?? 0.15;
  const perWorkerInputCost = config.defaultPerWorkerInputCost ?? 2;
  const minWage = config.minimumWage ?? 5;

  const trace: string[] = [];
  const wageChanges: WageAdjustmentResult['wageChanges'] = [];

  for (const ent of enterprises) {
    const before = ent.wage;
    let wage = before;

    // Step 2: Linear labor-market nudge
    const a = ent.lastApplicants;
    const v = ent.lastVacancies;
    let nudgeFactor = 1;
    if (v > 0 && a > v) {
      // Surplus: more applicants than vacancies → wage pressure downward
      const surplusRatio = Math.min(NUDGE_RATIO_CLAMP, (a - v) / Math.max(v, 1));
      nudgeFactor = 1 - k * surplusRatio;
    } else if (v > 0 && a < v) {
      // Shortage: more vacancies than applicants → wage pressure upward
      const shortageRatio = Math.min(NUDGE_RATIO_CLAMP, (v - a) / Math.max(a, 1));
      nudgeFactor = 1 + k * shortageRatio;
    }
    // If a === v or v === 0: no nudge (nudgeFactor remains 1)
    wage *= nudgeFactor;

    // Step 3: Profit-share top-up (only when last-iteration P&L > 0)
    const prev = previousLedgers.get(ent.id);
    let profitTopup = 0;
    if (prev !== undefined) {
      const pnl = prev.totalRevenue - prev.totalWages;
      if (pnl > 0) {
        const workforce = Math.max(1, prev.workerCount);
        profitTopup = alpha * (pnl / workforce);
        wage += profitTopup;
      }
    }

    // Step 4: MRP ceiling (skip when spot price ≤ 0 or NaN — 12-RESEARCH §8 mitigation)
    let mrpClampApplied = false;
    const commodity = sectorToCommodity(ent.sector);
    if (commodity !== 'none') {
      const spot = ammSpotPrices.get(commodity) ?? 0;
      if (spot > 0 && Number.isFinite(spot)) {
        const mrp = spot * PRODUCTION_PER_WORKER - perWorkerInputCost;
        if (mrp > 0 && wage > mrp) {
          wage = mrp;
          mrpClampApplied = true;
        }
      }
    }

    // Step 5: Minimum-wage floor (Phase 10 invariant preserved)
    wage = Math.max(wage, minWage);

    // Mutate the enterprise record in-place (SFC-safe: wage is a property, not fiat)
    ent.wage = wage;

    wageChanges.push({
      enterpriseId: ent.id,
      before,
      after: wage,
      nudgeFactor,
      profitTopup,
      mrpClampApplied,
    });
    trace.push(
      `Enterprise ${ent.id}: wage ${before.toFixed(2)}→${wage.toFixed(2)} ` +
      `(nudge×${nudgeFactor.toFixed(3)}, pnl+${profitTopup.toFixed(2)}, mrpCap=${mrpClampApplied})`,
    );
  }

  return { trace, wageChanges };
}

// ── processEnterpriseCostPassThrough ─────────────────────────────────────────

/**
 * When wage costs rise, enterprises pass through 50% of the cost increase as a price markup.
 * markup = 1 + (wageCostDelta / previousWageCost) * 0.5
 */
export function processEnterpriseCostPassThrough(params: {
  currentWageCosts: Map<string, number>;
  previousWageCosts: Map<string, number>;
}): EnterpriseDelta {
  const { currentWageCosts, previousWageCosts } = params;
  const delta = emptyDelta();

  for (const [entId, currentCost] of currentWageCosts) {
    const prevCost = previousWageCosts.get(entId) ?? currentCost;
    if (prevCost === 0) {
      delta.costPassThroughMarkup.set(entId, 1.0);
      continue;
    }

    const costDelta = currentCost - prevCost;
    const markup = 1 + (costDelta / prevCost) * 0.5;
    delta.costPassThroughMarkup.set(entId, markup);

    if (costDelta !== 0) {
      delta.trace.push(
        `Enterprise ${entId}: wage cost ${prevCost}->${currentCost}, markup=${markup.toFixed(3)}`,
      );
    }
  }

  return delta;
}
