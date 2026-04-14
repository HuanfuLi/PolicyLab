# Phase 12: Labor Market Realism — Research

**Researched:** 2026-04-13
**Domain:** Labor economics integration — enterprise engine, simulation loop placement, AMM calibration, prompt template interpolation
**Confidence:** HIGH (all findings verified against source code at HEAD of `refactor/structural-decomposition`)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
D-01 through D-21 are locked. See 12-CONTEXT.md §Implementation Decisions for all formulas, tuning constants, and integration points. No alternatives to be explored.

### Claude's Discretion
- Exact choice of sigmoid vs linear for labor-market nudge function (D-01 step 2)
- Whether to store wage history per enterprise (for debugging) vs only latest posted wage
- Specific re-prompt phrasing for D-06 creative-mode validator feedback
- Prompt-level phrasing polish of D-17/D-18 beyond the template skeleton
- Dashboard chart styling (follow existing EconomicDashboard patterns)

### Deferred Ideas (OUT OF SCOPE)
- Education / training actions affecting reservation-wage / MRP
- Collective bargaining / unions
- Minimum-wage policy as governance-ballot item
- Unemployment benefits
- Sector/skill-match filters on APPLY_FOR_JOB
- Persistent wage history per enterprise (planner's discretion)
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| L-01 | Location-mode enterprise generation matches WB sectorEmployment distribution | §D-04/D-05; `generateEnterprises` at dataBootstrapPipeline.ts:440-552 needs vacancy count audit |
| L-02 | Creative-mode Central Agent generates enterprises matching society sector breakdown | §D-06/D-15; retryWithHealing already exists; JSON schema in prompt needs extending |
| L-03 | Every employable citizen has at least one candidate employer after bootstrap | §D-05 post-generation invariant check; new verification function needed in bootstrap |
| L-04 | Per-agent reservation wage = last-period PRODUCE_AND_SELL net proceeds | §D-12; resolvedActions is the cleanest read-only source; see §3 below |
| L-05 | Enterprises adjust posted wage each iteration from (applicants, vacancies, P&L) | §D-01; new `processWageAdjustment` function in enterpriseEngine.ts; runs before intent phase |
| L-06 | Wage upper bound enforced at MRP of labor | §D-01 step 4; MRP data requirements detailed in §2 below |
| L-07 | PRODUCE_AND_SELL physics + AMM calibrated to subsistence-margin only | §D-09/D-11; AMM depth + sell-price drag analysis in §5 below |
| L-08 | Action-dictionary prompts rewritten (subsistence framing + per-agent wage interpolated) | §D-17/D-18; ACTION_SCHEMAS is static — template interpolation pattern in §6 below |
| L-09 | APPLY_FOR_JOB auto-match from enterprises with open vacancies, wired into sim loop | §D-13; exact insertion point in simulationRunner detailed in §4 below |
| L-10 | QUIT_JOB + reapply path so employed agents can migrate to higher-paying work | §D-14; existing quit code works; reapply eligibility flag needed on weekState |
| L-11 | Wage history + labor-market telemetry (avg posted wage, unemployment rate, reservation-wage distribution) | §D-20/D-21; TelemetryLog extension + macroSnapshots schema addition |
</phase_requirements>

---

## Summary

Phase 12 integrates three tightly-coupled features into an already-complex simulation loop. The code archaeology confirms that most foundations exist and are wired correctly; the risk is in integration ordering and SFC boundary maintenance. The `APPLY_FOR_JOB` mechanism today adds agents to an applicant pool for a human-owner HIRE decision — Phase 12 replaces this with an automated matching pass, but the dispatch code in `enterpriseActionDispatch.ts` must stay compatible. The wage adjustment rule (D-01) is a pure-math extension to `EnterpriseRecord`; it needs two new fields (`lastApplicants`, `lastVacancies`) on the in-memory struct and their persistence via the enterprise DB table. Reservation-wage lookup is read-only and fits cleanly via a single query against `resolvedActions`. The AMM subsistence calibration requires adjusting `initialFiatReserve` / `initialFoodReserve` ratios and injecting a per-seller AMM depth drag, not rewriting the AMM.

**Primary recommendation:** Build in the wave order from CONTEXT.md §Next Steps (demographic gen → wage engine → matching pass → PAS recalibration → prompt wiring → telemetry + insolvency displacement). The matching pass (Plan 3) is the highest-risk integration point because it touches employment state that wage payment (Plan 2) and intent resolution (simulation loop) both read; get that sequencing right first.

---

## 1. Integration Risk Audit

### D-01 — Hybrid wage adjustment rule

**Risk: LOW.** The wage adjustment must run BEFORE the intent phase (so agents see updated wages in the employment board) but after the previous iteration's matching pass data is persisted (`lastApplicants`, `lastVacancies` on `EnterpriseRecord`). The integration point is in the per-iteration preamble of `simulationRunner.ts`, after `enterpriseRegistry` is loaded (~line 280) and before `buildEmploymentBoardEntries` (~line 672). The call is a pure function `processWageAdjustment(enterpriseRegistry, config)` → updates `enterprise.wage` in-memory + returns trace. No SFC impact: wage is a property stored on the enterprise record, not a fiat transfer. The transfer happens at the wage settlement block (lines 1754-1895).

**Risk: MEDIUM for MRP ceiling.** D-01 step 4 requires `output_price × output_per_worker − per_worker_input_cost` at runtime. This data is not currently tracked per-enterprise (see §2). If the MRP data is missing, the ceiling silently does nothing. The planner must schedule a data-availability check in Plan 2.

### D-02 — k and α in EconomyConfig

**Risk: LOW.** Pattern is identical to existing optional EconomyConfig fields with defaults. `shared/src/types.ts` already has `// Phase 10/11` addition blocks; add `laborWageNudgeK` and `laborWageProfitShareAlpha` following the same pattern with `?:` typing and defaults in `DEFAULT_ECONOMY_CONFIG`.

### D-03 — lastApplicants / lastVacancies per enterprise

**Risk: LOW.** `EnterpriseRecord` in `simulationState.ts:16-26` is an in-memory interface. Adding `lastApplicants: number` and `lastVacancies: number` with default 0 is non-breaking — all existing code reads the struct but none spreads/exhausts it. The DB enterprise table must also persist these fields across pause/resume via the ALTER TABLE guard pattern established in Phase 10-fix-simulation-realism.

### D-04/D-05 — Location-mode bootstrap invariant (110% vacancy target)

**Risk: MEDIUM.** Current `generateEnterprises` (dataBootstrapPipeline.ts:440-552) allocates employees round-robin and sets a flat `wage = max(minimumWage, baseFiat × 0.05)`. It does not compute or enforce a vacancy count. "Vacancies" in Phase 12 terminology = `enterprise.capacity − employees.length`. Currently enterprises have no explicit `capacity` field — they just have `employees` set.

**Required new concept:** `EnterpriseRecord` needs a `capacity: number` field (max workforce). Bootstrap sets `capacity = ceil(vacancies_target_per_sector / entCount)`. The D-05 invariant check sums `capacity − employees.length` across all enterprises and asserts ≥ 1.05 × employable_agent_count. This is a schema addition, not a refactor.

**Atomic bootstrap dual-write concern:** `generateEnterprises` returns `EnterpriseBlueprint[]` which is written to DB in `routes/bootstrap.ts` inside a single SQLite transaction. Adding `capacity` to the blueprint and schema requires:
1. `EnterpriseBlueprint` type in `shared/src/types.ts` gains `capacity?: number`
2. DB `enterprises` table gains `capacity INTEGER NOT NULL DEFAULT 20` with ALTER TABLE guard
3. `enterpriseRepo.insertEnterprise` writes the new field
4. The in-memory `EnterpriseRecord` loaded at simulation start reads it from DB

### D-06 — Creative-mode retry with validator feedback

**Risk: LOW.** `retryWithHealing` in `server/src/llm/retryWithHealing.ts` already exists and is used throughout. The creative-mode path uses `buildLawMessages` / Central Agent call sequence. The validator feedback is a new `parse` function that checks D-05 invariant on the LLM JSON, returns a healing message if it fails, and passes through on success. Max N=3 retries matches existing usage.

### D-07 — "Employable" definition

**Risk: LOW.** The filter excludes `type: 'bank'`, `role: 'central_bank'`, and roles matching `'central_agent'`/`'official'`. The existing `citizenAgents` filter in simulationRunner already excludes `type === 'bank'`. Phase 12 needs a shared `isEmployableAgent(agent)` predicate that matches D-07's definition, used in both bootstrap (D-04 denominator) and the matching pass (D-13 unemployment rate).

### D-08 — BASE_FOOD_PRODUCTION unchanged

**Risk: NONE.** `inventorySystem.ts:40` constant is not touched. D-08 is explicitly a no-op.

### D-09/D-10/D-11 — AMM subsistence calibration

**Risk: MEDIUM.** See §5 for detailed analysis. Key concern: AMM sell-price is governed by pool depth, and the `PRODUCE_AND_SELL` action injects food into the pool via inventory (the agent holds it; they sell separately via `POST_SELL_ORDER` in a subsequent action, or via the `PRODUCE_AND_SELL` physics which currently only updates inventory, not AMM directly). Confirm the actual sell-revenue path for `PRODUCE_AND_SELL` — it is inventory → separate sell order, not a direct AMM inject. The calibration target is the combined (production physics + subsequent sell) net, not the AMM alone.

### D-12 — Reservation-wage computation

**Risk: LOW.** See §3 for storage pattern. The computation is read-only, runs per-iteration at the start, and is a transient in-memory map. No SFC impact.

### D-13 — APPLY_FOR_JOB matching pass

**Risk: HIGH.** Today `APPLY_FOR_JOB` in `enterpriseActionDispatch.ts:101-109` adds the agent to `enterprise.applicants` for a human HIRE_EMPLOYEE decision. Phase 12 replaces the HIRE pathway with an automated matching pass that runs AFTER intent resolution (so applicants set is populated) but BEFORE wage payment (so new employees are in registry). This changes the semantics of `APPLY_FOR_JOB` from "notify owner" to "automated placement." The `HIRE_EMPLOYEE` action becomes vestigial. See §4 for exact insertion point.

**SFC risk:** The matching pass only mutates `employmentRegistry` and `enterprise.employees` — no fiat movement. Zero SFC impact.

### D-14 — QUIT_JOB reapply

**Risk: LOW.** Current `QUIT_JOB` in `enterpriseActionDispatch.ts:143-158` clears `employmentRegistry` and sets `state.employer_id = null`. D-14 adds the agent to an "auto-reapply" pool for the next iteration. This can be implemented as a `sessionQuitLastIteration: Map<string, Set<string>>` (sessionId → agentIds who quit last iteration), checked at the top of the matching pass alongside APPLY_FOR_JOB intents.

### D-15 — Creative-mode enterprise generation

**Risk: LOW.** D-15 is identical to D-06 (same generator). CONTEXT.md confirms these are the same path. The LLM prompt needs a `blueprintSchema` JSON block added to `buildLawMessages` (or a dedicated enterprise-generation prompt message).

### D-16 — Insolvency displacement telemetry

**Risk: LOW.** The insolvency path already exists at simulationRunner.ts:1816-1893 and releases employees. Phase 12 adds `displacedThisIteration` counter (increment per released employee), an `auto-reapply` flag (same mechanism as D-14), and one new telemetry field. The existing code structure accommodates this with a simple counter accumulation.

### D-17/D-18 — Action dictionary rewrite

**Risk: LOW.** See §6 for the interpolation pattern. The static `ACTION_SCHEMAS` dict needs a new construction function for per-agent variants. The interpolation happens inside `buildNaturalIntentPrompt` before it calls `buildActionDictionary(allowedActions)`.

### D-19 — Employment board augmentation

**Risk: LOW.** `buildEmploymentBoardSection` in `shared.ts:379-387` currently renders: `enterprise_id, industry, wage, min_skill, owner_name`. D-19 adds `vacancy_count` and `workforce/capacity` to the entry. `EmploymentBoardEntry` interface needs `vacancies?: number; workforce?: number; capacity?: number`. The builder in `marketBoard.ts:31-42` derives these from `EnterpriseRecord` when the new `capacity` field is available.

Reservation wage is shown "near the top of the block" per D-19 — this is passed as an extra parameter to `buildEmploymentBoardSection` (or a dedicated wrapper) so the block header shows the agent's anchor.

### D-20/D-21 — Labor-market telemetry

**Risk: LOW.** `TelemetryLog` in `shared/src/types.ts` already has a well-established pattern for optional fields (all Phase 11 fields are optional). Adding 7 fields in a `// Phase 12: Labor market` section is a non-breaking type extension. The `macroSnapshots` DB table must also gain columns via ALTER TABLE guard pattern. The fields can be computed at telemetry-build time (after matching pass and wage settlement have both run).

---

## 2. MRP Ceiling Data Requirements

**Decision context:** D-01 step 4 requires `wage ≤ output_price × output_per_worker − per_worker_input_cost`.

### Current per-enterprise data availability

| Field | Currently tracked | Where |
|-------|------------------|----|
| `sector` | Yes | `EnterpriseRecord.sector` |
| `commodity` | Derivable via `sectorToCommodity(sector)` | enterpriseEngine.ts:64 |
| `output_price` (commodity spot price) | Yes (AMM spot price for commodity) | `sessionMultiAMMRegistry` / `sessionAMMRegistry` per session |
| `output_per_worker` | Partially — `baseQty = 10 * workerCount` (simulationRunner.ts:1905) | Hard-coded in runner; not stored on enterprise |
| `per_worker_input_cost` | No — not tracked anywhere | Must be added |

### Recommended approach (HIGH confidence)

Add `productionPerWorker: number` to `EnterpriseRecord` (initialize from bootstrap at `10`, adjustable later). For `per_worker_input_cost`, use sector-based heuristics:
- `agriculture`: raw_materials cost per worker = `(RAW_MATERIALS_PER_PRODUCE × raw_materials_spot_price)` per unit of production. At 1 raw-material per PRODUCE action and `production = 10 × workerCount`, per-worker input = `raw_materials_spot_price × 1`.
- `industry`: tools and raw_materials are the inputs. Use `tools_spot_price × tool_wear_rate + raw_materials_spot_price × raw_mat_per_unit`.
- `services` / `government`: no physical input, per_worker_input_cost = 0.

**Practical simplification:** For Phase 12, use:
```
mrpCeiling = ammSpotPrice(commodity) × productionPerWorker − perWorkerInputCost
```
where `perWorkerInputCost` is a new optional `EconomyConfig` field `defaultPerWorkerInputCost` (default: 2, covers raw-material depletion cost). This avoids per-sector logic complexity while still providing a meaningful cap. If the AMM has no price for this commodity yet (iteration 1), MRP ceiling is skipped (wage unchanged from nudge + profit-share).

**Schema additions required:**
- `EnterpriseRecord` gains `productionPerWorker: number` (in-memory only; initialized to 10 at bootstrap load)
- `EconomyConfig` gains `defaultPerWorkerInputCost?: number` (default: 2)
- `EconomyConfig` gains `laborWageNudgeK?: number` (default: 0.03)
- `EconomyConfig` gains `laborWageProfitShareAlpha?: number` (default: 0.15)

**Confidence:** MEDIUM — the productionPerWorker=10 constant is hardcoded at simulationRunner.ts:1905 and represents the actual engine behavior; using it for MRP is internally consistent.

---

## 3. Reservation-Wage Storage Pattern

**Decision context:** D-12 requires `reservation_wage = last_period_PRODUCE_AND_SELL_net_proceeds` if the agent used PRODUCE_AND_SELL last iteration, otherwise `max(minimumWage × 0.5, small_constant)`.

### Option A: Read from resolvedActions (RECOMMENDED)

At the start of each iteration, after `aliveAgents` is fetched, query:

```typescript
// One query per iteration for all alive agents
const lastPasActions = db.select({
  agentId: resolvedActions.agentId,
  outcome: resolvedActions.outcome,
})
  .from(resolvedActions)
  .innerJoin(iterationsTable, eq(resolvedActions.iterationId, iterationsTable.id))
  .where(and(
    eq(resolvedActions.sessionId, sessionId),
    eq(iterationsTable.iterationNumber, iterNum - 1),
    sql`json_extract(${resolvedActions.outcome}, '$.actionCode') = 'PRODUCE_AND_SELL'`,
  ))
  .all();
```

Extract `net_proceeds` from the `outcome` JSON column (currently stores outcome text, not structured numeric data — see risk below).

**Risk:** The `resolvedActions.outcome` column stores a text string today, not structured JSON with a `net_proceeds` field. To make this query reliable, the PRODUCE_AND_SELL outcome must be stored with a numeric proceeds field, OR the reservation wage is computed differently.

**Alternative approach (RECOMMENDED):** Use `sessionLastActionResults` which already holds the outcome text per agent. Parse the last PRODUCE_AND_SELL outcome text for a proceeds amount. This is fragile.

**Better alternative:** Add a `sessionReservationWageMap: Map<string, Map<string, number>>` to `simulationState.ts` (sessionId → agentId → reservationWage). Populate it AFTER the AMM sell step when the physics engine processes PRODUCE_AND_SELL: compute net proceeds at the point-of-resolution and write to the map. At the start of the NEXT iteration, read from the map. This is clean, zero-query, and follows the `sessionPreviousWageCosts` pattern already used for cost pass-through.

### Option B: agentEconomy row (NOT RECOMMENDED)

Adding a `lastPasNetProceeds` column to `agentEconomy` table works but adds a DB write per agent per iteration that used PRODUCE_AND_SELL, which is high-frequency write pressure.

### Recommended pattern

```
simulationState.ts:
  export const sessionReservationWages = new Map<string, Map<string, number>>();
  // Populated end-of-iteration when PRODUCE_AND_SELL net is computed
  // Read start-of-next-iteration for matching pass + prompt context
```

At PRODUCE_AND_SELL resolution in the physics loop (inside the per-agent action processing block ~line 1373-1601), after AMM sell executes, compute:
```
netProceeds = sellRevenue − foodCostConsumed_thisIteration
sessionReservationWages.get(sessionId)?.set(agentId, netProceeds)
```

If the agent did not use PRODUCE_AND_SELL, the map entry is absent → D-12 fallback applies at read time.

Add `sessionReservationWages` to `cleanupSessionState` in simulationState.ts.

**Confidence:** HIGH — this follows the exact same pattern as `sessionPreviousWageCosts`.

---

## 4. APPLY_FOR_JOB Matching Pass Placement

### Current state

`APPLY_FOR_JOB` at `enterpriseActionDispatch.ts:101-109` adds `agent.id` to `enterprise.applicants`. The owner must use `HIRE_EMPLOYEE` to complete the hire. There is no automated matching.

### Phase 12 changes

The matching pass replaces the owner-mediated hire with a deterministic algorithm. The `enterprise.applicants` set is still populated by the action dispatch (this can remain unchanged — it is the input to the matching pass). The `HIRE_EMPLOYEE` action becomes a no-op or is removed from the action dictionary for non-owner agents.

### Exact insertion point

The matching pass must run:
- AFTER intent resolution (so `enterprise.applicants` is populated from APPLY_FOR_JOB actions this iteration)
- AFTER `weekStateMap` is built (so employer_id is initialized from the persisted registry)
- BEFORE the wage settlement block at line 1754

The correct insertion point is **after line 1296** (`weekStateMap` populated with `employer_id` from registry) and **before line 1297** (where `orderBook` is accessed — the order book block has no dependency on employment state).

Specifically, insert after:

```typescript
// line 1296
for (const agent of aliveAgents) {
  const state = weekStateMap.get(agent.id)!;
  state.employer_id = employmentRegistry.get(agent.id)?.enterpriseId ?? null;
}
// ← INSERT MATCHING PASS HERE (lines ~1297-1297)
const orderBook = getOrderBook(sessionId);  // line 1297
```

**Matching pass implementation:**

```typescript
// ── D-13: APPLY_FOR_JOB Automated Matching Pass ──────────────────────────
{
  const reservationWages = sessionReservationWages.get(sessionId) ?? new Map<string, number>();
  const minWage = iterEconomyConfig.minimumWage ?? 5;
  const reservationFloor = minWage * 0.5;

  // Build applicant pool: APPLY_FOR_JOB this iteration + QUIT last iteration (auto-reapply)
  const applicantIds = new Set<string>();
  for (const intent of intents) {
    if (intent.actions?.some(a => a.actionCode === 'APPLY_FOR_JOB')) {
      applicantIds.add(intent.agentId);
    }
  }
  // Add agents who quit last iteration (sessionQuitLastIteration)
  for (const agentId of (sessionQuitLastIteration.get(sessionId) ?? new Set())) {
    applicantIds.add(agentId);
  }
  sessionQuitLastIteration.set(sessionId, new Set()); // reset for this iteration

  // Per-applicant greedy best-offer matching
  for (const agentId of applicantIds) {
    if (employmentRegistry.has(agentId)) continue; // already employed
    const reservationWage = reservationWages.get(agentId) ?? reservationFloor;
    const qualifying = [...enterpriseRegistry.values()]
      .filter(ent => {
        const vacancies = (ent.capacity ?? 0) - ent.employees.size;
        return vacancies > 0 && ent.wage >= reservationWage;
      })
      .sort((a, b) => {
        if (b.wage !== a.wage) return b.wage - a.wage; // highest wage first
        return a.employees.size - b.employees.size;    // tie-break: smallest workforce
      });
    if (qualifying.length === 0) continue;
    const best = qualifying[0]!;
    employmentRegistry.set(agentId, {
      enterpriseId: best.id,
      employerId: best.ownerId,
      employeeId: agentId,
      wage: best.wage,
      minSkill: best.minSkill,
      startedAt: iterNum,
    });
    best.employees.add(agentId);
    weekStateMap.get(agentId)!.employer_id = best.id;
  }

  // Persist lastApplicants and lastVacancies for D-03
  for (const ent of enterpriseRegistry.values()) {
    ent.lastApplicants = [...ent.applicants].filter(id => applicantIds.has(id)).length;
    ent.lastVacancies = Math.max(0, (ent.capacity ?? 0) - ent.employees.size);
    ent.applicants.clear(); // consumed
  }
}
```

**Lines to add to simulationState.ts:**
```typescript
export const sessionQuitLastIteration = new Map<string, Set<string>>();
```

**QUIT_JOB dispatch change (enterpriseActionDispatch.ts):** After clearing `employmentRegistry`, add:
```typescript
// D-14: mark for auto-reapply next iteration
const quitSet = sessionQuitLastIteration.get(sessionId) ?? new Set<string>();
quitSet.add(agent.id);
sessionQuitLastIteration.set(sessionId, quitSet);
```

**Confidence:** HIGH — verified against actual simulationRunner loop structure.

---

## 5. AMM Subsistence Calibration Approach

### Current AMM mechanics (verified)

The AMM (`automatedMarketMaker.ts`) uses constant-product `x·y = k`. Key parameters:
- `initialFiatReserve` — set at session init based on `totalAgentWealth × 2` (approx)
- `initialFoodReserve` — set to produce a target spot price (e.g., `fiat=5000, food=1000 → price=5/unit`)
- `MAX_SLIPPAGE = 0.5` — prevents pool-draining trades

### PRODUCE_AND_SELL revenue path (verified)

`PRODUCE_AND_SELL` in `inventorySystem.ts:177-190` does NOT directly inject into the AMM. It updates the agent's **inventory** (`food.quantity += produced`). The agent then must use a separate `POST_SELL_ORDER` to sell food. The AMM is only hit when the order book has no matching buyer (AMM fallback at simulationRunner.ts:1705-1752).

**Implication for D-09 calibration:** "Net proceeds from PRODUCE_AND_SELL" = sell revenue from subsequent food sales minus food consumed for the agent's own survival. The full revenue path:
1. `PRODUCE_AND_SELL` adds ~4 units to inventory
2. Agent's weekly food consumption ≈ MET-driven (varies by weight/age/MET, typically 1-3 units/iteration)
3. Net sellable surplus ≈ 1-3 units at median agent stats
4. Sell price depends on AMM depth at time of sale

### Calibration targets per D-09

At 10-iteration steady-state with multiple sellers present:
- Median net ≈ 0: sell revenue barely covers food cost
- Bottom quartile net negative: raw-material depletion + tool wear + AMM saturation
- Top quartile slightly positive: fresh tools + few competing sellers

**AMM calibration lever:** The spot price is `fiatReserve / foodReserve`. When many sellers inject food (each `PRODUCE_AND_SELL` user selling 1-3 units), `foodReserve` grows and spot price drops. With 30% of agents doing PRODUCE_AND_SELL (10 agents in a 30-agent sim), food supply pressure is significant.

**Calibration approach:**

1. Run a baseline 10-iteration smoke test with agents all doing PRODUCE_AND_SELL.
2. Measure median sell price per unit.
3. If median net > 0.5 fiat/iteration, reduce `initialFoodReserve` (raises baseline price) and lower `initialFiatReserve` (deepens pool depth relative to food, meaning more sellers drive price down faster).
4. Target: `baselineFoodSpotPrice × sellableUnits − weeklyFoodCost ≈ 0.0`

**Recommended starting calibration (MEDIUM confidence):**
- `initialFoodReserve` increase of ~20% over current default reduces baseline price, compresses margin
- Alternatively: lower `MAX_SLIPPAGE` for food pool to 0.3 (more price impact per seller) — this directly implements the "AMM saturation" variance source from D-10

**Do NOT change:** `BASE_FOOD_PRODUCTION = 4`, `RAW_MATERIALS_PER_PRODUCE = 1`. Both are frozen per D-08.

**Practical path:** Implement a `ammSubsistenceCalibrationFactor?: number` in `EconomyConfig` that scales the food pool's initial depth ratio. Default 1.0 (current). Planner can set 0.7 to compress the sell-price margin without touching the AMM code itself.

**Confidence:** MEDIUM — calibration constants need empirical validation in the smoke test.

---

## 6. Prompt Template Interpolation Pattern

### Current architecture

`ACTION_SCHEMAS` in `shared.ts:17-80` is a static `Record<ActionCode, ActionSchema>` object. `buildActionDictionary(allowedActions)` in `shared.ts:157+` maps over it and renders each entry as a string.

### The problem with D-17

D-17 requires the WORK_AT_ENTERPRISE description to include the agent's **actual wage** — this is per-agent data unavailable in the static dictionary.

### Existing template patterns

`buildNaturalIntentPrompt` at `agent-intent.ts:280-482` already injects per-agent data into narrative blocks (wealth, health, etc.) using template literals. The `enterpriseContext` slot at line 470 is currently never populated — it is the exact hook D-17/D-19 should use.

### Recommended interpolation pattern

**Option A: Override at build time (RECOMMENDED)**

Before calling `buildActionDictionary`, construct a per-agent override map:

```typescript
// In buildNaturalIntentPrompt (agent-intent.ts), around line 413
const actionSchemaOverrides: Partial<Record<ActionCode, ActionSchema>> = {};

// D-17: inject actual wage into WORK_AT_ENTERPRISE description
const employment = personalStatus?.employment;
if (employment && employment.wage != null) {
  const employerName = employment.employer_name ?? 'your employer';
  actionSchemaOverrides['WORK_AT_ENTERPRISE'] = {
    description: `Show up at ${employerName} for this week's ${employment.wage.toFixed(1)} fiat wage. Guaranteed — no market risk. Paid directly to your wealth.`,
    params: '{ "enterprise_id": string }',
  };
}

