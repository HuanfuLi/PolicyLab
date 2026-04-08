# Phase 10: Fix Simulation Realism — Agent Economic Behavior, Inflation Response, Narrative Grounding - Context

**Gathered:** 2026-04-07
**Status:** Ready for planning

<domain>
## Phase Boundary

Fix the simulation engine so that running a policy scenario (e.g., China +30% minimum wage) produces economically coherent outcomes. Agents must actually work, trade, and borrow; prices must respond to wage shocks; narratives must reflect real telemetry; and banking must be organically used through enterprise demand. This phase changes the simulation runner, physics engine, data bootstrap pipeline, inflation engine, and prompt system — but does NOT add new frontend features.

</domain>

<decisions>
## Implementation Decisions

### Agent Employment & Enterprise System
- **D-01:** Auto-create enterprises from real World Bank data during location bootstrap. Fetch new indicators (firm count/size per sector) to generate plausible enterprise structures. Multiple small enterprises per sector (e.g., 2-3 competing farms, 2 factories) rather than one mega-enterprise per role.
- **D-02:** Elite-role agents (merchants, foremen) are assigned as enterprise owners. They have higher initial wealth from Gini-based distribution, making them natural capitalists.
- **D-03:** Enterprise initial capital seeded from bootstrap data — proportional to GDP per capita. Inventory seeded by sector (farms get food stock, factories get raw materials).
- **D-04:** For creative-mode sessions, the Central Agent generates enterprises during the design phase (roster generation step). One more output alongside the agent roster.
- **D-05:** Agents are paid on WORK action only — no work, no pay. Keeps agent agency central.
- **D-06:** Enterprise insolvency: partial pay when treasury is low. After 3 consecutive iterations of insufficient funds, enterprise goes bankrupt — employees become unemployed, assets liquidated to AMM.
- **D-07:** Config-based minimum wage floor (from World Bank data or user input) + market forces. Enterprises can pay above minimum based on profitability. The existing `minimumWage` parameter becomes meaningful.
- **D-08:** Labor mobility via new QUIT_JOB action code. Agents can leave their enterprise and re-apply elsewhere.
- **D-09:** Idle-agent fallback: after 2 consecutive iterations of zero production (no WORK/PRODUCE action), the physics engine forces a minimal PRODUCE action (5 food) representing subsistence activity. Safety net against total economic paralysis.

### CPI & Inflation Response
- **D-10:** Enterprise cost pass-through: when enterprise wage costs rise (from minimum wage hike), enterprises raise the price at which they sell goods to the AMM. Creates cost-push inflation through the existing market mechanism.
- **D-11:** Supply/demand shocks via enterprise production: enterprises sell output to AMM (adding supply), agents buy from AMM (adding demand). With active enterprises, the AMM naturally becomes more volatile.
- **D-12:** Keep current CPI basket (food 40%, tools 25%, luxury 20%, raw materials 15%). The problem was price stagnation, not basket composition.
- **D-13:** Reduce inflation smoothing window from 3 to 1-2 iterations so price shocks appear in CPI quickly.
- **D-14:** Central bank Taylor Rule response: raise rates when CPI exceeds target, lower when below. Creates monetary policy feedback loop. Uses existing `centralBankEnabled` config.
- **D-15:** Central bank rate ceiling (e.g., 15%). When rates hit ceiling, switch to direct intervention: restrict lending, increase reserve requirements. Prevents infinite rate hikes in runaway scenarios.
- **D-16:** Agents see inflation trend in their economic context each iteration: "Inflation is running at X% — prices have risen Y% over the last 3 iterations." Already partially from Phase 4; verify and strengthen.

