/**
 * Fiscal Engine — deterministic fiscal spending mechanics.
 *
 * Design: All functions receive data and return delta objects. No direct DB mutations.
 * The caller (simulationRunner in Plan 03) applies deltas in batch via fiscalRepo.
 *
 * SFC Accounting:
 *  - Treasury spending: treasury -= totalSpending (net outflow from government)
 *  - All spending distributed to alive agents equally (simulates government employment + transfers)
 *  - treasuryDelta + sum(agentPayments) = 0 (SFC-neutral: money transfers, doesn't disappear)
 *  - Quality scores track cumulative investment effect (side effect of spending, not a store of value)
 *
 * Public Goods Quality:
 *  - Infrastructure, Education, Defense quality: gain from category-specific spending (diminishing returns)
 *  - Welfare: direct payment tracked via welfarePerAgent; welfare quality score also maintained
 *  - All quality scores: decay by decayRate per iteration when no spending occurs
 *  - All quality scores clamped to [0, 100]
 */
import type { BudgetAllocation, EconomyConfig, PublicGoodsState } from '@policylab/shared';

// ── Income Tax types ─────────────────────────────────────────────────────────

export interface TaxInput {
  agentIncomes: Array<{ agentId: string; income: number }>; // income earned this iteration (wages, enterprise revenue)
  taxRate: number; // from EconomyConfig.incomeTaxRate
}

export interface TaxOutput {
  totalRevenue: number;
  perAgentTax: Array<{ agentId: string; taxAmount: number }>;
  trace: string[];
}

/**
 * Compute income tax for all agents with positive income.
 * Flat rate applied to each agent's gross income. Zero/negative income is exempt.
 * Returns per-agent deductions and total treasury revenue.
 */
export function computeIncomeTax(input: TaxInput): TaxOutput {
  const perAgentTax: Array<{ agentId: string; taxAmount: number }> = [];
  let totalRevenue = 0;

  for (const { agentId, income } of input.agentIncomes) {
    if (income <= 0 || input.taxRate <= 0) continue;
    const tax = income * input.taxRate;
    perAgentTax.push({ agentId, taxAmount: tax });
    totalRevenue += tax;
  }

  return {
    totalRevenue,
    perAgentTax,
    trace: [`[FISCAL] Income tax collected: ${totalRevenue.toFixed(2)} from ${perAgentTax.length} agents at ${(input.taxRate * 100).toFixed(1)}% rate`],
  };
}

// ── Return types ──────────────────────────────────────────────────────────────

export interface MultiplierEffects {
  /** Productivity multiplier from infrastructure quality (bonus on PRODUCE/WORK output) */
  productivityBonus: number;
  /** Skill gain rate multiplier from education quality (bonus on skill XP gain) */
  skillGainBonus: number;
  /** Enforcement multiplier from defense quality (reduces STEAL success probability) */
  enforcementBonus: number;
  /** Direct fiat payment per agent from welfare spending this iteration */
  welfarePerAgent: number;
}

export interface FiscalDelta {
  /** Negative: total spending deducted from treasury this iteration */
  treasuryDelta: number;
  /** agentId → total payment received (sum of all budget categories distributed equally) */
  agentPayments: Map<string, number>;
  /** Updated public goods quality scores after spending and decay */
  updatedPublicGoods: Omit<PublicGoodsState, 'id' | 'sessionId'>;
  /** Multiplier effects derived from updated quality scores */
  multiplierEffects: MultiplierEffects;
  /** Physics trace log entries for narrative grounding */
  trace: string[];
}

// ── Scale factor calibration ─────────────────────────────────────────────────
// With default params: 1000 treasury, 0.10 rate, 0.25 allocation → 25 fiat per category.
// We want ~2-3 quality points gain from 25 fiat.
// gain = (spendAmount ^ 0.7) * SCALE_FACTOR
// 25^0.7 ≈ 9.46. For gain ≈ 2.5: SCALE_FACTOR ≈ 2.5/9.46 ≈ 0.264
const QUALITY_GAIN_SCALE_FACTOR = 0.264;

// ── Pure helper functions ─────────────────────────────────────────────────────

/**
 * Update a single quality score given spending and config.
 * Gain formula: (spendAmount ^ diminishingExponent) * SCALE_FACTOR
 * If spendAmount <= 0, apply decay instead.
 * Result is clamped to [0, 100].
 */
export function updatePublicGoodsQuality(params: {
  currentQuality: number;
  spendAmount: number;
  decayRate: number;
  diminishingExponent: number;
}): number {
  const { currentQuality, spendAmount, decayRate, diminishingExponent } = params;

  let newQuality: number;
  if (spendAmount > 0) {
    const gain = Math.pow(spendAmount, diminishingExponent) * QUALITY_GAIN_SCALE_FACTOR;
    newQuality = currentQuality + gain;
  } else {
    newQuality = currentQuality - decayRate;
  }

  // Clamp to [0, 100]
  return Math.max(0, Math.min(100, newQuality));
}

