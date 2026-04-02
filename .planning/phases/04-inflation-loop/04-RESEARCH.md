# Phase 4: Inflation Loop - Research

**Researched:** 2026-04-01
**Domain:** CPI computation from AMM/order-book price data; M1-to-price-level feedback via AMM reserve scaling; central bank policy agent; inflation expectations injected into agent cognition
**Confidence:** HIGH (mechanics derivable from existing codebase patterns) / MEDIUM (AMM reserve scaling formula, blending coefficients)

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| INFL-01 | CPI calculated per iteration from AMM/market price data using weighted basket | `marketPrices` table populated each iteration; weighted basket formula; base-period anchoring at iteration 1 |
| INFL-02 | M1 growth rate feeds back into price levels via AMM reserve scaling | AMM exposes `injectFiatReserve` / `withdrawFiatReserve`; reserve scaling preserves x*y=k invariant; formula derived below |
| INFL-03 | Inflation expectations injected into agent cognition prompts with CPI trend data | `buildNaturalIntentPrompt` optional-parameter pattern; `sessionIterationMetrics` rolling-window pattern |
| INFL-04 | Agents adapt behavior in response to inflation (hoarding, wage demands, saving shifts) | No new ActionCodes needed; LLM cognition + existing actions cover behaviors; physics hook (AMM price floor) ensures it is not pure narrative |
| BANK-07 | Central bank agent observes CPI and M1 growth; adjusts reserve ratio and base interest rate | `central_bank` agent type; SET_RESERVE_RATIO + SET_BASE_RATE action codes; reads macro snapshot from DB; EconomyConfig already has `reserveRequirement` and `baseLoanInterestRate` as live fields |

</phase_requirements>

---

## Summary

Phase 4 closes the macro feedback loop by wiring together three systems that are already individually functional: the AMM price data (emitted to `marketPrices` since v0), M1 money supply (tracked in telemetry since Phase 1), and agent cognition (the cognitive engine and intent prompt system from Phase 3 / base system).

The core work is four components: (1) `inflationEngine.ts` — a pure computation function that reads `marketPrices`, computes a weighted CPI, blends the M1 signal, and returns `InflationState`; (2) `macroSnapshotRepo.ts` — a thin DB repo for the `macro_snapshots` table; (3) `simulationRunner.ts` modification — call the inflation engine at the end of each iteration and store the result for cognitive injection; and (4) prompt/cognitive injection — add a one-line `inflationContext` field to `buildNaturalIntentPrompt` so agents see the economic signal.

BANK-07 (central bank agent) adds a fifth piece: a new `central_bank` agent role with two action codes (`SET_RESERVE_RATIO`, `SET_BASE_RATE`) that allow the LLM or rule-based policy agent to respond to CPI and M1 trend data by adjusting the live `EconomyConfig` fields that are already read by the banking engine.

**Primary recommendation:** Build in five focused plans — (1) shared types + schema + macroSnapshotRepo, (2) inflationEngine pure computation, (3) simulationRunner wiring + AMM feedback, (4) central bank agent + action codes, (5) cognitive injection + tests.

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| better-sqlite3 (via drizzle) | Already installed | Persist `macro_snapshots` per iteration | Same pattern as all existing DB writes in this project |
| drizzle-orm | Already installed | Schema declaration for `macro_snapshots` | Project standard ORM |
| vitest | Already installed | SFC and behavioral unit tests | Project standard test runner |

No new npm dependencies. All computation is pure TypeScript arithmetic.

**Installation:** None required.

---

## Architecture Patterns

### Recommended Project Structure

New files to create:

```
server/src/
├── mechanics/
│   └── inflationEngine.ts         # Pure function: CPI + M1 blend + AMM feedback delta
└── db/
    └── repos/
        └── macroSnapshotRepo.ts   # insert/getRecent for macro_snapshots table

server/src/db/
└── schema.ts                      # MODIFIED: add macro_snapshots table
└── migrate.ts                     # MODIFIED: migration SQL for macro_snapshots

shared/src/
└── types.ts                       # MODIFIED: MacroSnapshot + InflationState types;
                                   # EconomyConfig: cpiBasketWeights, m1InflationCoeff,
                                   # inflationSmoothingWindow, centralBankEnabled;
                                   # ActionCode union: SET_RESERVE_RATIO + SET_BASE_RATE

server/src/mechanics/
└── actionCodes.ts                 # MODIFIED: SET_RESERVE_RATIO + SET_BASE_RATE

server/src/mechanics/
└── physicsEngine.ts               # MODIFIED: resolution cases for new action codes

server/src/orchestration/
└── simulationRunner.ts            # MODIFIED: inflation tick + cognitive injection

server/src/llm/
└── prompts.ts                     # MODIFIED: inflationContext param in buildNaturalIntentPrompt
                                   # + CentralBankContext interface

server/src/__tests__/
└── sfcInflation.test.ts           # NEW: CPI computation + AMM feedback + SFC invariant
```

