# Phase 5 & 6 Detailed Implementation Plan

## Current State

After Phase 1 extraction, `simulationRunner.ts` is 3026 lines with:
- Pre-loop init: lines 199–481 (~280 lines)
- Main loop body: lines 482–2907 (~2425 lines across 26 sections)
- Post-loop: lines 2909–2996 (~90 lines)
- Catch block: lines 2997–3028 (~30 lines)

Target: under 1500 lines. Need to extract ~1500 more lines.

---

## Phase 5: Extract Iteration Phases

### Strategy

The 26 loop sections cluster into 5 natural phases based on data flow boundaries. Each phase gets its own module that receives typed input and returns typed output. The main loop becomes a ~200-line orchestrator that calls each phase in sequence.

### 5A. `intentPhase.ts` — Collect agent intentions via LLM

**Current location:** Sections 2-3 (lines 567–975, ~408 lines)

**Extract as:**
```typescript
// server/src/orchestration/phases/intentPhase.ts
export interface IntentPhaseInput {
  sessionId: SessionScope;
  scope: SessionScope;
  iterNum: number;
  agents: Agent[];
  aliveAgents: Agent[];
  agentEconomyMap: Map<string, AgentEconomyState>;
  economyConfig: EconomyConfig;
  session: Session;
  primaryAMM: AutomatedMarketMaker | null;
  multiAMMs: Map<string, AutomatedMarketMaker>;
  previousSummary: string;
  settings: LLMSettings;
  provider: LLMProvider;
  citizenProv: LLMProvider;
  lockedVariables: string[];
  sessionPolicy: PolicyState;
  latestMarketBoard: MarketBoardEntry[];
}

export interface IntentPhaseOutput {
  intents: AgentIntent[];
  illegalActionMap: Map<string, Set<string>>;
  intentRows: QueuedInsert[];  // for asyncLogFlusher
}

export async function runIntentPhase(input: IntentPhaseInput): Promise<IntentPhaseOutput>
```

**What moves:**
- Cognitive pre-processing call
- Market intelligence block building
- Per-iteration context pre-computation (banking/capital/fiscal/inflation loads)
- Intent collection loop with `runWithConcurrency`
- Sheriff A legality detection
- Intent row building for async enqueue

**What stays in runner:** The `asyncLogFlusher.enqueue` call (side effect) — the phase returns the rows, runner enqueues them.

**Abort/pause:** The phase accepts a `shouldAbort: () => boolean` callback. Internal abort checks call it; throw `SimulationPausedError` if true.

---

### 5B. `resolutionPhase.ts` — Central Agent narrative resolution

**Current location:** Section 4 (lines 977–1108, ~130 lines)

**Extract as:**
```typescript
// server/src/orchestration/phases/resolutionPhase.ts
export interface ResolutionPhaseInput {
  sessionId: string;
  iterNum: number;
  intents: AgentIntent[];
  aliveAgents: Agent[];
  illegalActionMap: Map<string, Set<string>>;  // may be populated by map-reduce
  previousSummary: string;
  settings: LLMSettings;
  provider: LLMProvider;
  citizenProv: LLMProvider;
  lockedVariables: string[];
  session: Session;
}

export interface ResolutionPhaseOutput {
  resolution: ParsedResolution;
  illegalActionMap: Map<string, Set<string>>;  // may be augmented by map-reduce legality
}

export async function runResolutionPhase(input: ResolutionPhaseInput): Promise<ResolutionPhaseOutput>
```

**What moves:**
- Map-reduce path (clustering, group tasks, merge)
- Standard path (single resolution prompt)
- Role-change filtering for locked variables
- HMAS coverage gap warning

**Relatively clean extraction** — this section has few dependencies on mutable state beyond its inputs.

---

### 5C. `executionPhase.ts` — Physics, action queues, market, wages, metabolism

**Current location:** Sections 5–14 (lines 1110–1834, ~724 lines) — the largest block

