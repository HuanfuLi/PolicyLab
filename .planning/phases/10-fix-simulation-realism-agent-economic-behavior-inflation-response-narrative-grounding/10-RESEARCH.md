# Phase 10: Fix Simulation Realism - Research

**Researched:** 2026-04-07
**Domain:** Simulation engine realism: enterprise economics, inflation mechanics, narrative grounding, banking adoption
**Confidence:** HIGH

## Summary

Phase 10 is a deep engine rework across 4 interlocking subsystems: (1) enterprise auto-creation and employment economics, (2) CPI/inflation response with Taylor Rule central bank feedback, (3) narrative grounding via pre-interpreted telemetry digests and hard validation, and (4) banking adoption through enterprise-integral deposit/loan flows. The codebase already has enterprise registries, wage settlement, bankruptcy logic, banking engine, inflation engine, and capital market engine -- all implemented across Phases 1-4 and wired in `simulationRunner.ts`. The work is primarily about making these existing systems work together coherently rather than building from scratch.

The critical insight from code review: enterprises currently only exist when agents FOUND_ENTERPRISE via LLM action. No enterprises are auto-created during bootstrap. This means location-mode sessions start with zero enterprises, zero employment, and agents default to independent PRODUCE_AND_SELL/WORK actions. Banking is unused because there is no enterprise demand for loans. CPI is stagnant because prices only move when agents trade with the AMM, and with no enterprise supply chains, AMM activity is sporadic.

**Primary recommendation:** Structure implementation in 4 waves: (1) Enterprise bootstrap + auto-creation infrastructure, (2) Enterprise wage/production/banking integration, (3) Inflation response + Taylor Rule central bank, (4) Narrative grounding + validation. Each wave builds on the previous and can be independently tested.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Auto-create enterprises from real World Bank data during location bootstrap. Fetch new indicators (firm count/size per sector) to generate plausible enterprise structures. Multiple small enterprises per sector (e.g., 2-3 competing farms, 2 factories) rather than one mega-enterprise per role.
- **D-02:** Elite-role agents (merchants, foremen) are assigned as enterprise owners. They have higher initial wealth from Gini-based distribution, making them natural capitalists.
- **D-03:** Enterprise initial capital seeded from bootstrap data -- proportional to GDP per capita. Inventory seeded by sector (farms get food stock, factories get raw materials).
- **D-04:** For creative-mode sessions, the Central Agent generates enterprises during the design phase (roster generation step). One more output alongside the agent roster.
- **D-05:** Agents are paid on WORK action only -- no work, no pay. Keeps agent agency central.
- **D-06:** Enterprise insolvency: partial pay when treasury is low. After 3 consecutive iterations of insufficient funds, enterprise goes bankrupt -- employees become unemployed, assets liquidated to AMM.
- **D-07:** Config-based minimum wage floor (from World Bank data or user input) + market forces. Enterprises can pay above minimum based on profitability. The existing minimumWage parameter becomes meaningful.
- **D-08:** Labor mobility via new QUIT_JOB action code. Agents can leave their enterprise and re-apply elsewhere.
- **D-09:** Idle-agent fallback: after 2 consecutive iterations of zero production (no WORK/PRODUCE action), the physics engine forces a minimal PRODUCE action (5 food) representing subsistence activity. Safety net against total economic paralysis.
- **D-10:** Enterprise cost pass-through: when enterprise wage costs rise (from minimum wage hike), enterprises raise the price at which they sell goods to the AMM. Creates cost-push inflation through the existing market mechanism.
- **D-11:** Supply/demand shocks via enterprise production: enterprises sell output to AMM (adding supply), agents buy from AMM (adding demand). With active enterprises, the AMM naturally becomes more volatile.
- **D-12:** Keep current CPI basket (food 40%, tools 25%, luxury 20%, raw materials 15%). The problem was price stagnation, not basket composition.
- **D-13:** Reduce inflation smoothing window from 3 to 1-2 iterations so price shocks appear in CPI quickly.
- **D-14:** Central bank Taylor Rule response: raise rates when CPI exceeds target, lower when below. Creates monetary policy feedback loop. Uses existing centralBankEnabled config.
- **D-15:** Central bank rate ceiling (e.g., 15%). When rates hit ceiling, switch to direct intervention: restrict lending, increase reserve requirements. Prevents infinite rate hikes in runaway scenarios.
- **D-16:** Agents see inflation trend in their economic context each iteration. Already partially from Phase 4; verify and strengthen.
- **D-17:** Replace "friction first" narrative directive with data-driven tone that also incorporates citizen sentiment. Tone MUST match the data.
- **D-18:** Pre-interpreted telemetry digest sent to resolution prompt. Before LLM call, compute trend summary with key metric changes and population mood.
- **D-19:** Prose with embedded data points. Narrative reads like prose but weaves in real numbers.
- **D-20:** Hard validation with re-generation. After narrative generation, check 3 key assertions: Gini direction consistency, death count accuracy, wealth trend consistency. If contradictions found, regenerate with stricter prompt.
- **D-21:** Agent reflections receive full personal stat trajectory: per-iteration wealth, health, happiness, what they produced/consumed.
- **D-22:** Audit and fix per-iteration agent data injection + add runtime assertions that verify agent context includes accurate personal data before sending to LLM.
- **D-23:** Prompt incentive redesign for citizen agents -- rewrite banking action descriptions to emphasize ROI.
- **D-24:** Enterprises bank through the system. Enterprise treasury is a deposit account at the bank. Payroll is a bank transfer. Capital investment requires loans.
- **D-25:** Differentiated loan products: business loans (larger, longer term, lower rates, collateralized by enterprise assets) vs personal loans (smaller, shorter, higher rates).
- **D-26:** Central bank liquidity injection: when bank reserves are critically low, central bank injects fiat to maintain lending capacity. Lender of last resort.
- **D-27:** If agent background LLM enrichment fails during location bootstrap, fail the entire bootstrap.
- **D-28:** Role-based commodity mapping: Farms -> food, Factories -> tools + raw_materials, Artisan/merchant enterprises -> luxury_goods. Maps to existing 4-commodity AMM.
- **D-29:** Service enterprises (schools, clinics) provide multiplier effects only -- boost education/health quality via existing fiscal multiplier system. No commodity output. Revenue from government budget.