### Pattern 1: inflationEngine Pure Function

**What:** `inflationEngine.ts` is a pure TypeScript module with no DB imports, following the `bankingEngine` / `capitalMarketEngine` separation of concerns. It receives price snapshots and macro state, returns deltas.

**When to use:** Called from `simulationRunner.ts` at the end of each iteration, after all action resolution and banking/capital market ticks.

**Example:**
```typescript
// inflationEngine.ts — pure, no DB
export interface InflationInput {
  sessionId: string;
  iterationNumber: number;
  currentPrices: Record<string, number>;   // food, tools, luxury_goods, raw_materials
  basePrices: Record<string, number>;       // from iteration 1, stored in session config
  m1Current: number;
  m1Previous: number | null;               // null on iteration 1 (no prior snapshot)
  recentCpiHistory: number[];              // last N CPI values for EMA smoothing
  economyConfig: EconomyConfig;
}

export interface InflationOutput {
  cpi: number;                  // weighted price index (base = 100)
  inflationRate: number;        // % change vs prior iteration CPI
  inflationExpectations: number;// EMA-smoothed signal
  ammFeedbackFactor: number;    // multiplicative factor to apply to AMM reserves
  trace: string[];
}

export function computeInflation(input: InflationInput): InflationOutput { ... }
```

### Pattern 2: CPI Basket Computation

**What:** Weighted average of current prices relative to base prices. Base prices are pinned at iteration 1 and stored in `session.config.basePrices`.

**Formula (HIGH confidence — standard Laspeyres index):**
```
CPI = Σ(w_i * currentPrice_i / basePrice_i) * 100

Default weights (configurable via EconomyConfig.cpiBasketWeights):
  food:          0.40   (largest consumption share)
  tools:         0.25
  luxury_goods:  0.20
  raw_materials: 0.15

inflationRate = (CPI_current / CPI_previous - 1) * 100   // percent
```

**Source of prices:** The `marketPrices` table is written each iteration by `economyRepo.savePriceIndices()`. Each row has `(sessionId, iterationNumber, itemType, lastPrice, vwap, volume)`. Use `vwap` where `volume > 0`; fall back to `lastPrice` if no volume; fall back to `basePrice_i` if neither (no trade in that item this iteration). This prevents zero-volume iterations from distorting CPI.

**Base price initialization:** On iteration 1, if `session.config.basePrices` is null/empty, set it from the current iteration's prices and persist. Subsequent iterations divide by this base. Store as `EconomyConfig.cpiBasePrices` (type: `Record<string, number>`).

### Pattern 3: M1 Growth Signal Blending

**What:** Quantity theory adjustment: if money supply grows faster than real output, inject inflationary pressure beyond what AMM price discovery alone shows.

**Formula (MEDIUM confidence — simplified quantity theory):**
```
m1GrowthRate = (m1Current - m1Previous) / m1Previous    // may be 0 or negative
productivityGrowthEstimate = 0.01                        // 1% per iteration (configurable)
m1Signal = m1GrowthRate - productivityGrowthEstimate

blendedInflation = (1 - α) * cpiInflation + α * m1Signal
  where α = economyConfig.m1InflationCoeff (default 0.3)

inflationExpectations = EMA(blendedInflation, recentWindow)
  smoothingWindow = economyConfig.inflationSmoothingWindow (default 3)
```

**Key constraint:** The m1Signal should only be used to compute `inflationExpectations` for cognitive injection. The AMM feedback (INFL-02) should use the **blended inflation rate**, not raw m1Signal alone, to avoid instability.

### Pattern 4: AMM Reserve Scaling (INFL-02)

**What:** When `inflationExpectations` exceeds a threshold, scale both AMM reserves proportionally so the spot price reflects the inflation signal. Preserves `x * y = k` because we scale both reserves by the same factor, which updates `k` (this is intentional — it represents the nominal price level rising).