const actionDictionary = buildActionDictionary(allowedActions, actionSchemaOverrides);
```

**Option B: Extend `enterpriseContext` slot**

The `enterpriseContext` slot at prompt line 470 is rendered as-is. Populate it from `simulationRunner.ts` with a per-agent employer block:

```typescript
const enterpriseContextBlock = employment
  ? `Your employment: ${enterpriseName} | Wage: ${employment.wage} fiat/week | Sector: ${ent.sector}\nYour reservation wage (self-production break-even): ${reservationWage.toFixed(1)} fiat`
  : undefined;
```

**Both can coexist:** Option A for the action dictionary (D-17), Option B for the employment status block (D-19). Option B is lower-risk since it does not touch `buildActionDictionary`.

### Signature change to `buildActionDictionary`

```typescript
// shared.ts — add optional override parameter
export function buildActionDictionary(
  allowedActions: readonly ActionCode[],
  overrides?: Partial<Record<ActionCode, ActionSchema>>,
): string
```

No callers break since the new parameter is optional.

**Confidence:** HIGH — verified against `buildNaturalIntentPrompt` structure and `enterpriseContext` slot.

---

## 7. Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest (verified in `server/vitest.config.ts`) |
| Config file | `server/vitest.config.ts` |
| Quick run command | `npm run test -w server -- --reporter=dot --run src/mechanics/__tests__/enterpriseEngine.test.ts` |
| Full suite command | `npm run test -w server` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| L-01 | generateEnterprises produces ≥1.05× vacancy-to-employable ratio | unit | `npx vitest run server/src/data/__tests__/enterpriseGeneration.test.ts -x` | ❌ Wave 0 |
| L-02 | D-05 invariant check triggers and emits correction trace | unit | `npx vitest run server/src/data/__tests__/enterpriseGeneration.test.ts -x` | ❌ Wave 0 |
| L-03 | retryWithHealing wires creative-mode validator and retries on failure | unit | `npx vitest run server/src/data/__tests__/enterpriseGeneration.test.ts -x` | ❌ Wave 0 |
| L-04 | Reservation wage = last-period PAS net proceeds | unit | `npx vitest run server/src/mechanics/__tests__/laborMarket.test.ts -x` | ❌ Wave 0 |
| L-05 | Wage nudge formula: surplus → wage down, shortage → wage up | unit | `npx vitest run server/src/mechanics/__tests__/laborMarket.test.ts -x` | ❌ Wave 0 |
| L-06 | MRP ceiling clamps wage above threshold | unit | `npx vitest run server/src/mechanics/__tests__/laborMarket.test.ts -x` | ❌ Wave 0 |
| L-07 | PAS net proceeds ≈ 0 over 10-iteration test | unit/integration | `npx vitest run server/src/mechanics/__tests__/laborMarket.test.ts -x` | ❌ Wave 0 |
| L-08 | WORK_AT_ENTERPRISE description contains agent wage | unit | `npx vitest run server/src/llm/__tests__/promptContent.test.ts -x` | ✅ (extend) |
| L-09 | Matching pass: applicant placed at highest-wage qualifying enterprise | unit | `npx vitest run server/src/orchestration/__tests__/matchingPass.test.ts -x` | ❌ Wave 0 |
| L-10 | QUIT_JOB sets auto-reapply flag; agent placed next iteration | unit | `npx vitest run server/src/orchestration/__tests__/matchingPass.test.ts -x` | ❌ Wave 0 |
| L-11 | avgPostedWage / unemploymentRate emitted in TelemetryLog | unit | `npx vitest run server/src/mechanics/__tests__/laborMarket.test.ts -x` | ❌ Wave 0 |
| SFC | Wage payment remains net-zero transfer after Phase 12 | unit | `npx vitest run server/src/mechanics/__tests__/sfcInvariant.test.ts -x` | ✅ (extend) |
| SMOKE | 10 iterations: unemployment rate decreases, avg wage changes, PAS break-even | integration | `npx vitest run server/src/orchestration/__tests__/laborSmoke.test.ts -x` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** Quick unit test for the module being changed
- **Per wave merge:** Full suite `npm run test -w server`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps (test scaffold files needed before implementation)

- [ ] `server/src/mechanics/__tests__/laborMarket.test.ts` — covers L-04..L-07, L-11 (wage formula unit tests)
- [ ] `server/src/data/__tests__/enterpriseGeneration.test.ts` — covers L-01, L-02, L-03
- [ ] `server/src/orchestration/__tests__/matchingPass.test.ts` — covers L-09, L-10
- [ ] `server/src/orchestration/__tests__/laborSmoke.test.ts` — 10-iteration smoke integration (no LLM — stub intents)

Existing test files to extend:
- `server/src/mechanics/__tests__/sfcInvariant.test.ts` — add wage-adjustment SFC case
- `server/src/llm/__tests__/promptContent.test.ts` — add wage interpolation assertion
- `server/src/mechanics/__tests__/enterpriseEngine.test.ts` — add `processWageAdjustment` cases

---

## 8. Risks and Mitigations

| Risk | Severity | Description | Mitigation |
|------|----------|-------------|------------|
| Matching pass breaks existing HIRE_EMPLOYEE semantics | HIGH | `APPLY_FOR_JOB` currently means "add to applicant pool for owner to review." Phase 12 auto-matches, making HIRE_EMPLOYEE a no-op. If any test or simulation relies on the two-step flow, it will fail silently (agents will be placed automatically, owner's HIRE call does nothing). | Document the semantic change. In enterpriseActionDispatch.ts:HIRE_EMPLOYEE, keep the code path but add a `// Phase 12: matching pass supersedes; this action is now vestigial` comment. Do NOT remove it — avoid breaking role-restricted action lists. |
| `capacity` field undefined on old EnterpriseRecords loaded from DB | HIGH | Old DB enterprise rows have no `capacity` column → `ent.capacity` is `undefined`. Matching pass uses `(ent.capacity ?? 0) - ent.employees.size` → always 0 vacancies → nobody ever gets hired. | ALTER TABLE guard pattern (established in Phase 10-fix-simulation-realism) adds `capacity INTEGER NOT NULL DEFAULT 20`. The default 20 ensures old sessions don't starve. Add explicit zero-check with warning log. |
| MRP ceiling silently no-ops if spot price for commodity not yet initialized | MEDIUM | At iteration 1, CPI base prices auto-init but commodity AMM spots may be zero or near-zero (empty pools). MRP = 0 → every wage gets clamped to minimum. | Guard with: `if (mrpCeiling <= 0 || isNaN(mrpCeiling)) skip ceiling this iteration`. Log the skip so it's observable. |
| Reservation wage map not cleaned between iterations | MEDIUM | `sessionReservationWages` stores last-period values. If an agent dies mid-simulation, their stale entry lingers. | Clean on agent death (where `deaths` array is populated, ~simulationRunner.ts line 1300). Also cleaned by `cleanupSessionState` at session end. |
| PAS net proceeds computation: food cost is MET-driven, not constant | MEDIUM | `reservation_wage = sell_revenue − food_cost_this_week`. MET metabolism (allostaticEngine.ts) consumes food proportional to weight/age/MET — it is not constant per agent. The net proceeds figure thus varies by agent physiology, making the reservation wage slightly random. | This is a feature, not a bug — per D-09, variance is intentional. Just ensure the net computation uses the actual food_consumed value from the inventory processing step, not a hardcoded amount. |
| D-06 creative-mode invariant check retry loop: 3 attempts may not converge | LOW | If the LLM consistently generates too few enterprises (e.g., only 2 sectors), 3 retries may all fail and bootstrap aborts. | The abort path already exists (D-06: "on exhaustion, bootstrap aborts with a clear error"). Ensure the error message propagates to the SSE stream so the UI shows a human-readable failure. |
| Tax withholding applies to wages already — wage increase flows through correctly | LOW | Phase 11 D-12/D-14 already withhold income tax at wage payment. When D-01 nudges wages up, employees receive `(newWage − tax)` automatically — no changes needed to the withholding code. | Verified: `computeWithholding(employment.wage, 'wage', taxPolicy)` at simulationRunner.ts:1794 uses `employment.wage` which comes from `EmploymentRecord`. The matching pass writes the enterprise's `wage` into `EmploymentRecord.wage`, so withholding is automatically correct for newly hired agents. |

