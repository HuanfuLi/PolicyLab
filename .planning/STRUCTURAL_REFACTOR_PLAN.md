# PolicyLab Structural Refactor Plan

## Problem Statement

Two audit rounds found 60+ bugs, with the same *classes* of bug recurring each time. The root causes are architectural:

1. **`simulationRunner.ts` is 4684 lines** with only 2 exports. Cleanup/abort paths are manually duplicated (3 abort paths, each hand-picking Map deletions). Every audit finds new bugs because no human or AI can reason about all code paths in a file this large.

2. **No session-scoping enforcement** at the type level. Repos accept `sessionId` but whether it's used in WHERE clauses depends on the developer remembering. 4 repos had this bug in the same audit.

3. **No SFC invariant tests.** The M0-constant rule is documented but never enforced by automated tests. 4 confirmed fiat leaks exist today (STEAL no-target: +3, INVEST: -10, treasury bond floor: variable, loan interest compounding: variable).

## Architecture: Three Workstreams

### Workstream A: Decompose `simulationRunner.ts`

**Goal:** Break the 4684-line god file into ~12 focused modules with clear interfaces, so each module can be audited, tested, and modified independently.

**Guiding principle:** Extract by *phase boundary*, not by *feature*. The simulation loop already has clear phase markers. Each phase becomes a module that receives typed input and returns typed output.

#### Phase 1: Extract Pre-Loop Helpers (low risk, high reward)

These are already module-level pure functions with no closure dependencies:

| New Module | Functions to Extract | Current Lines | Est. Size |
|---|---|---|---|
| `server/src/orchestration/helpers/statsUtils.ts` | `gini()`, `computeStats()` | 144-199 | ~60 lines |
| `server/src/orchestration/helpers/sfcAudit.ts` | `computeSystemFiatTotal()` | 262-284 | ~30 lines |
| `server/src/orchestration/helpers/marketBoard.ts` | `buildMarketBoardEntries()`, `buildEmploymentBoardEntries()`, `buildPersonalStatus()`, `updatePriceHistory()` | 348-392, 586-592 | ~80 lines |
| `server/src/orchestration/helpers/weekState.ts` | `createAgentWeekState()`, `clampStat()`, `clampWealth()` | 392-428 | ~40 lines |
| `server/src/orchestration/helpers/physicsUtils.ts` | `distributeProRata()`, `normalizeItemType()`, `industryToItemType()`, `getAgentPeakSkill()` | 306-320, 442-453 | ~60 lines |
| `server/src/orchestration/helpers/inflationUtils.ts` | `getInflationBasketPrices()`, `buildInflationContext()`, `applyInflationFeedback()` | 594-633 | ~50 lines |
| `server/src/orchestration/helpers/metabolismRunner.ts` | `applyMETMetabolism()` | 469-584 | ~120 lines |
| `server/src/orchestration/enterpriseActionDispatch.ts` | `applyEnterpriseAction()` | 635-1075 | ~440 lines |

**Impact:** Removes ~880 lines from `simulationRunner.ts` with zero behavioral change. Each extracted function keeps its exact signature. The runner imports them.

**Risk:** Very low. These are pure functions (no side effects on session state). A simple search-and-replace on imports.

#### Phase 2: Extract Iteration Phases as Named Functions

Each major phase block inside the `for` loop becomes a named async function in its own file, receiving a typed context object and returning a typed result.

**Define the shared context type:**

```typescript
// server/src/orchestration/iterationContext.ts
export interface IterationContext {
  sessionId: string;
  session: Session;
  iterNum: number;
  iterationId: string;
  agents: Agent[];
  aliveAgents: Agent[];
  agentEconomyMap: Map<string, AgentEconomyState>;
  economyConfig: EconomyConfig;
  primaryAMM: AutomatedMarketMaker | null;
  multiAMMs: Map<string, AutomatedMarketMaker>;
  previousSummaries: string[];
  settings: LLMSettings;
  provider: LLMProvider;
}
```

**Extract these phase modules:**

| New Module | Current Lines | Consumes | Produces |
|---|---|---|---|
| `phases/intentPhase.ts` | 1671-2019 | `IterationContext`, market intelligence block, cognitive outputs | `AgentIntent[]`, `illegalActionMap` |
| `phases/resolutionPhase.ts` | 2021-2253 | `IterationContext`, `intents`, physics traces, telemetry logs | `Resolution` (narrativeSummary, agentOutcomes, lifecycleEvents) |
| `phases/executionPhase.ts` | 2255-3054 | `IterationContext`, `intents`, `resolution`, `illegalActionMap` | `weekStateMap`, `statUpdates`, `deaths`, `seizedWealthPool`, action rows, economy updates |
| `phases/financialPhase.ts` | 3319-3902 | `IterationContext`, `intents`, `weekStateMap`, `statUpdates` | Patched `statUpdates` with banking/capital/fiscal/enterprise deltas |
| `phases/telemetryPhase.ts` | 3912-4249 | `IterationContext`, `statUpdates`, `weekStateMap`, telemetry data | `iterTelemetry`, SFC check result |
| `phases/persistPhase.ts` | 4251-4498 | `IterationContext`, all outputs from above phases | DB writes (atomic transaction) |

