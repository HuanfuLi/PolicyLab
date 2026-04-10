/**
 * persistPhase.ts — cognitive post-processing, telemetry, DB flush, SFC assertion.
 *
 * Extracted verbatim from simulationRunner.ts sections 21-24.
 * Covers lines ~3293-3662 of the original runner.
 *
 * Runs after the financial phase. Computes employment metrics, Gini/trust/crime
 * telemetry, flushes all DB writes in a transaction, reloads agents, and asserts
 * SFC integrity.
 */
import { v4 as uuidv4 } from 'uuid';
import { db, sqlite } from '../../db/index.js';
import { iterations as iterationsTable, ammSnapshots as ammSnapshotsTable } from '../../db/schema.js';
import { agentRepo } from '../../db/repos/agentRepo.js';
import { economyRepo, type AgentEconomyState } from '../../db/repos/economyRepo.js';
import { asyncLogFlusher } from '../../db/asyncLogFlusher.js';
import type { AgentIntent } from '../../llm/prompts.js';
import { runCognitivePostProcessing, type CognitivePostInput } from '../../cognition/cognitiveEngine.js';
import type { Agent, EconomyConfig, IterationStats, TelemetryLog, SkillMatrix, MarketState } from '@policylab/shared';
import {
  sessionAMMRegistry,
  sessionMultiAMMRegistry,
  sessionStateTreasury,
  sessionAllostaticStates,
  sessionIterationMetrics,
  sessionTelemetryLogs,
  sessionSFCTracking,
} from '../simulationState.js';
import type { AutomatedMarketMaker } from '../../mechanics/automatedMarketMaker.js';
import type { MultiAMMItemType } from '../../mechanics/automatedMarketMaker.js';

// ── Types ─────────────────────────────────────────────────────────────────────

type StatUpdate = { id: string; wealth: number; health: number; happiness: number; cortisol: number; dopamine: number };

type AgentEconomyUpdate = {
  agentId: string;
  sessionId: string;
  skills: SkillMatrix;
  inventory: import('@policylab/shared').Inventory;
  lastUpdated: number;
};

interface AgentWeekState {
  skills: SkillMatrix;
  inventory: import('@policylab/shared').Inventory;
  events: string[];
  wealthDelta: number;
  healthDelta: number;
  happinessDelta: number;
  cortisolDelta: number;
  dopamineDelta: number;
  executedActions: Array<{ actionCode: string; parameters?: Record<string, unknown> }>;
  interrupted: boolean;
  interruptedReason: 'starvation' | 'mental_breakdown' | null;
  workedEnterpriseId: string | null;
  quitEnterpriseId: string | null;
  employer_id: string | null;
  caloriesBurned: number;
  caloriesProduced: number;
  failedActionCount: number;
}

interface EmploymentRecord {
  enterpriseId: string;
  employerId: string;
  employeeId: string;
  wage: number;
  minSkill: number;
  startedAt: number;
}

interface EnterpriseLedger {
  totalRevenue: number;
  totalWages: number;
  workerCount: number;
}

export interface PersistPhaseContext {
  sessionId: string;
  iterNum: number;
  iterationId: string;
  now: string;
  agents: Agent[];
  aliveAgents: Agent[];
  statUpdates: StatUpdate[];
  deaths: Array<{ id: string; iterationNumber: number }>;
  economyUpdates: AgentEconomyUpdate[];
  actionRows: Array<{
    id: string;
    sessionId: string;
    agentId: string;
    iterationId: string;
    action: string;
    outcome: string;
    resolvedAt: string;
  }>;
  weekStateMap: Map<string, AgentWeekState>;
  intentMap: Map<string, AgentIntent>;
  resolution: { narrativeSummary: string; lifecycleEvents: Array<{ type: string }> };
  economyConfig: EconomyConfig;
  bankingTotalDeposits: number;
  bankingCollateralEscrow: number;
  bankingLoansOutstanding: number;
  inflationTelemetry: Pick<TelemetryLog, 'cpi' | 'inflationRate' | 'inflationExpectations'> | null;
  fiscalPublicGoodsQuality: Record<string, number> | null;
  humiliatedAgentIds: Set<string>;
  bankruptciesThisIter: number;
  enterpriseLedgerMap: Map<string, EnterpriseLedger>;
  employmentRegistry: Map<string, EmploymentRecord>;
  marketState: MarketState;
  agentEconomyMap: Map<string, AgentEconomyState>;
  /** SFC inter-iteration drift tracker — read and written by this phase. */
  sfcPrevTotalFiat: number | null;
  previousSummary: string;
  summaries: Array<{ number: number; summary: string }>;
}

export interface PersistPhaseResult {
  agents: Agent[];
  agentEconomyMap: Map<string, AgentEconomyState>;
  iterTelemetry: TelemetryLog;
  stats: IterationStats;
  previousSummary: string;
  sfcPrevTotalFiat: number;
}

// ── Helpers (verbatim from simulationRunner.ts) ───────────────────────────────