**Extract as:**
```typescript
// server/src/orchestration/phases/executionPhase.ts
export interface ExecutionPhaseInput {
  sessionId: SessionScope;
  iterNum: number;
  agents: Agent[];
  aliveAgents: Agent[];
  intents: AgentIntent[];
  resolution: ParsedResolution;
  illegalActionMap: Map<string, Set<string>>;
  agentEconomyMap: Map<string, AgentEconomyState>;
  economyConfig: EconomyConfig;
  lockedVariables: string[];
  lockedEconomySnapshot: Map<string, AgentEconomyState>;
  sessionPolicy: PolicyState;
  session: Session;
}

export interface ExecutionPhaseOutput {
  weekStateMap: Map<string, AgentWeekState>;
  statUpdates: StatUpdate[];
  deaths: Array<{ id: string; iterationNumber: number }>;
  seizedWealthPool: number;  // after Sheriff C redistribution = 0
  economyUpdates: AgentEconomyUpdate[];
  actionRows: ActionRow[];
  humiliatedAgentIds: Set<string>;
  enterpriseLedgerMap: Map<string, EnterpriseLedger>;
  bankruptciesThisIter: number;
  latestMarketBoard: MarketBoardEntry[];
}

export function runExecutionPhase(input: ExecutionPhaseInput): ExecutionPhaseOutput
```

**What moves (in order):**
1. weekStateMap initialization + outcomeMap/intentMap building
2. Ghost enterprise cleanup
3. Per-agent action queue micro-turns (calls `applyEnterpriseAction`, `resolveAction`)
4. Sheriff C enforcement (arrest/seizure)
5. WORK/INVEST/STEAL/HELP SFC routing
6. Physics trace save
7. Non-food order book matching + SYSTEM_NPC
8. Wage settlement & bankruptcy
9. ADJUST_TAX, SET_RESERVE_RATIO, SET_BASE_RATE
10. EMBEZZLE settlement
11. AMM famine reserve
12. Inventory depreciation
13. MET metabolism
14. Allostatic load pipeline
15. Demurrage UBI
16. Market board + price history update
17. Stat finalization loop (death/humiliation/clamp/economyUpdates/actionRows)
18. Sheriff C seized wealth redistribution