### Narrative Grounding
- **D-17:** Replace "friction first" narrative directive with data-driven tone that also incorporates citizen sentiment. Tone MUST match the data: if metrics improve, narrate cautious optimism; if they decline, narrate crisis. But also weave in how agents collectively feel (happiness, cortisol aggregates).
- **D-18:** Pre-interpreted telemetry digest sent to resolution prompt. Before LLM call, compute: "Trend: improving/declining. Key changes: Gini -0.02 (equality growing), avg wealth +40 (fiscal redistribution), food price -0.5 (supply surplus). Population mood: 72% satisfied, 8% in distress." LLM narrates FROM the interpretation.
- **D-19:** Prose with embedded data points. Narrative reads like prose but weaves in real numbers: "Food prices fell 15% to 4.88 fiat/unit as agricultural output surged."
- **D-20:** Hard validation with re-generation. After narrative generation, check 3 key assertions: (1) Gini direction consistency, (2) death count accuracy (0 deaths = no starvation language), (3) wealth trend consistency (rising wealth != "wealth collapsed"). If contradictions found, regenerate with stricter prompt.
- **D-21:** Agent reflections receive full personal stat trajectory: per-iteration wealth, health, happiness, what they produced/consumed. They reflect on THEIR actual journey, not the collective narrative.
- **D-22:** Audit and fix per-iteration agent data injection (Phase 9 D-01/D-02) + add runtime assertions that verify agent context includes accurate personal data before sending to LLM. Both belt and suspenders.

### Banking & Credit Adoption
- **D-23:** Prompt incentive redesign for citizen agents — rewrite banking action descriptions to emphasize ROI: "Depositing earns you passive income every iteration" and "A loan lets you buy tools that double your production."
- **D-24:** Enterprises bank through the system. Enterprise treasury is a deposit account at the bank. Payroll is a bank transfer. Capital investment requires loans. Banking becomes integral, not optional.
- **D-25:** Differentiated loan products: business loans (larger, longer term, lower rates, collateralized by enterprise assets) vs personal loans (smaller, shorter, higher rates).
- **D-26:** Central bank liquidity injection: when bank reserves are critically low, central bank injects fiat to maintain lending capacity. Lender of last resort. Creates inflationary pressure as a trade-off.

### Location Bootstrap Robustness
- **D-27:** If agent background LLM enrichment fails during location bootstrap, fail the entire bootstrap. No sessions with stub backgrounds ("Background to be generated by LLM"). User must retry.

### Enterprise Output Types
- **D-28:** Role-based commodity mapping: Farms -> food, Factories -> tools + raw_materials, Artisan/merchant enterprises -> luxury_goods. Maps to existing 4-commodity AMM.
- **D-29:** Service enterprises (schools, clinics) provide multiplier effects only — boost education/health quality via existing fiscal multiplier system. No commodity output. Revenue from government budget (tax-funded public services).

### CPI & Fiscal Fixes (from simulation analysis 2026-04-08)
- **D-30:** Initialize `cpiBasePrices` from AMM spot prices at iteration 0/1 instead of all zeros. The Laspeyres index divides by base prices — zero base prices produce undefined CPI, which defaults to 100 forever. This is the root cause of frozen CPI independent of enterprise activity.
- **D-31:** Rebalance public goods quality scaling: (A) cap quality gain by spending-to-GDP ratio so that <1% GDP spending cannot produce 100% quality, AND (B) rebalance decay/gain parameters so 100% quality requires near-maximum treasury commitment. Current params allow instant saturation from iteration 2 onward, making fiscal trade-offs meaningless.
- **D-32:** Add flat income/production tax. A configurable tax rate (stored in EconomyConfig) is applied to WORK income and enterprise revenue each iteration, flowing back to the treasury. Without taxation the treasury is a one-way drain that always depletes, making government insolvency inevitable.

### Claude's Discretion
- Exact Taylor Rule parameters (neutral rate, inflation target, response coefficients) — researcher should investigate standard calibrations
- How enterprise capital is split between multiple enterprises in same sector — planner decides allocation algorithm
- Exact threshold for central bank liquidity injection trigger
- How narrative validation assertions are implemented (regex, LLM judge, or keyword matching)
- Enterprise naming during bootstrap (LLM-generated contextual names)
- Exact tax rate default and whether it's flat or progressive (D-32)
- Exact public goods scaling formula (D-31) — as long as 100% quality requires significant spending commitment

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Simulation Engine
- `server/src/orchestration/simulationRunner.ts` — Core simulation loop; WORK_AT_ENTERPRISE resolution (lines 717-849); banking wiring (lines 3023-3085); inflation block (lines 3245-3286)
- `server/src/mechanics/physicsEngine.ts` — Deterministic delta calculations; action resolution; SFC audit
- `server/src/mechanics/actionCodes.ts` — Action type registry + role-permission gates; new QUIT_JOB must be registered here