function getAgentPeakSkill(skills: SkillMatrix): number {
  return Math.max(...Object.values(skills).map(entry => Math.round(entry.level)));
}

function gini(values: number[]): number {
  if (values.length < 2) return 0;
  const n = values.length;
  const mean = values.reduce((s, v) => s + v, 0) / n;
  if (mean === 0) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      sum += Math.abs(values[i] - values[j]);
    }
  }
  return Math.round((sum / (2 * n * n * mean)) * 1000) / 1000;
}

function computeStats(agents: Agent[], iterationNumber: number): IterationStats {
  const alive = agents.filter(a => a.isAlive);
  if (alive.length === 0) {
    return {
      iterationNumber,
      avgWealth: 0, avgHealth: 0, avgHappiness: 0,
      minWealth: 0, maxWealth: 0,
      minHealth: 0, maxHealth: 0,
      minHappiness: 0, maxHappiness: 0,
      aliveCount: 0,
      totalCount: agents.length,
      giniWealth: 0,
      giniHappiness: 0,
      avgCortisol: 0,
      avgDopamine: 0,
    };
  }
  const wArr = alive.map(a => a.currentStats.wealth);
  const hArr = alive.map(a => a.currentStats.health);
  const hapArr = alive.map(a => a.currentStats.happiness);
  const cortArr = alive.map(a => a.currentStats.cortisol ?? 0);
  const dopArr = alive.map(a => a.currentStats.dopamine ?? 0);
  return {
    iterationNumber,
    avgWealth: Math.round(wArr.reduce((s, v) => s + v, 0) / alive.length),
    avgHealth: Math.round(hArr.reduce((s, v) => s + v, 0) / alive.length),
    avgHappiness: Math.round(hapArr.reduce((s, v) => s + v, 0) / alive.length),
    minWealth: Math.min(...wArr), maxWealth: Math.max(...wArr),
    minHealth: Math.min(...hArr), maxHealth: Math.max(...hArr),
    minHappiness: Math.min(...hapArr), maxHappiness: Math.max(...hapArr),
    aliveCount: alive.length,
    totalCount: agents.length,
    giniWealth: gini(wArr),
    giniHappiness: gini(hapArr),
    avgCortisol: Math.round(cortArr.reduce((s, v) => s + v, 0) / alive.length),
    avgDopamine: Math.round(dopArr.reduce((s, v) => s + v, 0) / alive.length),
  };
}

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

// ── Main export ───────────────────────────────────────────────────────────────

export async function runPersistPhase(ctx: PersistPhaseContext): Promise<PersistPhaseResult> {
  const {
    sessionId, iterNum, iterationId, now,
    aliveAgents, statUpdates, deaths, economyUpdates, actionRows,
    weekStateMap, intentMap, resolution, economyConfig,
    bankingTotalDeposits, bankingCollateralEscrow, bankingLoansOutstanding,
    inflationTelemetry, fiscalPublicGoodsQuality,
    humiliatedAgentIds, bankruptciesThisIter,
    employmentRegistry, marketState,
    enterpriseLedgerMap,
    summaries,
  } = ctx;

  let { agents, agentEconomyMap, sfcPrevTotalFiat, previousSummary } = ctx;

  const finalStatsByAgentId = new Map(statUpdates.map(u => [u.id, u]));

  // ── Cognitive post-processing ────────────────────────────────────────────
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
        infrastructureQuality: Math.round((fiscalPublicGoodsQuality.infrastructureQuality ?? 0) * 100) / 100,
        educationQuality: Math.round((fiscalPublicGoodsQuality.educationQuality ?? 0) * 100) / 100,
        defenseQuality: Math.round((fiscalPublicGoodsQuality.defenseQuality ?? 0) * 100) / 100,
        welfareQuality: Math.round((fiscalPublicGoodsQuality.welfareQuality ?? 0) * 100) / 100,
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
  await economyRepo.saveSnapshot(sessionId, iterNum, snapshot);
  if (marketState.priceIndices.length > 0) {
    await economyRepo.savePriceIndices(sessionId, iterNum, marketState.priceIndices);
  }

  // AMM snapshot is now committed atomically above with the iteration record.
  // Vacuum old snapshots every 10 iterations to reduce WAL write amplification.
  if (iterNum % 10 === 0) economyRepo.vacuumAMMSnapshots(sessionId);

  // Resolved-action rows are log data → enqueue for async flush
  const actionCols = ['id', 'session_id', 'agent_id', 'iteration_id', 'action', 'outcome', 'resolved_at'];
  for (const row of actionRows) {
    asyncLogFlusher.enqueue('resolved_actions', actionCols, [
      row.id, row.sessionId, row.agentId, row.iterationId,
      row.action, row.outcome, row.resolvedAt,
    ]);
  }

  // Reload agents after updates
  agents = await agentRepo.listBySession(sessionId);

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

  return {
    agents,
    agentEconomyMap,
    iterTelemetry: iterTelemetry!,
    stats,
    previousSummary,
    sfcPrevTotalFiat: sfcPrevTotalFiat!,
  };
}
