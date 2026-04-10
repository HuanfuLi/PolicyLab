/**
 * financialPhase.ts — banking, capital markets, fiscal policy, and inflation ticks.
 *
 * Extracted verbatim from simulationRunner.ts sections 16-20.
 * Covers lines ~2885-3291 of the original runner.
 *
 * Runs after all agent action resolutions so agent wealth is fully settled
 * before interest accrual, default checks, equity dividends, and CPI computation.
 */
import { db, sqlite } from '../../db/index.js';
import { sessionRepo } from '../../db/repos/sessionRepo.js';
import * as bankingEngine from '../../mechanics/bankingEngine.js';
import * as bankingRepo from '../../db/repos/bankingRepo.js';
import { getEconomyConfig } from '../../mechanics/economyConfigUtils.js';
import * as capitalMarketEngine from '../../mechanics/capitalMarketEngine.js';
import * as capitalMarketRepo from '../../db/repos/capitalMarketRepo.js';
import * as fiscalEngine from '../../mechanics/fiscalEngine.js';
import * as fiscalRepo from '../../db/repos/fiscalRepo.js';
import { DEFAULT_BUDGET_ALLOCATION, DEFAULT_PUBLIC_GOODS_INITIAL, DEFAULT_ECONOMY_CONFIG } from '@policylab/shared';
import { computeInflation } from '../../mechanics/inflationEngine.js';
import * as macroSnapshotRepo from '../../db/repos/macroSnapshotRepo.js';
import type { Agent, EconomyConfig, TelemetryLog, ItemType, PriceIndex } from '@policylab/shared';
import type { AgentIntent } from '../../llm/prompts.js';
import {
  sessionAMMRegistry,
  sessionMultiAMMRegistry,
  sessionStateTreasury,
  sessionLastPhysicsTraces,
  sessionFiscalMultipliers,
  sessionInflationState,
  sessionPriceHistory,
} from '../simulationState.js';
import type { AutomatedMarketMaker } from '../../mechanics/automatedMarketMaker.js';
import type { MultiAMMItemType } from '../../mechanics/automatedMarketMaker.js';

// ── Types ─────────────────────────────────────────────────────────────────────

type StatUpdate = { id: string; wealth: number; health: number; happiness: number; cortisol: number; dopamine: number };

export interface FinancialPhaseContext {
  sessionId: string;
  iterNum: number;
  agents: Agent[];
  aliveAgents: Agent[];
  intents: AgentIntent[];
  /** Mutated in-place: banking/capital/fiscal wealth deltas are applied here. */
  statUpdates: StatUpdate[];
  economyConfig: EconomyConfig;
  session: { config: unknown };
  /** Current market state (price indices), used for inflation basket pricing. */
  marketPriceIndices: PriceIndex[];
}

export interface FinancialPhaseResult {
  bankingTotalDeposits: number;
  bankingCollateralEscrow: number;
  bankingLoansOutstanding: number;
  inflationTelemetry: Pick<TelemetryLog, 'cpi' | 'inflationRate' | 'inflationExpectations'> | null;
  fiscalPublicGoodsQuality: Record<string, number> | null;
}

// ── Helpers (verbatim from simulationRunner.ts) ───────────────────────────────

/** SFC-safe computation of total fiat in the closed-loop economy. */
function computeSystemFiatTotal(
  agents: Agent[],
  primaryAMM: AutomatedMarketMaker | undefined,
  multiAMMs: Map<MultiAMMItemType, AutomatedMarketMaker> | undefined,
  treasury: number,
  wealthOverrides?: Map<string, number>,
  depositBalances: number = 0,
  collateralEscrow: number = 0,
): number {
  const agentFiat = agents
    .filter(agent => agent.isAlive)
    .reduce((sum, agent) => sum + (wealthOverrides?.get(agent.id) ?? agent.currentStats.wealth), 0);
  const multiAMMFiat = multiAMMs
    ? [...multiAMMs.values()].reduce((sum, pool) => sum + pool.currentFiatReserve, 0)
    : 0;
  return agentFiat
    + (primaryAMM?.currentFiatReserve ?? 0)
    + multiAMMFiat
    + treasury
    + depositBalances
    + collateralEscrow;
}

