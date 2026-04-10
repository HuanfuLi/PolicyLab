/**
 * C4: SimulationRunner — main simulation loop (spec §9, Stage 2).
 *
 * Flow per iteration:
 *   1. Check pause/abort flags
 *   2. Emit iteration-start
 *   3. Parallel: collect intents from all alive citizen agents
 *   4. Emit agent-intent for each
 *   5. Central Agent resolves all intents
 *   6. Emit resolution
 *   7. Apply stat deltas + lifecycle events in DB
 *   8. Persist iteration record
 *   9. Emit iteration-complete with stats
 *
 * After all iterations: emit simulation-complete with final report.
 */
import { v4 as uuidv4 } from 'uuid';
import { db, sqlite } from '../db/index.js';
import { agentIntents, resolvedActions, iterations as iterationsTable, ammSnapshots as ammSnapshotsTable } from '../db/schema.js';
import { asc, eq, sql } from 'drizzle-orm';
import { agentRepo } from '../db/repos/agentRepo.js';
import { sessionRepo } from '../db/repos/sessionRepo.js';
import { getProvider, getCitizenProvider } from '../llm/gateway.js';
import { readSettings } from '../settings.js';
import { runGovernanceCycle, getSessionPolicy } from './governanceManager.js';
import type { SessionPolicy } from '@policylab/shared';
import {
  buildNaturalIntentPrompt,
  buildResolutionPrompt,
  buildGroupResolutionMessages,
  buildMergeResolutionMessages,
  buildFinalReportPrompt,
  buildPostMortemPrompt,
  buildLegalityCheckPrompt,
  type EmploymentBoardEntry,
  type MarketBoardEntry,
  type PersonalStatusBoard,
  type QueuedActionInstruction,
  type AgentIntent,
  type PostMortemInput,
  type CitizenBankingContext,
  type BankOperationsContext,
  type CitizenCapitalMarketContext,
  type CitizenFiscalContext,
} from '../llm/prompts/index.js';
import {
  parseResolutionStrict,
  parseGroupResolutionStrict,
  parseMergeResolutionStrict,
  parseFinalReport,
  parseSinglePassIntent,
} from '../parsers/simulation.js';
import { runWithConcurrency } from './concurrencyPool.js';
import { asyncLogFlusher } from '../db/asyncLogFlusher.js';
import { resolveAction, clampHappinessByPhysiology } from '../mechanics/physicsEngine.js';
import { physicsConfig } from '../mechanics/physicsConfig.js';
import { type ActionCode, getAllowedActions, getRoleTier } from '../mechanics/actionCodes.js';
import { clusterByRole } from './clustering.js';
import { retryWithHealing } from '../llm/retryWithHealing.js';
// Banking Foundation imports (Phase 1: Banking Foundation)
import * as bankingEngine from '../mechanics/bankingEngine.js';
import * as bankingRepo from '../db/repos/bankingRepo.js';
import { getEconomyConfig } from '../mechanics/economyConfigUtils.js';
// Capital Markets imports (Phase 2: Capital Markets)
import * as capitalMarketEngine from '../mechanics/capitalMarketEngine.js';
import * as capitalMarketRepo from '../db/repos/capitalMarketRepo.js';
// Fiscal Policy imports (Phase 3: Fiscal Policy)
import * as fiscalEngine from '../mechanics/fiscalEngine.js';
import * as fiscalRepo from '../db/repos/fiscalRepo.js';
import { DEFAULT_BUDGET_ALLOCATION, DEFAULT_PUBLIC_GOODS_INITIAL } from '@policylab/shared';
import { computeInflation } from '../mechanics/inflationEngine.js';
import * as macroSnapshotRepo from '../db/repos/macroSnapshotRepo.js';
// Phase 1 Economy imports
import { getOrderBook, clearOrderBook, restoreOrderBook, isOrderBookWarm } from '../mechanics/orderBook.js';
import { economyRepo, type AgentEconomyState } from '../db/repos/economyRepo.js';
import { createScope, type SessionScope } from '../db/sessionScope.js';
import type { Agent, Inventory, ItemType, SkillMatrix, TelemetryLog } from '@policylab/shared';
import { DEFAULT_ECONOMY_CONFIG } from '@policylab/shared';
import { processSkills } from '../mechanics/skillSystem.js';
// Phase 3 Cognitive Engine imports
import {
  runCognitivePreProcessing,
  runCognitivePostProcessing,
  cleanupSessionCognition,
  type CognitivePreInput,
  type CognitivePostInput,
} from '../cognition/cognitiveEngine.js';
// Tick-based Metabolism & Allostatic Load imports
import {
  AllostaticEngine,
  type AllostaticState,
} from '../mechanics/allostaticEngine.js';
// AMM & Demurrage UBI imports
import {
  AutomatedMarketMaker,
  createAMMForSession,
  createMultiCommodityAMMs,
  computeDemurrageCycle,
  type AgentWealth as AMMAgentWealth,
  type MultiAMMItemType,
} from '../mechanics/automatedMarketMaker.js';
import { simulationManager } from './simulationManager.js';
import { SimulationLifecycle, SimulationAbortedError } from './simulationLifecycle.js';
// ── Extracted helper modules ──────────────────────────────────────────────────
import { gini, computeStats } from './helpers/statsUtils.js';
import { computeSystemFiatTotal } from './helpers/sfcAudit.js';
import { buildMarketBoardEntries, buildEmploymentBoardEntries, buildPersonalStatus, updatePriceHistory } from './helpers/marketBoard.js';
import { type AgentWeekState, createAgentWeekState, clampStat, clampWealth } from './helpers/weekState.js';
import { normalizeItemType, industryToItemType, getAgentPeakSkill, distributeProRata } from './helpers/physicsUtils.js';
import { getInflationBasketPrices, buildInflationContext, applyInflationFeedback } from './helpers/inflationUtils.js';
import { applyMETMetabolism } from './helpers/metabolismRunner.js';
import { applyEnterpriseAction } from './enterpriseActionDispatch.js';
import {
  type EnterpriseRecord,
  type EmploymentRecord,
  type EnterpriseLedger,
  sessionPriceHistory,
  sessionAMMRegistry,
  sessionMultiAMMRegistry,
  sessionAllostaticStates,
  sessionLastActionResults,
  sessionIterationMetrics,
  sessionTelemetryLogs,
  sessionInflationState,
  sessionSFCTracking,
  sessionStateTreasury,
  sessionLastPhysicsTraces,
  sessionFiscalMultipliers,
  getEnterpriseRegistry,
  getEmploymentRegistry,
  appendTrace,
} from './simulationState.js';

/**
 * Thrown when intent parsing is exhausted (all retries used) for a specific agent.
 * Caught by the outer simulation loop to pause cleanly rather than silently defaulting to REST.
 */
export class SimulationPausedError extends Error {
  constructor(
    public readonly reason: 'parse-failure' | 'context-overflow' | 'provider-failure' | 'pause-requested',
    public readonly iterationNumber: number,
    public readonly agentId: string,
    public readonly agentName: string,
    message: string,
  ) {
    super(message);
    this.name = 'SimulationPausedError';
  }
}

/** Regex to identify context-length errors from LLM providers */
const CONTEXT_OVERFLOW_RE = /context.?length|maximum.?context|maximum.?token|token.?limit|too.?long|exceeds.?context|context.?window|context_length_exceeded/i;
/** Regex to identify connection/channel failures from local OpenAI-compatible providers. */
const PROVIDER_CONNECTION_RE = /channel error|econnreset|econnrefused|socket hang up|network error|fetch failed|connection reset|etimedout|epipe/i;

/** Agents per resolution batch when session is large */
const MAPREDUCE_THRESHOLD = 30;
const BATCH_SIZE = 15;


/**
 * Returns the telemetry log array for a session.
 *
 * Always reads committed history from the DB first (survives server restarts,
 * pause/resume cycles, and session handoffs). Then merges any in-memory entries
 * from the current active run that have not yet been committed (i.e. the current
 * iteration's telemetry is pushed to in-memory before the DB insert).
 *
 * This "merge" strategy fixes two bugs:
 *  1. After pause+resume the in-memory map is fresh (only new iterations) and
 *     would shadow the DB history via an early-return, hiding pre-pause data.
 *  2. If a SimulationPausedError fires before the telemetry block the in-memory
 *     map is empty, but DB still has all previously committed iterations.
 */
export function getSessionTelemetry(sessionId: string): TelemetryLog[] {
  // Always load committed history from DB
  const dbLogs: TelemetryLog[] = [];
  try {
    const rows = sqlite.prepare(
      `SELECT statistics FROM iterations WHERE session_id = ? ORDER BY iteration_number ASC`
    ).all(sessionId) as Array<{ statistics: string }>;

    for (const row of rows) {
      try {
        const parsed = JSON.parse(row.statistics) as Record<string, unknown>;
        if (parsed._telemetry) dbLogs.push(parsed._telemetry as TelemetryLog);
      } catch { /* skip malformed rows */ }
    }
  } catch { /* ignore DB errors */ }

  // Merge in-memory entries not yet committed (e.g. current in-flight iteration)
  const inMemory = sessionTelemetryLogs.get(sessionId) ?? [];
  if (inMemory.length === 0) return dbLogs;

  const dbIterNums = new Set(dbLogs.map(l => l.iterationNumber));
  const uncommitted = inMemory.filter(l => !dbIterNums.has(l.iterationNumber));
  return uncommitted.length > 0 ? [...dbLogs, ...uncommitted] : dbLogs;
}