**This is the hardest extraction** because it reads/writes many Maps from `simulationState.ts` directly. The phase function will need to import those Maps (they're already module-level singletons in `simulationState.ts`). The key insight: this phase doesn't need to receive the Maps as parameters — it imports them, same as the runner does today. The extraction is about moving the code, not changing the data access pattern.

**Internal structure:** Consider further splitting into sub-functions within `executionPhase.ts`:
- `runActionQueues(...)` — the per-agent loop (lines 1172–1373)
- `runMarketSettlement(...)` — order book + wages + EMBEZZLE (lines 1390–1648)
- `runBiologicalTicks(...)` — depreciation + metabolism + allostatic + demurrage (lines 1678–1780)
- `finalizeStats(...)` — stat computation + death/humiliation + Sheriff C (lines 1836–2051)

---

### 5D. `financialPhase.ts` — Banking, capital markets, fiscal, inflation ticks

**Current location:** Sections 16–20 (lines 2053–2472, ~420 lines)

**Extract as:**
```typescript
// server/src/orchestration/phases/financialPhase.ts
export interface FinancialPhaseInput {
  sessionId: SessionScope;
  scope: SessionScope;
  iterNum: number;
  agents: Agent[];
  aliveAgents: Agent[];
  intents: AgentIntent[];
  statUpdates: StatUpdate[];
  economyConfig: EconomyConfig;
  session: Session;
  bankingTotalDeposits?: number;
  bankingCollateralEscrow?: number;
  bankingLoansOutstanding?: number;
}

export interface FinancialPhaseOutput {
  bankingTotalDeposits: number;
  bankingCollateralEscrow: number;
  bankingLoansOutstanding: number;
  inflationTelemetry: Pick<TelemetryLog, 'cpi' | 'inflationRate' | 'inflationExpectations'>;
  fiscalPublicGoodsQuality: Record<string, number>;
}

export async function runFinancialPhase(input: FinancialPhaseInput): Promise<FinancialPhaseOutput>
```

**What moves:**
1. Capital market request accumulation from intents
2. Banking tick (processIteration + DB writes)
3. Capital market tick (processIteration + DB writes + treasury pro-ration)
4. Fiscal policy tick (executeBudget + public goods + income tax)
5. Inflation tick (computeInflation + macro snapshot + Taylor Rule + AMM feedback)

**Note:** This phase mutates `statUpdates` in place (patches wealth for banking/capital/fiscal deltas). It also mutates several Maps from `simulationState.ts` (treasury, inflation state, fiscal multipliers, physics traces). Same pattern as execution phase — import the Maps directly.

---

### 5E. `persistPhase.ts` — Telemetry, DB writes, SFC audit, iteration snapshot

**Current location:** Sections 21–24 (lines 2474–2851, ~377 lines)

**Extract as:**
```typescript
// server/src/orchestration/phases/persistPhase.ts
export interface PersistPhaseInput {
  sessionId: SessionScope;
  scope: SessionScope;
  iterNum: number;
  iterationId: string;
  agents: Agent[];
  aliveAgents: Agent[];
  statUpdates: StatUpdate[];
  deaths: Array<{ id: string; iterationNumber: number }>;
  economyUpdates: AgentEconomyUpdate[];
  actionRows: ActionRow[];
  weekStateMap: Map<string, AgentWeekState>;
  resolution: ParsedResolution;
  economyConfig: EconomyConfig;
  bankingTotalDeposits: number;
  bankingCollateralEscrow: number;
  bankingLoansOutstanding: number;
  inflationTelemetry: object;
  fiscalPublicGoodsQuality: Record<string, number>;
  humiliatedAgentIds: Set<string>;
}

export interface PersistPhaseOutput {
  agents: Agent[];                // reloaded from DB after writes
  agentEconomyMap: Map<string, AgentEconomyState>;  // refreshed
  iterTelemetry: TelemetryLog;
  stats: IterationStats;
}

export async function runPersistPhase(input: PersistPhaseInput): Promise<PersistPhaseOutput>
```

**What moves:**
1. Cognitive post-processing call
2. Employment metrics computation → `sessionIterationMetrics`
3. Telemetry snapshot building (all the analytical metrics)
4. SFC drift check
5. DB flush: `sqlite.transaction` for stats/deaths/allostatic + economy upsert + snapshot + prices
6. Action rows async enqueue
7. Agent reload from DB
8. SFC assertion
9. Abort race guard
10. Atomic iteration row + AMM snapshot DB write

---

### Resulting `runSimulation` main loop

After all 5 extractions, the main loop body becomes approximately:

```typescript
for (let iterNum = startIter; iterNum <= endIter; iterNum++) {
  lifecycle.checkContinue();  // Phase 6 — unified abort/pause

  simulationManager.broadcast(sessionId, { type: 'iteration-start', iteration: iterNum, total: endIter });
  decayStatusEffects(sabotageRegistry, suppressRegistry);

  // Phase A: Collect intentions
  const { intents, illegalActionMap, intentRows } = await runIntentPhase({ ... });
  asyncLogFlusher.enqueue(intentRows);

  // Phase B: Resolution
  const { resolution } = await runResolutionPhase({ ... });
  simulationManager.broadcast(sessionId, { type: 'resolution', ... });

  // Phase C: Execution (physics, market, wages, metabolism)
  const execResult = runExecutionPhase({ ... });

  // Phase D: Financial ticks (banking, capital, fiscal, inflation)
  const finResult = await runFinancialPhase({ ... });

  // Phase E: Persist (telemetry, DB writes, SFC audit, iteration snapshot)
  const persistResult = await runPersistPhase({ ... });
  agents = persistResult.agents;
  agentEconomyMap = persistResult.agentEconomyMap;

  simulationManager.broadcast(sessionId, { type: 'iteration-complete', ... });

  // Governance (every 5th)
  if (iterNum % 5 === 0 && aliveAgents.length >= 2) {
    await runGovernanceCycle(...);
  }

  // Regime collapse check
  if (shouldCollapse(persistResult.stats)) break;
}
```

**Estimated main loop: ~80 lines.** With pre-loop init (~280), post-loop (~90), catch (~30), imports (~50): **total runner ~530 lines**.

---

## Phase 6: Lifecycle Controller

### Problem

Abort and pause checking is currently duplicated at 7 points with subtly different cleanup logic. The mid-iteration abort guard (Section 23) still uses manual Map deletions instead of `cleanupSessionState()`.

### Solution

Create `SimulationLifecycle` class that encapsulates all state management:

```typescript
// server/src/orchestration/simulationLifecycle.ts

export class SimulationLifecycle {
  private sessionId: string;
  private onDataLoss: (payload: DataLossPayload) => void;

  constructor(sessionId: string) {
    this.sessionId = sessionId;
    this.onDataLoss = (payload) => {
      simulationManager.broadcast(sessionId, {
        type: 'warning',
        message: `Data loss: ${payload.rowsLost} rows dropped from ${payload.table}`,
      });
    };
  }

  /** Call at the start of the simulation to set up the flusher and listeners. */
  start(): void {
    asyncLogFlusher.start();
    asyncLogFlusher.on('data-loss', this.onDataLoss);
    simulationManager.start(this.sessionId);
  }

  /**
   * Check abort/pause before each phase. Call at the top of the iteration
   * and between phases.
   *
   * - If abort requested: cleans up everything and throws SimulationAbortedError
   * - If pause requested: enters polling loop, blocks until resumed or aborted
   */
  checkContinue(): void {
    if (simulationManager.isAbortRequested(this.sessionId)) {
      this.abort();
      // abort() throws, so this line is never reached
    }
    if (simulationManager.isPauseRequested(this.sessionId)) {
      this.pause();
    }
  }

  /**
   * Callback factory for phase-internal abort checking.
   * Phases that run parallel LLM calls pass this to retryWithHealing/runWithConcurrency.
   */
  shouldAbort(): boolean {
    return simulationManager.isAbortRequested(this.sessionId) ||
           simulationManager.isPauseRequested(this.sessionId);
  }

  /**
   * Full cleanup — called exactly once on abort, completion, or non-recoverable error.
   * Consolidates the 3 previously duplicated cleanup paths.
   */
  cleanup(): void {
    asyncLogFlusher.off('data-loss', this.onDataLoss);
    asyncLogFlusher.stop();
    clearOrderBook(this.sessionId);
    cleanupSessionCognition(this.sessionId);
    cleanupSessionState(this.sessionId);  // all 16+ Maps in one call
  }

  /**
   * Normal completion: cleanup + set stage + broadcast.
   */
  async complete(finalReport: string): Promise<void> {
    this.cleanup();
    await sessionRepo.updateStage(this.sessionId, 'simulation-complete');
    simulationManager.broadcast(this.sessionId, { type: 'simulation-complete', finalReport });
    simulationManager.finish(this.sessionId);
  }

  /**
   * Pause (LLM failure): persist stage, set status, do NOT clean up session state.
   */
  async handlePause(error: SimulationPausedError): Promise<void> {
    asyncLogFlusher.off('data-loss', this.onDataLoss);
    asyncLogFlusher.stop();
    // Do NOT call cleanupSessionState — preserve in-memory state for resume
    try { await sessionRepo.updateStage(this.sessionId, 'simulation-paused'); } catch { /* best-effort */ }
    try { simulationManager.broadcast(this.sessionId, { type: 'error', message: error.message }); } catch { /* best-effort */ }
    simulationManager.setPaused(this.sessionId);
  }

  /**
   * Non-recoverable error: full cleanup + broadcast.
   */
  async handleError(error: unknown): Promise<void> {
    this.cleanup();
    const message = error instanceof Error ? error.message : 'Simulation error';
    const stack = error instanceof Error ? error.stack?.split('\n').slice(0, 8).join('\n') : '';
    try { simulationManager.broadcast(this.sessionId, { type: 'error', message }); } catch { /* best-effort */ }
    console.error(`[SimulationRunner] Session ${this.sessionId}: ${message}\n${stack}`);
    simulationManager.finish(this.sessionId);
  }

  // ── Private ──────────────────────────────────────────────────────────

  private abort(): never {
    this.cleanup();
    if (simulationManager.isResetRequested(this.sessionId)) {
      simulationManager.broadcast(this.sessionId, { type: 'aborted-reset' });
    } else {
      simulationManager.broadcast(this.sessionId, { type: 'error', message: 'Simulation aborted.' });
      // Note: stage update is async but we're throwing — caller's catch block handles it
    }
    simulationManager.finish(this.sessionId);
    throw new SimulationAbortedError(this.sessionId);
  }

  private pause(): void {
    simulationManager.setPaused(this.sessionId);
    simulationManager.broadcast(this.sessionId, { type: 'paused', iteration: -1 });
    // Block until resumed or aborted
    // This is the existing polling loop, centralized here
    // Implementation: same setInterval/Promise pattern as current code
  }
}
```

### How the runner uses it

```typescript
export async function runSimulation(sessionId: string, totalIterations: number) {
  const lifecycle = new SimulationLifecycle(sessionId);
  lifecycle.start();

  try {
    // ... pre-loop init ...

    for (let iterNum = startIter; iterNum <= endIter; iterNum++) {
      lifecycle.checkContinue();
      // ... phase calls ...
    }

    // ... final report ...
    await lifecycle.complete(finalReport);

  } catch (err) {
    if (err instanceof SimulationPausedError) {
      await lifecycle.handlePause(err);
    } else if (err instanceof SimulationAbortedError) {
      // Already handled by lifecycle.abort() — just exit
    } else {
      await lifecycle.handleError(err);
    }
  }
}
```

### What this eliminates

- **7 inline abort check blocks** → 1 `lifecycle.checkContinue()` call
- **3 different cleanup code paths** (each with different Map deletion sets) → 1 `lifecycle.cleanup()`
- **The mid-iteration abort race guard** (which was missing 9 Maps) → uses `cleanupSessionState()` via `lifecycle.cleanup()`
- **The `finish()` vs `setPaused()` confusion** in the catch block → each error type has a dedicated handler

---

## Execution Order

```
Step 1: Create SimulationLifecycle (Phase 6)
  → New file, no changes to runner yet
  → Write tests for the lifecycle class

Step 2: Wire lifecycle into runner
  → Replace all 7 abort/pause blocks with lifecycle.checkContinue()
  → Replace catch block with lifecycle.handlePause/handleError
  → Delete all manual cleanup code
  → Verify: all tests pass, TypeScript clean

Step 3: Extract persistPhase.ts (5E)
  → Least coupled to weekStateMap — cleanest extraction
  → ~377 lines out

Step 4: Extract financialPhase.ts (5D)
  → Banking/capital/fiscal/inflation ticks
  → ~420 lines out

Step 5: Extract resolutionPhase.ts (5B)
  → Central Agent resolution (standard + map-reduce)
  → ~130 lines out

Step 6: Extract intentPhase.ts (5A)
  → Intent collection with full context building
  → ~408 lines out

Step 7: Extract executionPhase.ts (5C)
  → The big one: physics, market, wages, metabolism
  → ~724 lines out
  → Consider internal sub-functions to keep this file manageable

Step 8: Verify & measure
  → TypeScript clean, all tests pass
  → Target: simulationRunner.ts < 600 lines
```

### Why this order?

- **Lifecycle first** (Step 1-2): The controller simplifies all subsequent extractions because phases no longer need to handle abort/pause internally — they just throw, and the lifecycle catches.
- **Persist phase first** (Step 3): It's the most independent — reads final data, writes to DB. No mutable shared state except `agentEconomyMap` refresh.
- **Financial phase next** (Step 4): Each tick already delegates to an engine module. The runner code is just orchestration boilerplate.
- **Resolution next** (Step 5): Clean LLM-call-based phase with few side effects.
- **Intent phase** (Step 6): More complex due to per-agent context assembly, but well-bounded.
- **Execution phase last** (Step 7): The messiest extraction due to heavy `weekStateMap` mutation. Doing it last means all other phases are already stable.

---

## Risk Mitigation

1. **Each step is independently committable and testable.** If Step 7 proves too complex, the runner is still at ~1300 lines (vs 3026 today) — a 57% reduction.

2. **Shared mutable state (Maps) stays in `simulationState.ts`.** Phase modules import them directly rather than receiving them as parameters. This avoids interface explosion while maintaining the singleton pattern.

3. **The SFC test suite (Phase 3) acts as a regression guard.** After each extraction step, run the 16 SFC tests + full test suite to catch any accounting errors introduced by the refactor.

4. **No logic changes.** Every extraction is a pure move. Function signatures preserved. Only the call site changes (from inline code to function call).

## Success Criteria

- [ ] `simulationRunner.ts` under 600 lines
- [ ] `SimulationLifecycle` handles all abort/pause/cleanup in one class
- [ ] Zero manual `Map.delete()` calls remain in the runner
- [ ] All 16 SFC tests pass after each step
- [ ] TypeScript compilation clean after each step
- [ ] No behavioral changes — simulation output identical for same inputs