/**
 * Compute multiplier effects from current quality scores and config.
 */
export function getMultiplierEffects(params: {
  publicGoods: Omit<PublicGoodsState, 'id' | 'sessionId'>;
  economyConfig: EconomyConfig;
  welfarePerAgent: number;
}): MultiplierEffects {
  const { publicGoods, economyConfig, welfarePerAgent } = params;

  return {
    productivityBonus: publicGoods.infrastructureQuality * (economyConfig.infrastructureMultiplier ?? 0.005),
    skillGainBonus: publicGoods.educationQuality * (economyConfig.educationMultiplier ?? 0.005),
    enforcementBonus: publicGoods.defenseQuality * (economyConfig.defenseMultiplier ?? 0.003),
    welfarePerAgent,
  };
}

// ── Main function ─────────────────────────────────────────────────────────────

/**
 * Execute one iteration of budget spending from the treasury.
 *
 * All budget spending is distributed to alive agents (SFC requirement: money
 * cannot disappear). Quality scores track cumulative investment impact.
 *
 * @param treasuryBalance - Current treasury fiat balance
 * @param budgetAllocation - Fractional allocation across categories (sum must be 1.0)
 * @param economyConfig - Fiscal policy parameters
 * @param currentPublicGoods - Current quality state (will be updated)
 * @param aliveAgentIds - IDs of alive agents to receive payments
 * @param iterationNumber - Current simulation iteration (for updated public goods snapshot)
 */