**How the AMM exposes this:** The existing AMM class has `injectFiatReserve(amount)` / `withdrawFiatReserve(amount)` and `injectGoodsReserve(amount)`. Both call `this.k = this.fiatReserve * this.foodReserve` afterward — they update `k` by design. This is the correct hook for a price level adjustment.

**CRITICAL — SFC implication:** Injecting fiat into the AMM without a corresponding agent debit violates SFC (Anti-Pattern 4 from PITFALLS.md). The correct approach is to adjust the AMM's **goods reserve**, not its fiat reserve, to reflect inflation. When goods become more expensive in nominal terms, the AMM goods reserve appears smaller relative to fiat, which raises the spot price. Alternatively: scale both reserves proportionally — fiat reserve * (1+factor), goods reserve / (1+factor) — so the price ratio changes but SFC is maintained by not inserting new fiat into the system from nowhere.

**Correct formula (HIGH confidence based on codebase analysis):**
```typescript
// In simulationRunner.ts after inflation tick:
// Scale AMM to reflect inflation: raise spot price by inflationAmmFactor
// WITHOUT injecting new fiat. Scale fiat reserve up, goods reserve down proportionally.
// This preserves x*y=k (k changes — that's the price level change).
// SFC: no net fiat created — AMM reserves are internal to the SFC perimeter.

const factor = 1 + (inflationOutput.inflationExpectations / 100) * economyConfig.m1InflationCoeff;
if (factor !== 1 && Math.abs(factor - 1) > 0.001) {
  // Primary AMM (food)
  const primaryAMM = sessionAMMRegistry.get(sessionId);
  if (primaryAMM) {
    primaryAMM.injectFiatReserve(primaryAMM.currentFiatReserve * (factor - 1));
    // withdraw goods proportionally so spot price rises
    // new spotPrice = (fiatReserve * factor) / (goodsReserve / factor) = oldSpotPrice * factor^2
    // To get factor^1 price change: only adjust fiat:
    // new spotPrice = (fiatReserve + delta) / goodsReserve
    // => delta = fiatReserve * (factor - 1)
    // This raises price by factor, and k increases (intentional price-level shift)
  }
  // Repeat for each pool in multiAMMRegistry
}
```

**Note for planner:** The research identifies a subtlety: using ONLY `injectFiatReserve` changes `k` while `goodsReserve` stays constant, so `spotPrice = fiatReserve / goodsReserve` rises. This is mathematically sound and SFC-neutral because the AMM fiat reserve is already counted in `computeSystemFiatTotal`. The injection amount comes from INSIDE the SFC perimeter (an accounting adjustment, not new money). The planner should verify this against the final SFC audit to confirm zero drift. Confidence: MEDIUM (requires codebase verification during implementation).

**Threshold and cap:** Only apply AMM feedback when `|inflationExpectations| > 0.5%` per iteration to avoid noise amplification. Apply a per-iteration cap of 2% price change from this mechanism to prevent runaway spiral.

### Pattern 5: Central Bank Agent (BANK-07)

**What:** A `central_bank` agent type (parallel to `bank`) with two new action codes: `SET_RESERVE_RATIO` and `SET_BASE_RATE`. The agent reads CPI and M1 growth from the most recent `macro_snapshot` and decides whether to tighten or loosen policy.

**Integration point:** `actionCodes.ts` already has `BANK_ACTIONS` for the `bank` role. Add `CENTRAL_BANK_ACTIONS` for the `central_bank` role. The physics engine resolution cases for these codes apply the change to `session.config.economyConfig` immediately (same iteration, affects the banking engine on next tick).

**LLM vs rule-based decision:** The architecture research specifies "LLM or rule-based response." Given that the central bank agent is already an LLM agent (all agents are), the CPI + M1 data is injected as a `CentralBankContext` in its intent prompt (analogous to `BankOperationsContext` from Phase 1). The LLM then generates `SET_RESERVE_RATIO` or `SET_BASE_RATE` actions with a `value` parameter.

**Physics engine validation:** The physics engine must clamp the LLM-provided value to a valid range:
- `reserveRequirement`: clamp to [0.05, 0.50]
- `baseLoanInterestRate`: clamp to [0.001, 0.05] per-iteration

**EconomyConfig update pattern:** When a `SET_RESERVE_RATIO` action resolves, update `session.config.economyConfig.reserveRequirement` and persist to DB. The banking engine reads `economyConfig` each tick, so the change takes effect next iteration. Follow the existing pattern for how `ADJUST_TAX` updates `session.config.policy.tax_rate`.

