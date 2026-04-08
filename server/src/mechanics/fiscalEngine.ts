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
  /** Per-category spending amounts for telemetry */
  categorySpending: { infrastructure: number; education: number; defense: number; welfare: number };
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

// Target spending-to-GDP ratio for full quality gain effect (10% of GDP per category).
// At this ratio, quality gain reaches maximum per iteration.
const TARGET_SPENDING_RATIO = 0.10;

// GDP-scaled gain: max achievable quality gain per iteration when spending ratio >= target.
// At 100% effect (spendingRatio >= target), gain is 75 quality points per iteration
// (before diminishing returns). With quality clamp at 100, achieving max quality
// requires sustained significant spending over multiple iterations.
const GDP_SCALED_MAX_GAIN_PER_ITER = 75;

/**
 * Update a single quality score given spending and config.
 *
 * Two formulas:
 * - Legacy (gdpScaling off): gain = (spendAmount ^ diminishingExponent) * SCALE_FACTOR
 * - GDP-scaled (gdpScaling on): effectiveGain = GDP_SCALED_MAX_GAIN * min(1, spendingRatio / targetRatio)
 *   then diminishing returns: qualityDelta = effectiveGain ^ diminishingExponent
 *
 * If spendAmount <= 0, apply decay instead.
 * Result is clamped to [0, 100].
 */
export function updatePublicGoodsQuality(params: {
  currentQuality: number;
  spendAmount: number;
  decayRate: number;
  diminishingExponent: number;
  gdpScaling?: boolean;
  totalEconomyFiat?: number;
}): number {
  const { currentQuality, spendAmount, decayRate, diminishingExponent, gdpScaling, totalEconomyFiat } = params;

  let newQuality: number;
  if (spendAmount > 0) {
    if (gdpScaling && totalEconomyFiat && totalEconomyFiat > 0) {
      // GDP-scaled formula: quality proportional to spending commitment relative to economy size.
      // ratioEffect goes from 0 (no spending) to 1.0 (spending >= targetRatio of GDP).
      // Diminishing returns applied to ratioEffect so marginal gains decrease.
      const spendingRatio = spendAmount / totalEconomyFiat;
      const ratioEffect = Math.min(1.0, spendingRatio / TARGET_SPENDING_RATIO);
      const diminishedEffect = Math.pow(ratioEffect, diminishingExponent);
      const gain = GDP_SCALED_MAX_GAIN_PER_ITER * diminishedEffect;
      newQuality = currentQuality + gain;
    } else {
      // Legacy formula: absolute spending drives quality
      const gain = Math.pow(spendAmount, diminishingExponent) * QUALITY_GAIN_SCALE_FACTOR;
      newQuality = currentQuality + gain;
    }
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

/**
 * Convenience: rebuild multiplier effects from quality scores alone (for resume/restore).
 * Uses welfarePerAgent=0 since we don't have the spending context from a prior iteration.
 */
export function getMultiplierEffectsFromQuality(
  quality: { infrastructureQuality: number; educationQuality: number; defenseQuality: number; welfareQuality: number },
  economyConfig: EconomyConfig,
): MultiplierEffects {
  return getMultiplierEffects({
    publicGoods: { iterationNumber: 0, ...quality },
    economyConfig,
    welfarePerAgent: 0,
  });
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
 * @param totalEconomyFiat - Total economy fiat (GDP proxy) for spending-to-GDP scaling
 */
export function executeBudget(params: {
  treasuryBalance: number;
  budgetAllocation: BudgetAllocation;
  economyConfig: EconomyConfig;
  currentPublicGoods: Omit<PublicGoodsState, 'id' | 'sessionId'>;
  aliveAgentIds: string[];
  iterationNumber: number;
  totalEconomyFiat?: number;
}): FiscalDelta {
  const {
    treasuryBalance,
    budgetAllocation,
    economyConfig,
    currentPublicGoods,
    aliveAgentIds,
    iterationNumber,
    totalEconomyFiat,
  } = params;

  const spendingRate = economyConfig.budgetSpendingRate ?? 0.10;
  const decayRate = economyConfig.publicGoodsDecayRate ?? 0.5;
  const diminishingExponent = economyConfig.publicGoodsGainDiminishing ?? 0.7;
  const gdpScaling = economyConfig.publicGoodsSpendingToGdpScaling ?? false;

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
        gdpScaling,
        totalEconomyFiat,
      }),
      educationQuality: updatePublicGoodsQuality({
        currentQuality: currentPublicGoods.educationQuality,
        spendAmount: 0,
        decayRate,
        diminishingExponent,
        gdpScaling,
        totalEconomyFiat,
      }),
      defenseQuality: updatePublicGoodsQuality({
        currentQuality: currentPublicGoods.defenseQuality,
        spendAmount: 0,
        decayRate,
        diminishingExponent,
        gdpScaling,
        totalEconomyFiat,
      }),
      welfareQuality: updatePublicGoodsQuality({
        currentQuality: currentPublicGoods.welfareQuality,
        spendAmount: 0,
        decayRate,
        diminishingExponent,
        gdpScaling,
        totalEconomyFiat,
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
      categorySpending: { infrastructure: 0, education: 0, defense: 0, welfare: 0 },
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
    gdpScaling,
    totalEconomyFiat,
  });

  const educationQuality = updatePublicGoodsQuality({
    currentQuality: currentPublicGoods.educationQuality,
    spendAmount: educSpend,
    decayRate,
    diminishingExponent,
    gdpScaling,
    totalEconomyFiat,
  });

  const defenseQuality = updatePublicGoodsQuality({
    currentQuality: currentPublicGoods.defenseQuality,
    spendAmount: defSpend,
    decayRate,
    diminishingExponent,
    gdpScaling,
    totalEconomyFiat,
  });

  const welfareQuality = updatePublicGoodsQuality({
    currentQuality: currentPublicGoods.welfareQuality,
    spendAmount: welfareSpend,
    decayRate,
    diminishingExponent,
    gdpScaling,
    totalEconomyFiat,
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
    // No alive agents — do NOT spend treasury (SFC: money cannot be destroyed).
    // Quality scores still decay, but treasury balance is preserved.
    totalSpending = 0;
    trace.push(`[Fiscal] No alive agents — treasury preserved (no spending without recipients)`);
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
  const treasuryDelta = totalSpending === 0 ? 0 : -totalSpending;

  return {
    treasuryDelta,
    agentPayments,
    updatedPublicGoods,
    multiplierEffects,
    categorySpending: {
      infrastructure: infraSpend,
      education: educSpend,
      defense: defSpend,
      welfare: welfareSpend,
    },
    trace,
  };
}