export function executeBudget(params: {
  treasuryBalance: number;
  budgetAllocation: BudgetAllocation;
  economyConfig: EconomyConfig;
  currentPublicGoods: Omit<PublicGoodsState, 'id' | 'sessionId'>;
  aliveAgentIds: string[];
  iterationNumber: number;
}): FiscalDelta {
  const {
    treasuryBalance,
    budgetAllocation,
    economyConfig,
    currentPublicGoods,
    aliveAgentIds,
    iterationNumber,
  } = params;

  const spendingRate = economyConfig.budgetSpendingRate ?? 0.10;
  const decayRate = economyConfig.publicGoodsDecayRate ?? 0.5;
  const diminishingExponent = economyConfig.publicGoodsGainDiminishing ?? 0.7;

  const trace: string[] = [];
  const agentPayments = new Map<string, number>();

  // ── Step 1: Compute total spending (capped at treasury balance) ──────────
  let totalSpending = treasuryBalance * spendingRate;

  // Treasury never goes negative — cap spending to available balance
  if (totalSpending > treasuryBalance) {
    totalSpending = treasuryBalance;
    trace.push(`[Fiscal] Treasury insufficient — spending capped at ${totalSpending.toFixed(2)} fiat`);
  }

  // ── Step 2: Zero-treasury early path — only decay, no payments ──────────
  if (treasuryBalance <= 0 || totalSpending <= 0) {
    const updatedPublicGoods: Omit<PublicGoodsState, 'id' | 'sessionId'> = {
      iterationNumber,
      infrastructureQuality: updatePublicGoodsQuality({
        currentQuality: currentPublicGoods.infrastructureQuality,
        spendAmount: 0,
        decayRate,
        diminishingExponent,
      }),
      educationQuality: updatePublicGoodsQuality({
        currentQuality: currentPublicGoods.educationQuality,
        spendAmount: 0,
        decayRate,
        diminishingExponent,
      }),
      defenseQuality: updatePublicGoodsQuality({
        currentQuality: currentPublicGoods.defenseQuality,
        spendAmount: 0,
        decayRate,
        diminishingExponent,
      }),
      welfareQuality: updatePublicGoodsQuality({
        currentQuality: currentPublicGoods.welfareQuality,
        spendAmount: 0,
        decayRate,
        diminishingExponent,
      }),
    };

    trace.push(`[Fiscal] Treasury empty (${treasuryBalance.toFixed(2)}) — all public goods decaying`);

    const multiplierEffects = getMultiplierEffects({
      publicGoods: updatedPublicGoods,
      economyConfig,
      welfarePerAgent: 0,
    });

    return {
      treasuryDelta: 0,
      agentPayments,
      updatedPublicGoods,
      multiplierEffects,
      trace,
    };
  }

  // ── Step 3: Allocate spending per category ────────────────────────────────
  const infraSpend = totalSpending * budgetAllocation.infrastructure;
  const educSpend = totalSpending * budgetAllocation.education;
  const defSpend = totalSpending * budgetAllocation.defense;
  const welfareSpend = totalSpending * budgetAllocation.welfare;

  trace.push(
    `[Fiscal] Iteration ${iterationNumber}: treasury ${treasuryBalance.toFixed(2)}, spending ${totalSpending.toFixed(2)} ` +
    `(infra=${infraSpend.toFixed(2)}, edu=${educSpend.toFixed(2)}, def=${defSpend.toFixed(2)}, welfare=${welfareSpend.toFixed(2)})`
  );

  // ── Step 4: Update quality scores ────────────────────────────────────────
  const infrastructureQuality = updatePublicGoodsQuality({
    currentQuality: currentPublicGoods.infrastructureQuality,
    spendAmount: infraSpend,
    decayRate,
    diminishingExponent,
  });

  const educationQuality = updatePublicGoodsQuality({
    currentQuality: currentPublicGoods.educationQuality,
    spendAmount: educSpend,
    decayRate,
    diminishingExponent,
  });

  const defenseQuality = updatePublicGoodsQuality({
    currentQuality: currentPublicGoods.defenseQuality,
    spendAmount: defSpend,
    decayRate,
    diminishingExponent,
  });

  const welfareQuality = updatePublicGoodsQuality({
    currentQuality: currentPublicGoods.welfareQuality,
    spendAmount: welfareSpend,
    decayRate,
    diminishingExponent,
  });

  if (infraSpend > 0) {
    trace.push(
      `[Fiscal] Infrastructure: spent ${infraSpend.toFixed(2)} → quality ${currentPublicGoods.infrastructureQuality.toFixed(1)} → ${infrastructureQuality.toFixed(1)}`
    );
  } else {
    trace.push(`[Fiscal] Infrastructure: no spending → quality decays to ${infrastructureQuality.toFixed(1)}`);
  }

  if (educSpend > 0) {
    trace.push(
      `[Fiscal] Education: spent ${educSpend.toFixed(2)} → quality ${currentPublicGoods.educationQuality.toFixed(1)} → ${educationQuality.toFixed(1)}`
    );
  } else {
    trace.push(`[Fiscal] Education: no spending → quality decays to ${educationQuality.toFixed(1)}`);
  }

  if (defSpend > 0) {
    trace.push(
      `[Fiscal] Defense: spent ${defSpend.toFixed(2)} → quality ${currentPublicGoods.defenseQuality.toFixed(1)} → ${defenseQuality.toFixed(1)}`
    );
  } else {
    trace.push(`[Fiscal] Defense: no spending → quality decays to ${defenseQuality.toFixed(1)}`);
  }

  const updatedPublicGoods: Omit<PublicGoodsState, 'id' | 'sessionId'> = {
    iterationNumber,
    infrastructureQuality,
    educationQuality,
    defenseQuality,
    welfareQuality,
  };

  // ── Step 5: Distribute ALL spending equally to alive agents (SFC) ────────
  // Government spending in this model simulates employment and transfers:
  // all budget categories distribute fiat to agents rather than destroying money.
  const agentCount = aliveAgentIds.length;

  let welfarePerAgent = 0;

  if (agentCount > 0) {
    const paymentPerAgent = totalSpending / agentCount;
    welfarePerAgent = welfareSpend / agentCount;

    for (const agentId of aliveAgentIds) {
      agentPayments.set(agentId, paymentPerAgent);
    }

    trace.push(
      `[Fiscal] Distributed ${totalSpending.toFixed(2)} fiat to ${agentCount} agents ` +
      `(${paymentPerAgent.toFixed(2)} each); welfare portion ${welfarePerAgent.toFixed(4)}/agent`
    );
  } else {
    // No alive agents — spending is still removed from treasury (government overhead),
    // but no agent payments are made. This maintains SFC: the money is consumed.
    // In the empty-agent case we still deduct from treasury but no payments go out.
    // This is an edge case (society extinct) — trace it clearly.
    trace.push(`[Fiscal] No alive agents — treasury spent ${totalSpending.toFixed(2)} with no recipients`);
  }

  // ── Step 6: Compute multiplier effects from updated quality scores ────────
  const multiplierEffects = getMultiplierEffects({
    publicGoods: updatedPublicGoods,
    economyConfig,
    welfarePerAgent,
  });

  trace.push(
    `[Fiscal] Multipliers: productivity+${multiplierEffects.productivityBonus.toFixed(4)}, ` +
    `skillGain+${multiplierEffects.skillGainBonus.toFixed(4)}, ` +
    `enforcement+${multiplierEffects.enforcementBonus.toFixed(4)}`
  );

  // ── Step 7: Compute treasury delta ────────────────────────────────────────
  // SFC check: treasuryDelta + sum(agentPayments) must equal 0 (when agents exist)
  const treasuryDelta = -totalSpending;

  return {
    treasuryDelta,
    agentPayments,
    updatedPublicGoods,
    multiplierEffects,
    trace,
  };
}