---

## 9. Estimated Plan Shape

Seven plans aligned with CONTEXT.md §Next Steps wave structure:

| Plan | Title | Decisions | Key deliverables | Wave |
|------|-------|-----------|-----------------|------|
| 12-01 | Wave 0: types, DB schema, EconomyConfig extensions, test scaffolds | D-02, D-03 (schema), D-07 | `EnterpriseRecord.capacity/lastApplicants/lastVacancies`, `EconomyConfig` new fields, DB migration guards, 4 test scaffold files, `sessionReservationWages`/`sessionQuitLastIteration` in simulationState | 0 |
| 12-02 | Demographic-aligned enterprise generation — location and creative modes | D-04, D-05, D-06, D-07, D-15 | `generateEnterprises` 110% vacancy logic, D-05 invariant check, creative-mode validator retry, `isEmployableAgent` predicate | 1 |
| 12-03 | Wage-adjustment engine: nudge + profit-share + MRP cap | D-01, D-02, D-03 (runtime) | New `processWageAdjustment` function in enterpriseEngine.ts; EconomyConfig reads; simulationRunner wiring before intent phase | 1 |
| 12-04 | Reservation wage + APPLY_FOR_JOB matching pass + QUIT reapply | D-12, D-13, D-14 | `sessionReservationWages` population, matching pass at line ~1296, `sessionQuitLastIteration` tracking, vacancy count logic | 2 |
| 12-05 | PRODUCE_AND_SELL recalibration: AMM drag + prompt rewrite | D-08, D-09, D-10, D-11, D-18 | AMM calibration constant (`ammSubsistenceCalibrationFactor`), PAS net proceeds computation, new PRODUCE_AND_SELL prompt text | 2 |
| 12-06 | WORK_AT_ENTERPRISE prompt + enterpriseContext wiring + employment board augmentation | D-17, D-19 | `buildActionDictionary` override parameter, `buildEmploymentBoardSection` augmented with vacancy/workforce/capacity, `enterpriseContext` slot population with wage + reservation anchor | 3 |
| 12-07 | Insolvency displacement + labor-market telemetry + dashboard | D-16, D-20, D-21 | `displacedThisIteration` counter, `sessionQuitLastIteration` for bankruptcy path, TelemetryLog 7 new fields, macroSnapshots schema, dashboard chart additions | 3 |