### Pattern 6: Cognitive Injection (INFL-03/04)

**What:** Add an optional `inflationContext` parameter to `buildNaturalIntentPrompt` that injects a compact one-line economic signal. Follows the `citizenBankingContext` / `citizenCapitalMarketContext` pattern from Phases 1–2.

**When to inject:** Every iteration starting from iteration 2 (no prior CPI on iteration 1). Pass `null` on iteration 1.

**Content:** A single string from the `sessionInflationState` in-memory map (updated by the inflation tick):
```
"Economic conditions: CPI is 103.2 (up 3.2% from base). Inflation running at 1.8% this period. Consider adjusting wage demands or consumption strategy."
```

**Token budget:** This is injected into the static prefix of the prompt, which is shared across all agents in an iteration (cached). Keep under 60 tokens.

**Behavior adaptation (INFL-04):** No new action codes are needed. The LLM already knows `DEPOSIT`, `WORK`, `POST_BUY_ORDER`, `REST`. When told inflation is high, a rational agent will:
- Choose `REST` less (leisure is expensive when inflation erodes savings)
- Choose `DEPOSIT` to earn interest as a hedge
- Demand higher WORK wages (expressed in negotiation narrative)
- Hoard food (large `POST_BUY_ORDER` for food)

These are observable in telemetry through changes in action distribution and average wealth deltas per role. The physics trace log already captures what actions were taken.

### Anti-Patterns to Avoid

- **Injecting CPI into the prompt as a full data table:** A table of per-item prices per iteration blows the token budget and confuses the LLM. One sentence is enough.
- **Running the AMM feedback loop every iteration regardless of inflation:** Small stochastic noise in CPI will continuously jitter AMM prices. Apply a minimum inflation threshold (e.g., 0.5%) before adjusting.
- **Applying AMM feedback before all action resolution:** The feedback must run after all agent trades. If it runs mid-iteration, the physics trace reports prices that were then adjusted before agents saw them.
- **Treating inflationRate as a wealth tax:** Direct wealth deletion violates SFC. Inflation shows up through rising nominal AMM prices, not through agent.wealth decreasing. See PITFALLS.md Pitfall 7.
- **Injecting unbounded CPI history into `sessionIterationMetrics`:** The iteration metrics string is already bounded to a rolling window. Adding CPI data to it must respect that window or the central agent's context will overflow. Use a dedicated `sessionInflationState` map instead.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| EMA smoothing for inflation expectations | Custom recursive IIR filter | Simple rolling mean over 3-5 values from `macro_snapshots` | The DB already stores per-iteration CPI; read last N rows and average. No state machine needed. |
| Base price initialization | Per-item config UI | Read first iteration's `marketPrices` rows; store in `session.config.cpiBasePrices` as JSON | Prices at iteration 1 are already in the DB. `economyConfigUtils.getEconomyConfig` already handles backward compat with defaults. |
| Pro-rata dividend distribution | Custom fraction math | `distributeProRata` already in codebase (used by banking, capital markets) | Already handles integer remainder; SFC-tested |
| AMM reserve access | Direct field mutation | `AMM.injectFiatReserve()` / `AMM.withdrawFiatReserve()` / `AMM.injectGoodsReserve()` | These methods already exist in `automatedMarketMaker.ts` and correctly update `k` |
| Session config update | Ad-hoc JSON merge | `getEconomyConfig()` + spread pattern already used throughout | Backward compat and defaults are handled; do not mutate session.config directly |

---

## Runtime State Inventory

> This is a greenfield phase (no rename/refactor). Section is not applicable.

---

## Environment Availability Audit

Step 2.6: SKIPPED — Phase 4 is purely TypeScript code and DB writes with no external CLI tools, services, or runtimes beyond the existing project stack (Node.js, SQLite, better-sqlite3, drizzle-orm). All of these were verified as available in Phases 1–2.

---

## Common Pitfalls