**Impact:** `runSimulation` shrinks from ~3600 lines (loop body) to ~200 lines of phase orchestration. Each phase module is 200-400 lines and independently testable.

**Risk:** Medium. The phases share mutable state (`weekStateMap`, `statUpdates`). The extraction must carefully define which phase owns which mutations. The `executionPhase` is the messiest because it mutates everything.

#### Phase 3: Unify Abort/Pause/Cleanup into a Controller

Currently, abort/pause checking is duplicated at 5+ points with subtly different cleanup logic. Extract a single `SimulationLifecycle` controller:

```typescript
// server/src/orchestration/simulationLifecycle.ts
export class SimulationLifecycle {
  constructor(private sessionId: string) {}

  /** Check abort/pause before each phase. Throws on abort, pauses on pause. */
  checkContinue(): void {
    if (simulationManager.isAbortRequested(this.sessionId)) {
      this.cleanup();
      throw new SimulationAbortedError(this.sessionId);
    }
    if (simulationManager.isPauseRequested(this.sessionId)) {
      this.pause();
    }
  }

  /** Single cleanup path — called exactly once on abort, completion, or error. */
  cleanup(): void {
    asyncLogFlusher.stop();
    clearOrderBook(this.sessionId);
    cleanupSessionCognition(this.sessionId);
    cleanupSessionState(this.sessionId);  // all 16 Maps
  }

  private pause(): void { /* polling loop, broadcast, stage update */ }
}
```

**Impact:** Eliminates the class of bug where a new abort path forgets to clean up some Maps. Every abort/pause goes through one code path.

**Risk:** Low-medium. The pause polling loop has subtleties (resume vs abort-after-resume) that must be preserved.

---

### Workstream B: Enforce Session Scoping at the Type Level

**Goal:** Make it impossible to write a query that forgets `sessionId` by encoding the requirement in the type system.

#### Step 1: Create a `SessionScope` branded type

```typescript
// server/src/db/sessionScope.ts
declare const SessionBrand: unique symbol;
export type SessionScope = string & { readonly [SessionBrand]: true };

export function createScope(sessionId: string): SessionScope {
  if (!sessionId || typeof sessionId !== 'string') {
    throw new Error('Invalid sessionId for SessionScope');
  }
  return sessionId as SessionScope;
}
```

#### Step 2: Refactor repos to require `SessionScope` instead of `string`

Change every repo function that queries multi-session tables to accept `SessionScope` instead of `string` for the session parameter. The compiler then rejects bare strings — callers must explicitly create a scope.

**Remaining unscoped functions to fix (from audit):**

| Function | File | Fix |
|---|---|---|
| `getLoansByBorrower` | `bankingRepo.ts` | Add `sessionId: SessionScope` param, add WHERE clause |
| `getWithActions` sub-queries | `iterationRepo.ts` | Add `sessionId` filter to `agentIntents` and `resolvedActions` queries |

#### Step 3: Lint rule (optional, future)

Add an ESLint custom rule that flags any Drizzle `db.select().from(table).where(...)` on a table with `session_id` column that doesn't include `eq(table.sessionId, ...)` in the WHERE clause.

**Impact:** Prevents the entire class of cross-session data leak bugs. New repo functions that forget `sessionId` won't compile.

**Risk:** Low. Mechanical refactor — change parameter types, fix compile errors.

---

### Workstream C: SFC Invariant Test Suite

**Goal:** Catch fiat creation/destruction at the test level, not in production. Fix the 4 known violations.

#### Step 1: Fix Known Violations

| # | Violation | Fix |
|---|---|---|
| V1 | STEAL no-target: +3 fiat from nothing | In `physicsEngine.ts`: when `target` is null/undefined, set `w = 0` (no loot without a victim). The `stealFallback` should only apply as a *cap* on targeted steal, not as a default income. |
| V2 | INVEST: -10 fiat destroyed | Route INVEST cost to treasury: in `simulationRunner.ts` after physics returns for INVEST, add `sessionStateTreasury += Math.abs(physics.wealthDelta)`. Investment fees become state revenue (matching FOUND_ENTERPRISE pattern). |
| V3 | Treasury bond floor at 0 | In `simulationRunner.ts` line 3587: instead of `Math.max(0, ...)`, allow treasury to go negative (sovereign debt) OR pro-rate bond payouts when treasury is insufficient (matching the banking interest pro-ration pattern). Recommend pro-ration. |
| V4 | Loan interest compounding phantom | In `bankingEngine.ts` `accrueInterest`: when compounding unpaid interest, do NOT increase `remainingBalance` beyond `principal`. The 2x cap exists but still creates phantom M1. Instead, track missed payments as a count only (already done via `consecutiveMissed`) and leave `remainingBalance` unchanged. Default triggers on `consecutiveMissed >= threshold` regardless. |