export async function runSimulation(sessionId: string, totalIterations: number): Promise<void> {
  // Create a SessionScope at the boundary — all repo calls within use this typed value.
  const scope: SessionScope = createScope(sessionId);
  const settings = readSettings();
  const provider = getProvider();
  const citizenProv = getCitizenProvider();
  const summaries: Array<{ number: number; summary: string }> = [];

  const lifecycle = new SimulationLifecycle(sessionId);

  try {
    lifecycle.start();
    await sessionRepo.updateStage(sessionId, 'simulating');

    const session = await sessionRepo.getById(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    const lockedVariables: string[] = (session.config?.lockedVariables as string[] | undefined) ?? [];

    // Live economic policy — updated by the governance cycle every 5 iterations
    let sessionPolicy: SessionPolicy = getSessionPolicy(session.config?.policy);

    /** Round to 4 decimal places to prevent IEEE-754 drift in SFC accounting. */
    const r4 = (v: number): number => Math.round(v * 10000) / 10000;

    /** SFC tracker — tracks total fiat supply between iterations to detect drift. */
    let sfcPrevTotalFiat: number | null = null;

    let agents = await agentRepo.listBySession(scope);
    let previousSummary: string | null = null;

    // Seed allostatic states from DB so pause/resume preserves physiological history.
    // Without this, any restart or resume would reset strain/load to 0, breaking long-term decay.
    {
      const alloMap = new Map<string, AllostaticState>();
      for (const agent of agents) {
        alloMap.set(agent.id, {
          allostaticStrain: agent.allostaticStrain ?? 0,
          allostaticLoad: agent.allostaticLoad ?? 0,
        });
      }
      sessionAllostaticStates.set(sessionId, alloMap);
    }

    // Phase 2: Track active sabotage effects → targetAgentId → remaining iterations
    const sabotageRegistry = new Map<string, number>();
    // Phase 3: Track active suppress effects → targetAgentId → remaining iterations
    const suppressRegistry = new Map<string, number>();
    // Phase 2: Track death reasons for post-mortem system → agentId → { iteration, reason }
    const deathReasonMap = new Map<string, { iteration: number; reason: string }>();
    // Phase 3: Regime collapse tracking
    let collapseReason: string | null = null;
    let collapseIteration = 0;
    const enterpriseRegistry = getEnterpriseRegistry(sessionId);
    const employmentRegistry = getEmploymentRegistry(sessionId);
    let latestMarketBoard: MarketBoardEntry[] = [];

    // ── Phase 1: Initialize economy state for all agents ──────────────────
    const citizenAgents = agents.filter(a => a.isAlive && !a.isCentralAgent);
    await economyRepo.initializeForSession(
      scope,
      citizenAgents.map(a => ({ id: a.id, role: a.role }))
    );
    let agentEconomyMap = new Map<string, AgentEconomyState>();
    const econStates = await economyRepo.listBySession(scope);
    for (const state of econStates) {
      agentEconomyMap.set(state.agentId, state);
    }

    // Support continuation: find max existing iteration number
    const [maxRow] = await db.select({ max: sql<number>`max(${iterationsTable.iterationNumber})` })
      .from(iterationsTable).where(eq(iterationsTable.sessionId, sessionId));
    const startIter = (maxRow?.max ?? 0) + 1;
    const endIter = startIter + totalIterations - 1;

    // ── BUG-04 Fix: Seed treasury BEFORE genesis wealth floor ─────────────
    // The genesis wealth floor (below) funds top-ups from the treasury.
    // If the treasury is seeded after the floor runs, treasury === 0 and
    // no agents get topped up. Seed it here using the restored snapshot value
    // or the default formula so the floor can draw from it on iteration 1.
    if (!sessionStateTreasury.has(sessionId)) {
      const savedAMMForTreasury = await economyRepo.getLatestAMMSnapshot(scope);
      const restoredTreasury = savedAMMForTreasury?.treasury;
      sessionStateTreasury.set(
        sessionId,
        restoredTreasury !== undefined ? restoredTreasury : Math.max(citizenAgents.length, 1) * 500,
      );
    }

    // ── Phase 2: Darwinian Market Protocol — Genesis Endowment ────────────
    // Override default food surplus (10) with scarce starting ration (3)
    // to force immediate market participation and prevent trivial first iterations.
    // Minimum wealth floor of 20 ensures agents can buy at least one round of food.
    if (startIter === 1) {
      const genesisUpdates: Array<{ agentId: string; sessionId: string; skills: import('@policylab/shared').SkillMatrix; inventory: import('@policylab/shared').Inventory; lastUpdated: number }> = [];
      for (const [agentId, econState] of agentEconomyMap) {
        const updatedInventory = {
          ...econState.inventory,
          food: { ...econState.inventory?.food, quantity: 3, quality: 100 },
        } as import('@policylab/shared').Inventory;
        genesisUpdates.push({
          agentId,
          sessionId,
          skills: econState.skills,
          inventory: updatedInventory,
          lastUpdated: 0,
        });
        agentEconomyMap.set(agentId, { ...econState, inventory: updatedInventory });
      }
      if (genesisUpdates.length > 0) {
        await economyRepo.bulkUpsertAgentEconomy(genesisUpdates);
      }
      // B4: Assign role-differentiated starting inventories for fresh sessions
      const roleInventoryMap = (role: string): Partial<Record<string, number>> => {
        const r = role.toLowerCase();
        if (/farmer|gatherer|herder/.test(r)) return { food: 10, raw_materials: 2 };
        if (/artisan|craftsman|blacksmith|carpenter|smith/.test(r)) return { food: 3, tools: 5, raw_materials: 5 };
        if (/merchant|trader|shopkeeper/.test(r)) return { food: 3, tools: 1, raw_materials: 2, luxury_goods: 3 };
        if (/scholar|healer|teacher|doctor|priest/.test(r)) return { food: 3, luxury_goods: 5 };
        if (/miner|builder|laborer|worker/.test(r)) return { food: 5, tools: 2, raw_materials: 4 };
        return { food: 5 };
      };
      const b4Updates: Array<{ agentId: string; sessionId: string; skills: SkillMatrix; inventory: Inventory; lastUpdated: number }> = [];
      for (const agent of citizenAgents) {
        const existing = agentEconomyMap.get(agent.id);
        if (!existing) continue;
        const roleItems = roleInventoryMap(agent.role);
        const updatedInventory = { ...existing.inventory } as Record<string, { quantity: number }>;
        for (const [item, qty] of Object.entries(roleItems)) {
          if (qty !== undefined) {
            updatedInventory[item] = { ...(updatedInventory[item] ?? {}), quantity: qty };
          }
        }
        agentEconomyMap.set(agent.id, { ...existing, inventory: updatedInventory as Inventory });
        b4Updates.push({
          agentId: agent.id,
          sessionId,
          skills: existing.skills,
          inventory: updatedInventory as Inventory,
          lastUpdated: Date.now(),
        });
      }
      if (b4Updates.length > 0) {
        await economyRepo.bulkUpsertAgentEconomy(b4Updates);
      }
      // Apply wealth floor: any agent below 20 wealth gets topped up.
      // SFC fix: fund the top-ups from the state treasury to prevent minting fiat.
      {
        const wealthFloorCandidates = agents
          .filter(a => a.isAlive && !a.isCentralAgent && a.currentStats.wealth < 20);
        let totalTopUp = 0;
        for (const a of wealthFloorCandidates) {
          totalTopUp += 20 - a.currentStats.wealth;
        }
        const treasury = sessionStateTreasury.get(sessionId) ?? 0;
        const fundable = Math.min(totalTopUp, treasury);
        if (fundable > 0 && wealthFloorCandidates.length > 0) {
          // Proportionally distribute funded amount if treasury can't cover all
          const ratio = totalTopUp > 0 ? fundable / totalTopUp : 0;
          const wealthFloorUpdates = wealthFloorCandidates.map(a => ({
            id: a.id,
            wealth: a.currentStats.wealth + (20 - a.currentStats.wealth) * ratio,
            health: a.currentStats.health,
            happiness: a.currentStats.happiness,
            cortisol: a.currentStats.cortisol ?? 20,
            dopamine: a.currentStats.dopamine ?? 50,
          }));
          sessionStateTreasury.set(sessionId, treasury - fundable);
          sqlite.transaction(() => { agentRepo.bulkUpdateStats(wealthFloorUpdates); })();
          agents = await agentRepo.listBySession(scope);
        }
      }
    }

    // ── AMM Initialisation ────────────────────────────────────────────────
    // Primary and multi-commodity AMMs are initialised independently so that
    // a desync (one registry populated, the other not) never silently loses state.
    // On server restart, each missing registry fetches the latest DB snapshot
    // and restores only its own pool; fresh sessions fall back to agent-wealth sizing.
    const primaryMissing = !sessionAMMRegistry.has(sessionId);
    const multiMissing = !sessionMultiAMMRegistry.has(sessionId);

    if (primaryMissing || multiMissing) {
      // One DB round-trip covers both registries if both are missing.
      const savedAMM = await economyRepo.getLatestAMMSnapshot(scope);
      const avgWealth = citizenAgents.length > 0
        ? Math.round(citizenAgents.reduce((s, a) => s + a.currentStats.wealth, 0) / citizenAgents.length)
        : 50;

      if (primaryMissing) {
        const amm = createAMMForSession(Math.max(citizenAgents.length, 1), avgWealth, 6.0, startIter);
        if (savedAMM?.primary) amm.restore(savedAMM.primary);
        sessionAMMRegistry.set(sessionId, amm);
      }

      // D1: Initialise State Treasury for standalone WORK income (SFC-compliant).
      // Restored from the latest AMM snapshot on process restart; only seeds fresh
      // at 500 fiat per agent when no prior snapshot exists.
      if (!sessionStateTreasury.has(sessionId)) {
        const restoredTreasury = savedAMM?.treasury;
        sessionStateTreasury.set(
          sessionId,
          restoredTreasury !== undefined ? restoredTreasury : Math.max(citizenAgents.length, 1) * 500,
        );
      }

      if (multiMissing) {
        const multiAMMs = createMultiCommodityAMMs(Math.max(citizenAgents.length, 1), avgWealth, startIter);
        if (savedAMM?.multi) {
          for (const [itemType, pool] of multiAMMs) {
            const savedPool = savedAMM.multi[itemType];
            if (savedPool) pool.restore(savedPool);
          }
        }
        sessionMultiAMMRegistry.set(sessionId, multiAMMs);
      }
    }

    // ── Order Book Restoration (REL-01 / BUG-02) ─────────────────────────
    // Only restore from the DB if the in-memory registry is cold (new process /
    // server restart).  If the registry is already warm the in-memory state is
    // authoritative and DB re-loading would discard unperssited mid-iteration orders.
    if (!isOrderBookWarm(sessionId)) {
      restoreOrderBook(sessionId);
    }

    // Load previous summaries for final report if continuing
    if (startIter > 1) {
      const prevIters = await db.select({
        iterationNumber: iterationsTable.iterationNumber,
        stateSummary: iterationsTable.stateSummary,
        statistics: iterationsTable.statistics,
      }).from(iterationsTable)
        .where(eq(iterationsTable.sessionId, sessionId))
        .orderBy(asc(iterationsTable.iterationNumber));
      for (const pi of prevIters) {
        summaries.push({ number: pi.iterationNumber, summary: pi.stateSummary });
      }
      // Set previousSummary to last existing iteration's summary
      if (prevIters.length > 0) {
        previousSummary = prevIters[prevIters.length - 1].stateSummary;
        try {
          const prevStats = JSON.parse(prevIters[prevIters.length - 1].statistics) as { _telemetry?: TelemetryLog };
          sfcPrevTotalFiat = prevStats._telemetry?.totalFiatSupply ?? null;
        } catch {
          sfcPrevTotalFiat = null;
        }
        try {
          const firstStats = JSON.parse(prevIters[0].statistics) as { _telemetry?: TelemetryLog };
          const baselineFiat = firstStats._telemetry?.totalFiatSupply;
          if (baselineFiat !== undefined) {
            sessionSFCTracking.set(sessionId, { initialFiat: baselineFiat });
          }
        } catch {
          // Fall back to runtime baseline below if historical telemetry is unavailable.
        }
      }
    }

    if (!sessionSFCTracking.has(sessionId)) {
      // Include banking deposits and collateral in the baseline SFC measurement.
      // For new sessions these are 0; for resumed sessions they may be non-zero.
      const baselineEconomyConfig = getEconomyConfig(session.config as Record<string, unknown> | null);
      const baselineDeposits = baselineEconomyConfig.bankingEnabled
        ? bankingRepo.getTotalDeposits(scope)
        : 0;
      const baselineCollateral = baselineEconomyConfig.bankingEnabled
        ? bankingRepo.getTotalCollateral(scope)
        : 0;
      sessionSFCTracking.set(sessionId, {
        initialFiat: computeSystemFiatTotal(
          agents,
          sessionAMMRegistry.get(sessionId),
          sessionMultiAMMRegistry.get(sessionId),
          sessionStateTreasury.get(sessionId) ?? 0,
          undefined,
          baselineDeposits,
          baselineCollateral,
        ),
      });
    }

    // Snapshot economy state for controlled variable locking (skills/inventory)
    const lockedEconomySnapshot = new Map(agentEconomyMap);

    for (let iterNum = startIter; iterNum <= endIter; iterNum++) {
      // ── Abort/pause check (unified via lifecycle) ────────────────────────
      await lifecycle.checkContinue(iterNum);

      // ── Iteration start ──────────────────────────────────────────────────
      simulationManager.broadcast(sessionId, {
        type: 'iteration-start',
        iteration: iterNum,
        total: endIter,
      });

      // Phase 2/3: Decay status effect registries at the start of each iteration
      for (const [agentId, remaining] of sabotageRegistry) {
        if (remaining <= 1) sabotageRegistry.delete(agentId);
        else sabotageRegistry.set(agentId, remaining - 1);
      }
      for (const [agentId, remaining] of suppressRegistry) {
        if (remaining <= 1) suppressRegistry.delete(agentId);
        else suppressRegistry.set(agentId, remaining - 1);
      }

      // ── Collect intents: Phase 2+3 cognitive → natural language → parser ──
      const aliveAgents = agents.filter(a => a.isAlive && !a.isCentralAgent);
      const isFirstIteration = iterNum === startIter && startIter === 1;
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
      const employmentBoard = buildEmploymentBoardEntries(sessionId);

      // C1: Build MarketIntelligence block once per iteration (all agents see same market)
      const FOOD_SPOT_BASELINE = 6.0;
      const COMMODITY_BASELINES: Record<string, number> = { food: FOOD_SPOT_BASELINE, raw_materials: 4.0, luxury_goods: 12.0, tools: 12.0 };
      const miLines: string[] = [];
      const primaryAMMForMI = sessionAMMRegistry.get(sessionId);
      const multiAMMsForMI = sessionMultiAMMRegistry.get(sessionId);
      if (primaryAMMForMI) {
        const fp = primaryAMMForMI.spotPrice;
        const fr = primaryAMMForMI.currentFoodReserve;
        const fStatus = fr < 10 ? 'CRITICAL' : fr < 30 ? 'LOW' : fr < 100 ? 'NORMAL' : 'SURPLUS';
        const prevFP = sessionPriceHistory.get(sessionId)?.get('food');
        const fd = prevFP != null ? fp - prevFP : null;
        const fdStr = fd != null ? ` │ Trend: ${fd >= 0 ? '▲' : '▼'} ${fd >= 0 ? '+' : ''}${fd.toFixed(2)}` : '';
        const fVsB = Math.round((fp / FOOD_SPOT_BASELINE) * 100);
        miLines.push(`  food          │ Price: ${fp.toFixed(2)} fiat/unit  │ reserve: ${Math.round(fr).toString().padStart(4)} units (${fStatus.padEnd(8)})${fdStr} │ ${fVsB}% of baseline`);
      }
      if (multiAMMsForMI) {
        for (const [itemType, pool] of multiAMMsForMI) {
          const p = pool.spotPrice;
          const r = pool.currentFoodReserve;
          const rStatus = r < 5 ? 'CRITICAL' : r < 20 ? 'LOW' : r < 80 ? 'NORMAL' : 'SURPLUS';
          const prevP = sessionPriceHistory.get(sessionId)?.get(itemType as ItemType);
          const pd = prevP != null ? p - prevP : null;
          const pdStr = pd != null ? ` │ Trend: ${pd >= 0 ? '▲' : '▼'} ${pd >= 0 ? '+' : ''}${pd.toFixed(2)}` : '';
          const bl = COMMODITY_BASELINES[itemType] ?? p;
          const pVsB = Math.round((p / bl) * 100);
          miLines.push(`  ${itemType.padEnd(13)} │ Price: ${p.toFixed(2)} fiat/unit  │ reserve: ${Math.round(r).toString().padStart(4)} units (${rStatus.padEnd(8)})${pdStr} │ ${pVsB}% of baseline`);
        }
      }
      const iterEntsByIndustry: Record<string, number> = {};
      for (const ent of enterpriseRegistry.values()) {
        iterEntsByIndustry[ent.industry] = (iterEntsByIndustry[ent.industry] ?? 0) + 1;
      }
      const iterUnemployedCount = aliveAgents.filter(a => !employmentRegistry.has(a.id)).length;
      const iterEntsSummary = Object.entries(iterEntsByIndustry).map(([k, v]) => `${k} ×${v}`).join(', ') || 'none';
      const sharedMarketIntelligenceBlock = miLines.length > 0
        ? `\n\n[MARKET INTELLIGENCE — Use this data to reason about economic opportunity]\n\nCommodity prices and supply:\n${miLines.join('\n')}\n\nEconomy:\n  Population: ${aliveAgents.length} alive agents\n  Active enterprises: ${iterEntsSummary}\n  Unemployed agents: ${iterUnemployedCount}\n\nHow to read this:\n- CRITICAL/LOW reserve means the market is undersupplied — prices will rise further if no one produces.\n- SURPLUS reserve means the market is oversupplied — selling now yields less than baseline.\n- Your skills determine how efficiently you can produce each commodity.`
        : '';

      // Pre-compute inflation/macro context once per iteration (not per agent)
      const iterInflationState = sessionInflationState.get(sessionId);
      const iterInflationContext = buildInflationContext(iterInflationState);
      const iterEconomyConfig = getEconomyConfig(session.config as Record<string, unknown> | null);
      const iterMacroSnapshots = macroSnapshotRepo.getRecentSnapshots(db, sessionId, 2);
      const iterLatestMacro = iterMacroSnapshots[0] ?? null;
      const iterPreviousMacro = iterMacroSnapshots[1] ?? null;
      const iterM1GrowthRate = iterLatestMacro && iterPreviousMacro && iterPreviousMacro.m1 !== 0
        ? (iterLatestMacro.m1 - iterPreviousMacro.m1) / iterPreviousMacro.m1
        : 0;

      // Pre-compute banking/capital/fiscal context once per iteration (not per agent)
      const iterBankingDeposits = iterEconomyConfig.bankingEnabled
        ? bankingRepo.getDepositsBySession(scope) : [];
      const iterBankingLoans = iterEconomyConfig.bankingEnabled
        ? bankingRepo.getActiveLoans(scope) : [];
      const iterBankAgents = iterEconomyConfig.bankingEnabled
        ? agents.filter(a => a.type === 'bank' && a.isAlive) : [];
      const iterEquityPositions = iterEconomyConfig.capitalMarketsEnabled
        ? capitalMarketRepo.getEquityPositionsBySession(scope) : [];
      const iterBondHoldings = iterEconomyConfig.capitalMarketsEnabled
        ? capitalMarketRepo.getActiveBondHoldingsBySession(scope) : [];
      const iterBudgetAllocation = iterEconomyConfig.fiscalEnabled
        ? (fiscalRepo.getActiveBudget(scope) ?? DEFAULT_BUDGET_ALLOCATION) : null;
      const iterPublicGoods = iterEconomyConfig.fiscalEnabled
        ? fiscalRepo.getPublicGoodsState(scope) : null;

      // Single-pass structured intent collection (replaces two-step natural language → parser flow)
      const intentTasks = aliveAgents.map(agent => async (): Promise<AgentIntent> => {
        try {
          if (simulationManager.isPauseRequested(sessionId) || simulationManager.isAbortRequested(sessionId)) {
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
          const ownedEnterprise = [...enterpriseRegistry.values()].find(enterprise => enterprise.ownerId === agent.id);
          const personalStatus = buildPersonalStatus(sessionId, agent.id, ownedEnterprise?.id, agent.currentStats.wealth);
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
          // Phase 3: pass role-restricted action set so elite agents see privileged actions.
          const lastActionResults = sessionLastActionResults.get(sessionId)?.get(agent.id);
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
          // This surfaces parse/context failures so the simulation can pause rather than
          // produce meaningless REST-filled iterations ("zombie simulation").
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
            shouldAbort: () =>
              simulationManager.isPauseRequested(sessionId) ||
              simulationManager.isAbortRequested(sessionId),
          });

          // Task 3: Validate actionCodes against the role-allowed set.
          // normalizeActionCode maps hallucinations to 'NONE', but some may still
          // slip through as 'NONE' when the agent intended something else.
          // Here we explicitly drop any code not in the agent's allowed list,
          // preventing hallucinated actions from reaching the physics engine.
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
            reasoning: intentRecord.reasoning ?? '',
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
          // This prevents a single failing agent from silently dragging all others into REST.
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
        shouldContinue: () =>
          !simulationManager.isPauseRequested(sessionId) &&
          !simulationManager.isAbortRequested(sessionId),
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
      // Non-fatal in all cases: empty map → no enforcement this iteration.
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

      // Enqueue intent rows for async batch flush (non-blocking)
      const intentCols = ['id', 'session_id', 'agent_id', 'iteration_id', 'intent', 'reasoning', 'action_code', 'action_target', 'action_queue', 'created_at'];
      for (const intent of intents) {
        asyncLogFlusher.enqueue('agent_intents', intentCols, [
          uuidv4(), sessionId, intent.agentId, iterationId,
          intent.intent, intent.reasoning ?? '',
          intent.primaryActionCode ?? 'NONE', intent.primaryActionTarget ?? null,
          JSON.stringify(intent.actions ?? []),
          now,
        ]);
      }

      // ── Central Agent resolves (standard or map-reduce) ──────────────────
      let resolution: import('../parsers/simulation.js').ParsedResolution;

      const prevIterMetrics = sessionIterationMetrics.get(sessionId) ?? null;
      // D4: Physics log from last iteration — grounding data for the narrator
      const prevPhysicsLog = sessionLastPhysicsTraces.get(sessionId) ?? null;

      if (aliveAgents.length > MAPREDUCE_THRESHOLD) {
        // ── Map-Reduce path for large sessions (role-based clustering) ──
        const allIntentsBrief = intents
          .map(i => `- ${i.agentName}: ${i.intent.slice(0, 80)}`)
          .join('\n');

        const groups = clusterByRole(aliveAgents, BATCH_SIZE);
        const groupTasks = groups.map((group, gi) => async () => {
          const groupIntents = intents.filter(i => group.some(a => a.id === i.agentId));
          const msgs = buildGroupResolutionMessages(session, group, groupIntents, allIntentsBrief, iterNum, previousSummary, prevIterMetrics, lockedVariables, prevPhysicsLog);
          // Use citizenAgentModel for group coordinators (cheaper); merge step keeps centralAgentModel
          const resolutionPromise = retryWithHealing({
            provider: citizenProv,
            messages: msgs,
            options: { model: settings.citizenAgentModel },
            parse: parseGroupResolutionStrict,
            fallback: { groupSummary: 'The group continued their activities.', agentOutcomes: [], lifecycleEvents: [] },
            label: `groupResolution:${gi}`,
            shouldAbort: () =>
              simulationManager.isPauseRequested(sessionId) ||
              simulationManager.isAbortRequested(sessionId),
          });

          // Phase D: per-group legality check runs concurrently with resolution.
          // This avoids a single global prompt over 150 agents (context overflow risk).
          const legalityPromise: Promise<Array<{ agentId: string; actionCode: string; reason: string }>> =
            session.law
              ? (async () => {
                  try {
                    const legalityInput = groupIntents.map(i => ({
                      agentId: i.agentId,
                      agentName: i.agentName,
                      actionCodes: (i.actions ?? []).map(a => a.actionCode),
                      intent: i.intent,
                    }));
                    const legalityMsgs = buildLegalityCheckPrompt(legalityInput, session.law!, session.societyOverview ?? null);
                    const rawLegality = await citizenProv.chat(legalityMsgs, { model: settings.citizenAgentModel });
                    const clean = rawLegality.replace(/^```json?\s*/i, '').replace(/\s*```\s*$/, '').trim();
                    const parsed = JSON.parse(clean) as { illegalAgents?: Array<{ agentId: string; actionCode: string; reason: string }> };
                    return Array.isArray(parsed?.illegalAgents) ? parsed.illegalAgents : [];
                  } catch {
                    return [];
                  }
                })()
              : Promise.resolve([]);

          const [resolutionResult, illegalAgents] = await Promise.all([resolutionPromise, legalityPromise]);
          return { ...resolutionResult, illegalAgents };
        });

        const groupResults = await runWithConcurrency(groupTasks, settings.maxConcurrency, {
          shouldContinue: () =>
            !simulationManager.isPauseRequested(sessionId) &&
            !simulationManager.isAbortRequested(sessionId),
        });

        // Populate illegalActionMap from per-group legality results (Phase D)
        for (const groupResult of groupResults) {
          for (const entry of groupResult.illegalAgents ?? []) {
            if (typeof entry.agentId === 'string' && typeof entry.actionCode === 'string') {
              let codeSet = illegalActionMap.get(entry.agentId);
              if (!codeSet) { codeSet = new Set(); illegalActionMap.set(entry.agentId, codeSet); }
              codeSet.add(entry.actionCode);
              console.log(`[SHERIFF/MR] ${entry.agentId.slice(0, 8)}: "${entry.actionCode}" flagged illegal — ${entry.reason}`);
            }
          }
        }

        // Merge step: synthesise group summaries into a society-wide narrative
        const groupSummaries = groupResults.map(r => r.groupSummary);
        const mergeMessages = buildMergeResolutionMessages(session, groupSummaries, iterNum, previousSummary, prevIterMetrics, lockedVariables);
        const mergeResult = await retryWithHealing({
          provider,
          messages: mergeMessages,
          options: { model: settings.centralAgentModel },
          parse: parseMergeResolutionStrict,
          fallback: { narrativeSummary: 'The iteration passed.', lifecycleEvents: [] },
          label: 'mergeResolution',
          shouldAbort: () =>
            simulationManager.isPauseRequested(sessionId) ||
            simulationManager.isAbortRequested(sessionId),
        });

        resolution = {
          narrativeSummary: mergeResult.narrativeSummary,
          agentOutcomes: groupResults.flatMap(r => r.agentOutcomes),
          // Merge lifecycle events from all groups + merge result (deduplicate by agentId+type)
          lifecycleEvents: [
            ...groupResults.flatMap(r => r.lifecycleEvents),
            ...mergeResult.lifecycleEvents,
          ],
        };
      } else {
        // ── Standard path ────────────────────────────────────────────────
        // Bug #1 fix: pass aliveAgents only — dead agents must never appear in resolution
        const resolutionMessages = buildResolutionPrompt(session, aliveAgents, intents, iterNum, previousSummary, prevIterMetrics, lockedVariables, prevPhysicsLog);
        resolution = await retryWithHealing({
          provider,
          messages: resolutionMessages,
          options: { model: settings.centralAgentModel },
          parse: parseResolutionStrict,
          fallback: { narrativeSummary: 'The iteration passed without major events.', agentOutcomes: [], lifecycleEvents: [] },
          label: 'resolution',
          shouldAbort: () =>
            simulationManager.isPauseRequested(sessionId) ||
            simulationManager.isAbortRequested(sessionId),
        });
      }

      // Controlled Variable Method: suppress role_change lifecycle events when role is locked
      if (lockedVariables.includes('role')) {
        resolution = {
          ...resolution,
          lifecycleEvents: resolution.lifecycleEvents?.filter(
            (e: { type: string }) => e.type !== 'role_change'
          ) ?? [],
        };
      }

      simulationManager.broadcast(sessionId, {
        type: 'resolution',
        iteration: iterNum,
        narrativeSummary: resolution.narrativeSummary,
        lifecycleEvents: resolution.lifecycleEvents,
      });

      // ── Hybrid micro-turn execution: per-agent action queues + end-of-week market ──
      const intentMap = new Map(intents.map(i => [i.agentId, i]));
      const outcomeMap = new Map(resolution.agentOutcomes.map(o => [o.agentId, o]));
      // Fix A1: Reconcile lifecycle death events with agent outcomes.
      // If LLM narrated a death but forgot to set died:true in agentOutcomes, force it.
      for (const event of resolution.lifecycleEvents ?? []) {
        if ((event as { type: string; agentId?: string }).type === 'death') {
          const evtAgentId = (event as { type: string; agentId?: string }).agentId;
          if (evtAgentId) {
            const existing = outcomeMap.get(evtAgentId);
            if (existing && !existing.died) {
              outcomeMap.set(evtAgentId, { ...existing, died: true });
            }
          }
        }
      }
      const weekStateMap = new Map<string, AgentWeekState>(
        aliveAgents.map(agent => [agent.id, createAgentWeekState(agentEconomyMap.get(agent.id))])
      );
      // Populate employer_id from persisted employment registry
      for (const agent of aliveAgents) {
        const state = weekStateMap.get(agent.id)!;
        state.employer_id = employmentRegistry.get(agent.id)?.enterpriseId ?? null;
      }
      const orderBook = getOrderBook(sessionId);

      const statUpdates: Array<{ id: string; wealth: number; health: number; happiness: number; cortisol: number; dopamine: number }> = [];
      const deaths: Array<{ id: string; iterationNumber: number }> = [];
      const actionRows: Array<typeof resolvedActions.$inferInsert> = [];
      const actionRowByAgentId = new Map<string, typeof resolvedActions.$inferInsert>();
      const economyUpdates: Array<{ agentId: string; sessionId: string; skills: SkillMatrix; inventory: Inventory; lastUpdated: number }> = [];
      const humiliatedAgentIds = new Set<string>();
      // Phase B: per-enterprise revenue/wage ledger for this iteration
      const enterpriseLedgerMap = new Map<string, EnterpriseLedger>();
      // Phase Sheriff C: accumulated seized wealth to redistribute as UBI at end of iteration
      let seizedWealthPool = 0;

      // ── Ghost Enterprise Cleanup: dissolve enterprises whose owner died in a prior iteration ──
      // weekStateMap only contains alive agents; if an owner is absent, they are dead.
      // Without this, dead owners leave their enterprises running forever with no
      // bankruptcy event, no worker notifications, and no registry cleanup.
      {
        const aliveAgentIds = new Set(aliveAgents.map(a => a.id));
        for (const [enterpriseId, enterprise] of enterpriseRegistry) {
          if (aliveAgentIds.has(enterprise.ownerId)) continue; // owner alive — normal path
          // Owner is dead: dissolve enterprise and release all employees
          for (const [employeeId] of enterprise.employees) {
            const empRecord = employmentRegistry.get(employeeId);
            if (!empRecord) continue;
            const empState = weekStateMap.get(employeeId);
            if (empState) {
              empState.cortisolDelta += 20;
              empState.happinessDelta -= 15;
              empState.events.push(`Your employer died — enterprise ${enterpriseId} dissolved, you are now unemployed`);
              empState.employer_id = null;
            }
            employmentRegistry.delete(employeeId);
          }
          enterpriseRegistry.delete(enterpriseId);
        }
      }

      // D4: Per-agent physics trace accumulator — stored for next iteration's resolution prompt
      const agentTraceMap = new Map<string, string[]>();

      for (const agent of aliveAgents) {
        const weekState = weekStateMap.get(agent.id)!;
        const agentIntent = intentMap.get(agent.id);
        const queue = (agentIntent?.actions?.slice(0, 3) ?? [{ actionCode: 'NONE', parameters: {} }]) as QueuedActionInstruction[];
        let runningWealth = agent.currentStats.wealth;
        let runningHealth = agent.currentStats.health;
        let runningHappiness = agent.currentStats.happiness;
        let runningCortisol = agent.currentStats.cortisol ?? 20;
        let runningDopamine = agent.currentStats.dopamine ?? 50;

        for (const [actionIndex, action] of queue.entries()) {
          const rawTarget = action.parameters?.target ?? action.parameters?.agent_id;
          const targetText = typeof rawTarget === 'string' ? rawTarget.toLowerCase() : '';
          const targetAgent = aliveAgents.find(a => a.id === rawTarget || a.name.toLowerCase() === targetText);

          const economyDelta = applyEnterpriseAction({
            sessionId,
            iterationNumber: iterNum,
            agent,
            action,
            state: weekState,
            allWeekStates: weekStateMap,
            enterpriseRegistry,
            employmentRegistry,
            orderBook,
            amm: sessionAMMRegistry.get(sessionId),
            multiAMMs: sessionMultiAMMRegistry.get(sessionId),
            enterpriseLedger: enterpriseLedgerMap,
          });

          // SFC fix: For STEAL actions, patch the target's wealth in the allAgents
          // snapshot to reflect accumulated deltas, preventing stealCalc from using
          // stale start-of-iteration wealth and over-calculating the stolen amount.
          let agentsForPhysics = aliveAgents;
          if (action.actionCode === 'STEAL' && targetAgent) {
            const targetState = weekStateMap.get(targetAgent.id);
            if (targetState) {
              const targetRunningWealth = Math.max(0, targetAgent.currentStats.wealth + targetState.wealthDelta);
              agentsForPhysics = aliveAgents.map(a =>
                a.id === targetAgent.id
                  ? { ...a, currentStats: { ...a.currentStats, wealth: targetRunningWealth } }
                  : a
              );
            }
          }

          const physics = resolveAction({
            agent: {
              ...agent,
              currentStats: {
                ...agent.currentStats,
                wealth: runningWealth,
                health: runningHealth,
                happiness: runningHappiness,
                cortisol: runningCortisol,
                dopamine: runningDopamine,
              },
            },
            actionCode: action.actionCode,
            actionParameters: action.parameters,
            actionTarget: targetAgent?.id,
            allAgents: agentsForPhysics,
            skills: weekState.skills,
            inventory: weekState.inventory,
            economyDeltas: economyDelta,
            isSabotaged: sabotageRegistry.has(agent.id),
            isSuppressed: suppressRegistry.has(agent.id),
            isFirstAction: actionIndex === 0,
            fiscalMultipliers: sessionFiscalMultipliers.get(sessionId),
          });

          weekState.executedActions.push(action);

          // D4: Accumulate physics trace (last 3 entries per action, max 9 per agent)
          if (physics.trace.length > 0) {
            const existing = agentTraceMap.get(agent.id) ?? [];
            agentTraceMap.set(agent.id, [...existing, ...physics.trace.slice(-3)].slice(-9));
          }

          // ── Phase Sheriff C: enforcement check ────────────────────────────
          // If the Central Agent flagged this action as illegal, roll detection.
          // On catch: seizure penalty replaces normal physics wealth gain.
          const illegalCodesForAgent = illegalActionMap.get(agent.id);
          if (illegalCodesForAgent?.has(action.actionCode)) {
            const detectionProb = Math.min(0.9, 0.2 * sessionPolicy.enforcement_level);
            if (Math.random() < detectionProb) {
              const seizureFromBalance = runningWealth * 0.25;
              const seizedActionGain = Math.max(0, physics.wealthDelta);
              const totalSeized = seizureFromBalance + seizedActionGain;
              // Route both confiscated base wealth and any illegal action gain back into
              // the redistribution pool so arrests remain SFC-neutral.
              seizedWealthPool += totalSeized;
              physics.wealthDelta -= totalSeized;
              // Arrest trauma: +30 cortisol, nullify happiness gain
              physics.cortisolDelta += 30;
              physics.happinessDelta = Math.min(physics.happinessDelta, -5);
              weekState.events.push(
                `⚖️ ARRESTED for illegal "${action.actionCode}": −${totalSeized.toFixed(1)} fiat seized by state (${seizureFromBalance.toFixed(1)} from savings, ${seizedActionGain.toFixed(1)} from illegal gain; +30 stress, enforcement_level=${sessionPolicy.enforcement_level.toFixed(1)}).`
              );
            }
          }

          // enforcement_level scales STEAL cortisol penalty (higher enforcement = more deterrence)
          const enforcementCortisolScale = action.actionCode === 'STEAL' ? sessionPolicy.enforcement_level : 1.0;
          const effectiveCortisolDelta = physics.cortisolDelta * enforcementCortisolScale;

          weekState.wealthDelta += physics.wealthDelta;

          // D1: Deduct standalone WORK income from the state treasury (SFC-compliant).
          // The treasury prevents WORK from creating fiat from nothing — income is
          // a transfer from treasury to agent, keeping total fiat supply constant.
          if (action.actionCode === 'WORK' && physics.wealthDelta > 0) {
            const treasury = sessionStateTreasury.get(sessionId) ?? 0;
            if (treasury < physics.wealthDelta) {
              // Treasury exhausted — cap income at remaining balance
              weekState.wealthDelta -= (physics.wealthDelta - treasury);
              sessionStateTreasury.set(sessionId, 0);
            } else {
              sessionStateTreasury.set(sessionId, treasury - physics.wealthDelta);
            }
          }

          // SFC fix V2: INVEST cost routes to treasury instead of being destroyed.
          // Without this, the -10 wealthDelta destroys fiat with no counterparty.
          // Routing to treasury mirrors the FOUND_ENTERPRISE pattern.
          if (action.actionCode === 'INVEST' && physics.wealthDelta < 0) {
            const investCost = Math.abs(physics.wealthDelta);
            const prevTreasury = sessionStateTreasury.get(sessionId) ?? 0;
            sessionStateTreasury.set(sessionId, prevTreasury + investCost);
          }

          // D2: REST recovery scaling by dopamine (anhedonia impairs recovery).
          // High dopamine (≥70) → ×1.25 health recovery (motivated, well-rested).
          // Low dopamine (≤30) → ×0.75 health recovery (anhedonic, impaired recovery).
          let scaledHealthDelta = physics.healthDelta;
          if (action.actionCode === 'REST' && physics.healthDelta > 0) {
            const dopamineScaleMult = runningDopamine >= 70 ? 1.25 : runningDopamine <= 30 ? 0.75 : 1.0;
            scaledHealthDelta = Math.round(physics.healthDelta * dopamineScaleMult);
          }

          weekState.healthDelta += scaledHealthDelta;
          weekState.happinessDelta += physics.happinessDelta;
          weekState.cortisolDelta += effectiveCortisolDelta;
          weekState.dopamineDelta += physics.dopamineDelta;

          // Fix A: Zero-sum STEAL — deduct stolen amount from victim's weekState
          if (action.actionCode === 'STEAL' && targetAgent && physics.wealthDelta > 0) {
            const victimState = weekStateMap.get(targetAgent.id);
            if (victimState) {
              const victimAvailable = Math.max(0, targetAgent.currentStats.wealth + victimState.wealthDelta);
              const actualStolen = Math.min(physics.wealthDelta, victimAvailable);
              victimState.wealthDelta -= actualStolen;
              if (actualStolen < physics.wealthDelta) {
                weekState.wealthDelta -= (physics.wealthDelta - actualStolen);
              }
            }
          }

          // BUG-03 fix: Zero-sum HELP — transfer the helper's wealth cost to the target.
          // Without this, HELP destroys fiat (helper loses wealth, nobody gains it).
          // Cap the transfer to what the helper can actually afford (runningWealth is the
          // in-action-loop position BEFORE this action's physics.wealthDelta is applied).
          // If the helper has less than the full help_amount, only transfer what is available
          // and clawback the uncovered portion from weekState.wealthDelta so no fiat is destroyed.
          if (action.actionCode === 'HELP' && targetAgent && physics.wealthDelta < 0) {
            const beneficiaryState = weekStateMap.get(targetAgent.id);
            if (beneficiaryState) {
              const helpAmount = Math.abs(physics.wealthDelta);
              // actualGift is capped at runningWealth — the helper cannot give what they don't have
              const actualGift = Math.min(helpAmount, runningWealth);
              beneficiaryState.wealthDelta += actualGift;
              // Clawback: undo the uncovered portion of the physics delta so weekState stays SFC-neutral
              if (actualGift < helpAmount) {
                weekState.wealthDelta += (helpAmount - actualGift);
              }
            }
          }

          runningWealth = clampWealth(runningWealth + physics.wealthDelta);
          runningHealth = clampStat(runningHealth + physics.healthDelta);
          runningHappiness = clampStat(runningHappiness + physics.happinessDelta);
          runningCortisol = clampStat(runningCortisol + effectiveCortisolDelta);
          runningDopamine = clampStat(runningDopamine + physics.dopamineDelta);

          const fiscalSkillMult = sessionFiscalMultipliers.get(sessionId);
          const skillGainMult = fiscalSkillMult ? 1 + fiscalSkillMult.skillGainBonus : 1.0;
          weekState.skills = processSkills(weekState.skills, action.actionCode, skillGainMult);

          if (runningHealth < 20) {
            weekState.interrupted = true;
            weekState.interruptedReason = 'starvation';
            break;
          }
          if (runningCortisol > 90) {
            weekState.interrupted = true;
            weekState.interruptedReason = 'mental_breakdown';
            break;
          }
        }
      }

      // D4: Build physics log from this iteration's traces — used in next iteration's resolution
      {
        const logLines: string[] = [];
        for (const ag of aliveAgents) {
          const traces = agentTraceMap.get(ag.id) ?? [];
          if (traces.length > 0) {
            logLines.push(`${ag.name}: ${traces.slice(-3).join(' | ')}`);
          }
        }
        if (logLines.length > 0) {
          appendTrace(sessionId, logLines.join('\n'));
        }
      }

      // ── Non-food order book matching (raw_materials, tools, luxury_goods) ─
      // Food trades were executed immediately via AMM above; only non-food
      // orders remain in the order book and require peer matching.
      //
      // SYSTEM_NPC liquidity: inject a guaranteed floor-price buy for raw_materials
      // so producers can always liquidate their stock even if no citizen wants to buy.
      // This prevents the "frozen market" failure mode where all agents overproduce
      // raw_materials but the order book has no buyers, collapsing revenue to zero.
      if (aliveAgents.length > 0) {
        orderBook.submitOrder({
          sessionId,
          agentId: 'SYSTEM_NPC',
          side: 'buy',
          itemType: 'raw_materials',
          price: 2,
          quantity: aliveAgents.length * 10,
          iterationPlaced: iterNum,
        });
      }
      const trades = orderBook.matchOrders();
      for (const trade of trades) {
        const buyerState = weekStateMap.get(trade.buyerId);
        const sellerState = weekStateMap.get(trade.sellerId);
        if (buyerState) {
          buyerState.wealthDelta -= trade.executionPrice * trade.quantity;
          buyerState.inventory[trade.itemType].quantity += trade.quantity;
          buyerState.events.push(`Bought ${trade.quantity} ${trade.itemType} at ${trade.executionPrice}`);
        } else if (trade.buyerId === 'SYSTEM_NPC') {
          // SFC fix: SYSTEM_NPC purchases are funded from the state treasury
          // to prevent minting fiat from nothing when sellers are paid.
          const cost = trade.executionPrice * trade.quantity;
          const treasury = sessionStateTreasury.get(sessionId) ?? 0;
          const fundedCost = Math.min(cost, treasury);
          sessionStateTreasury.set(sessionId, treasury - fundedCost);
          if (sellerState && fundedCost < cost) {
            // Treasury cannot cover full cost — cap seller payment to funded amount
            sellerState.wealthDelta += fundedCost;
            sellerState.events.push(`Sold ${trade.quantity} ${trade.itemType} at ${trade.executionPrice} (treasury-backed)`);
            continue; // skip the sellerState block below
          }
        }
        if (sellerState) {
          sellerState.wealthDelta += trade.executionPrice * trade.quantity;
          sellerState.events.push(`Sold ${trade.quantity} ${trade.itemType} at ${trade.executionPrice}`);
        }
      }

      // ── Wage Settlement & Bankruptcy Check ───────────────────────────────
      // Group employees by enterprise, check if the owner can cover all wages,
      // then either pay in full or declare bankruptcy with proportional liquidation.
      let bankruptciesThisIter = 0;
      {
        // Build per-enterprise wage obligation map: enterpriseId → [employmentRecords that worked]
        const enterpriseWorkers = new Map<string, EmploymentRecord[]>();
        for (const employment of employmentRegistry.values()) {
          const employeeState = weekStateMap.get(employment.employeeId);
          if (!employeeState) continue;
          if (employeeState.workedEnterpriseId === employment.enterpriseId) {
            const list = enterpriseWorkers.get(employment.enterpriseId) ?? [];
            list.push(employment);
            enterpriseWorkers.set(employment.enterpriseId, list);
          } else if (employeeState.quitEnterpriseId !== employment.enterpriseId) {
            // Missed shift penalty
            employeeState.cortisolDelta += 10;
            employeeState.happinessDelta -= 5;
            employeeState.events.push(`Failed to fulfill employment obligation at ${employment.enterpriseId}`);
          }
        }

        for (const [enterpriseId, workers] of enterpriseWorkers) {
          const enterprise = enterpriseRegistry.get(enterpriseId);
          if (!enterprise) continue;
          const ownerState = weekStateMap.get(enterprise.ownerId);
          if (!ownerState) continue;

          const totalWageObligation = workers.reduce((sum, e) => sum + e.wage, 0);
          const ownerAvailableWealth = enterprise.ownerId
            ? (aliveAgents.find(a => a.id === enterprise.ownerId)?.currentStats.wealth ?? 0) + ownerState.wealthDelta
            : 0;

          if (ownerAvailableWealth >= totalWageObligation) {
            // ── Solvent: pay all employees in full ──
            for (const employment of workers) {
              const employeeState = weekStateMap.get(employment.employeeId);
              if (!employeeState) continue;
              ownerState.wealthDelta -= employment.wage;
              ownerState.events.push(`Paid wage ${employment.wage} to ${employment.employeeId}`);
              employeeState.wealthDelta += employment.wage;
              employeeState.events.push(`Received wage ${employment.wage} from ${enterpriseId}`);
            }
            // Phase B: record total wages in ledger
            {
              const ledger = enterpriseLedgerMap.get(enterpriseId) ?? { totalRevenue: 0, totalWages: 0, workerCount: 0 };
              ledger.totalWages += totalWageObligation;
              enterpriseLedgerMap.set(enterpriseId, ledger);
            }
          } else {
            // ── Insolvent: proportional liquidation then bankruptcy ──
            // Phase B: record wages owed (even if unpaid) so owner sees the deficit
            {
              const ledger = enterpriseLedgerMap.get(enterpriseId) ?? { totalRevenue: 0, totalWages: 0, workerCount: 0 };
              ledger.totalWages += totalWageObligation;
              enterpriseLedgerMap.set(enterpriseId, ledger);
            }
            bankruptciesThisIter++;
            const liquidatable = Math.max(0, ownerAvailableWealth);
            const payRatio = totalWageObligation > 0 ? liquidatable / totalWageObligation : 0;

            // SFC fix: compute payments first, then distribute truncation remainder
            // so Math.floor doesn't silently destroy fiat.
            const workerPayments: Array<{ employment: (typeof workers)[0]; payment: number }> = [];
            let totalPaid = 0;
            for (const employment of workers) {
              const payment = Math.floor(employment.wage * payRatio);
              workerPayments.push({ employment, payment });
              totalPaid += payment;
            }
            // Distribute truncation remainder (1 fiat each) to first workers
            let remainder = Math.floor(liquidatable) - totalPaid;
            for (let i = 0; i < workerPayments.length && remainder > 0; i++) {
              workerPayments[i].payment++;
              remainder--;
            }

            for (const { employment, payment: partialPay } of workerPayments) {
              const employeeState = weekStateMap.get(employment.employeeId);
              if (!employeeState) continue;
              if (partialPay > 0) {
                ownerState.wealthDelta -= partialPay;
                employeeState.wealthDelta += partialPay;
                employeeState.events.push(`Partial wage ${partialPay}/${employment.wage} from bankrupt enterprise ${enterpriseId}`);
              } else {
                employeeState.events.push(`Wage unpaid — enterprise ${enterpriseId} declared bankruptcy`);
              }
              // Release employee from this enterprise
              employmentRegistry.delete(employment.employeeId);
              enterprise.employees.delete(employment.employeeId);
              const empWeekState = weekStateMap.get(employment.employeeId);
              if (empWeekState) empWeekState.employer_id = null;
              employeeState.cortisolDelta += 20;
              employeeState.happinessDelta -= 15;
            }

            // Punish owner
            ownerState.events.push(`CRITICAL: Your enterprise ${enterpriseId} went bankrupt! You failed to pay your workers and lost your business.`);
            ownerState.cortisolDelta += 40;
            ownerState.happinessDelta -= 30;

            // Dissolve enterprise
            enterpriseRegistry.delete(enterpriseId);
          }
        }
      }

      const TAX_PER_AGENT = 3;
      for (const intent of intents) {
        const taxActions = intent.actions?.filter(action => action.actionCode === 'ADJUST_TAX') ?? [];
        if (taxActions.length === 0) continue;
        const taxerState = weekStateMap.get(intent.agentId);
        const taxableAgents = aliveAgents.filter(a =>
          !a.isCentralAgent && a.id !== intent.agentId && getRoleTier(a.role) !== 'elite'
        );
        // SFC-safe: accumulate only what each agent can actually pay — no ghost minting.
        let actualTaxCollected = 0;
        for (const taxed of taxableAgents) {
          const taxedState = weekStateMap.get(taxed.id);
          if (!taxedState) continue;
          const required = TAX_PER_AGENT * taxActions.length;
          const availableWealth = taxed.currentStats.wealth + taxedState.wealthDelta;
          const actualDeduction = Math.min(required, Math.max(0, availableWealth));
          taxedState.wealthDelta -= actualDeduction;
          actualTaxCollected += actualDeduction;
          taxedState.cortisolDelta += 5 * taxActions.length;
          taxedState.happinessDelta -= 3 * taxActions.length;
        }
        // Taxer receives only what was actually collected
        if (taxerState) taxerState.wealthDelta += actualTaxCollected;
      }

      {
        const configRoot = (session.config as Record<string, unknown> | null) ?? {};
        const persistedEconomyConfig = getEconomyConfig(configRoot);
        let configChanged = false;

        for (const intent of intents) {
          for (const action of intent.actions ?? []) {
            const requestedValue = typeof action.parameters?.value === 'number' ? action.parameters.value : null;
            if (requestedValue === null) continue;

            if (action.actionCode === 'SET_RESERVE_RATIO') {
              persistedEconomyConfig.reserveRequirement = Math.max(0.05, Math.min(0.50, requestedValue));
              configChanged = true;
            }

            if (action.actionCode === 'SET_BASE_RATE') {
              persistedEconomyConfig.baseLoanInterestRate = Math.max(0.001, Math.min(0.05, requestedValue));
              configChanged = true;
            }
          }
        }

        if (configChanged) {
          session.config = {
            ...(configRoot ?? {}),
            economyConfig: {
              ...((configRoot.economyConfig as Record<string, unknown> | undefined) ?? {}),
              ...persistedEconomyConfig,
            },
          };
          await sessionRepo.updateConfig(sessionId, session.config as Record<string, unknown>);
        }
      }

      // ── EMBEZZLE Settlement: skim communal pool pro-rata from all other agents ──
      // SFC-correct: wealth is redistributed, not created. Each embezzler draws up to
      // 20 fiat spread evenly across all other alive agents (capped by their available wealth).
      //
      // BUG-12/14 fix: Use distributeProRata (Math.floor + remainder distribution) instead
      // of simple division to avoid IEEE-754 float drift (e.g., 20/3 = 6.666... × 3 = 19.998).
      //
      // BUG-01 fix: Victim wealthDelta is updated here (cState.wealthDelta -= deducted).
      // When the death seizure loop runs later, newWealth = clamp(wealth + wealthDelta) already
      // reflects this deduction, so the seized amount is correct and no fiat is double-counted.
      {
        for (const intent of intents) {
          const embezzleActions = intent.actions?.filter(a => a.actionCode === 'EMBEZZLE') ?? [];
          if (embezzleActions.length === 0) continue;
          const embezzlerState = weekStateMap.get(intent.agentId);
          if (!embezzlerState) continue;
          const EMBEZZLE_TARGET = 20 * embezzleActions.length;
          const contributors = aliveAgents.filter(a => a.id !== intent.agentId);
          if (contributors.length === 0) continue;

          // Compute available wealth per contributor (capped at 0)
          const availableList = contributors.map(c => {
            const cState = weekStateMap.get(c.id);
            return cState ? Math.max(0, c.currentStats.wealth + cState.wealthDelta) : 0;
          });
          const totalAvailable = availableList.reduce((s, v) => s + v, 0);

          // Use pro-rata shares based on available wealth; cap each contributor at their available
          const targetShares = distributeProRata(
            Math.min(EMBEZZLE_TARGET, Math.floor(totalAvailable)),
            availableList.map(a => (a > 0 ? a : 0)),
          );

          let totalEmbezzled = 0;
          for (let i = 0; i < contributors.length; i++) {
            const contributor = contributors[i];
            const cState = weekStateMap.get(contributor.id);
            if (!cState) continue;
            const deducted = Math.min(targetShares[i] ?? 0, availableList[i] ?? 0);
            cState.wealthDelta -= deducted;
            totalEmbezzled += deducted;
          }
          embezzlerState.wealthDelta += totalEmbezzled;
          embezzlerState.events.push(`Embezzled ${totalEmbezzled.toFixed(1)} fiat from communal pool (spread across ${contributors.length} agents)`);
        }
      }

      // ── AMM Famine Reserve: ensure minimum food supply before metabolism ───
      // Equivalent to the "sys_farm" in the physics sandbox: injects a small
      // background food production into the AMM so the auto-buy in applyMETMetabolism
      // always finds some supply, preventing complete market deadlock.
      // Injection = 1 food unit per alive agent (baseline subsistence floor).
      // SFC fix: withdraw matching fiat from the AMM to keep k constant, and fund
      // the withdrawn fiat into the treasury so total system fiat is conserved.
      {
        const primaryAMM = sessionAMMRegistry.get(sessionId);
        if (primaryAMM && aliveAgents.length > 0) {
          const foodReserve = primaryAMM.currentFoodReserve;
          const minReserve = aliveAgents.length * 2;
          if (foodReserve < minReserve) {
            const injection = minReserve - foodReserve;
            // Add food to AMM without changing k: sell food into the AMM at market rate.
            // This increases food reserve and decreases fiat reserve, keeping k constant.
            // The fiat withdrawn goes to the treasury (system subsidy).
            const sellReceipt = primaryAMM.executeSell(injection, iterNum);
            if (sellReceipt.success && 'fiatOut' in sellReceipt.quote) {
              // Route the fiat from this system sale into the treasury
              const fiatFromSale = sellReceipt.quote.fiatOut;
              const treasury = sessionStateTreasury.get(sessionId) ?? 0;
              sessionStateTreasury.set(sessionId, treasury + fiatFromSale);
            }
          }
        }
      }

      // ── Inventory Depreciation: food spoilage + tool wear ─────────────────
      // Previously orphaned in inventorySystem.processInventory — now integrated
      // into the simulation loop so tools actually break and food actually spoils.
      for (const agent of aliveAgents) {
        const weekState = weekStateMap.get(agent.id)!;
        const inv = weekState.inventory;

        // Food quality decay: 15% per iteration (ITEM_PROPERTIES.food.decayRate = 0.15)
        if (inv.food.quantity > 0) {
          inv.food.quality = Math.max(0, inv.food.quality - 0.15 * 100);
          // Spoiled food (quality < 10) is removed
          if (inv.food.quality < 10) {
            weekState.events.push(`${inv.food.quantity} food spoiled (quality decayed below threshold)`);
            inv.food.quantity = 0;
            inv.food.quality = 100; // reset for new stock
          }
        }

        // Tool depreciation from work actions
        const workedThisTurn = weekState.executedActions.some(
          a => a.actionCode === 'WORK' || a.actionCode === 'WORK_AT_ENTERPRISE' || a.actionCode === 'PRODUCE_AND_SELL'
        );
        if (workedThisTurn && inv.tools.quantity > 0) {
          inv.tools.quality = Math.max(0, inv.tools.quality - 5); // TOOL_WEAR_PER_WORK = 5
          if (inv.tools.quality < 5) { // TOOL_BREAK_THRESHOLD = 5
            inv.tools.quantity = Math.max(0, inv.tools.quantity - 1);
            inv.tools.quality = inv.tools.quantity > 0 ? 80 : 100;
            weekState.events.push('A tool broke from use');
          }
        }

        // Raw materials quality decay: 1% per iteration (very slow)
        if (inv.raw_materials.quantity > 0) {
          inv.raw_materials.quality = Math.max(0, inv.raw_materials.quality - 0.01 * 100);
          if (inv.raw_materials.quality < 10) {
            weekState.events.push(`${inv.raw_materials.quantity} raw materials degraded`);
            inv.raw_materials.quantity = 0;
            inv.raw_materials.quality = 100;
          }
        }
      }

      // ── MET Metabolism: replace flat -1 food with physiological depletion ─
      for (const agent of aliveAgents) {
        const weekState = weekStateMap.get(agent.id)!;
        applyMETMetabolism(weekState, { ...agent, currentWealth: agent.currentStats.wealth }, sessionId, iterNum);
      }

      // ── Allostatic Load Pipeline: cortisol → strain → load → health ───────
      {
        let sessionAlloStates = sessionAllostaticStates.get(sessionId);
        if (!sessionAlloStates) {
          sessionAlloStates = new Map();
          sessionAllostaticStates.set(sessionId, sessionAlloStates);
        }
        for (const agent of aliveAgents) {
          const weekState = weekStateMap.get(agent.id)!;
          const currentCortisol = clampStat((agent.currentStats.cortisol ?? 20) + weekState.cortisolDelta);
          const currentDopamine = clampStat((agent.currentStats.dopamine ?? 50) + weekState.dopamineDelta);
          const priorState = sessionAlloStates.get(agent.id) ?? { allostaticStrain: 0, allostaticLoad: 0 };
          const engine = new AllostaticEngine(priorState);
          // D2: Pass dopamine so anhedonia (≤30) adds +4 cortisol feedback in the allostatic engine
          const alloResult = engine.tick({ cortisol: currentCortisol, dopamine: currentDopamine });
          if (alloResult.healthDelta < 0) {
            weekState.healthDelta += alloResult.healthDelta;
            weekState.events.push(
              `Allostatic overload: health ${alloResult.healthDelta.toFixed(1)} (strain: ${alloResult.updatedState.allostaticStrain.toFixed(1)}, load: ${alloResult.updatedState.allostaticLoad.toFixed(1)})`
            );
          }
          sessionAlloStates.set(agent.id, alloResult.updatedState);
        }
      }

      // ── Demurrage UBI: 2% wealth tax → redistributed as equal UBI ─────────
      {
        const agentWealthList: AMMAgentWealth[] = aliveAgents.map(agent => ({
          agentId: agent.id,
          wealth: clampWealth(agent.currentStats.wealth + (weekStateMap.get(agent.id)?.wealthDelta ?? 0)),
        }));
        const demurrage = computeDemurrageCycle(agentWealthList, sessionPolicy.tax_rate, sessionPolicy.ubi_allocation);
        for (const [agentId, netDelta] of demurrage.netDeltas) {
          const weekState = weekStateMap.get(agentId);
          if (!weekState) continue;
          weekState.wealthDelta += netDelta;
          if (netDelta > 0.5) {
            weekState.events.push(`UBI received: +${netDelta.toFixed(1)} fiat (demurrage redistribution @ ${(sessionPolicy.ubi_allocation * 100).toFixed(0)}% UBI allocation)`);
          } else if (netDelta < -0.5) {
            weekState.events.push(`Demurrage tax: ${netDelta.toFixed(1)} fiat (${(sessionPolicy.tax_rate * 100).toFixed(1)}% wealth decay)`);
          }
        }
        // SFC fix: When ubiAllocation < 1.0, the un-redistributed portion of the tax
        // pool would vanish from the economy. The floored UBI pool also leaves a
        // sub-unit remainder that must stay in treasury rather than disappear.
        {
          const clampedUbiAllocation = Math.min(1, Math.max(0, sessionPolicy.ubi_allocation));
          const unredistributed = demurrage.taxPoolCollected * (1 - clampedUbiAllocation);
          const treasuryCredit = unredistributed + demurrage.ubiFractionalRemainder;
          if (treasuryCredit > 0) {
            const treasury = sessionStateTreasury.get(sessionId) ?? 0;
            sessionStateTreasury.set(sessionId, treasury + treasuryCredit);
          }
        }
      }

      // Phase Sheriff C redistribution is deferred until after the stat-update loop
      // so that death/humiliation seizures (added inside that loop) are included.


      // ── Market board: AMM spot price for food + order book for other items ─
      const sessionAMM = sessionAMMRegistry.get(sessionId);
      const marketState = orderBook.getMarketState();
      latestMarketBoard = buildMarketBoardEntries(sessionId, marketState);
      if (sessionAMM) {
        // Inject AMM food spot price into market board (overrides order book food entry)
        const ammFoodPrice = Math.round(sessionAMM.spotPrice * 100) / 100;
        const prevFoodPrice = sessionPriceHistory.get(sessionId)?.get('food');
        let ammFoodTrend: MarketBoardEntry['trend'] = 'unknown';
        if (prevFoodPrice == null) ammFoodTrend = 'new';
        else if (ammFoodPrice > prevFoodPrice) ammFoodTrend = 'up';
        else if (ammFoodPrice < prevFoodPrice) ammFoodTrend = 'down';
        else ammFoodTrend = 'flat';
        // Replace or prepend food entry
        const withoutFood = latestMarketBoard.filter(e => e.itemType !== 'food');
        const INITIAL_FOOD_SPOT_PRICE = 6.0;
        latestMarketBoard = [{ itemType: 'food', averageClearingPrice: ammFoodPrice, trend: ammFoodTrend }, ...withoutFood];
        // Update price history for food from AMM
        let priceHist = sessionPriceHistory.get(sessionId);
        if (!priceHist) { priceHist = new Map(); sessionPriceHistory.set(sessionId, priceHist); }
        priceHist.set('food', ammFoodPrice);
      }
      // Add multi-commodity AMM spot prices to market board
      const multiAMMsForBoard = sessionMultiAMMRegistry.get(sessionId);
      if (multiAMMsForBoard) {
        const multiEntries = Array.from(multiAMMsForBoard.entries()).map(([itemType, pool]) => {
          const spotPrice = Math.round(pool.spotPrice * 100) / 100;
          const prevMultiPrice = sessionPriceHistory.get(sessionId)?.get(itemType as ItemType);
          let multiTrend: MarketBoardEntry['trend'] = 'unknown';
          if (prevMultiPrice == null) multiTrend = 'new';
          else if (spotPrice > prevMultiPrice) multiTrend = 'up';
          else if (spotPrice < prevMultiPrice) multiTrend = 'down';
          else multiTrend = 'flat';
          return { itemType, averageClearingPrice: spotPrice, trend: multiTrend };
        });
        latestMarketBoard = [
          ...latestMarketBoard,
          ...multiEntries.filter(e => !latestMarketBoard.some(m => m.itemType === e.itemType)),
        ];
      }
      if (multiAMMsForBoard) {
        let priceHistForMulti = sessionPriceHistory.get(sessionId);
        if (!priceHistForMulti) { priceHistForMulti = new Map(); sessionPriceHistory.set(sessionId, priceHistForMulti); }
        for (const [itemType, pool] of multiAMMsForBoard) {
          priceHistForMulti.set(itemType as ItemType, Math.round(pool.spotPrice * 100) / 100);
        }
      }
      updatePriceHistory(sessionId, marketState.priceIndices);
      orderBook.reset();

      for (const agent of aliveAgents) {
        const outcome = outcomeMap.get(agent.id);
        const agentIntent = intentMap.get(agent.id);
        const weekState = weekStateMap.get(agent.id)!;

        let newWealth = clampWealth(agent.currentStats.wealth + r4(weekState.wealthDelta));
        let newHealth = clampStat(agent.currentStats.health + weekState.healthDelta);
        let newHappiness = clampStat(agent.currentStats.happiness + weekState.happinessDelta);
        let newCortisol = clampStat((agent.currentStats.cortisol ?? 20) + weekState.cortisolDelta);
        let newDopamine = clampStat((agent.currentStats.dopamine ?? 50) + weekState.dopamineDelta);

        // Task 1: Psychological clamping — cap Happiness based on physiological state.
        // Prevents LLM hallucinations of "100 Happiness" while starving to death.
        newHappiness = clampHappinessByPhysiology(newHappiness, newHealth, newCortisol);

        const shouldDie = (outcome?.died === true) || newHealth <= 2;
        const isBreakdownTrapped =
          weekState.interruptedReason === 'mental_breakdown' &&
          weekState.inventory.food.quantity <= 0 &&
          newWealth < physicsConfig.lowWealthThreshold;
        const shouldHumiliate = !shouldDie && (
          (newHealth < 20 && weekState.inventory.food.quantity <= 0) ||
          isBreakdownTrapped
        );

        if (shouldDie) {
          deaths.push({ id: agent.id, iterationNumber: iterNum });
          const lifecycleEvent = resolution.lifecycleEvents?.find(
            (e: { type: string; agentId: string; detail?: string }) => e.agentId && e.agentId === agent.id && e.type === 'death'
          );
          const deathReason = lifecycleEvent?.detail ?? (newHealth <= 2 ? 'health depleted' : 'fatal circumstances');
          deathReasonMap.set(agent.id, { iteration: iterNum, reason: deathReason });
          // SFC fix: Remove dead agent's orders from the order book to prevent
          // stale orders matching in future iterations and leaking fiat.
          orderBook.removeAgentOrders(agent.id);
          // Fix B1: Redistribute dying agent's wealth into the seized pool (death tax / escheat)
          seizedWealthPool += Math.max(0, newWealth);
          newWealth = 0;
        } else if (shouldHumiliate) {
          humiliatedAgentIds.add(agent.id);
          // Fix B2: Redistribute humiliated agent's stripped wealth before zeroing
          seizedWealthPool += Math.max(0, newWealth);
          newHealth = 30;
          newWealth = 0;
          // Set cortisol to 85 — below the mentalBreakdownCortisolInterrupt threshold (90)
          // so the agent can queue at least one action next turn and is not permanently locked.
          newCortisol = 85;
          // Re-clamp happiness with the new physiology: health=30, cortisol=85
          newHappiness = clampHappinessByPhysiology(newHappiness, newHealth, newCortisol);
        }

        // Deterministic recovery path for agents whose queues were interrupted by
        // mental breakdown. This prevents locked-health sessions from trapping
        // poor agents in a permanent cortisol > 90 loop with no route back to work.
        if (weekState.interruptedReason === 'mental_breakdown') {
          newCortisol = Math.min(newCortisol, 75);
          newHappiness = clampHappinessByPhysiology(newHappiness, newHealth, newCortisol);
        }

        // Controlled Variable Method: absolute locks restore initial stat values
        if (lockedVariables.includes('wealth')) newWealth = agent.initialStats.wealth;
        if (lockedVariables.includes('health')) newHealth = agent.initialStats.health;
        if (lockedVariables.includes('happiness')) newHappiness = agent.initialStats.happiness;
        if (lockedVariables.includes('cortisol')) newCortisol = agent.initialStats.cortisol ?? 20;
        if (lockedVariables.includes('dopamine')) newDopamine = agent.initialStats.dopamine ?? 50;

        statUpdates.push({
          id: agent.id,
          wealth: newWealth,
          health: newHealth,
          happiness: newHappiness,
          cortisol: newCortisol,
          dopamine: newDopamine,
        });

        // Task 4: Build action-result feedback for next iteration's prompt injection
        {
          const wDelta = newWealth - agent.currentStats.wealth;
          const hDelta = newHealth - agent.currentStats.health;
          const hapDelta = newHappiness - agent.currentStats.happiness;
          const lines: string[] = [];
          if (weekState.executedActions.length > 0) {
            lines.push(`Actions taken: ${weekState.executedActions.map(a => a.actionCode).join(', ')}`);
          }
          const economyLines = weekState.events.filter(e =>
            /sold|bought|produced|wage|starv|food|fail|UBI|demurrage|AMM|market|hired|quit|enterprise/i.test(e)
          ).slice(0, 6);
          if (economyLines.length > 0) lines.push(...economyLines.map(e => `• ${e}`));
          lines.push(`Net changes: Wealth ${wDelta >= 0 ? '+' : ''}${wDelta}, Health ${hDelta >= 0 ? '+' : ''}${hDelta}, Happiness ${hapDelta >= 0 ? '+' : ''}${hapDelta}`);
          if (weekState.interrupted) {
            lines.push(`⚠️ Action queue interrupted: ${weekState.interruptedReason}`);
          }
          // Phase B: inject enterprise ledger summary for owners
          const ownedEnterprise = [...enterpriseRegistry.values()].find(e => e.ownerId === agent.id);
          if (ownedEnterprise) {
            const ledger = enterpriseLedgerMap.get(ownedEnterprise.id);
            if (ledger) {
              const netProfit = ledger.totalRevenue - ledger.totalWages;
              const profitLabel = netProfit >= 0 ? `+${netProfit.toFixed(1)}` : netProfit.toFixed(1);
              lines.push(
                `[Enterprise ${ownedEnterprise.id} Summary]: Total Revenue from Labor (+${ledger.totalRevenue.toFixed(1)}), Total Wages Paid (-${ledger.totalWages.toFixed(1)}). **Net Weekly Profit: ${profitLabel}.**` +
                (netProfit < 0 ? ' ⚠️ Your enterprise is LOSING money. Consider FIRE_EMPLOYEE or adjusting your business model.' : '')
              );
            }
          }
          const resultText = `[Week ${iterNum} Results]\n${lines.join('\n')}`;
          let agentResults = sessionLastActionResults.get(sessionId);
          if (!agentResults) { agentResults = new Map(); sessionLastActionResults.set(sessionId, agentResults); }
          agentResults.set(agent.id, resultText);
        }

        for (const action of weekState.executedActions) {
          const rawTarget = action.parameters?.target ?? action.parameters?.agent_id;
          const targetText = typeof rawTarget === 'string' ? rawTarget.toLowerCase() : '';
          const targetAgent = aliveAgents.find(a => a.id === rawTarget || a.name.toLowerCase() === targetText);
          if (action.actionCode === 'SABOTAGE' && targetAgent) {
            sabotageRegistry.set(targetAgent.id, 3);
          }
          if (action.actionCode === 'SUPPRESS' && targetAgent) {
            suppressRegistry.set(targetAgent.id, 2);
            const targetUpdate = statUpdates.find(u => u.id === targetAgent.id);
            if (targetUpdate) {
              targetUpdate.cortisol = clampStat(targetUpdate.cortisol + 25);
              targetUpdate.happiness = clampStat(targetUpdate.happiness - 10);
            }
          }
        }

        const lockedSnap = lockedEconomySnapshot.get(agent.id);
        economyUpdates.push({
          agentId: agent.id,
          sessionId,
          skills: lockedVariables.includes('skills') && lockedSnap ? lockedSnap.skills : weekState.skills,
          inventory: lockedVariables.includes('inventory') && lockedSnap ? lockedSnap.inventory : weekState.inventory,
          lastUpdated: iterNum,
        });

        const actionRow = {
          id: uuidv4(),
          sessionId,
          agentId: agent.id,
          iterationId,
          action: outcome?.outcome ?? agentIntent?.intent ?? 'No action.',
          outcome: JSON.stringify({
            text: outcome?.outcome ?? agentIntent?.intent ?? 'No action.',
            actionQueue: weekState.executedActions,
            wealthDelta: weekState.wealthDelta,
            healthDelta: weekState.healthDelta,
            happinessDelta: weekState.happinessDelta,
            // Final clamped stat values after physiology clamping and lifecycle events.
            // Used by /agent-stats to reconstruct per-agent history accurately.
            finalWealth: newWealth,
            finalHealth: newHealth,
            finalHappiness: newHappiness,
            interrupted: weekState.interrupted,
            interruptedReason: weekState.interruptedReason,
            economyEvents: weekState.events,
            foodAfterMetabolism: weekState.inventory.food.quantity,
          }),
          resolvedAt: now,
        };
        actionRows.push(actionRow);
        actionRowByAgentId.set(agent.id, actionRow);
      }

      // ── Phase Sheriff C: redistribute seized wealth (SFC-safe) ────────────
      // Runs after the stat-update loop so death and humiliation seizures are
      // included in the pool before redistribution. Distributes directly into
      // statUpdates (excluding agents who died this iteration) so the pool is
      // never silently dropped from the closed-loop economy.
      if (seizedWealthPool > 0) {
        const deadIds = new Set(deaths.map(d => d.id));
        const survivorUpdates = statUpdates.filter(u => !deadIds.has(u.id));
        if (survivorUpdates.length > 0) {
          // BUG-12/14 fix: Use distributeProRata for integer-safe equal distribution
          // to prevent float drift (e.g., 100 / 3 = 33.33... × 3 = 99.999...).
          const integerPool = Math.floor(seizedWealthPool);
          const fractionalRemainder = seizedWealthPool - integerPool;
          const equalShares = distributeProRata(
            integerPool,
            survivorUpdates.map(() => 1),
          );
          // Preserve the fractional remainder by routing it to the first survivor.
          const seizedUBI = seizedWealthPool / survivorUpdates.length; // for display only
          for (let i = 0; i < survivorUpdates.length; i++) {
            const update = survivorUpdates[i];
            const share = (equalShares[i] ?? 0) + (i === 0 ? fractionalRemainder : 0);
            update.wealth = clampWealth(update.wealth + share);
            const actionRow = actionRowByAgentId.get(update.id);
            if (actionRow?.outcome) {
              try {
                const parsed = JSON.parse(actionRow.outcome) as {
                  wealthDelta?: number;
                  finalWealth?: number;
                };
                parsed.wealthDelta = Number(parsed.wealthDelta ?? 0) + share;
                parsed.finalWealth = update.wealth;
                actionRow.outcome = JSON.stringify(parsed);
              } catch {
                // Leave malformed historical payloads untouched; live stats remain correct.
              }
            }
          }
          simulationManager.broadcast(sessionId, {
            type: 'resolution',
            iteration: iterNum,
            narrativeSummary: `⚖️ State enforcement: ${seizedWealthPool.toFixed(1)} fiat redistributed equally among ${survivorUpdates.length} survivors (+${seizedUBI.toFixed(1)}/citizen).`,
            lifecycleEvents: [],
          });
        } else {
          // If everyone died this iteration, keep confiscated fiat in the treasury
          // rather than dropping it from the closed-loop economy.
          const treasury = sessionStateTreasury.get(sessionId) ?? 0;
          sessionStateTreasury.set(sessionId, treasury + seizedWealthPool);
        }
      }

      // ── Capital market request accumulation ────────────────────────────────
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
        const allEquityPositions = capitalMarketRepo.getEquityPositionsBySession(scope);
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
        const loans = bankingRepo.getActiveLoans(scope);
        const deposits = bankingRepo.getDepositsBySession(scope);

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
          appendTrace(sessionId, bankingDelta.trace.join('\n'));
        }

        // Get banking totals for SFC audit and telemetry
        bankingTotalDeposits = bankingRepo.getTotalDeposits(scope);
        bankingCollateralEscrow = bankingRepo.getTotalCollateral(scope);
        bankingLoansOutstanding = bankingRepo.getTotalLoansOutstanding(scope);
      }

      // ── Capital market tick ───────────────────────────────────────────────
      // Runs immediately after banking tick so agent wealth (post-banking) is current.
      // All capital market DB writes are batched in a single transaction.
      // SFC: bond/equity transactions are SFC-neutral transfers within the perimeter —
      // no escrow term needed; computeSystemFiatTotal is unchanged.
      if (cmktEconomyConfig.capitalMarketsEnabled) {
        const equityPositions = capitalMarketRepo.getEquityPositionsBySession(scope);
        const bondHoldings = capitalMarketRepo.getActiveBondHoldingsBySession(scope);

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

        // SFC fix V3: Pro-rate gov-bond payouts when treasury cannot cover obligations.
        // Scale positive wealthDeltas (gov-bond coupon/maturity receipts) before applying
        // them so no fiat is created from nothing when the treasury runs dry.
        const currentTreasury = sessionStateTreasury.get(sessionId) ?? 0;
        const newTreasury = currentTreasury + cmktDelta.treasuryDelta;
        if (newTreasury < 0 && cmktDelta.treasuryDelta < 0) {
          const scaleFactor = currentTreasury > 0
            ? currentTreasury / Math.abs(cmktDelta.treasuryDelta)
            : 0;
          for (const [agentId, delta] of cmktDelta.wealthDeltas) {
            if (delta > 0) {
              cmktDelta.wealthDeltas.set(agentId, Math.floor(delta * scaleFactor));
            }
          }
          sessionStateTreasury.set(sessionId, 0);
        } else {
          sessionStateTreasury.set(sessionId, Math.max(0, newTreasury));
        }

        // Apply (possibly scaled) wealth deltas in-memory (persisted with statUpdates)
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

        // Append capital market traces to physics trace log
        if (cmktDelta.trace.length > 0) {
          appendTrace(sessionId, cmktDelta.trace.join('\n'));
        }
      }

      // ── Fiscal policy tick ──────────────────────────────────────────────────
      // Runs after capital market tick. Executes budget spending from treasury,
      // updates public goods quality, applies welfare payments to agents.
      // SFC: all spending flows from treasury to agents (direct transfers).
      let fiscalPublicGoodsQuality: { infrastructureQuality: number; educationQuality: number; defenseQuality: number; welfareQuality: number } | null = null;
      if (economyConfig.fiscalEnabled) {
        const budgetAllocation = fiscalRepo.getActiveBudget(scope) ?? DEFAULT_BUDGET_ALLOCATION;
        const currentPublicGoods = fiscalRepo.getPublicGoodsState(scope);
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
          appendTrace(sessionId, fiscalDelta.trace.join('\n'));
        }
      }

      // ── Inflation tick ────────────────────────────────────────────────────
      // Runs after banking/capital/fiscal effects are known so CPI, M1, and treasury
      // all reflect the end-of-iteration macro state before telemetry is recorded.
      if (economyConfig.inflationEnabled) {
        const configRoot = (session.config as Record<string, unknown> | null) ?? {};
        const persistedEconomyConfig = getEconomyConfig(configRoot);
        const currentPrices = getInflationBasketPrices(sessionId, persistedEconomyConfig, marketState.priceIndices);
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

      const finalStatsByAgentId = new Map(statUpdates.map(u => [u.id, u]));

      const cognitivePostInputs: CognitivePostInput[] = aliveAgents.map(agent => {
        const agentIntent = intentMap.get(agent.id);
        const weekState = weekStateMap.get(agent.id)!;
        const isHumiliated = humiliatedAgentIds.has(agent.id);
        return {
          agentId: agent.id,
          sessionId,
          iteration: iterNum,
          actionPerformed: isHumiliated
            ? `[HUMILIATION] I ran out of resources and was force-fed synthetic slop by the state. My remaining wealth was stripped. I am at the absolute bottom of society. I feel extreme rage and despair.`
            : (agentIntent?.intent ?? 'continued routine'),
          actionCode: agentIntent?.primaryActionCode ?? 'NONE',
          wealthDelta: isHumiliated ? -agent.currentStats.wealth : (finalStatsByAgentId.get(agent.id)?.wealth ?? agent.currentStats.wealth) - agent.currentStats.wealth,
          healthDelta: isHumiliated ? -(agent.currentStats.health - 30) : weekState.healthDelta,
          happinessDelta: isHumiliated ? -20 : weekState.happinessDelta,
          cortisolDelta: isHumiliated ? 30 : weekState.cortisolDelta,
          dopamineDelta: isHumiliated ? -20 : weekState.dopamineDelta,
          economyEvents: weekState.events,
          isStarving: weekState.inventory.food.quantity <= 0,
          narrativeSummary: resolution.narrativeSummary,
        };
      });
      runCognitivePostProcessing(cognitivePostInputs);

      // ── Compute employment metrics ────────────────────────────────────────
      {
        const totalWorked = [...weekStateMap.values()].filter(ws => ws.workedEnterpriseId !== null).length;
        const unemployedAgents = aliveAgents.filter(a => !employmentRegistry.has(a.id));
        // Display rounding only; underlying agent wealth remains unrounded
      const avgUnemployedWealth = unemployedAgents.length > 0
          ? Math.round(unemployedAgents.reduce((s, a) => s + a.currentStats.wealth, 0) / unemployedAgents.length)
          : 0;
        const bankruptcyNote = bankruptciesThisIter > 0
          ? ` ${bankruptciesThisIter} enterprise${bankruptciesThisIter > 1 ? 's' : ''} went bankrupt this week, causing a spike in unemployment.`
          : '';
        const ammForMetrics = sessionAMMRegistry.get(sessionId);
        const multiAMMsForMetrics = sessionMultiAMMRegistry.get(sessionId);
        let marketContextBlock = '';
        if (ammForMetrics) {
          const foodReserve = ammForMetrics.currentFoodReserve;
          const foodPrice = ammForMetrics.spotPrice;
          const foodStatus = foodReserve < 10 ? 'CRITICAL' : foodReserve < 30 ? 'LOW' : foodReserve < 100 ? 'NORMAL' : 'SURPLUS';
          let foodVerdict = '';
          if (foodStatus === 'CRITICAL' || foodStatus === 'LOW') foodVerdict = ' — food is SCARCE, famine conditions may apply';
          else if (foodStatus === 'SURPLUS') foodVerdict = ' — food is ABUNDANT, do NOT narrate famine or empty markets';
          else foodVerdict = ' — food supply is adequate';
          marketContextBlock = `\n\n[MARKET STATE — AUTHORITATIVE]\n- Food: ${foodReserve.toFixed(1)} units in AMM reserve (${foodStatus}), spot price ${foodPrice.toFixed(2)} fiat${foodVerdict}`;
        }
        if (multiAMMsForMetrics) {
          for (const [itemType, pool] of multiAMMsForMetrics) {
            const reserve = pool.currentFoodReserve;
            const price = pool.spotPrice;
            const rStatus = reserve < 5 ? 'CRITICAL' : reserve < 20 ? 'LOW' : reserve < 80 ? 'NORMAL' : 'SURPLUS';
            marketContextBlock += `\n- ${itemType}: ${reserve.toFixed(1)} units (${rStatus}), spot price ${price.toFixed(2)} fiat`;
          }
        }
        sessionIterationMetrics.set(sessionId,
          `System Metrics (iteration ${iterNum}): ${totalWorked}/${aliveAgents.length} agents successfully worked. ${unemployedAgents.length} total unemployed. Average unemployed wealth: ${avgUnemployedWealth}.${bankruptcyNote}${marketContextBlock}`
        );
        // B5: Detect food monoculture and add diversity warning to LLM context
        const produceActions = [...weekStateMap.values()].flatMap(ws =>
          ws.executedActions.filter(a => a.actionCode === 'PRODUCE_AND_SELL')
        );
        if (produceActions.length > 0) {
          const foodCount = produceActions.filter(a => a.parameters?.itemType === 'food' || !a.parameters?.itemType).length;
          const foodPct = Math.round((foodCount / produceActions.length) * 100);
          if (foodPct > 70) {
            const prevMetricsB5 = sessionIterationMetrics.get(sessionId) ?? '';
            sessionIterationMetrics.set(sessionId,
              prevMetricsB5 + ` Economy warning: ${foodPct}% of production was food this iteration. Raw materials and luxury goods are undersupplied — agents who diversify will find higher margins.`
            );
          }
        }
      }

      // ── Telemetry: push per-iteration physics snapshot ────────────────────
      // Declared outside the block so it can be embedded in the statistics JSON below.
      let iterTelemetry: TelemetryLog | null = null;
      {
        const sessionAMMForTelemetry = sessionAMMRegistry.get(sessionId);
        const multiAMMsForTelemetry = sessionMultiAMMRegistry.get(sessionId);
        const treasury = sessionStateTreasury.get(sessionId) ?? 0;
        const finalWealthByAgentId = new Map(statUpdates.map(update => [update.id, update.wealth]));
        const totalFiatSupply = computeSystemFiatTotal(
          agents,
          sessionAMMForTelemetry,
          multiAMMsForTelemetry,
          treasury,
          finalWealthByAgentId,
          bankingTotalDeposits,
          bankingCollateralEscrow,
        );
        const totalCaloriesBurned = [...weekStateMap.values()].reduce((sum, ws) => sum + ws.caloriesBurned, 0);
        const totalCaloriesProduced = [...weekStateMap.values()].reduce((sum, ws) => sum + ws.caloriesProduced, 0);
        const totalFailedActions = [...weekStateMap.values()].reduce((sum, ws) => sum + ws.failedActionCount, 0);
        const totalActionSlots = aliveAgents.length * 3; // max 3 actions per agent per iteration
        const actionFailureRate = totalActionSlots > 0
          ? Math.round((totalFailedActions / totalActionSlots) * 1000) / 1000
          : 0;
        // ── Analytical metrics ──────────────────────────────────────────────
        // Gini coefficient: measures wealth inequality (0 = perfect equality, 1 = total inequality)
        const giniCoefficient = gini(statUpdates.map(u => u.wealth));
        // Trust and crime indices from executed actions
        const allExecutedActions = [...weekStateMap.values()].flatMap(ws => ws.executedActions);
        const helpCount = allExecutedActions.filter(a => a.actionCode === 'HELP').length;
        const stealCount = allExecutedActions.filter(a => a.actionCode === 'STEAL').length;
        const sabotageCount = allExecutedActions.filter(a => a.actionCode === 'SABOTAGE').length;
        const embezzleCount = allExecutedActions.filter(a => a.actionCode === 'EMBEZZLE').length;
        const totalActions = allExecutedActions.filter(a => a.actionCode !== 'NONE').length;
        const trustDenom = helpCount + stealCount;
        // undefined when no cooperative/predatory actions occurred — avoids false "perfect trust" signal
        const trustIndex = trustDenom > 0 ? Math.round((helpCount / trustDenom) * 1000) / 1000 : undefined;
        const crimeRate = totalActions > 0
          ? Math.round(((stealCount + sabotageCount + embezzleCount) / totalActions) * 1000) / 1000
          : 0;
        // Social mobility: fraction of agents with role changes this iteration
        const roleChangeCount = resolution.lifecycleEvents?.filter(
          (e: { type: string }) => e.type === 'role_change'
        ).length ?? 0;
        const socialMobilityIndex = aliveAgents.length > 0
          ? Math.round((roleChangeCount / aliveAgents.length) * 1000) / 1000
          : 0;
        // Population averages
        const averageCortisol = statUpdates.length > 0
          ? Math.round(statUpdates.reduce((s, u) => s + u.cortisol, 0) / statUpdates.length)
          : 0;
        const averageDopamine = statUpdates.length > 0
          ? Math.round(statUpdates.reduce((s, u) => s + u.dopamine, 0) / statUpdates.length)
          : 0;

        iterTelemetry = {
          iterationNumber: iterNum,
          totalFiatSupply: totalFiatSupply,  // Unrounded for SFC accuracy
          totalFiatSupplyRounded: Math.round(totalFiatSupply),  // Rounded for UI display
          ammFoodReserve_Y: Math.round((sessionAMMForTelemetry?.currentFoodReserve ?? 0) * 100) / 100,
          ammFiatReserve_X: Math.round(sessionAMMForTelemetry?.currentFiatReserve ?? 0),
          ammSpotPrice_Food: Math.round((sessionAMMForTelemetry?.spotPrice ?? 0) * 100) / 100,
          totalCaloriesBurned: Math.round(totalCaloriesBurned * 10) / 10,
          totalCaloriesProduced: Math.round(totalCaloriesProduced),
          actionFailureRate,
          giniCoefficient,
          socialMobilityIndex,
          trustIndex,
          crimeRate,
          averageCortisol,
          averageDopamine,
          // Banking M0/M1 telemetry (zero when bankingEnabled is false)
          m0: totalFiatSupply,  // base money — constant under SFC (includes depositBalances + collateral)
          m1: totalFiatSupply + bankingLoansOutstanding,  // M1 = M0 + outstanding loan principals
          loansOutstanding: bankingLoansOutstanding,
          ...(inflationTelemetry ?? {}),
          // Fiscal public goods quality telemetry (absent when fiscalEnabled is false)
          ...(fiscalPublicGoodsQuality ? {
            infrastructureQuality: Math.round(fiscalPublicGoodsQuality.infrastructureQuality * 100) / 100,
            educationQuality: Math.round(fiscalPublicGoodsQuality.educationQuality * 100) / 100,
            defenseQuality: Math.round(fiscalPublicGoodsQuality.defenseQuality * 100) / 100,
            welfareQuality: Math.round(fiscalPublicGoodsQuality.welfareQuality * 100) / 100,
          } : {}),
        };
        // Phase A: SFC drift check — warn if unaccounted fiat appears or disappears.
        // Keep a floor tolerance so extinction or tiny populations do not generate
        // meaningless warnings from sub-cent floating-point noise.
        if (sfcPrevTotalFiat !== null) {
          const sfcDrift = totalFiatSupply - sfcPrevTotalFiat;
          const tolerance = Math.max(0.1, aliveAgents.length * 0.01);
          if (Math.abs(sfcDrift) > tolerance) {
            const agentNote = aliveAgents.length === 0 ? 'with 0 alive agents' : `with ${aliveAgents.length} alive agents`;
            console.warn(`[SFC] iter=${iterNum}: drift=${sfcDrift.toFixed(6)} ${agentNote} — possible unaccounted fiat creation or destruction`);
          }
        }
        sfcPrevTotalFiat = totalFiatSupply;

        let logs = sessionTelemetryLogs.get(sessionId);
        if (!logs) { logs = []; sessionTelemetryLogs.set(sessionId, logs); }
        logs.push(iterTelemetry);

        // Append analytical metrics to LLM context for the NEXT iteration's resolution
        const prevMetrics = sessionIterationMetrics.get(sessionId) ?? '';
        const trustNote = trustIndex !== undefined ? ` Trust ratio: ${trustIndex.toFixed(2)}.` : '';
        sessionIterationMetrics.set(sessionId,
          prevMetrics + ` Inequality: Gini=${giniCoefficient.toFixed(3)}.${trustNote} Crime rate: ${crimeRate.toFixed(2)}.`
        );
      }

      sqlite.transaction(() => {
        if (statUpdates.length > 0) {
          agentRepo.bulkUpdateStats(statUpdates);
        }
        if (deaths.length > 0) {
          agentRepo.bulkMarkDead(deaths);
        }
        // Persist allostatic strain/load alongside stats so restarts resume correctly
        const alloStates = sessionAllostaticStates.get(sessionId);
        if (alloStates && alloStates.size > 0) {
          const alloUpdates = aliveAgents
            .map(agent => {
              const state = alloStates.get(agent.id);
              if (!state) return null;
              return { id: agent.id, allostaticStrain: state.allostaticStrain, allostaticLoad: state.allostaticLoad };
            })
            .filter((u): u is { id: string; allostaticStrain: number; allostaticLoad: number } => u !== null);
          agentRepo.bulkUpdateAllostaticStates(alloUpdates);
        }
      })();

      if (economyUpdates.length > 0) {
        await economyRepo.bulkUpsertAgentEconomy(economyUpdates);
        for (const eu of economyUpdates) {
          agentEconomyMap.set(eu.agentId, eu);
        }
      }

      const snapshot = {
        iteration: iterNum,
        market: marketState,
        contracts: [...employmentRegistry.values()].map(contract => ({
          employerId: contract.employerId,
          employeeId: contract.employeeId,
          wage: contract.wage,
          startedAt: contract.startedAt,
        })),
        summary: {
          totalWealth: aliveAgents.reduce((sum, agent) => sum + (finalStatsByAgentId.get(agent.id)?.wealth ?? agent.currentStats.wealth), 0),
          totalFood: aliveAgents.reduce((sum, agent) => sum + (weekStateMap.get(agent.id)?.inventory.food.quantity ?? 0), 0),
          totalTools: aliveAgents.reduce((sum, agent) => sum + (weekStateMap.get(agent.id)?.inventory.tools.quantity ?? 0), 0),
          avgSkillLevel: aliveAgents.length > 0
            ? Math.round(
              aliveAgents.reduce((sum, agent) => sum + getAgentPeakSkill(weekStateMap.get(agent.id)!.skills), 0) / aliveAgents.length
            )
            : 0,
          activeContracts: employmentRegistry.size,
        },
      };
      await economyRepo.saveSnapshot(scope, iterNum, snapshot);
      if (marketState.priceIndices.length > 0) {
        await economyRepo.savePriceIndices(scope, iterNum, marketState.priceIndices);
      }

      // AMM snapshot is now committed atomically above with the iteration record.
      // Vacuum old snapshots every 10 iterations to reduce WAL write amplification.
      if (iterNum % 10 === 0) economyRepo.vacuumAMMSnapshots(scope);

      // Resolved-action rows are log data → enqueue for async flush
      const actionCols = ['id', 'session_id', 'agent_id', 'iteration_id', 'action', 'outcome', 'resolved_at'];
      for (const row of actionRows) {
        asyncLogFlusher.enqueue('resolved_actions', actionCols, [
          row.id, row.sessionId, row.agentId, row.iterationId,
          row.action, row.outcome, row.resolvedAt,
        ]);
      }

      // Reload agents after updates
      agents = await agentRepo.listBySession(scope);

      // ── SFC assertion: detect unexpected fiat creation or destruction ─────
      // The economy is fully closed-loop. Every transfer must be zero-sum.
      // If total fiat (agent wealth + all AMM reserves + banking deposits + collateral)
      // drifts beyond ±0.1 from the initial baseline, log a critical warning.
      {
        const sfcAMM = sessionAMMRegistry.get(sessionId);
        const sfcMultiAMMs = sessionMultiAMMRegistry.get(sessionId);
        const sfcActual = computeSystemFiatTotal(
          agents,
          sfcAMM,
          sfcMultiAMMs,
          sessionStateTreasury.get(sessionId) ?? 0,
          undefined,
          bankingTotalDeposits,
          bankingCollateralEscrow,
        );

        let sfcEntry = sessionSFCTracking.get(sessionId);
        if (!sfcEntry) {
          // First iteration: establish baseline
          sfcEntry = { initialFiat: sfcActual };
          sessionSFCTracking.set(sessionId, sfcEntry);
        } else {
          const drift = sfcActual - sfcEntry.initialFiat;
          if (Math.abs(drift) > 0.1) {
            console.error(
              `🚨 CRITICAL SFC LEAK DETECTED! Session ${sessionId} iter ${iterNum}: ` +
              `Fiat drifted by ${drift > 0 ? '+' : ''}${drift.toFixed(4)} ` +
              `(expected ${sfcEntry.initialFiat.toFixed(2)}, actual ${sfcActual.toFixed(2)})`
            );
          }
        }
      }

      // ── Race guard: abort-reset may have fired mid-iteration ─────────────
      if (await lifecycle.checkMidIterationAbort(iterNum)) return;

      // ── Atomic iteration snapshot: iterations row + AMM state (BUG-05 / REL-02) ──
      // Wrapping the iterationsTable insert and the AMM snapshot insert in a single
      // sqlite transaction ensures that a crash between the two writes cannot leave
      // the DB with a dangling iteration record but a stale AMM state, or vice versa.
      const stats = computeStats(agents, iterNum);
      // Embed telemetry in the statistics blob so it survives server restarts
      // and is available even when the in-memory map has been cleared.
      const statsWithTelemetry = iterTelemetry
        ? { ...stats, _telemetry: iterTelemetry }
        : stats;

      // Build AMM snapshot values once (used inside the transaction)
      const ammToPersistAtomic = sessionAMMRegistry.get(sessionId);
      const multiAMMsToPersistAtomic = sessionMultiAMMRegistry.get(sessionId);
      const ammSnapshotValues = ammToPersistAtomic
        ? (() => {
            const multiRecord: Record<string, ReturnType<typeof ammToPersistAtomic.snapshot>> = {};
            if (multiAMMsToPersistAtomic) {
              for (const [itemType, pool] of multiAMMsToPersistAtomic) {
                multiRecord[itemType] = pool.snapshot(iterNum);
              }
            }
            return {
              id: uuidv4(),
              sessionId,
              iterationNumber: iterNum,
              snapshotData: JSON.stringify({
                primary: ammToPersistAtomic.snapshot(iterNum),
                multi: multiRecord,
                treasury: sessionStateTreasury.get(sessionId),
              }),
              timestamp: now,
            };
          })()
        : null;

      sqlite.transaction(() => {
        // 1. Iteration record
        db.insert(iterationsTable).values({
          id: iterationId,
          sessionId,
          iterationNumber: iterNum,
          stateSummary: resolution.narrativeSummary,
          statistics: JSON.stringify(statsWithTelemetry),
          lifecycleEvents: JSON.stringify(resolution.lifecycleEvents),
          timestamp: now,
        }).run();

        // 2. AMM + Treasury snapshot (co-committed with the iteration row)
        if (ammSnapshotValues) {
          db.insert(ammSnapshotsTable).values(ammSnapshotValues).run();
        }
      })();

      summaries.push({ number: iterNum, summary: resolution.narrativeSummary });
      previousSummary = resolution.narrativeSummary;

      simulationManager.broadcast(sessionId, {
        type: 'iteration-complete',
        iteration: iterNum,
        stats: stats as unknown as Record<string, unknown>,
      });

      // ── Governance Phase (every 5th iteration) ───────────────────────────
      if (iterNum % 5 === 0 && aliveAgents.length >= 2) {
        try {
          const govResult = await runGovernanceCycle({
            sessionId,
            agents: aliveAgents,
            session,
            currentPolicy: sessionPolicy,
            iterNum,
            provider,
            citizenProv,
            model: settings.centralAgentModel,
            citizenModel: settings.citizenAgentModel,
          });
          if (govResult.policyChanged) {
            sessionPolicy = govResult.newPolicy;
          }
          if (govResult.summary) {
            simulationManager.broadcast(sessionId, {
              type: 'resolution',
              iteration: iterNum,
              narrativeSummary: govResult.summary,
              lifecycleEvents: [],
            });
          }
        } catch (err) {
          // Non-fatal: log and continue — governance failure never stops the simulation
          console.error(`[GOVERNANCE] Cycle failed at iteration ${iterNum}:`, err);
        }
      }

      // ── Phase 3: Regime Collapse check ───────────────────────────────────
      // If society reaches critical misery thresholds, the tested structure has
      // failed — continue blindly would produce meaningless zombie iterations.
      // Skipped when early stopping is disabled by the user.
      const COLLAPSE_CORTISOL = 95;
      const COLLAPSE_HAPPINESS = 5;
      const avgCor = stats.avgCortisol ?? 0;
      if (simulationManager.isEarlyStoppingEnabled(sessionId) &&
          (avgCor >= COLLAPSE_CORTISOL || stats.avgHappiness <= COLLAPSE_HAPPINESS)) {
        const reason = avgCor >= COLLAPSE_CORTISOL
          ? `societal stress reached critical levels (avg cortisol: ${avgCor})`
          : `societal happiness collapsed (avg happiness: ${stats.avgHappiness})`;
        console.error(`[REGIME_COLLAPSE] Session ${sessionId} at iteration ${iterNum}: ${reason}`);
        simulationManager.broadcast(sessionId, {
          type: 'resolution',
          iteration: iterNum,
          narrativeSummary: `⚠️ REGIME COLLAPSE at iteration ${iterNum}: The society has reached critical instability. The government has fallen. ${reason.charAt(0).toUpperCase() + reason.slice(1)}. The social fabric has disintegrated beyond recovery.`,
          lifecycleEvents: [],
        });
        collapseReason = reason;
        collapseIteration = iterNum;
        break;
      }
    }

    // ── Final report ─────────────────────────────────────────────────────────
    const finalStats = computeStats(agents, endIter);
    const finalMessages = buildFinalReportPrompt(session, summaries, {
      aliveCount: finalStats.aliveCount,
      avgWealth: finalStats.avgWealth,
      avgHealth: finalStats.avgHealth,
      avgHappiness: finalStats.avgHappiness,
    });
    let finalReport = '';
    try {
      const finalRaw = await provider.chat(finalMessages, { model: settings.centralAgentModel });
      finalReport = parseFinalReport(finalRaw);
    } catch {
      finalReport = `The simulation of "${session.idea}" concluded after ${endIter} iterations with ${finalStats.aliveCount} survivors.`;
    }

    // Phase 3: Prepend regime collapse notice if early termination was triggered
    if (collapseReason) {
      finalReport = `⚠️ REGIME_COLLAPSE — EARLY TERMINATION at iteration ${collapseIteration}\n`
        + `The simulation was halted because ${collapseReason}.\n`
        + `The societal structure tested in "${session.idea}" has been judged a systemic failure.\n\n`
        + finalReport;
    }

    // ── Phase 2: Post-Mortem Review System ──────────────────────────────────
    // Dead agents provide retrospective systemic critique from their frozen perspective.
    // Memory is frozen at death — no new observations were pushed after isAlive → false.
    const deadAgents = agents.filter(a => !a.isAlive && !a.isCentralAgent);
    if (deadAgents.length > 0) {
      const postMortemTasks = deadAgents.slice(0, 8).map(agent => async () => {
        const deathInfo = deathReasonMap.get(agent.id);
        const diedAtIteration = deathInfo?.iteration ?? agent.diedAtIteration ?? endIter;
        const deathReason = deathInfo?.reason ?? 'unknown causes';
        const frozenMemoryContext = [
          `Background: ${agent.background}`,
          `Final wealth: ${agent.currentStats.wealth}`,
          `Final health: ${agent.currentStats.health}/100`,
          `Final happiness: ${agent.currentStats.happiness}/100`,
          `Society: ${session.idea}`,
        ].join('\n');

        const input: PostMortemInput = {
          agent,
          diedAtIteration,
          deathReason,
          frozenMemoryContext,
        };

        try {
          const messages = buildPostMortemPrompt(input);
          const raw = await citizenProv.chat(messages, { model: settings.citizenAgentModel });
          const parsed = JSON.parse(raw.trim().replace(/^```json\s*/i, '').replace(/```\s*$/i, ''));
          return `${agent.name} (${agent.role}, died Iter ${diedAtIteration}): "${parsed.postMortemCritique}"`;
        } catch {
          return null;
        }
      });

      const postMortemResults = await runWithConcurrency(postMortemTasks, settings.maxConcurrency);
      const critiques = postMortemResults.filter((c): c is string => c !== null);
      if (critiques.length > 0) {
        finalReport += `\n\n--- VOICES FROM THE DEAD ---\n${critiques.join('\n\n')}`;
      }
    }

    await lifecycle.complete(finalReport);
  } catch (err) {
    if (err instanceof SimulationAbortedError) {
      // Already handled by lifecycle.checkContinue — just exit
    } else if (err instanceof SimulationPausedError) {
      console.error(
        `[SimulationRunner] Session ${sessionId} paused — ${err.reason} for agent "${err.agentName}" at iteration ${err.iterationNumber}`,
      );
      await lifecycle.handlePause(err);
    } else {
      await lifecycle.handleError(err);
    }
  }
}
