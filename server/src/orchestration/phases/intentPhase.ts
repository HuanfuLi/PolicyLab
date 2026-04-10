/**
 * intentPhase.ts — Cognitive pre-processing + parallel intent collection (Phase 5 extraction).
 *
 * Covers:
 *   1. Cognitive pre-processing (memories, reflections, planning)
 *   2. Market intelligence block building (shared across all agents)
 *   3. Per-iteration context pre-computation (banking/capital/fiscal/inflation)
 *   4. Parallel LLM intent collection with action validation
 *   5. Sheriff A legality detection (standard path only)
 *   6. Intent row building for async log flusher
 *
 * Extracted verbatim from simulationRunner.ts lines ~1416–1816.
 * No logic changes — pure extraction.
 */

import { v4 as uuidv4 } from 'uuid';
import {
  buildNaturalIntentPrompt,
  buildLegalityCheckPrompt,
  type AgentIntent,
  type MarketBoardEntry,
  type EmploymentBoardEntry,
} from '../../llm/prompts.js';
import { parseSinglePassIntent } from '../../parsers/simulation.js';
import { retryWithHealing } from '../../llm/retryWithHealing.js';
import { runWithConcurrency } from '../concurrencyPool.js';
import { simulationManager } from '../simulationManager.js';
import { SimulationPausedError } from '../simulationRunner.js';
import {
  runCognitivePreProcessing,
  type CognitivePreInput,
} from '../../cognition/cognitiveEngine.js';
import { type ActionCode, getAllowedActions } from '../../mechanics/actionCodes.js';
import * as bankingRepo from '../../db/repos/bankingRepo.js';
import * as capitalMarketRepo from '../../db/repos/capitalMarketRepo.js';
import * as fiscalRepo from '../../db/repos/fiscalRepo.js';
import * as macroSnapshotRepo from '../../db/repos/macroSnapshotRepo.js';
import { getEconomyConfig } from '../../mechanics/economyConfigUtils.js';
import { db } from '../../db/index.js';
import type { LLMProvider } from '../../llm/types.js';
import type {
  Agent,
  AppSettings,
  ItemType,
  SkillMatrix,
} from '@policylab/shared';
import { DEFAULT_ECONOMY_CONFIG, DEFAULT_BUDGET_ALLOCATION } from '@policylab/shared';
import type { AgentEconomyState } from '../../db/repos/economyRepo.js';
import type { AutomatedMarketMaker, MultiAMMItemType } from '../../mechanics/automatedMarketMaker.js';
import type {
  CitizenBankingContext,
  BankOperationsContext,
  CitizenCapitalMarketContext,
  CitizenFiscalContext,
  PersonalStatusBoard,
} from '../../llm/prompts.js';

/** Agents per resolution batch when session is large */
const MAPREDUCE_THRESHOLD = 30;
const CONTEXT_OVERFLOW_RE = /context.?length|maximum.?context|maximum.?token|token.?limit|too.?long|exceeds.?context|context.?window|context_length_exceeded/i;
const PROVIDER_CONNECTION_RE = /channel error|econnreset|econnrefused|socket hang up|network error|fetch failed|connection reset|etimedout|epipe/i;

/** Describes the per-session scope needed for context building. */
export interface SessionScope {
  sessionId: string;
  enterpriseRegistry: Map<string, any>;
  employmentRegistry: Map<string, any>;
  sessionPriceHistory: Map<string, Map<ItemType, number>>;
  sessionAMMRegistry: Map<string, AutomatedMarketMaker>;
  sessionMultiAMMRegistry: Map<string, Map<MultiAMMItemType, AutomatedMarketMaker>>;
  sessionLastActionResults: Map<string, Map<string, string>>;
  sessionInflationState: Map<string, { cpi: number; inflationRate: number; inflationExpectations: number }>;
}