#### Step 2: Build the SFC Test Harness

```typescript
// server/src/mechanics/__tests__/sfcInvariant.test.ts

/**
 * SFC Invariant Test Suite
 * 
 * Runs micro-simulations (3-5 agents, 5-10 iterations) with specific
 * action sequences and asserts M0 conservation after each iteration.
 *
 * M0 = Σ(citizen_agent.wealth) + treasury + AMM.fiatReserve
 *       + Σ(deposit.balance) + Σ(loan.collateral)
 *       - Σ(deposit.balance)  // deposits are M1, not M0
 *       [adjusted per computeSystemFiatTotal logic]
 */

describe('SFC Invariant', () => {
  // Test: Pure WORK economy (no banking) — M0 must be constant
  it('WORK-only: M0 conserved across 10 iterations');

  // Test: STEAL targeted — zero-sum transfer
  it('STEAL targeted: attacker gains = victim loses');

  // Test: STEAL untargeted — no fiat creation (post-fix)
  it('STEAL untargeted: no wealth change');

  // Test: INVEST — fee routes to treasury (post-fix)
  it('INVEST: agent -10, treasury +10');

  // Test: Banking — M1 expansion is tracked, M0 unchanged
  it('DEPOSIT + BORROW: M1 expands, M0 constant');

  // Test: Loan default — collateral returns to bank, remainder written off
  it('Loan default: no fiat leak');

  // Test: Gov bond lifecycle — purchase, coupon, maturity
  it('Gov bond: fiat conserved through full lifecycle');

  // Test: Demurrage UBI — redistributive, no leak
  it('Demurrage UBI: sum(deltas) = 0');

  // Test: Agent death — wealth redistributed, deposits liquidated
  it('Agent death: seized wealth = redistributed wealth');

  // Test: Enterprise founding — fee to treasury, not destroyed
  it('FOUND_ENTERPRISE: agent -40, treasury +40');
});
```

#### Step 3: Add Per-Iteration SFC Assertion as a Hard Fail (not just a warning)

Currently the SFC check at `simulationRunner.ts:4346` logs a critical error but continues. Options:

- **Option A:** Throw `SFCViolationError` which triggers `SimulationPausedError` — simulation pauses and user is notified. They can inspect and resume.
- **Option B:** Keep logging but add a telemetry field `sfcDrift` visible in the Economic Dashboard so policymakers can see fiat integrity.

**Recommend:** Option B for production (don't break running simulations), Option A for test builds via an environment flag.

---

## Execution Order

```
Phase 1: Extract helpers (Workstream A.1)          — 1 session, low risk
   ↓
Phase 2: Fix SFC violations (Workstream C.1)       — 1 session, medium risk  
   ↓
Phase 3: SFC test suite (Workstream C.2-C.3)       — 1 session, low risk
   ↓
Phase 4: Session scoping types (Workstream B)       — 1 session, low risk
   ↓
Phase 5: Extract iteration phases (Workstream A.2)  — 2-3 sessions, medium risk
   ↓
Phase 6: Lifecycle controller (Workstream A.3)      — 1 session, medium risk
```

**Phases 1-4** are safe, mechanical, and can be done without breaking anything. They deliver immediate value (testability, type safety, fixed SFC leaks).

**Phases 5-6** are the structural heart of the refactor. They require careful interface design and should be done after the test suite exists to catch regressions.

## What NOT to Do

- Do not rewrite `simulationRunner.ts` from scratch. Extract incrementally.
- Do not change the simulation loop's phase ordering. The financial ticks must run after physics resolution (settled wealth before interest accrual).
- Do not make `simulationState.ts` Maps private/encapsulated yet. That's a Phase 7 concern (after extraction proves the interfaces are stable).
- Do not add new features during this refactor. The goal is structural improvement only.

## Success Criteria

1. `simulationRunner.ts` is under 1500 lines (from 4684)
2. No function in `server/src/db/repos/` can be called without `SessionScope` on multi-session tables
3. SFC test suite passes with 0 fiat leaks across all 10 test scenarios
4. Every abort/pause path calls the same `cleanup()` function (no manual Map deletion)
5. TypeScript compilation remains clean throughout