*(Standard final verification plan is assumed to follow as Plan 12-08 or umbrella integration test.)*

---

## Environment Availability

Step 2.6: No external dependencies beyond existing project stack. Node.js, SQLite, vitest are all already verified operational. SKIPPED for this phase.

---

## Validation Architecture

See §7 above for the full test matrix.

### Wave 0 Gaps Summary

All four scaffold files are new. None exist yet:

- [ ] `server/src/mechanics/__tests__/laborMarket.test.ts` — unit tests for wage formula (L-04..L-07, L-11)
- [ ] `server/src/data/__tests__/enterpriseGeneration.test.ts` — enterprise bootstrap invariants (L-01..L-03)
- [ ] `server/src/orchestration/__tests__/matchingPass.test.ts` — matching pass determinism (L-09, L-10)
- [ ] `server/src/orchestration/__tests__/laborSmoke.test.ts` — 10-iteration no-LLM smoke (all requirements)

Existing files to extend:
- `server/src/mechanics/__tests__/sfcInvariant.test.ts` — wage adjustment SFC case
- `server/src/llm/__tests__/promptContent.test.ts` — wage interpolation in prompt

---

## Sources

### Primary (HIGH confidence)
- `server/src/mechanics/enterpriseEngine.ts` — processEnterpriseWages, processIdleFallback, processEnterpriseCostPassThrough (verified at HEAD)
- `server/src/orchestration/simulationState.ts` — EnterpriseRecord, EmploymentRecord, sessionMaps (verified at HEAD)
- `server/src/orchestration/simulationRunner.ts:1296-1895` — wage settlement + bankruptcy loop (verified loop structure)
- `server/src/orchestration/enterpriseActionDispatch.ts:101-158` — APPLY_FOR_JOB, HIRE_EMPLOYEE, QUIT_JOB (verified)
- `server/src/llm/prompts/shared.ts:17-80, 379-387` — ACTION_SCHEMAS, buildEmploymentBoardSection (verified)
- `server/src/llm/prompts/agent-intent.ts:396-470` — employmentBoardBlock, enterpriseContext slot (verified)
- `server/src/mechanics/inventorySystem.ts:40, 177-190` — BASE_FOOD_PRODUCTION, PRODUCE_AND_SELL physics (verified)
- `server/src/mechanics/automatedMarketMaker.ts` — AMM constants, sell mechanics (verified)
- `shared/src/types.ts:243-333` — TelemetryLog, full field inventory (verified)
- `server/src/db/schema.ts:229-241` — macroSnapshots schema (verified)

### Secondary (MEDIUM confidence)
- `server/src/data/dataBootstrapPipeline.ts:440-552` — generateEnterprises (verified, no vacancy logic exists)
- `server/src/orchestration/helpers/marketBoard.ts:31-42` — buildEmploymentBoardEntries (verified, missing capacity/vacancy fields)
- `server/src/orchestration/helpers/weekState.ts:17-18` — workedEnterpriseId / quitEnterpriseId (verified)

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependencies
- Architecture: HIGH — all integration points verified against actual code at HEAD
- Pitfalls: HIGH — capacity/undefined risk, matching-pass semantics, MRP null guard are all code-verified
- AMM calibration: MEDIUM — constants require empirical validation in smoke test

**Research date:** 2026-04-13
**Valid until:** 2026-05-13 (stable codebase; lower risk of staleness than typical)