### Economic Engines
- `server/src/mechanics/inflationEngine.ts` — CPI calculation, M1 blending, inflation expectations; smoothing window parameter
- `server/src/mechanics/bankingEngine.ts` — Loan lifecycle, reserve enforcement, deposit interest
- `server/src/mechanics/capitalMarketEngine.ts` — Enterprise equity, dividends; enterprise creation patterns
- `server/src/mechanics/automatedMarketMaker.ts` — Constant product AMM; price discovery; where enterprise output enters the market
- `server/src/mechanics/fiscalEngine.ts` — Budget spending, public goods quality; service enterprise multiplier integration

### Prompt System
- `server/src/llm/prompts/agent-intent.ts` — Citizen decision prompts; banking action descriptions; economic context injection
- `server/src/llm/prompts/central-agent.ts` — Resolution narrative prompt; physics log injection; friction-first directive (line ~248)
- `server/src/llm/prompts/reflection.ts` — Agent reflection prompts; where stat trajectory must be added
- `server/src/llm/prompts/shared.ts` — Action schemas; banking action descriptions

### Data Pipeline
- `server/src/data/dataBootstrapPipeline.ts` — World Bank data -> EconomyConfig + agent roster; enterprise creation must be added here
- `server/src/data/locationDataService.ts` — World Bank API calls; new firm-level indicators must be added
- `server/src/data/indicatorMap.ts` — World Bank indicator code registry; new enterprise indicators go here
- `server/src/routes/bootstrap.ts` — SSE bootstrap endpoint; background enrichment failure handling (line 237-259)

### Types & Config
- `shared/src/types.ts` — EconomyConfig type; enterprise types; new loan product types
- `server/src/db/schema.ts` — Database schema; enterprise table may need columns for sector/output type

### Prior Phase Context
- `.planning/phases/09-redesign-prompts-for-all/09-CONTEXT.md` — Phase 9 prompt decisions (D-01 through D-22); this phase builds on prompt improvements from Phase 9

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `capitalMarketEngine.ts` enterprise creation pattern: shares, ownership registry, IPO mechanics — extend for auto-created enterprises
- `bankingEngine.ts` loan lifecycle: create/repay/default already implemented — extend for business vs personal loan differentiation
- `inflationEngine.ts` CPI calculation: working but needs smoothing window tuning and central bank feedback loop
- `fiscalEngine.ts` public goods quality multipliers: reuse for service enterprise effects

### Established Patterns
- Action codes registered in `actionCodes.ts` with role-permission table — new QUIT_JOB follows same pattern
- Enterprise ownership via `enterpriseOwnerId` = agent.id (DB-persisted) — extend for multiple enterprises per sector
- Banking context injection via `citizenBankingContext` in simulation runner — extend for enterprise banking context
- SFC audit validates M0 constant + M1 tracking — must still pass with enterprise banking flows

### Integration Points
- `simulationRunner.ts` processIteration: enterprise wage payment, idle-agent fallback, and enterprise cost pass-through all wire into the existing iteration loop
- `dataBootstrapPipeline.ts` generateAgentRoster: enterprise creation hooks into existing roster generation
- `buildResolutionPrompt` in central-agent.ts: telemetry digest replaces current raw metric injection
- `buildNaturalIntentPrompt` in agent-intent.ts: inflation trend context added alongside existing economic dashboard

</code_context>

<specifics>
## Specific Ideas

- User wants to investigate root causes of narrative-data mismatches at both Central Agent AND citizen agent levels, not just patch symptoms
- Enterprise data should come from real World Bank indicators (new API calls), not just LLM inference from sector percentages
- The existing minimum wage parameter in EconomyConfig should become the actual wage floor enforced by the enterprise wage system
- Service enterprises (schools, hospitals) are tax-funded — revenue comes from government budget, creating a realistic public sector employment model

</specifics>

<deferred>
## Deferred Ideas

- Early stopping recalibration — with active enterprises and banking, the stagnation detector needs different thresholds. Could be part of this phase but may warrant its own tuning pass.
- Order-book pricing as AMM replacement — most realistic price discovery but massive engine rewrite. Future milestone.
- Dynamic CPI basket weights (Engel's law) — basket weights shift based on agent spending patterns. Interesting but adds complexity beyond current needs.
- Enterprise merger/acquisition mechanics — enterprises could buy each other. Beyond current scope.

None — discussion stayed within phase scope

</deferred>

---

*Phase: 10-fix-simulation-realism-agent-economic-behavior-inflation-response-narrative-grounding*
*Context gathered: 2026-04-07*
