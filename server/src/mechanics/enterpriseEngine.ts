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