function applyInflationFeedback(pool: AutomatedMarketMaker, factor: number): void {
  if (Math.abs(factor - 1) <= 0.001) return;

  if (factor > 1) {
    const withdrawal = pool.currentFoodReserve * (1 - 1 / factor);
    pool.withdrawGoodsReserve(withdrawal);
    return;
  }

  const injection = pool.currentFoodReserve * ((1 / factor) - 1);
  pool.injectGoodsReserve(injection);
}

function getInflationBasketPrices(
  sessionId: string,
  economyConfig: ReturnType<typeof getEconomyConfig>,
  priceIndices: PriceIndex[] = [],
): Record<string, number> {
  const iterationPrices = new Map<ItemType, number>();
  for (const idx of priceIndices) {
    iterationPrices.set(idx.itemType, idx.volume > 0 ? idx.vwap : idx.lastPrice);
  }
  const priceHistory = sessionPriceHistory.get(sessionId);
  const basePrices = economyConfig.cpiBasePrices ?? {};
  return {
    food: iterationPrices.get('food') ?? priceHistory?.get('food') ?? basePrices.food ?? 1,
    tools: iterationPrices.get('tools') ?? priceHistory?.get('tools') ?? basePrices.tools ?? 1,
    luxury_goods: iterationPrices.get('luxury_goods') ?? priceHistory?.get('luxury_goods') ?? basePrices.luxury_goods ?? 1,
    raw_materials: iterationPrices.get('raw_materials') ?? priceHistory?.get('raw_materials') ?? basePrices.raw_materials ?? 1,
  };
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Run the full financial subsystem for one iteration.
 *
 * Mutates `ctx.statUpdates` in-place with wealth deltas from banking interest,
 * capital market dividends/coupons, fiscal welfare, and inflation feedback.
 */
export async function runFinancialPhase(ctx: FinancialPhaseContext): Promise<FinancialPhaseResult> {
  const { sessionId, iterNum, agents, aliveAgents, intents, statUpdates, session } = ctx;

  // ── Capital market request accumulation ────────────────────────────────────
  // Gather pending capital market requests from intents before the capital market tick.
  // Mirrors the ADJUST_TAX / EMBEZZLE pattern: scan all intents for the relevant action codes.
  const cmktPendingSharePurchases: Array<{
    buyerId: string;
    enterpriseOwnerId: string;
    sharesToBuy: number;
    totalSharesOutstanding: number;
  }> = [];
  const cmktPendingShareSales: Array<{
    sellerId: string;
    buyerId: string;
    enterpriseOwnerId: string;
    sharesToSell: number;
    totalSharesOutstanding: number;
  }> = [];
  const cmktPendingGovBondPurchases: Array<{
    buyerId: string;
    faceValue: number;
  }> = [];
  const cmktPendingCorpBondIssuances: Array<{
    buyerId: string;
    enterpriseOwnerId: string;
    faceValue: number;
    couponRate: number;
    maturityIteration: number;
  }> = [];

  const cmktEconomyConfig = getEconomyConfig(session.config as Record<string, unknown> | null);
  if (cmktEconomyConfig.capitalMarketsEnabled) {
    // Load equity positions to compute totalSharesOutstanding per enterprise
    const allEquityPositions = capitalMarketRepo.getEquityPositionsBySession(sessionId);
    const sharesByEnterprise = new Map<string, number>();
    for (const pos of allEquityPositions) {
      const prev = sharesByEnterprise.get(pos.enterpriseOwnerId) ?? 0;
      sharesByEnterprise.set(pos.enterpriseOwnerId, prev + pos.sharesHeld);
    }

    for (const intent of intents) {
      if (!intent.actions) continue;
      for (const action of intent.actions) {
        const rawTarget = action.parameters?.target ?? action.parameters?.agent_id ?? '';
        const targetText = typeof rawTarget === 'string' ? rawTarget.toLowerCase() : '';

        if (action.actionCode === 'BUY_SHARES') {
          // Find enterprise owner by name or ID
          const enterpriseOwner = aliveAgents.find(
            a => a.id === rawTarget || a.name.toLowerCase() === targetText,
          );
          if (!enterpriseOwner) continue;
          const sharesToBuy = typeof action.parameters?.quantity === 'number' ? action.parameters.quantity : 10;
          const totalShares = sharesByEnterprise.get(enterpriseOwner.id) ?? 0;
          cmktPendingSharePurchases.push({
            buyerId: intent.agentId,
            enterpriseOwnerId: enterpriseOwner.id,
            sharesToBuy,
            totalSharesOutstanding: totalShares,
          });
        } else if (action.actionCode === 'SELL_SHARES') {
          // Seller sells to any willing buyer (we pick the first available non-owner agent)
          const enterpriseOwner = aliveAgents.find(
            a => a.id === rawTarget || a.name.toLowerCase() === targetText,
          );
          if (!enterpriseOwner) continue;
          const sharesToSell = typeof action.parameters?.quantity === 'number' ? action.parameters.quantity : 10;
          const totalShares = sharesByEnterprise.get(enterpriseOwner.id) ?? 0;
          // Buy side: pick the first alive agent that is not the seller and not the enterprise owner
          const potentialBuyer = aliveAgents.find(
            a => a.id !== intent.agentId && a.id !== enterpriseOwner.id,
          );
          if (!potentialBuyer) continue;
          cmktPendingShareSales.push({
            sellerId: intent.agentId,
            buyerId: potentialBuyer.id,
            enterpriseOwnerId: enterpriseOwner.id,
            sharesToSell,
            totalSharesOutstanding: totalShares,
          });
        } else if (action.actionCode === 'BUY_BOND') {
          // target is 'treasury' for gov bonds or enterprise owner name/id for corp bonds
          const faceValue = typeof action.parameters?.amount === 'number' ? action.parameters.amount : 50;
          if (targetText === 'treasury' || !targetText) {
            cmktPendingGovBondPurchases.push({
              buyerId: intent.agentId,
              faceValue,
            });
          } else {
            // Corporate bond: target is enterprise owner
            const enterpriseOwner = aliveAgents.find(
              a => a.id === rawTarget || a.name.toLowerCase() === targetText,
            );
            if (!enterpriseOwner) continue;
            const couponRate = cmktEconomyConfig.govBondCouponRate ?? 0.01;
            const maturityIter = iterNum + (cmktEconomyConfig.govBondTermIterations ?? 10);
            cmktPendingCorpBondIssuances.push({
              buyerId: intent.agentId,
              enterpriseOwnerId: enterpriseOwner.id,
              faceValue,
              couponRate,
              maturityIteration: maturityIter,
            });
          }
        } else if (action.actionCode === 'ISSUE_GOV_BOND') {
          // Elite only (already gated by action codes): issuer is the agent themselves
          // The face value is in the target parameter
          const faceValue = typeof action.parameters?.amount === 'number'
            ? action.parameters.amount
            : (typeof rawTarget === 'string' && !isNaN(Number(rawTarget)) ? Number(rawTarget) : 100);
          cmktPendingGovBondPurchases.push({
            buyerId: intent.agentId,
            faceValue,
          });
        }
      }
    }
  }

  // ── Banking tick ──────────────────────────────────────────────────────
  // Runs after all agent action resolutions so agent wealth is settled before
  // interest accrual and default checks. All banking DB writes are batched here.
  const economyConfig = getEconomyConfig(session.config as Record<string, unknown> | null);
  let bankingTotalDeposits = 0;
  let bankingCollateralEscrow = 0;
  let bankingLoansOutstanding = 0;
  let inflationTelemetry: Pick<TelemetryLog, 'cpi' | 'inflationRate' | 'inflationExpectations'> | null = null;

  if (economyConfig.bankingEnabled) {
    const bankAgents = agents.filter(a => a.type === 'bank' && a.isAlive);
    const loans = bankingRepo.getActiveLoans(sessionId);
    const deposits = bankingRepo.getDepositsBySession(sessionId);

    const bankingDelta = bankingEngine.processIteration({
      sessionId,
      bankAgents,
      allAgents: agents,
      loans,
      deposits,
      economyConfig,
      iterationNumber: iterNum,
    });

    // Apply all banking DB writes in a single synchronous transaction to avoid
    // SQLITE_BUSY and ensure atomicity. Banking runs once per iteration (not per-agent)
    // so the write volume is small and a direct transaction is safe here.
    sqlite.transaction(() => {
      for (const upd of bankingDelta.depositUpdates) {
        bankingRepo.updateDepositBalance(upd.accountId, upd.newBalance, upd.iteration);
      }
      for (const upd of bankingDelta.loanUpdates) {
        bankingRepo.updateLoan(upd.loanId, upd.updates);
      }
      for (const loan of bankingDelta.newLoans) {
        bankingRepo.insertLoan(loan);
      }
      for (const dep of bankingDelta.newDeposits) {
        bankingRepo.upsertDeposit(dep);
      }
      for (const sheet of bankingDelta.balanceSheetSnapshots) {
        bankingRepo.insertBalanceSheet(sheet);
      }
    })();
    // Apply wealth deltas (interest income, collateral seizure) — in-memory only,
    // will be persisted with the rest of statUpdates below.
    for (const [agentId, delta] of bankingDelta.wealthDeltas) {
      const agentUpdate = statUpdates.find(u => u.id === agentId);
      if (agentUpdate) agentUpdate.wealth += delta;
    }
    // Append banking traces to physics trace log
    if (bankingDelta.trace.length > 0) {
      const existingTrace = sessionLastPhysicsTraces.get(sessionId) ?? '';
      sessionLastPhysicsTraces.set(sessionId,
        existingTrace + '\n' + bankingDelta.trace.join('\n'));
    }

    // Get banking totals for SFC audit and telemetry
    bankingTotalDeposits = bankingRepo.getTotalDeposits(sessionId);
    bankingCollateralEscrow = bankingRepo.getTotalCollateral(sessionId);
    bankingLoansOutstanding = bankingRepo.getTotalLoansOutstanding(sessionId);
  }

  // ── Capital market tick ───────────────────────────────────────────────
  // Runs immediately after banking tick so agent wealth (post-banking) is current.
  // All capital market DB writes are batched in a single transaction.
  // SFC: bond/equity transactions are SFC-neutral transfers within the perimeter —
  // no escrow term needed; computeSystemFiatTotal is unchanged.
  if (cmktEconomyConfig.capitalMarketsEnabled) {
    const equityPositions = capitalMarketRepo.getEquityPositionsBySession(sessionId);
    const bondHoldings = capitalMarketRepo.getActiveBondHoldingsBySession(sessionId);

    // Build agent snapshots with current running wealth (post-banking deltas applied)
    const agentsWithRunningWealth = aliveAgents.map(a => {
      const upd = statUpdates.find(u => u.id === a.id);
      return upd
        ? { ...a, currentStats: { ...a.currentStats, wealth: upd.wealth } }
        : a;
    });

    const cmktDelta = capitalMarketEngine.processIteration({
      sessionId,
      allAgents: agentsWithRunningWealth,
      equityPositions,
      bondHoldings,
      economyConfig: cmktEconomyConfig,
      iterationNumber: iterNum,
      pendingSharePurchases: cmktPendingSharePurchases,
      pendingShareSales: cmktPendingShareSales,
      pendingGovBondPurchases: cmktPendingGovBondPurchases,
      pendingCorpBondIssuances: cmktPendingCorpBondIssuances,
    });

    // Apply all capital market DB writes in a single synchronous transaction
    // (once-per-iteration frequency — same rationale as banking tick)
    sqlite.transaction(() => {
      for (const pos of cmktDelta.upsertEquityPositions) {
        capitalMarketRepo.upsertEquityPosition(pos);
      }
      for (const holding of cmktDelta.upsertBondHoldings) {
        capitalMarketRepo.upsertBondHolding(holding);
      }
      for (const id of cmktDelta.deleteBondHoldingIds) {
        capitalMarketRepo.deleteBondHolding(id);
      }
    })();

    // Apply wealth deltas in-memory (will be persisted with the rest of statUpdates)
    for (const [agentId, delta] of cmktDelta.wealthDeltas) {
      const agentUpdate = statUpdates.find(u => u.id === agentId);
      if (agentUpdate) agentUpdate.wealth += delta;
    }

    // Apply enterprise treasury deltas: corporate bond coupon/maturity payments come from
    // enterprise owner agent wealth. Route through statUpdates so they persist with agents.
    for (const [enterpriseOwnerId, delta] of cmktDelta.enterpriseTreasuryDeltas) {
      const agentUpdate = statUpdates.find(u => u.id === enterpriseOwnerId);
      if (agentUpdate) agentUpdate.wealth += delta;
    }

    // Apply treasury delta (gov bond purchases, gov coupon/maturity payments)
    sessionStateTreasury.set(
      sessionId,
      (sessionStateTreasury.get(sessionId) ?? 0) + cmktDelta.treasuryDelta,
    );

    // Append capital market traces to physics trace log
    if (cmktDelta.trace.length > 0) {
      const existingTrace = sessionLastPhysicsTraces.get(sessionId) ?? '';
      sessionLastPhysicsTraces.set(sessionId,
        existingTrace + '\n' + cmktDelta.trace.join('\n'));
    }
  }

  // ── Fiscal policy tick ──────────────────────────────────────────────────
  // Runs after capital market tick. Executes budget spending from treasury,
  // updates public goods quality, applies welfare payments to agents.
  // SFC: all spending flows from treasury to agents (direct transfers).
  let fiscalPublicGoodsQuality: { infrastructureQuality: number; educationQuality: number; defenseQuality: number; welfareQuality: number } | null = null;
  if (economyConfig.fiscalEnabled) {
    const budgetAllocation = fiscalRepo.getActiveBudget(sessionId) ?? DEFAULT_BUDGET_ALLOCATION;
    const currentPublicGoods = fiscalRepo.getPublicGoodsState(sessionId);
    const treasuryBalance = sessionStateTreasury.get(sessionId) ?? 0;

    const fiscalDelta = fiscalEngine.executeBudget({
      treasuryBalance,
      budgetAllocation,
      economyConfig,
      currentPublicGoods: currentPublicGoods
        ? {
            iterationNumber: currentPublicGoods.iterationNumber,
            infrastructureQuality: currentPublicGoods.infrastructureQuality,
            educationQuality: currentPublicGoods.educationQuality,
            defenseQuality: currentPublicGoods.defenseQuality,
            welfareQuality: currentPublicGoods.welfareQuality,
          }
        : { iterationNumber: 0, ...DEFAULT_PUBLIC_GOODS_INITIAL },
      aliveAgentIds: aliveAgents.map(a => a.id),
      iterationNumber: iterNum,
    });

    // Lift quality scores to outer scope for iterTelemetry population
    fiscalPublicGoodsQuality = fiscalDelta.updatedPublicGoods;

    // Apply treasury delta (spending removed from treasury)
    sessionStateTreasury.set(sessionId, treasuryBalance + fiscalDelta.treasuryDelta);

    // Apply agent welfare/spending payments to statUpdates (in-memory, persisted below)
    for (const [agentId, payment] of fiscalDelta.agentPayments) {
      const agentUpdate = statUpdates.find(u => u.id === agentId);
      if (agentUpdate) agentUpdate.wealth += payment;
    }

    // Persist public goods state for this iteration
    sqlite.transaction(() => {
      fiscalRepo.upsertPublicGoodsState({
        id: `${sessionId}-${iterNum}`,
        sessionId,
        ...fiscalDelta.updatedPublicGoods,
      });
    })();

    // Store multiplier effects for the NEXT iteration's physics calls (1-iteration lag).
    // Public goods effects are realistic with a lag: investment this week affects
    // productivity next week as infrastructure improvements take time to materialize.
    sessionFiscalMultipliers.set(sessionId, fiscalDelta.multiplierEffects);

    // Append fiscal traces to physics trace log
    if (fiscalDelta.trace.length > 0) {
      const existingTrace = sessionLastPhysicsTraces.get(sessionId) ?? '';
      sessionLastPhysicsTraces.set(sessionId,
        existingTrace + '\n' + fiscalDelta.trace.join('\n'));
    }
  }

  // ── Inflation tick ────────────────────────────────────────────────────
  // Runs after banking/capital/fiscal effects are known so CPI, M1, and treasury
  // all reflect the end-of-iteration macro state before telemetry is recorded.
  if (economyConfig.inflationEnabled) {
    const configRoot = (session.config as Record<string, unknown> | null) ?? {};
    const persistedEconomyConfig = getEconomyConfig(configRoot);
    const currentPrices = getInflationBasketPrices(sessionId, persistedEconomyConfig, ctx.marketPriceIndices);
    const hasBasePrices = Object.keys(persistedEconomyConfig.cpiBasePrices ?? {}).length > 0;

    if (!hasBasePrices) {
      persistedEconomyConfig.cpiBasePrices = { ...currentPrices };
      session.config = {
        ...configRoot,
        economyConfig: {
          ...((configRoot.economyConfig as Record<string, unknown> | undefined) ?? {}),
          ...persistedEconomyConfig,
        },
      };
      await sessionRepo.updateConfig(sessionId, session.config as Record<string, unknown>);
    }

    const finalWealthByAgentId = new Map(statUpdates.map(update => [update.id, update.wealth]));
    const treasuryBalance = sessionStateTreasury.get(sessionId) ?? 0;
    const currentM0 = computeSystemFiatTotal(
      agents,
      sessionAMMRegistry.get(sessionId),
      sessionMultiAMMRegistry.get(sessionId),
      treasuryBalance,
      finalWealthByAgentId,
      bankingTotalDeposits,
      bankingCollateralEscrow,
    );
    const latestSnapshot = macroSnapshotRepo.getLatestSnapshot(db, sessionId);
    const smoothingWindow = persistedEconomyConfig.inflationSmoothingWindow ?? DEFAULT_ECONOMY_CONFIG.inflationSmoothingWindow ?? 3;
    const recentSnapshots = macroSnapshotRepo.getRecentSnapshots(db, sessionId, smoothingWindow);
    const inflationOutput = computeInflation({
      iterationNumber: iterNum,
      currentPrices,
      basePrices: persistedEconomyConfig.cpiBasePrices ?? currentPrices,
      m1Current: currentM0 + bankingLoansOutstanding,
      m1Previous: latestSnapshot?.m1 ?? null,
      previousCpi: latestSnapshot?.cpi ?? null,
      recentCpiHistory: recentSnapshots.map(snapshot => snapshot.cpi).reverse(),
      economyConfig: persistedEconomyConfig,
    });

    macroSnapshotRepo.insertMacroSnapshot(db, {
      sessionId,
      iterationNumber: iterNum,
      m0: currentM0,
      m1: currentM0 + bankingLoansOutstanding,
      cpi: inflationOutput.cpi,
      inflationRate: inflationOutput.inflationRate,
      inflationExpectations: inflationOutput.inflationExpectations,
      totalLoansOutstanding: bankingLoansOutstanding,
      treasuryBalance,
    });

    sessionInflationState.set(sessionId, {
      cpi: inflationOutput.cpi,
      inflationRate: inflationOutput.inflationRate,
      inflationExpectations: inflationOutput.inflationExpectations,
    });
    inflationTelemetry = {
      cpi: inflationOutput.cpi,
      inflationRate: inflationOutput.inflationRate,
      inflationExpectations: inflationOutput.inflationExpectations,
    };

    if (Math.abs(inflationOutput.ammFeedbackFactor - 1) > 0.001) {
      const primaryAMM = sessionAMMRegistry.get(sessionId);
      if (primaryAMM) {
        applyInflationFeedback(primaryAMM, inflationOutput.ammFeedbackFactor);
      }
      const secondaryAMMs = sessionMultiAMMRegistry.get(sessionId);
      if (secondaryAMMs) {
        for (const pool of secondaryAMMs.values()) {
          applyInflationFeedback(pool, inflationOutput.ammFeedbackFactor);
        }
      }
      const existingTrace = sessionLastPhysicsTraces.get(sessionId) ?? '';
      sessionLastPhysicsTraces.set(
        sessionId,
        existingTrace + '\n' + `AMM feedback: scaled goods reserves for price factor ${inflationOutput.ammFeedbackFactor.toFixed(4)}`,
      );
    }

    if (inflationOutput.trace.length > 0) {
      const existingTrace = sessionLastPhysicsTraces.get(sessionId) ?? '';
      sessionLastPhysicsTraces.set(
        sessionId,
        existingTrace + '\n' + inflationOutput.trace.join('\n'),
      );
    }
  }

  return {
    bankingTotalDeposits,
    bankingCollateralEscrow,
    bankingLoansOutstanding,
    inflationTelemetry,
    fiscalPublicGoodsQuality,
  };
}