### Pitfall 1: AMM Reserve Injection Violates SFC (Pitfall 7 from PITFALLS.md)
**What goes wrong:** Injecting fiat into the AMM to raise prices creates fiat from nowhere. `computeSystemFiatTotal` includes `ammFiatReserve` — so injecting there increases the total without a corresponding agent debit.
**Why it happens:** Naive "raise prices → inject fiat into AMM" implementation.
**How to avoid:** AMM price adjustment must be SFC-neutral. The correct approach: adjust the goods reserve side only (withdraw goods from AMM to make food "scarcer" and price higher), or accept that `k` changes (price level rise is not conserved — it's the nominal anchor shifting). The existing `injectFiatReserve` method IS used by the UBI/demurrage cycle, which also changes `k`. Verify in a test that `computeSystemFiatTotal` does not drift after AMM feedback. If it does, switch to goods-reserve-only adjustment.
**Warning signs:** `computeSystemFiatTotal` increases by exactly the AMM feedback injection amount each iteration.

### Pitfall 2: No Base Price Anchor Means CPI Drifts to Infinity
**What goes wrong:** CPI is computed as a ratio to "previous iteration prices" rather than a fixed base. After 20 iterations of 2% inflation, CPI reads 140 (correct) but each step computes it as 1.02 × prior — which is a floating-point accumulation of rounding errors.
**Why it happens:** Using `CPI_t = (price_t / price_{t-1}) * CPI_{t-1}` (chain-weighted) instead of Laspeyres fixed-base.
**How to avoid:** Store `cpiBasePrices` at iteration 1 in `session.config`. Use Laspeyres formula: `CPI_t = Σ(w_i * price_t_i / price_0_i) * 100`. This is anchored forever to iteration 1 prices.
**Warning signs:** CPI reads 100 on iteration 1 then diverges; inflation rate becomes inconsistent with observable AMM spot price changes.

### Pitfall 3: Inflation Injected Before the End of Resolution Phase
**What goes wrong:** Inflation expectations are read from the PREVIOUS iteration's state but the cognitive phase runs BEFORE the current iteration's resolution. This is actually correct (see data flow below) — but if the inflation tick updates session state mid-iteration, agents in the same iteration will see contradictory signals.
**Why it happens:** Placing the inflation tick inside the intent phase loop rather than at the end of the iteration.
**How to avoid:** Place the inflation tick AFTER all action resolution, banking tick, and capital markets tick — at the very end of the iteration, just before the telemetry block. Cognitive injection reads the PREVIOUS iteration's `inflationExpectations` from the `sessionInflationState` map, which is only updated by the current iteration's tick after it completes.

### Pitfall 4: Central Bank LLM Generates Extreme Values
**What goes wrong:** The LLM-driven central bank agent panics at high CPI and sets `reserveRequirement = 0.99`, effectively freezing all lending.
**Why it happens:** The LLM responds dramatically to economic signals without understanding the mechanical constraints.
**How to avoid:** Physics engine must clamp all central bank action values to the ranges documented in the pattern above (0.05–0.50 for reserve ratio, 0.001–0.05 for base rate). Add validation in `physicsEngine.ts` resolution case, just like `ADJUST_TAX` clamps tax rate. Also inject the valid range into the `CentralBankContext` prompt so the LLM knows the constraints.
**Warning signs:** Banking engine suddenly shows 0% lending activity; simulation dies within 2 iterations of central bank activation.

### Pitfall 5: `sessionIterationMetrics` Bloat
**What goes wrong:** Adding CPI and inflation trend data to the `sessionIterationMetrics` string (which is passed to the Central Agent narrative prompt) causes the string to grow beyond the LLM's context window.
**Why it happens:** Following the pattern of appending to `sessionIterationMetrics` without a length bound.
**How to avoid:** Do NOT add inflation data to `sessionIterationMetrics`. Instead, create a separate `sessionInflationState` in-memory map (`Map<string, InflationState>`) that stores the latest CPI and expectations. The cognitive injection reads from this map directly, not from the iteration metrics string. The Central Agent narrative gets a single line appended — not a history.

### Pitfall 6: Phase 3 Fiscal Dependency
**What goes wrong:** ARCHITECTURE.md describes inflation as depending on "M1/M2 from banking and CPI basket from fiscal" — but Phase 3 (fiscal) plans exist but the code has not been executed yet per the codebase scan (no `fiscalEngine.ts`, no `fiscal_budget` table).
**Why it happens:** The architecture assumes sequential build order.
**How to avoid:** Phase 4 (inflation) does NOT depend on Phase 3 (fiscal) having been implemented. CPI basket uses AMM/order-book price data directly, which has been available since v0. M1 comes from Phase 1 banking (complete). The inflation engine can be built independently of the fiscal engine. The planner should note: if Phase 3 is incomplete when Phase 4 is planned/executed, that is acceptable — inflation does not require fiscal budget data.

---

## Code Examples

Verified patterns from existing codebase:

### Reading market prices for CPI (economyRepo pattern)
```typescript
// Source: server/src/db/repos/economyRepo.ts getPriceHistory()
// To get latest price snapshot for all items in one query:
const rows = await db.select()
  .from(marketPrices)
  .where(and(
    eq(marketPrices.sessionId, sessionId),
    eq(marketPrices.iterationNumber, iterationNumber),
  ));
// Returns: [{itemType: 'food', lastPrice, vwap, volume}, ...]
```

### AMM spot price adjustment (automatedMarketMaker pattern)
```typescript
// Source: server/src/mechanics/automatedMarketMaker.ts
// Raise spot price by inflating fiat reserve (k changes — intentional nominal anchor shift):
amm.injectFiatReserve(amm.currentFiatReserve * inflationFactor);
// spotPrice = fiatReserve / goodsReserve, so this raises price linearly.
// Note: verify SFC neutrality in sfcInflation.test.ts — see Pitfall 1 above.
```

### Session config update for central bank (existing ADJUST_TAX pattern)
```typescript
// Source: simulationRunner.ts — how ADJUST_TAX updates session policy
// Analogous pattern for SET_RESERVE_RATIO:
const sessionConfig = JSON.parse(session.config ?? '{}') as Record<string, unknown>;
const econConf = getEconomyConfig(sessionConfig);
econConf.reserveRequirement = clamp(newValue, 0.05, 0.50);
sessionConfig.economyConfig = econConf;
await sessionRepo.updateConfig(sessionId, JSON.stringify(sessionConfig));
```

### Banking context injection pattern (phase 1 established)
```typescript
// Source: server/src/llm/prompts.ts buildNaturalIntentPrompt()
// The optional parameter pattern — add inflationContext analogously:
buildNaturalIntentPrompt(
  agent, session, prevSummary, iterNum, economyContext,
  cognitiveContext, isFirstIteration, aliveAgentNames,
  allowedActions, marketBoard, employmentBoard,
  personalStatus, lastActionResults, enforcementLevel,
  marketIntelligenceBlock,
  citizenBankingContext,           // Phase 1
  bankOperationsContext,           // Phase 1
  citizenCapitalMarketContext,     // Phase 2
  inflationContext,                // Phase 4 NEW
)
```

### skillSystem exhaustiveness fix (required when adding ActionCodes)
```typescript
// Source: server/src/mechanics/skillSystem.ts ACTION_SKILL_MAP
// Phase 1 SUMMARY documents: adding ActionCodes to actionCodes.ts
// requires corresponding entries in ACTION_SKILL_MAP (TypeScript Record<ActionCode> exhaustiveness).
// Must add SET_RESERVE_RATIO and SET_BASE_RATE entries here.
SET_RESERVE_RATIO: { primary: 'management', secondary: null },
SET_BASE_RATE:     { primary: 'management', secondary: null },
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Inflation as exogenous shock (hardcoded % per N iterations) | Endogenous: computed from actual market price data + M1 growth | Phase 4 (this phase) | Inflation is attributable and observable, not arbitrary |
| CPI from single good (food price) | Laspeyres weighted basket (food 40%, tools 25%, luxury 20%, raw materials 15%) | Phase 4 | CPI reflects multi-market dynamics; food supply shocks do not dominate |
| Central bank as static config (reserve ratio hardcoded) | Central bank as LLM policy agent with SET_RESERVE_RATIO + SET_BASE_RATE | Phase 4 | Reserve requirement becomes a monetary policy lever that responds to CPI |

**Prior to this phase:**
- `EconomyConfig.inflationEnabled` field exists but no implementation reads it
- `TelemetryLog.m0` and `m1` are populated since Phase 1 but no feedback loop exists
- `marketPrices` table has been written since v0 but nothing reads it for CPI

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 1.x |
| Config file | `server/vitest.config.ts` |
| Quick run command | `npx vitest run server/src/__tests__/sfcInflation.test.ts` |
| Full suite command | `npm run test -w server` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| INFL-01 | CPI computed correctly from market price data with weighted basket | unit | `npx vitest run server/src/__tests__/sfcInflation.test.ts` | ❌ Wave 0 |
| INFL-01 | Base price anchoring: CPI=100 at iteration 1, rises correctly at iteration 2 | unit | same | ❌ Wave 0 |
| INFL-02 | AMM reserve scaling preserves expected price change; SFC audit unchanged | unit | same | ❌ Wave 0 |
| INFL-02 | Inflation factor below threshold produces no AMM adjustment | unit | same | ❌ Wave 0 |
| INFL-03 | Inflation expectations EMA smoothed over 3-iteration window | unit | same | ❌ Wave 0 |
| INFL-04 | (manual) Agent narrative mentions hoarding/wage demands when CPI > 5% | manual-only | — | N/A |
| BANK-07 | SET_RESERVE_RATIO clamps value to [0.05, 0.50]; updates EconomyConfig | unit | `npx vitest run server/src/__tests__/sfcInflation.test.ts` | ❌ Wave 0 |
| BANK-07 | SET_BASE_RATE clamps value to [0.001, 0.05]; banking engine reads new rate next tick | unit | same | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run server/src/__tests__/sfcInflation.test.ts`
- **Per wave merge:** `npm run test -w server`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `server/src/__tests__/sfcInflation.test.ts` — covers INFL-01, INFL-02, INFL-03, BANK-07
- [ ] Framework: already installed (vitest) — no install needed

---

## Open Questions

1. **SFC neutrality of AMM reserve injection**
   - What we know: `injectFiatReserve` increases `ammFiatReserve`, which IS counted in `computeSystemFiatTotal`. Injecting fiat there without a corresponding agent debit increases the total.
   - What's unclear: Whether the intended design is to update `k` by scaling both reserves proportionally (ratio preserved, `k` increases — price stays same!) or to only inject fiat (fiat/goods ratio changes — price rises). Only the latter raises prices, but it does change the SFC total.
   - Recommendation: In the inflation test, verify `computeSystemFiatTotal` before and after AMM feedback. If it drifts, switch to goods-reserve-only withdrawal (which is SFC-neutral within the AMM's own perimeter AND raises the price). Document the chosen approach in the plan.

2. **Phase 3 completion state**
   - What we know: Phase 3 plans exist (03-01, 03-02, 03-03 PLANs in `.planning/phases/03-fiscal-policy/`) but no fiscal code is implemented in the codebase.
   - What's unclear: Whether Phase 3 will be executed before Phase 4.
   - Recommendation: Phase 4 must NOT assume fiscal infrastructure. The inflation engine reads only `marketPrices` (v0) and M1 telemetry (Phase 1) — both available regardless of Phase 3 status. Document this independence explicitly in the plan.

3. **Central bank initialization**
   - What we know: The bank agent is initialized as a special agent with `type: 'bank'`. The same pattern should work for `type: 'central_bank'`.
   - What's unclear: Whether a session design with no central bank agent should still run inflation (yes — CPI is computed regardless; only BANK-07's policy response is conditional on the central bank agent existing).
   - Recommendation: The `inflationEnabled` flag in EconomyConfig gates CPI computation. `centralBankEnabled` (new flag) gates the central bank agent's policy actions. They are independent.

---

## Data Flow: Inflation Loop (Complete)

```
End of iteration N (after all action resolution, banking tick, capital markets tick):
    ↓
inflationEngine.computeInflation({
  currentPrices: from marketPrices table (iterationNumber = N),
  basePrices: from session.config.cpiBasePrices (set at N=1),
  m1Current: bankingLoansOutstanding + totalFiatSupply,
  m1Previous: from macroSnapshotRepo.getLatest(N-1),
  recentCpiHistory: from macroSnapshotRepo.getRecent(N, 3),
  economyConfig,
})
    ↓ returns InflationOutput { cpi, inflationRate, inflationExpectations, ammFeedbackFactor }
    ↓
macroSnapshotRepo.insertSnapshot({ iterationNumber: N, m0, m1, cpi, inflationRate, inflationExpectations })
    ↓
sessionInflationState.set(sessionId, { cpi, inflationRate, inflationExpectations })
    ↓
if (|inflationExpectations| > 0.5% && |factor| > 0.001):
  apply AMM reserve scaling to primaryAMM + all multiAMM pools
    ↓
if (centralBankEnabled):
  read macro snapshot → build CentralBankContext → inject into central bank agent intent prompt
    ↓
TelemetryLog extended: { ...existing, cpi, inflationRate, inflationExpectations }

Beginning of iteration N+1 (cognitive phase):
    ↓
sessionInflationState.get(sessionId) → inflationContext string
    ↓
buildNaturalIntentPrompt(..., inflationContext)
    ↓
Agents see: "CPI is 103.2 (up 3.2% from base). Running inflation: 1.8% this period."
    ↓
Agent LLM decides: POST_BUY_ORDER (food hoarding), WORK (wage demand), DEPOSIT (interest hedge)
    ↓
Resolution phase: these actions execute with standard physics rules
    ↓
Higher food demand → AMM food price rises further
    ↓ (next iteration) CPI rises further → expectations update → feedback continues
```

---

## Sources

### Primary (HIGH confidence)
- Codebase analysis: `server/src/mechanics/automatedMarketMaker.ts` — AMM reserve mutation methods
- Codebase analysis: `server/src/db/repos/economyRepo.ts` — `marketPrices` table read/write pattern
- Codebase analysis: `server/src/orchestration/simulationRunner.ts` — banking tick placement, SFC audit, telemetry pattern
- Codebase analysis: `shared/src/types.ts` — `EconomyConfig` existing fields, `TelemetryLog` m0/m1 fields
- Codebase analysis: `server/src/__tests__/sfcBanking.test.ts` — test structure pattern to follow
- `.planning/research/ARCHITECTURE.md` — Phase D build order, inflation engine component spec
- `.planning/research/FEATURES.md` — SFC accounting table for AMM inflation adjustment
- `.planning/research/PITFALLS.md` — Pitfall 7 (inflation-narrative decoupling), Pitfall 4 (bank agent SFC)

### Secondary (MEDIUM confidence)
- `.planning/phases/01-banking-foundation/01-03-SUMMARY.md` — M0/M1 naming convention confirmed: `m0 = totalFiatSupply`, `m1 = totalFiatSupply + loansOutstanding`; banking tick placement in simulationRunner
- `.planning/phases/02-capital-markets/02-03-SUMMARY.md` — Pattern for separate typed arrays, SFC-neutral transactions, simulation runner integration
- Laspeyres price index (standard macroeconomics) — weighted basket formula is definitionally correct

### Tertiary (LOW confidence — flag for implementation validation)
- M1 blending coefficient `α = 0.3` — initial estimate from ARCHITECTURE.md; requires empirical tuning against actual simulation wealth/price ranges
- Inflation smoothing window of 3 iterations — initial estimate; may need adjustment if CPI is too noisy at low agent counts
- AMM feedback cap of 2% per iteration — conservative estimate; may need tuning

---

## Project Constraints (from CLAUDE.md)

The following directives from `CLAUDE.md` constrain Phase 4 implementation:

| Directive | Impact on Phase 4 |
|-----------|------------------|
| **Shared types in `shared/src/types.ts`** | `MacroSnapshot`, `InflationState`, `CpiBasketWeights` types must go in `shared/src/types.ts`. Import as `@policylab/shared`. |
| **Prompt changes in `prompts.ts` only** | `inflationContext` parameter and `CentralBankContext` interface must be added to `server/src/llm/prompts.ts`. No prompt strings elsewhere. |
| **New action types: register in `actionCodes.ts` first** | `SET_RESERVE_RATIO` and `SET_BASE_RATE` must be added to `actionCodes.ts` (union type + role-permission table + `VALID_ACTIONS` set) before any physics engine reference. |
| **Economy changes: run SFC audit** | After any AMM reserve adjustment, verify `computeSystemFiatTotal` is not drifting. Add to `sfcInflation.test.ts` as an explicit assertion. |
| **All tunable economic parameters in `EconomyConfig`** | `cpiBasketWeights`, `m1InflationCoeff`, `inflationSmoothingWindow`, `centralBankEnabled`, `cpiBasePrices` must be EconomyConfig fields, not hardcoded constants. Defaults go in `DEFAULT_ECONOMY_CONFIG`. |
| **Multi-provider LLM** | Central bank agent LLM calls use the same `provider` + `citizenAgentModel` setting as other agents. No hardcoded model. |

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependencies; all existing patterns reused
- Architecture: HIGH — patterns directly derived from Phase 1 and 2 precedents; inflation engine follows same pure-function + repo separation
- AMM feedback formula: MEDIUM — mathematically sound but SFC neutrality requires verification in test
- Pitfalls: HIGH — all derived from PITFALLS.md research + direct codebase analysis
- Central bank clamping values: MEDIUM — reasonable initial bounds; may need iteration

**Research date:** 2026-04-01
**Valid until:** 2026-05-01 (stable codebase; AMM and banking patterns won't change)