export async function runIntentPhase(ctx: {
  sessionId: string;
  scope: SessionScope;
  iterNum: number;
  agents: Agent[];
  aliveAgents: Agent[];
  agentEconomyMap: Map<string, AgentEconomyState>;
  session: any;
  previousSummary: string | null;
  settings: AppSettings;
  provider: LLMProvider;
  citizenProv: LLMProvider;
  lockedVariables: string[];
  sessionPolicy: any;
  latestMarketBoard: MarketBoardEntry[];
  isFirstIteration: boolean;
  shouldAbort: () => boolean;
}): Promise<{
  intents: AgentIntent[];
  illegalActionMap: Map<string, Set<string>>;
  intentRows: Array<{ table: string; columns: string[]; values: unknown[] }>;
  iterationId: string;
  now: string;
}> {
  const {
    sessionId,
    scope,
    iterNum,
    agents,
    aliveAgents,
    agentEconomyMap,
    session,
    previousSummary,
    settings,
    provider,
    citizenProv,
    lockedVariables,
    sessionPolicy,
    latestMarketBoard,
    isFirstIteration,
    shouldAbort,
  } = ctx;

  const iterationId = uuidv4();
  const now = new Date().toISOString();
  const aliveAgentNames = aliveAgents.map(a => a.name);

  // ── Phase 3: Cognitive pre-processing (memories, reflections, planning) ──
  const cognitiveInputs: CognitivePreInput[] = aliveAgents.map(agent => {
    const econState = agentEconomyMap.get(agent.id);
    return {
      agentId: agent.id,
      agentName: agent.name,
      agentRole: agent.role,
      currentStats: {
        wealth: agent.currentStats.wealth,
        health: agent.currentStats.health,
        happiness: agent.currentStats.happiness,
      },
      isStarving: (econState?.inventory?.food?.quantity ?? 10) <= 0,
    };
  });

  const cognitiveOutputs = await runCognitivePreProcessing(
    sessionId, iterNum, cognitiveInputs, citizenProv,
    { model: settings.citizenAgentModel },
    settings.maxConcurrency,
  );

  const employmentBoard = buildEmploymentBoardEntriesFromScope(scope, sessionId);

  // C1: Build MarketIntelligence block once per iteration (all agents see same market)
  const sharedMarketIntelligenceBlock = buildMarketIntelligenceBlock(scope, sessionId, aliveAgents.length, employmentBoard);

  // Pre-compute inflation/macro context once per iteration (not per agent)
  const iterInflationState = scope.sessionInflationState.get(sessionId);
  const iterInflationContext = buildInflationContextFromState(iterInflationState);
  const iterEconomyConfig = getEconomyConfig(session.config as Record<string, unknown> | null);
  const iterMacroSnapshots = macroSnapshotRepo.getRecentSnapshots(db, sessionId, 2);
  const iterLatestMacro = iterMacroSnapshots[0] ?? null;
  const iterPreviousMacro = iterMacroSnapshots[1] ?? null;
  const iterM1GrowthRate = iterLatestMacro && iterPreviousMacro && iterPreviousMacro.m1 !== 0
    ? (iterLatestMacro.m1 - iterPreviousMacro.m1) / iterPreviousMacro.m1
    : 0;

  // Pre-compute banking/capital/fiscal context once per iteration (not per agent)
  const iterBankingDeposits = iterEconomyConfig.bankingEnabled
    ? bankingRepo.getDepositsBySession(sessionId) : [];
  const iterBankingLoans = iterEconomyConfig.bankingEnabled
    ? bankingRepo.getActiveLoans(sessionId) : [];
  const iterBankAgents = iterEconomyConfig.bankingEnabled
    ? agents.filter(a => a.type === 'bank' && a.isAlive) : [];
  const iterEquityPositions = iterEconomyConfig.capitalMarketsEnabled
    ? capitalMarketRepo.getEquityPositionsBySession(sessionId) : [];
  const iterBondHoldings = iterEconomyConfig.capitalMarketsEnabled
    ? capitalMarketRepo.getActiveBondHoldingsBySession(sessionId) : [];
  const iterBudgetAllocation = iterEconomyConfig.fiscalEnabled
    ? (fiscalRepo.getActiveBudget(sessionId) ?? DEFAULT_BUDGET_ALLOCATION) : null;
  const iterPublicGoods = iterEconomyConfig.fiscalEnabled
    ? fiscalRepo.getPublicGoodsState(sessionId) : null;

  // Single-pass structured intent collection
  const intentTasks = aliveAgents.map(agent => async (): Promise<AgentIntent> => {
    try {
      if (shouldAbort()) {
        throw new SimulationPausedError(
          'provider-failure',
          iterNum,
          agent.id,
          agent.name,
          `Simulation paused: stop requested before launching "${agent.name}" at iteration ${iterNum}. Resume will retry this iteration.`,
        );
      }

      // Build economy context for the agent
      const econState = agentEconomyMap.get(agent.id);
      let economyContext: {
        inventory: { food: number; tools: number; raw_materials: number; luxury_goods: number };
        skills: SkillMatrix;
        isStarving: boolean;
      } | undefined;
      if (econState) {
        const inv = econState.inventory;
        const invAny = inv as Record<string, { quantity: number }>;
        economyContext = {
          inventory: {
            food: inv?.food?.quantity ?? 10,
            tools: inv?.tools?.quantity ?? 0,
            raw_materials: invAny?.raw_materials?.quantity ?? 0,
            luxury_goods: invAny?.luxury_goods?.quantity ?? 0,
          },
          skills: econState.skills,
          isStarving: (inv?.food?.quantity ?? 10) <= 0,
        };
      }

      // Phase 3: Get cognitive context for this agent
      const cogOutput = cognitiveOutputs.get(agent.id);
      const cognitiveContext = cogOutput ? {
        memoryContext: cogOutput.memoryContext,
        currentPlanStep: cogOutput.currentPlanStep,
        planGoal: cogOutput.planGoal,
        reflectionText: cogOutput.reflectionText,
      } : undefined;

      const enterpriseRegistry = scope.enterpriseRegistry.get(sessionId) ?? new Map<string, any>();
      const ownedEnterprise = [...enterpriseRegistry.values()].find((enterprise: any) => enterprise.ownerId === agent.id);
      const personalStatus = buildPersonalStatusFromScope(scope, sessionId, agent.id, ownedEnterprise?.id, agent.currentStats.wealth);
      const inflationContext = iterInflationContext;
      const centralBankContext = agent.role === 'central_bank' && iterInflationState
        ? {
            cpi: iterInflationState.cpi,
            inflationRate: iterInflationState.inflationRate,
            inflationExpectations: iterInflationState.inflationExpectations,
            m1Current: iterLatestMacro?.m1 ?? 0,
            m1GrowthRate: iterM1GrowthRate,
            currentReserveRatio: iterEconomyConfig.reserveRequirement ?? DEFAULT_ECONOMY_CONFIG.reserveRequirement,
            currentBaseRate: iterEconomyConfig.baseLoanInterestRate ?? DEFAULT_ECONOMY_CONFIG.baseLoanInterestRate,
          }
        : undefined;

      // Build per-agent banking context
      let citizenBankingContext: CitizenBankingContext | undefined;
      let bankOperationsContext: BankOperationsContext | undefined;
      if (iterEconomyConfig.bankingEnabled) {
        const deposit = iterBankingDeposits.find(d => d.ownerAgentId === agent.id);
        const bankAgent = iterBankAgents[0]; // primary bank
        if (deposit && bankAgent) {
          const agentLoans = iterBankingLoans.filter(l => l.borrowerAgentId === agent.id && l.status === 'active');
          citizenBankingContext = {
            depositBalance: deposit.balance,
            bankName: bankAgent.name,
            outstandingLoans: agentLoans.map(l => ({
              remainingBalance: l.remainingBalance,
              dueAtIteration: l.dueAtIteration,
            })),
            iterationNumber: iterNum,
          };
        }
        if (agent.type === 'bank') {
          const bankDeposits = iterBankingDeposits.filter(d => d.bankAgentId === agent.id);
          const totalDep = bankDeposits.reduce((sum, d) => sum + d.balance, 0);
          const bankLoans = iterBankingLoans.filter(l => l.lenderAgentId === agent.id);
          const totalLoans = bankLoans.reduce((sum, l) => sum + l.remainingBalance, 0);
          const reserveReq = iterEconomyConfig.reserveRequirement ?? DEFAULT_ECONOMY_CONFIG.reserveRequirement;
          bankOperationsContext = {
            bankReserves: agent.currentStats.wealth,
            totalDeposits: totalDep,
            currentReserveRatio: totalDep > 0 ? agent.currentStats.wealth / totalDep : 1,
            reserveRequirement: reserveReq,
            activeLoans: bankLoans.length,
            totalLoansOutstanding: totalLoans,
            lendingCapacity: Math.max(0, agent.currentStats.wealth - totalDep * reserveReq),
          };
        }
      }

      // Build per-agent capital market context
      let citizenCapitalMarketContext: CitizenCapitalMarketContext | undefined;
      if (iterEconomyConfig.capitalMarketsEnabled) {
        const agentEquity = iterEquityPositions.filter(p => p.ownerAgentId === agent.id && p.sharesHeld > 0);
        const agentBonds = iterBondHoldings.filter(b => b.ownerAgentId === agent.id);
        if (agentEquity.length > 0 || agentBonds.length > 0) {
          citizenCapitalMarketContext = {
            equityHoldings: agentEquity.map(p => {
              const owner = agents.find(a => a.id === p.enterpriseOwnerId);
              return {
                enterpriseOwnerName: owner?.name ?? 'Unknown',
                sharesHeld: p.sharesHeld,
                estimatedValue: p.sharesHeld * p.averageCostBasis,
              };
            }),
            bondHoldings: agentBonds.map(b => {
              const issuer = agents.find(a => a.id === b.issuerId);
              return {
                issuerName: issuer?.name ?? (b.bondType === 'government' ? 'Treasury' : 'Unknown'),
                bondType: b.bondType,
                faceValue: b.faceValue,
                couponRate: b.couponRate,
                iterationsToMaturity: b.maturityIteration - iterNum,
              };
            }),
          };
        }
      }

      // Build fiscal context
      const citizenFiscalContext: CitizenFiscalContext | undefined =
        iterBudgetAllocation && iterPublicGoods
          ? {
              budgetAllocation: iterBudgetAllocation,
              publicGoodsQuality: {
                infrastructure: iterPublicGoods.infrastructureQuality,
                education: iterPublicGoods.educationQuality,
                defense: iterPublicGoods.defenseQuality,
                welfare: iterPublicGoods.welfareQuality,
              },
            }
          : undefined;

      // Single-pass: one LLM call returns structured JSON with narrative + actionCode.
      const lastActionResults = scope.sessionLastActionResults.get(sessionId)?.get(agent.id);
      const messages = buildNaturalIntentPrompt(
        agent, session, previousSummary, iterNum,
        economyContext, cognitiveContext, isFirstIteration, aliveAgentNames,
        getAllowedActions(agent.role),
        latestMarketBoard,
        employmentBoard,
        personalStatus,
        lastActionResults,
        sessionPolicy.enforcement_level,
        sharedMarketIntelligenceBlock,
        citizenBankingContext,
        bankOperationsContext,
        citizenCapitalMarketContext,
        citizenFiscalContext,
        inflationContext,
        centralBankContext,
      );

      // throwOnExhaustion: true — after all retries, throw instead of silently defaulting to REST.
      const parsed = await retryWithHealing({
        provider: citizenProv,
        messages,
        options: { model: settings.citizenAgentModel },
        parse: parseSinglePassIntent,
        fallback: {
          intent: '',
          reasoning: '',
          actions: [{ actionCode: 'REST' as ActionCode, parameters: {} }],
          primaryActionCode: 'REST' as ActionCode,
          primaryActionTarget: null,
        },
        throwOnExhaustion: true,
        label: `intent:${agent.name}`,
        shouldAbort,
      });

      // Validate actionCodes against the role-allowed set.
      const allowedSet = new Set<string>(getAllowedActions(agent.role));
      let validatedActions = parsed.actions.filter(a => {
        if (!allowedSet.has(a.actionCode)) {
          console.warn(`[HALLUCINATION] ${agent.name} (${agent.role}) returned disallowed code "${a.actionCode}" — dropped`);
          return false;
        }
        return true;
      });
      if (validatedActions.length === 0) {
        console.warn(`[HALLUCINATION] ${agent.name} had no valid actions after filtering — defaulting to REST`);
        validatedActions = [{ actionCode: 'REST' as ActionCode, parameters: {} }];
      }
      const validatedPrimary = validatedActions[0]!;
      const validatedPrimaryTarget = (() => {
        const p = validatedPrimary.parameters;
        const raw = p.target ?? p.agent_id ?? p.enterprise_id;
        return raw && String(raw).toLowerCase() !== 'null' ? String(raw).trim() || null : null;
      })();

      const intentRecord = {
        agentId: agent.id,
        agentName: agent.name,
        intent: parsed.intent.slice(0, 500),
        reasoning: parsed.reasoning,
        actions: validatedActions,
        primaryActionCode: validatedPrimary.actionCode,
        primaryActionTarget: validatedPrimaryTarget,
        parseMethod: 'structured' as const,
      };

      simulationManager.broadcast(sessionId, {
        type: 'agent-intent',
        agentId: intentRecord.agentId,
        agentName: intentRecord.agentName,
        intent: intentRecord.intent,
        actionCode: intentRecord.primaryActionCode ?? 'NONE',
        actionTarget: intentRecord.primaryActionTarget ?? null,
        actions: intentRecord.actions?.map(action => ({
          actionCode: action.actionCode,
          parameters: action.parameters,
        })) ?? [],
      });

      return intentRecord;
    } catch (err) {
      if (err instanceof SimulationPausedError) {
        throw err;
      }

      // Wrap any error as SimulationPausedError so the outer loop can pause cleanly.
      const msg = err instanceof Error ? err.message : String(err);
      const isCtx = CONTEXT_OVERFLOW_RE.test(msg);
      const isProvider = PROVIDER_CONNECTION_RE.test(msg);

      if (isProvider) {
        simulationManager.pause(sessionId);
      }

      throw new SimulationPausedError(
        isCtx ? 'context-overflow' : isProvider ? 'provider-failure' : 'parse-failure',
        iterNum, agent.id, agent.name,
        `Simulation paused: ${isCtx ? 'context length exceeded' : isProvider ? 'provider connection failure' : 'parser failure'} for "${agent.name}" at iteration ${iterNum}. Resume will retry this iteration.`,
      );
    }
  });

  const intents = await runWithConcurrency(intentTasks, settings.maxConcurrency, {
    shouldContinue: () => !shouldAbort(),
  });

  if (simulationManager.isPauseRequested(sessionId)) {
    throw new SimulationPausedError(
      'pause-requested',
      iterNum,
      'system',
      'system',
      `Simulation paused: user pause requested during intent collection at iteration ${iterNum}. Resume will retry this iteration.`,
    );
  }

  // ── Phase Sheriff A: Legality detection ───────────────────────────────
  // Standard path (≤ MAPREDUCE_THRESHOLD): single global check against all intents.
  // Map-reduce path (> MAPREDUCE_THRESHOLD): per-group checks run concurrently inside
  // each group task (Phase D) and populate illegalActionMap after group results arrive.
  const illegalActionMap = new Map<string, Set<string>>(); // agentId → Set<actionCode>
  if (session.law && aliveAgents.length <= MAPREDUCE_THRESHOLD) {
    try {
      const legalityInput = intents.map(i => ({
        agentId: i.agentId,
        agentName: i.agentName,
        actionCodes: (i.actions ?? []).map(a => a.actionCode),
        intent: i.intent,
      }));
      const legalityMessages = buildLegalityCheckPrompt(legalityInput, session.law, session.societyOverview ?? null);
      const rawLegality = await provider.chat(legalityMessages, { model: settings.centralAgentModel });
      const cleanLegality = rawLegality.replace(/^```json?\s*/i, '').replace(/\s*```\s*$/, '').trim();
      const parsedLegality = JSON.parse(cleanLegality) as { illegalAgents?: Array<{ agentId: string; actionCode: string; reason: string }> };
      if (Array.isArray(parsedLegality?.illegalAgents)) {
        for (const entry of parsedLegality.illegalAgents) {
          if (typeof entry.agentId === 'string' && typeof entry.actionCode === 'string') {
            let codeSet = illegalActionMap.get(entry.agentId);
            if (!codeSet) { codeSet = new Set(); illegalActionMap.set(entry.agentId, codeSet); }
            codeSet.add(entry.actionCode);
            console.log(`[SHERIFF] ${entry.agentId.slice(0, 8)}: "${entry.actionCode}" flagged illegal — ${entry.reason}`);
          }
        }
      }
    } catch (err) {
      console.warn('[SHERIFF] Legality check failed (non-fatal):', err instanceof Error ? err.message : err);
    }
  }

  // Build intent rows for async log flusher (returned, not enqueued here)
  const intentCols = ['id', 'session_id', 'agent_id', 'iteration_id', 'intent', 'reasoning', 'action_code', 'action_target', 'action_queue', 'created_at'];
  const intentRows = intents.map(intent => ({
    table: 'agent_intents',
    columns: intentCols,
    values: [
      uuidv4(), sessionId, intent.agentId, iterationId,
      intent.intent, intent.reasoning ?? '',
      intent.primaryActionCode ?? 'NONE', intent.primaryActionTarget ?? null,
      JSON.stringify(intent.actions ?? []),
      now,
    ],
  }));

  return { intents, illegalActionMap, intentRows, iterationId, now };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function buildEmploymentBoardEntriesFromScope(scope: SessionScope, sessionId: string): EmploymentBoardEntry[] {
  const enterprises = scope.enterpriseRegistry.get(sessionId) ?? new Map<string, any>();
  return [...enterprises.values()]
    .filter((enterprise: any) => enterprise.wage > 0)
    .map((enterprise: any) => ({
      enterprise_id: enterprise.id,
      industry: enterprise.industry,
      wage: enterprise.wage,
      min_skill: enterprise.minSkill,
      owner_name: enterprise.ownerName,
    }));
}

function buildPersonalStatusFromScope(scope: SessionScope, sessionId: string, agentId: string, enterpriseOwnerId?: string, agentWealth?: number): PersonalStatusBoard {
  const employmentRegistry = scope.employmentRegistry.get(sessionId) ?? new Map<string, any>();
  const employment = employmentRegistry.get(agentId);
  if (employment) {
    return { employed: true, enterprise_id: employment.enterpriseId, enterprise_role: 'employee', agentWealth };
  }
  if (enterpriseOwnerId) {
    return { employed: false, enterprise_id: enterpriseOwnerId, enterprise_role: 'owner', agentWealth };
  }
  return { employed: false, enterprise_id: null, enterprise_role: null, agentWealth };
}

function buildInflationContextFromState(state?: { cpi: number; inflationRate: number; inflationExpectations: number }): string | undefined {
  if (!state) return undefined;
  const direction = state.inflationRate >= 0 ? 'up' : 'down';
  return `Economic conditions: CPI is ${state.cpi.toFixed(1)} (${direction} ${Math.abs(state.inflationRate).toFixed(1)}% from base). Inflation running at ${state.inflationRate.toFixed(1)}% this period. Consider adjusting wage demands or consumption strategy.`;
}

function buildMarketIntelligenceBlock(scope: SessionScope, sessionId: string, aliveCount: number, employmentBoard: EmploymentBoardEntry[]): string {
  const FOOD_SPOT_BASELINE = 6.0;
  const COMMODITY_BASELINES: Record<string, number> = { food: FOOD_SPOT_BASELINE, raw_materials: 4.0, luxury_goods: 12.0, tools: 12.0 };
  const miLines: string[] = [];
  const primaryAMM = scope.sessionAMMRegistry.get(sessionId);
  const multiAMMs = scope.sessionMultiAMMRegistry.get(sessionId);

  if (primaryAMM) {
    const fp = primaryAMM.spotPrice;
    const fr = primaryAMM.currentFoodReserve;
    const fStatus = fr < 10 ? 'CRITICAL' : fr < 30 ? 'LOW' : fr < 100 ? 'NORMAL' : 'SURPLUS';
    const prevFP = scope.sessionPriceHistory.get(sessionId)?.get('food');
    const fd = prevFP != null ? fp - prevFP : null;
    const fdStr = fd != null ? ` │ Trend: ${fd >= 0 ? '▲' : '▼'} ${fd >= 0 ? '+' : ''}${fd.toFixed(2)}` : '';
    const fVsB = Math.round((fp / FOOD_SPOT_BASELINE) * 100);
    miLines.push(`  food          │ Price: ${fp.toFixed(2)} fiat/unit  │ reserve: ${Math.round(fr).toString().padStart(4)} units (${fStatus.padEnd(8)})${fdStr} │ ${fVsB}% of baseline`);
  }
  if (multiAMMs) {
    for (const [itemType, pool] of multiAMMs) {
      const p = pool.spotPrice;
      const r = pool.currentFoodReserve;
      const rStatus = r < 5 ? 'CRITICAL' : r < 20 ? 'LOW' : r < 80 ? 'NORMAL' : 'SURPLUS';
      const prevP = scope.sessionPriceHistory.get(sessionId)?.get(itemType as ItemType);
      const pd = prevP != null ? p - prevP : null;
      const pdStr = pd != null ? ` │ Trend: ${pd >= 0 ? '▲' : '▼'} ${pd >= 0 ? '+' : ''}${pd.toFixed(2)}` : '';
      const bl = COMMODITY_BASELINES[itemType] ?? p;
      const pVsB = Math.round((p / bl) * 100);
      miLines.push(`  ${itemType.padEnd(13)} │ Price: ${p.toFixed(2)} fiat/unit  │ reserve: ${Math.round(r).toString().padStart(4)} units (${rStatus.padEnd(8)})${pdStr} │ ${pVsB}% of baseline`);
    }
  }

  const enterpriseRegistry = scope.enterpriseRegistry.get(sessionId) ?? new Map<string, any>();
  const employmentRegistry = scope.employmentRegistry.get(sessionId) ?? new Map<string, any>();
  const iterEntsByIndustry: Record<string, number> = {};
  for (const ent of enterpriseRegistry.values()) {
    iterEntsByIndustry[ent.industry] = (iterEntsByIndustry[ent.industry] ?? 0) + 1;
  }
  const iterUnemployedCount = aliveCount - employmentRegistry.size;
  const iterEntsSummary = Object.entries(iterEntsByIndustry).map(([k, v]) => `${k} ×${v}`).join(', ') || 'none';

  return miLines.length > 0
    ? `\n\n[MARKET INTELLIGENCE — Use this data to reason about economic opportunity]\n\nCommodity prices and supply:\n${miLines.join('\n')}\n\nEconomy:\n  Population: ${aliveCount} alive agents\n  Active enterprises: ${iterEntsSummary}\n  Unemployed agents: ${iterUnemployedCount}\n\nHow to read this:\n- CRITICAL/LOW reserve means the market is undersupplied — prices will rise further if no one produces.\n- SURPLUS reserve means the market is oversupplied — selling now yields less than baseline.\n- Your skills determine how efficiently you can produce each commodity.`
    : '';
}