### Claude's Discretion
- Exact Taylor Rule parameters (neutral rate, inflation target, response coefficients)
- How enterprise capital is split between multiple enterprises in same sector
- Exact threshold for central bank liquidity injection trigger
- How narrative validation assertions are implemented (regex, LLM judge, or keyword matching)
- Enterprise naming during bootstrap (LLM-generated contextual names)

### Deferred Ideas (OUT OF SCOPE)
- Early stopping recalibration -- with active enterprises and banking, the stagnation detector needs different thresholds
- Order-book pricing as AMM replacement
- Dynamic CPI basket weights (Engel's law)
- Enterprise merger/acquisition mechanics
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| D-01 | Auto-create enterprises from World Bank data during location bootstrap | WB indicators IC.BUS.NDNS.ZS (business density) and IC.BUS.NREG (new businesses) available via API; generateAgentRoster in dataBootstrapPipeline.ts is the integration point |
| D-02 | Elite-role agents assigned as enterprise owners | getRoleTier in actionCodes.ts already classifies agents; generateAgentRoster assigns wealthiest slots to industry agents first |
| D-03 | Enterprise initial capital from bootstrap data | profileToEconomyConfig already maps GDP per capita; extend with enterprise capital multiplier |
| D-04 | Creative-mode enterprise generation | centralAgent.ts design generation step; add enterprise output alongside roster |
| D-05 | Pay on WORK only | Wage settlement block at line 2248 already handles this -- workers paid only when workedEnterpriseId matches |
| D-06 | Enterprise insolvency with 3-iteration tracking | Bankruptcy block exists at line 2298; needs consecutive insolvency counter (currently instant bankruptcy) |
| D-07 | Minimum wage floor | EconomyConfig needs new minimumWage field; enforce in wage settlement |
| D-08 | QUIT_JOB labor mobility | QUIT_JOB already registered in actionCodes.ts and handled at line 700 |
| D-09 | Idle-agent fallback (subsistence production) | New mechanic; insert after action resolution, before wage settlement |
| D-10 | Enterprise cost pass-through | New mechanic in enterprise production pricing logic |
| D-11 | Supply/demand via enterprise AMM interaction | WORK_AT_ENTERPRISE already sells to AMM (line 744-780); needs enterprise-level pricing |
| D-12 | Keep CPI basket as-is | No changes needed |
| D-13 | Reduce inflation smoothing window | inflationSmoothingWindow in EconomyConfig; change default from 3 to 2 |
| D-14 | Taylor Rule central bank response | Extend SET_BASE_RATE/SET_RESERVE_RATIO handling (line 2390); add autonomous Taylor Rule logic |
| D-15 | Central bank rate ceiling | New clamp logic in Taylor Rule implementation |
| D-16 | Inflation trend in agent context | buildInflationContextSection in shared.ts; verify and strengthen |
| D-17 | Data-driven narrative tone | Replace FRICTION FIRST directive in buildResolutionPrompt (central-agent.ts line 248) |
| D-18 | Pre-interpreted telemetry digest | New function in central-agent.ts or shared.ts; compute before resolution LLM call |
| D-19 | Prose with embedded data points | Prompt engineering in buildResolutionPrompt |
| D-20 | Hard validation with re-generation | New validation function post-narrative generation |
| D-21 | Agent reflection stat trajectory | Extend buildAgentReflectionPrompt in reflection.ts with per-iteration stats |
| D-22 | Audit agent data injection + runtime assertions | Verify existing context injection in simulationRunner.ts; add assertions |
| D-23 | Banking prompt ROI emphasis | Rewrite ACTION_SCHEMAS for DEPOSIT, TAKE_LOAN etc in shared.ts |
| D-24 | Enterprise banking integration | New mechanic: enterprise deposit accounts, bank-mediated payroll |
| D-25 | Differentiated loan products | Extend LoanContract type and bankingEngine.processLoanRequest |
| D-26 | Central bank liquidity injection | New mechanic in banking tick |
| D-27 | Fail bootstrap on LLM enrichment failure | Modify bootstrap.ts error handling (line 237-259) |
| D-28 | Role-based commodity mapping | Extend industryToItemType (line 290) for factories -> tools+raw_materials |
| D-29 | Service enterprises via fiscal multipliers | New enterprise type that integrates with fiscalEngine.ts |
| D-30 | CPI base price auto-initialization from AMM spot prices | cpiBasePrices all-zero check in simulationRunner before computeInflation; snapshot AMM prices as base |
| D-31 | Public goods quality spending-to-GDP scaling + decay rebalance | Scale gain by categorySpending/totalFiat ratio; trivial spending cannot max quality |
| D-32 | Flat income/production tax on WORK income and enterprise revenue | computeIncomeTax in fiscalEngine.ts; wired after wage settlement, before budget execution |
</phase_requirements>

## Standard Stack

### Core (Existing -- No New Dependencies)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| vitest | existing | Unit/integration testing for engine mechanics | Already configured in server/vitest.config.ts |
| drizzle-orm + better-sqlite3 | existing | Schema extensions for enterprise/loan types | Already wired; DB schema in server/src/db/schema.ts |
| uuid | existing | Enterprise ID generation | Already used in bankingEngine.ts and capitalMarketEngine.ts |

### No New Dependencies Required
This phase is entirely engine-internal. All changes are to existing TypeScript modules, types, and prompts. No new npm packages needed.

## Architecture Patterns

### Recommended Change Structure
```
shared/src/types.ts          -- EconomyConfig extensions (minimumWage, Taylor params, loan types)
server/src/data/
  indicatorMap.ts             -- New WB indicators (IC.BUS.NDNS.ZS, IC.BUS.NREG)
  dataBootstrapPipeline.ts    -- Enterprise generation in generateAgentRoster
  locationDataService.ts      -- Fetch new enterprise indicators
server/src/mechanics/
  bankingEngine.ts            -- Differentiated loan products, enterprise deposit logic
  inflationEngine.ts          -- Smoothing window change, Taylor Rule output
  enterpriseEngine.ts         -- NEW: enterprise cost pass-through, idle fallback, insolvency tracking
server/src/orchestration/
  simulationRunner.ts         -- Wire enterprise banking, Taylor Rule, narrative validation
  simulationState.ts          -- Enterprise insolvency counter
server/src/llm/prompts/
  central-agent.ts            -- Telemetry digest, data-driven narrative, validation
  agent-intent.ts             -- Banking ROI prompts, inflation context
  shared.ts                   -- Updated ACTION_SCHEMAS
  reflection.ts               -- Stat trajectory injection
```

### Pattern 1: Deterministic Engine with Delta Returns
**What:** All engine functions (bankingEngine, capitalMarketEngine, fiscalEngine) receive data and return delta objects. No direct DB mutations. The simulationRunner applies deltas in batch.
**When to use:** All new mechanics must follow this pattern.
**Example:**
```typescript
// Pattern from bankingEngine.ts -- all new mechanics MUST follow this
export interface EnterpriseDelta {
  wagePayments: Array<{ fromAgentId: string; toAgentId: string; amount: number }>;
  productionOutput: Array<{ enterpriseId: string; itemType: ItemType; quantity: number }>;
  insolvencyUpdates: Array<{ enterpriseId: string; consecutiveDeficits: number }>;
  bankruptcies: string[]; // enterprise IDs dissolved
  trace: string[];
}
```

### Pattern 2: EconomyConfig Extension for New Parameters
**What:** All tunable parameters stored in EconomyConfig (optional fields with defaults). Never hardcode.
**When to use:** Every new economic parameter (minimumWage, taylorNeutralRate, etc.)
**Example:**
```typescript
// In shared/src/types.ts -- extend EconomyConfig
export interface EconomyConfig {
  // ... existing fields ...
  minimumWage?: number;           // per-iteration minimum wage floor
  taylorNeutralRate?: number;     // neutral real interest rate (default: 0.02/12)
  taylorInflationTarget?: number; // target CPI inflation rate (default: 2%)
  taylorInflationCoeff?: number;  // response to inflation gap (default: 0.5)
  taylorOutputCoeff?: number;     // response to output gap (default: 0.5)
  centralBankRateCeiling?: number; // max rate before direct intervention (default: 0.0125)
  businessLoanRateDiscount?: number; // rate discount for business vs personal (default: 0.3)
  businessLoanTermMultiplier?: number; // term extension for business loans (default: 1.5)
  liquidityInjectionThreshold?: number; // reserve ratio below which CB injects (default: 0.05)
}
```

### Pattern 3: Enterprise Auto-Creation During Bootstrap
**What:** After generating agent roster, create enterprise structures and assign owners.
**When to use:** In both location-mode (dataBootstrapPipeline) and creative-mode (centralAgent design step).
**Example:**
```typescript
// New export from dataBootstrapPipeline.ts
export interface EnterpriseBlueprint {
  id: string;        // e.g., "ent_farm_01"
  name: string;      // LLM-generated or formulaic
  ownerId: string;   // agent ID of elite/specialist owner
  sector: 'agriculture' | 'industry' | 'services' | 'government';
  industry: string;  // maps to commodity type via industryToItemType
  initialCapital: number;
  initialInventory: Record<string, number>;
  employees: string[]; // agent IDs of initial workers
  wage: number;       // starting wage (>= minimumWage)
}
```

### Pattern 4: Narrative Validation Post-Generation
**What:** After LLM generates narrative, programmatically check key assertions against telemetry. If contradictions found, regenerate with stricter prompt.
**When to use:** After every buildResolutionPrompt LLM call.
**Example:**
```typescript
interface NarrativeValidation {
  giniDirectionMatch: boolean;   // narrative says inequality "grew" when gini increased
  deathCountAccurate: boolean;   // 0 deaths in telemetry = no starvation language
  wealthTrendMatch: boolean;     // rising avg wealth != "wealth collapsed"
  passed: boolean;
}

function validateNarrative(
  narrative: string,
  currentTelemetry: TelemetryLog,
  previousTelemetry: TelemetryLog | null
): NarrativeValidation { ... }
```

### Anti-Patterns to Avoid
- **Direct DB writes in engine functions:** All new mechanics MUST return deltas, not call repos directly. The simulationRunner is the only module that applies writes.
- **Hardcoded economic constants:** Every tunable value goes in EconomyConfig. D-07 specifically calls out that minimumWage must be configurable.
- **Breaking SFC accounting:** Any new fiat flow (enterprise wages, liquidity injection, loan differentiation) must be SFC-neutral. Run the SFC audit after changes.
- **Enterprise state in DB-only:** Enterprise registries are in-memory Maps (simulationState.ts). DB is for persistence across pause/resume. Both must stay in sync.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Taylor Rule computation | Custom monetary policy logic | Standard Taylor Rule formula from macroeconomics | Well-established: i = r* + pi + 0.5*(pi - pi*) + 0.5*(y - y*); widely validated |
| Enterprise-to-AMM pricing | Custom price discovery | Existing AMM executeSell/executeBuy | AMM already handles price discovery via constant product; enterprise output sells through it |
| Gini direction detection | Custom inequality analysis | Existing giniCoefficient in telemetry | Already computed per iteration; just compare current vs previous |
| Per-agent stat trajectory | New tracking system | Existing DB tables (agentEconomy, iterations, resolvedActions) | Data already persisted; query at reflection time |

## Common Pitfalls

### Pitfall 1: SFC Violation from Enterprise Banking
**What goes wrong:** Enterprise deposit accounts and bank-mediated payroll create new M1 flows that the SFC audit doesn't expect. Fiat appears to leak or duplicate.
**Why it happens:** Enterprise treasury as a deposit account means payroll is a deposit-to-deposit transfer (within M1), not a wealth-to-wealth transfer (within M0). The SFC formula M1 = M0 + loansOutstanding must still hold.
**How to avoid:** When enterprise treasury becomes a deposit account, payroll transfers happen within the deposit system (deposit-to-deposit). Owner wealth is only the deposit balance, not separate. Bank agent wealth (reserves) must correctly track all flows.
**Warning signs:** SFC audit failures after banking tick; totalFiatSupply changes between iterations.

### Pitfall 2: Infinite Inflation Spiral
**What goes wrong:** Cost-push inflation from wage hikes causes CPI spike, Taylor Rule raises rates, higher rates increase enterprise borrowing costs, enterprises raise prices further, CPI spikes more.
**Why it happens:** The Taylor Rule response coefficient is too aggressive or the rate ceiling is too high.
**How to avoid:** Use standard Taylor Rule calibration (coefficient 0.5, not 1.0+). Set rate ceiling at ~15% annual (~1.25% per iteration). When ceiling hit, switch to quantity restrictions (reserve ratio increase) which naturally limits credit expansion without amplifying price signals.
**Warning signs:** CPI increasing by >5% per iteration; base rate hitting ceiling within 3 iterations.

### Pitfall 3: Bootstrap Data Gaps for Enterprise Indicators
**What goes wrong:** World Bank IC.BUS.NDNS.ZS and IC.BUS.NREG have patchy coverage -- many developing countries lack recent data.
**Why it happens:** Enterprise survey data is collected less frequently than standard WDI indicators.
**How to avoid:** Always provide fallback heuristics. If no enterprise density data, derive from sector employment + GDP per capita: higher GDP = more firms per worker. Default to 2-3 enterprises per sector for 30-50 agent simulations.
**Warning signs:** locationDataService returning null for enterprise indicators.

### Pitfall 4: Narrative Validation False Positives
**What goes wrong:** Regex/keyword matching flags valid narratives as contradictory. "Wealth inequality narrowed slightly" gets flagged when checking for "wealth" near "decline".
**Why it happens:** Natural language is ambiguous; simple keyword matching has high false-positive rates.
**How to avoid:** Use structured checks against numerical assertions, not prose analysis. Check: (1) if narrative mentions specific numbers, do they match telemetry? (2) if narrative says "X deaths", does it match the actual death count? (3) directional claims (growth/decline) checked against telemetry deltas. Use LLM judge only as fallback for ambiguous cases.
**Warning signs:** High re-generation rate (>20% of iterations triggering re-gen).

### Pitfall 5: Enterprise Owner Double-Counting
**What goes wrong:** Enterprise owner's personal wealth and their enterprise treasury are both counted in SFC total, but they represent the same money.
**Why it happens:** D-24 makes enterprise treasury a bank deposit. If the owner's "wealth" field still includes enterprise funds, they're counted twice -- once as agent wealth, once as deposit balance.
**How to avoid:** When enterprise banking is active, enterprise treasury IS the deposit account balance. Owner agent's wealth tracks ONLY their personal cash. Enterprise revenue goes to deposit, not to wealth. Payroll withdraws from deposit.
**Warning signs:** SFC total increases when enterprises are founded.

### Pitfall 6: Creative-Mode Regression
**What goes wrong:** Enterprise auto-creation works for location-mode but creative-mode sessions break because the Central Agent's design generation doesn't produce enterprise structures.
**Why it happens:** D-04 requires separate implementation path for creative sessions.
**How to avoid:** Both paths must produce the same EnterpriseBlueprint output format. Test both paths.
**Warning signs:** Creative-mode sessions starting with zero enterprises.

## Code Examples

### Taylor Rule Implementation (Discretion Area)
```typescript
// Standard Taylor Rule: i = r* + pi + alpha*(pi - pi*) + beta*(y - y*)
// Adapted for per-iteration discrete simulation (annual rates / 12)
//
// Source: Taylor (1993), verified via Federal Reserve Bank of Atlanta Taylor Rule Utility
// https://www.atlantafed.org/cqer/research/taylor-rule

interface TaylorRuleInput {
  currentInflationRate: number;  // per-iteration CPI inflation rate (from inflationEngine)
  inflationTarget: number;       // per-iteration target (default: 2% annual / 12 = 0.167%)
  neutralRate: number;           // per-iteration neutral real rate (default: 2% annual / 12)
  outputGapEstimate: number;     // (actual - potential) / potential; estimated from employment rate
  rateCeiling: number;           // maximum rate (default: 15% annual / 12 = 1.25% per iteration)
  inflationCoeff: number;        // response to inflation gap (default: 0.5)
  outputCoeff: number;           // response to output gap (default: 0.5)
}

interface TaylorRuleOutput {
  targetRate: number;            // recommended per-iteration lending rate
  ceilingHit: boolean;           // true if rate was clamped to ceiling
  reserveRatioAdjustment: number; // +delta when ceiling hit, 0 otherwise
  trace: string[];
}

function computeTaylorRule(input: TaylorRuleInput): TaylorRuleOutput {
  const inflationGap = input.currentInflationRate - input.inflationTarget;
  const rawRate = input.neutralRate
    + input.currentInflationRate
    + input.inflationCoeff * inflationGap
    + input.outputCoeff * input.outputGapEstimate;

  const clampedRate = Math.max(0.001, Math.min(input.rateCeiling, rawRate));
  const ceilingHit = rawRate > input.rateCeiling;

  // When rate ceiling hit, shift to quantity restriction
  const reserveRatioAdjustment = ceilingHit
    ? Math.min(0.05, (rawRate - input.rateCeiling) * 0.5) // scale reserve increase
    : 0;

  return {
    targetRate: clampedRate,
    ceilingHit,
    reserveRatioAdjustment,
    trace: [
      `[CB] Taylor Rule: r*=${input.neutralRate.toFixed(4)}, pi=${input.currentInflationRate.toFixed(4)}, pi*=${input.inflationTarget.toFixed(4)}, gap=${inflationGap.toFixed(4)}`,
      `[CB] Raw rate=${rawRate.toFixed(4)}, clamped=${clampedRate.toFixed(4)}, ceiling=${ceilingHit}`,
      ceilingHit ? `[CB] Ceiling hit — reserve ratio adjustment: +${reserveRatioAdjustment.toFixed(4)}` : '',
    ].filter(Boolean),
  };
}
```

### Telemetry Digest for Narrative Grounding (D-18)
```typescript
// Computed BEFORE LLM call; injected into resolution prompt
function buildTelemetryDigest(
  current: TelemetryLog,
  previous: TelemetryLog | null,
  agentStats: Array<{ health: number; happiness: number; cortisol: number; wealth: number }>
): string {
  if (!previous) return 'First iteration -- no trend data available.';

  const giniDelta = (current.giniCoefficient ?? 0) - (previous.giniCoefficient ?? 0);
  const avgWealth = agentStats.reduce((s, a) => s + a.wealth, 0) / agentStats.length;
  const prevAvgWealth = previous.totalFiatSupply / agentStats.length; // approximation
  const satisfiedPct = Math.round(agentStats.filter(a => a.happiness > 50).length / agentStats.length * 100);
  const distressedPct = Math.round(agentStats.filter(a => a.health < 30 || a.cortisol > 70).length / agentStats.length * 100);

  const trend = giniDelta > 0.01 ? 'declining (inequality growing)'
    : giniDelta < -0.01 ? 'improving (equality growing)'
    : 'stable';

  return `TELEMETRY DIGEST (you MUST ground your narrative in these facts):
- Trend: ${trend}
- Gini: ${(current.giniCoefficient ?? 0).toFixed(3)} (${giniDelta > 0 ? '+' : ''}${giniDelta.toFixed(3)})
- Avg wealth: ${avgWealth.toFixed(0)} fiat (${avgWealth > prevAvgWealth ? 'rising' : 'falling'})
- CPI: ${(current.cpi ?? 100).toFixed(1)} (inflation ${(current.inflationRate ?? 0).toFixed(1)}%)
- Food price: ${(current.ammSpotPrice_Food ?? 0).toFixed(2)} fiat/unit
- Population mood: ${satisfiedPct}% satisfied, ${distressedPct}% in distress
- Deaths this iteration: [computed from lifecycle events]

NARRATIVE RULE: Your prose MUST include at least 2 specific numbers from this digest. If metrics improve, narrate cautious optimism. If they decline, narrate crisis. Do NOT contradict these numbers.`;
}
```

### Enterprise Auto-Creation During Bootstrap (D-01, D-02, D-03)
```typescript
// In dataBootstrapPipeline.ts, called after generateAgentRoster
export function generateEnterprises(
  agents: AgentBlueprint[],
  profile: LocationProfile,
  baseFiat: number,
): EnterpriseBlueprint[] {
  const enterprises: EnterpriseBlueprint[] = [];
  const gdpPC = profile.economics.gdpPerCapita?.value ?? 10000;
  const enterpriseCapital = gdpPC * 0.3; // 30% of GDP per capita per enterprise

  // Group agents by sector
  const bySector = new Map<string, AgentBlueprint[]>();
  for (const a of agents) {
    const list = bySector.get(a.sector) ?? [];
    list.push(a);
    bySector.set(a.sector, list);
  }

  for (const [sector, sectorAgents] of bySector) {
    if (sector === 'government') continue; // service enterprises handled separately
    // Create 2-3 enterprises per sector
    const enterpriseCount = Math.max(1, Math.min(3, Math.ceil(sectorAgents.length / 5)));
    const owners = sectorAgents.filter(a => getRoleTier(a.role) !== 'laborer').slice(0, enterpriseCount);
    // ... assign remaining agents as employees, distribute initial capital
  }
  return enterprises;
}
```

## Taylor Rule Calibration (Discretion Area)

Standard Taylor Rule parameters from macroeconomic literature:

| Parameter | Standard Value (Annual) | Per-Iteration (/ 12) | Rationale |
|-----------|------------------------|----------------------|-----------|
| Neutral real rate (r*) | 2.0% | 0.00167 | Taylor (1993) original calibration |
| Inflation target (pi*) | 2.0% | 0.167% | Standard central bank target |
| Inflation coefficient | 0.5 | 0.5 (unitless) | "Taylor Principle": total response > 1 |
| Output gap coefficient | 0.5 | 0.5 (unitless) | Equal weight to output and inflation |
| Rate ceiling | 15% | 1.25% per iteration | Historical Fed max ~20%, reduced for simulation stability |

**Recommendation:** Use these standard values as defaults in EconomyConfig. The per-iteration conversion (annual / 12) is consistent with the project convention (see ITERATIONS_PER_YEAR = 12 in dataBootstrapPipeline.ts). For the output gap estimate, use `(employmentRate - 0.95) / 0.95` where employmentRate = employed agents / total alive agents. This is a rough proxy but sufficient for an agent-based simulation.

**Central Bank Liquidity Injection Threshold:** Recommend reserve ratio falling below 50% of the configured reserve requirement (e.g., if reserveRequirement = 0.10, inject when actual ratio < 0.05). The injection amount should be capped at 5% of total deposits to limit inflationary impact per iteration.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Enterprises created only via FOUND_ENTERPRISE action | Auto-created at bootstrap (this phase) | Phase 10 | Sessions start with functioning economy |
| "FRICTION FIRST" narrative directive | Data-driven tone matching telemetry | Phase 10 | Narratives match simulation reality |
| Single loan product type | Business vs personal loan differentiation | Phase 10 | Banking becomes enterprise-integral |
| CPI smoothing window = 3 | Smoothing window = 1-2 | Phase 10 | Price shocks visible immediately |
| Central bank via LLM action codes | Autonomous Taylor Rule | Phase 10 | Systematic monetary policy response |
| Enterprise wages from owner personal wealth | Enterprise banking (deposit-mediated payroll) | Phase 10 | SFC-compliant enterprise treasury |

## Open Questions

1. **Enterprise Naming During Bootstrap**
   - What we know: D-01 says auto-create from World Bank data; names could be formulaic ("Farm Enterprise 1") or LLM-generated ("Chen Family Rice Paddy")
   - What's unclear: Whether LLM naming adds value vs. complexity in the bootstrap pipeline
   - Recommendation: Use formulaic names during initial bootstrap, allow LLM enrichment during the background enrichment step that already generates agent backgrounds. If enrichment fails, formulaic names are fine.

2. **Enterprise DB Persistence**
   - What we know: Enterprise registries are currently in-memory Maps (simulationState.ts). They survive within a simulation run but are lost on server restart.
   - What's unclear: Whether enterprises need DB persistence for pause/resume
   - Recommendation: Yes -- add an `enterprises` table to schema.ts. Bootstrap-created enterprises must survive server restart. Load from DB at simulation resume, same pattern as agentEconomy.

3. **D-24 Enterprise Banking and SFC Implications**
   - What we know: Making enterprise treasury a deposit account changes how payroll flows through the system
   - What's unclear: Exact SFC accounting when an enterprise deposit pays wages to employee deposits (both are M1)
   - Recommendation: Payroll within the deposit system is deposit-to-deposit transfer. Bank reserves are unaffected. M1 is unchanged (money moves within deposits). This is SFC-neutral by construction, but must be validated with the existing SFC audit.

4. **Output Gap Estimation for Taylor Rule**
   - What we know: Standard Taylor Rule uses output gap = (actual GDP - potential GDP) / potential GDP
   - What's unclear: The simulation has no GDP metric; closest proxy is employment rate
   - Recommendation: Use employment rate as proxy: outputGap = (employedAgents / totalAgents - naturalEmploymentRate) where naturalEmploymentRate defaults to 0.95. This is a recognized simplification in ABM literature.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest (existing) |
| Config file | server/vitest.config.ts |
| Quick run command | `npm run test -w server -- --run` |
| Full suite command | `npm run test -w server` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| D-01 | Enterprise auto-creation from bootstrap data | unit | `npx vitest run server/src/data/__tests__/enterpriseBootstrap.test.ts -x` | Wave 0 |
| D-06 | Enterprise insolvency tracking (3 consecutive iterations) | unit | `npx vitest run server/src/mechanics/__tests__/enterpriseEngine.test.ts -x` | Wave 0 |
| D-07 | Minimum wage enforcement | unit | `npx vitest run server/src/mechanics/__tests__/enterpriseEngine.test.ts -x` | Wave 0 |
| D-09 | Idle-agent subsistence fallback | unit | `npx vitest run server/src/mechanics/__tests__/enterpriseEngine.test.ts -x` | Wave 0 |
| D-14 | Taylor Rule rate computation | unit | `npx vitest run server/src/mechanics/__tests__/inflationEngine.test.ts -x` | Extends existing |
| D-15 | Rate ceiling with reserve ratio escalation | unit | `npx vitest run server/src/mechanics/__tests__/inflationEngine.test.ts -x` | Extends existing |
| D-20 | Narrative validation assertions | unit | `npx vitest run server/src/llm/__tests__/narrativeValidation.test.ts -x` | Wave 0 |
| D-25 | Differentiated loan products | unit | `npx vitest run server/src/mechanics/__tests__/banking.test.ts -x` | Extends existing |
| D-26 | Central bank liquidity injection | unit | `npx vitest run server/src/mechanics/__tests__/banking.test.ts -x` | Extends existing |
| D-28 | Role-based commodity mapping | unit | `npx vitest run server/src/mechanics/__tests__/enterpriseEngine.test.ts -x` | Wave 0 |
| D-17/18/19 | Telemetry digest + data-driven narrative | integration | Manual review of generated narratives | Manual |
| D-21/22 | Agent stat trajectory + data injection audit | integration | Manual review of reflection outputs | Manual |
| D-30 | CPI base price auto-init from AMM spot prices | unit | `npx vitest run server/src/mechanics/__tests__/inflationEngine.test.ts -x` | Extends existing |
| D-31 | Public goods spending-to-GDP scaling | unit | `npx vitest run server/src/mechanics/__tests__/fiscalEngine.test.ts -x` | Extends existing |
| D-32 | Income/production tax collection | unit | `npx vitest run server/src/mechanics/__tests__/fiscalEngine.test.ts -x` | Extends existing |

### Sampling Rate
- **Per task commit:** `npm run test -w server -- --run`
- **Per wave merge:** Full suite: `npm run test -w server`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `server/src/data/__tests__/enterpriseBootstrap.test.ts` -- covers D-01, D-02, D-03
- [ ] `server/src/mechanics/__tests__/enterpriseEngine.test.ts` -- covers D-06, D-07, D-09, D-28
- [ ] `server/src/llm/__tests__/narrativeValidation.test.ts` -- covers D-20

## Sources

### Primary (HIGH confidence)
- Codebase analysis: simulationRunner.ts (enterprise registry, wage settlement, banking tick, inflation tick), bankingEngine.ts, inflationEngine.ts, actionCodes.ts, dataBootstrapPipeline.ts, shared/types.ts
- [Taylor Rule - Wikipedia](https://en.wikipedia.org/wiki/Taylor_rule) - standard calibration parameters
- [Federal Reserve Bank of Atlanta Taylor Rule Utility](https://www.atlantafed.org/cqer/research/taylor-rule) - interactive parameter exploration

### Secondary (MEDIUM confidence)
- [World Bank IC.BUS.NDNS.ZS](https://data.worldbank.org/indicator/IC.BUS.NDNS.ZS) - business density indicator, verified available via WB API
- [World Bank IC.BUS.NREG](https://databank.worldbank.org/metadataglossary/world-development-indicators/series/IC.BUS.NREG) - new businesses registered count

### Tertiary (LOW confidence)
- Enterprise density data coverage across countries (IC.BUS indicators have patchy coverage for developing nations -- fallback heuristics needed)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - no new dependencies, all existing codebase modules
- Architecture: HIGH - follows established delta-return pattern used in banking/fiscal/capital market engines
- Pitfalls: HIGH - identified from direct code analysis of SFC audit, enterprise registry, wage settlement
- Taylor Rule calibration: HIGH - standard macroeconomic parameters with decades of literature
- Enterprise bootstrap: MEDIUM - World Bank indicator coverage varies; fallback heuristics are estimation

**Research date:** 2026-04-07
**Valid until:** 2026-05-07 (stable -- no rapidly evolving external dependencies)
