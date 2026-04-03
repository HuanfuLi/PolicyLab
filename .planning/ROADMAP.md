# Roadmap: PolicyLab

## Overview

This milestone transforms PolicyLab from a cash/barter economy into a modern economic system with fractional reserve banking, capital markets, fiscal budget execution, and endogenous inflation dynamics. The four mechanical sub-engines build in strict dependency order — banking underpins M1 measurement, capital markets use banking for settlement, fiscal policy uses bonds for deficit financing, and the inflation loop synthesizes all prior data into emergent price dynamics. A final frontend phase surfaces the economic telemetry as charts for policy experimentation.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Banking Foundation** - Bank agent role, deposit accounts, loan lifecycle (create/repay/default), reserve enforcement, M0/M1 SFC audit, and EconomyConfig foundation
- [ ] **Phase 2: Capital Markets** - Enterprise equity (shares + dividends), government bonds (issuance/coupon/maturity), corporate bonds, and holder ledger persistence
- [x] **Phase 3: Fiscal Policy** - Budget categories configurable at design time, per-category spending multipliers, public goods quality state, and per-iteration budget execution (completed 2026-04-02)
- [ ] **Phase 4: Inflation Loop** - CPI calculation, M1-to-price-level feedback, central bank policy agent, inflation expectations in agent cognition, and behavioral adaptation
- [ ] **Phase 5: Economic Dashboard** - Four recharts panels (CPI, M1/M2, fiscal, bond yield), macro snapshot SSE telemetry field, and simulationStore accumulation

## Phase Details

### Phase 1: Banking Foundation
**Goal**: A bank agent can receive deposits, issue loans that expand M1, collect repayments that contract M1, trigger bankruptcy on default, and the SFC audit enforces M0 constant with M1 fully traceable through loan contracts
**Depends on**: Nothing (first phase)
**Requirements**: CONF-01, CONF-02, CONF-03, BANK-01, BANK-02, BANK-03, BANK-04, BANK-05, BANK-06, BANK-08
**Success Criteria** (what must be TRUE):
  1. A simulation session with a bank agent shows individual deposit balances tracked separately from agent cash-on-hand, and agents earn interest on deposits each iteration
  2. When a bank issues a loan, M1 increases by exactly the principal amount and the bank's loan-asset ledger records the contract; when repaid, M1 decreases by the same amount
  3. When a borrower misses K consecutive repayments, the system marks the contract as defaulted, seizes configurable collateral, and the bank's balance sheet reflects the write-down
  4. The SFC audit passes every iteration asserting M0 constant and M1 = M0 + net loans outstanding; any drift throws a simulation error
  5. All economic parameters (reserve ratio, base interest rate, loan term defaults) live in EconomyConfig at session level, not hardcoded; existing pre-v1.0 sessions run legacy mechanics unchanged
**Plans:** 3/3 plans executed
Plans:
- [x] 01-01-PLAN.md — Types, DB schema, EconomyConfig, computeSystemFiatTotal extension
- [x] 01-02-PLAN.md — Banking repository CRUD + banking engine (loan lifecycle, reserve enforcement, deposits)
- [x] 01-03-PLAN.md — Action codes, simulation wiring, SFC audit integration, prompts, export/import

### Phase 2: Capital Markets
**Goal**: Agents can hold enterprise equity and receive dividends, the treasury can issue government bonds that pay coupons and redeem at maturity, enterprises can issue corporate bonds, and all positions are persisted for pause/resume and export
**Depends on**: Phase 1
**Requirements**: CMKT-01, CMKT-02, CMKT-03, CMKT-04, CMKT-05, CMKT-06
**Success Criteria** (what must be TRUE):
  1. When an enterprise is founded or raises capital, shares are created in an ownership registry; buying a share transfers wealth from buyer to enterprise and the buyer's equity position is recorded in the DB
  2. Each iteration, a profitable enterprise distributes dividends pro-rata to shareholders; total dividend paid equals enterprise profit allocation with no fiat created or destroyed
  3. The treasury can issue a government bond; the buyer's cash decreases and a bond holding is recorded; coupon payments flow from treasury to holder each cycle; at maturity the principal is returned and the holding is deleted
  4. An enterprise can issue a corporate bond reusing the government bond instrument schema; coupon and maturity mechanics behave identically
  5. All equity positions and bond holdings survive session pause/resume and appear in session export
**Plans:** 3 plans
Plans:
- [x] 02-01-PLAN.md — Types, DB schema, migration, ActionCodes, skillSystem for capital markets
- [x] 02-02-PLAN.md — Capital market engine (pure deterministic) + repository CRUD + unit tests
- [x] 02-03-PLAN.md — Physics engine cases, simulationRunner wiring, prompts, export/import, SFC integration tests
**UI hint**: yes

### Phase 3: Fiscal Policy
**Goal**: At session design time a policymaker configures budget allocation across infrastructure, education, defense, and welfare; each iteration the engine executes spending from the treasury, applies per-category multiplier effects to agent stats, and public goods quality compounds with investment or decays without it
**Depends on**: Phase 2
**Requirements**: FISC-01, FISC-02, FISC-03, FISC-04
**Success Criteria** (what must be TRUE):
  1. A new session's design screen exposes budget allocation sliders for infrastructure, education, defense, and welfare; the allocation is stored in session config and applied every iteration automatically
  2. Each budget category produces a measurable per-iteration effect on the relevant simulation stat (e.g., education allocation raises agent skill gain rate, welfare supplements UBI); the effect is absent when allocation is zero
  3. Public goods quality scores for each category exist as persistent state in the DB; they increase (with diminishing returns) when spending exceeds a threshold and decay when spending is absent; the score is visible in simulation telemetry
  4. The treasury balance never goes negative after budget execution; if the treasury lacks funds, spending is scaled down proportionally rather than minting fiat
**Plans:** 5/5 plans complete
Plans:
- [x] 03-01-PLAN.md — Types, DB schema, migration, EconomyConfig extensions, fiscalRepo CRUD
- [x] 03-02-PLAN.md — Fiscal engine (pure deterministic) with budget execution, public goods quality, multiplier effects + unit tests
- [x] 03-03-PLAN.md — Physics engine multipliers, simulationRunner wiring, prompts, export/import, SFC integration tests
- [x] 03-04-PLAN.md — Gap closure: design-time budget configurability (server endpoint + DesignReview sliders)
- [x] 03-05-PLAN.md — Gap closure: public goods quality fields in TelemetryLog + SSE telemetry population
**UI hint**: yes

### Phase 4: Inflation Loop
**Goal**: CPI is computed every iteration from actual market price data, M1 growth feeds back into AMM price levels, the central bank agent responds to CPI and M1 by adjusting reserve ratio and base rate, and citizen agents receive inflation context in their cognition prompts causing observable behavioral shifts
**Depends on**: Phase 3
**Requirements**: INFL-01, INFL-02, INFL-03, INFL-04, BANK-07
**Success Criteria** (what must be TRUE):
  1. Each iteration, CPI is calculated from a Laspeyres basket of food, tools, luxury, and raw material prices weighted by EconomyConfig basket weights; the value is stored in macro_snapshots and surfaced in telemetry
  2. When M1 grows faster than a configurable threshold, AMM reserve scaling applies upward price pressure; a 50-iteration session with high lending activity shows higher commodity prices than an equivalent session with no lending
  3. The central bank agent observes CPI trend and M1 growth each iteration and emits reserve ratio and base rate adjustments that take effect the following iteration; rate changes are visible in telemetry
  4. Citizen agent prompts include a concise inflation context block (current CPI, 3-iteration trend, expectation signal); in a high-inflation session, agents demonstrably shift toward hoarding, wage demands, or accelerated purchases within their action choices
**Plans:** 3/3 plans complete
Plans:
- [x] 04-01-PLAN.md — Types, DB schema, macroSnapshotRepo, inflationEngine pure function (CPI + M1 blend + AMM factor)
- [x] 04-02-PLAN.md — Central bank action codes (SET_RESERVE_RATIO, SET_BASE_RATE), physics engine resolution with clamping
- [x] 04-03-PLAN.md — SimulationRunner inflation tick, AMM feedback, cognitive injection, prompts, export/import, SFC tests
**Design Decision**: INFL-04 behavioral adaptation relies on LLM emergence via prompt context injection, not mechanical action constraints. Citizen agents receive CPI/trend context and the LLM decides how to adapt — no hardcoded hoarding or wage-demand triggers.

### Phase 5: Economic Dashboard
**Goal**: Four real-time chart panels surface the economic telemetry produced by Phases 1-4; policymakers can observe CPI trends, money supply dynamics, budget execution, and bond yields during and after a simulation run
**Depends on**: Phase 4
**Requirements**: (none — UI delivery phase; all data requirements covered in Phases 1-4)
**Success Criteria** (what must be TRUE):
  1. During a simulation run, a CPI line chart updates in real time showing the Laspeyres index per iteration with a smoothed trend overlay
  2. An M1/M2 area chart shows money supply expansion and contraction over the simulation history; M0 baseline is visually distinct from M1 and M2 bands
  3. A fiscal budget bar chart shows per-category spending allocation and the current public goods quality score for each category
  4. A bond yield line chart tracks government and corporate bond coupon yields over time; the chart is absent (or shows empty state) when no bonds have been issued
**Plans:** 1/2 plans executed
Plans:
- [x] 05-01-PLAN.md — Extend TelemetryLog shared type with Phase 3-4 fields; add macroHistory to simulationStore; install recharts
- [ ] 05-02-PLAN.md — Build EconomicDashboard component (4 recharts panels); wire into TelemetryPanel tabs and Simulation page
**UI hint**: yes

### Phase 6: Scenario Entry — policymakers configure economic parameters and initial conditions at session design time

**Goal:** Policymakers configure all EconomyConfig parameters through an Economy tab in Design Review, fork sessions to create A/B policy experiments, and compare results with 8-dimension scoring and a configuration differences table showing exactly which parameters were changed
**Depends on:** Phase 5
**Requirements**: D-01, D-02, D-03, D-04, D-05, D-06, D-07, D-08, D-09, D-10
**Success Criteria** (what must be TRUE):
  1. An Economy tab in Design Review displays all EconomyConfig parameters in grouped collapsible panels (Banking, Fiscal, Capital Markets, Inflation) with slider + numeric input controls
  2. Each parameter has an inline tooltip with a real-world analogy and soft-limit warnings that trigger on user interaction (not page load) when values exceed recommended ranges
  3. Forking a session preserves economyConfig and budgetAllocation from the source session; the forked session's Economy tab shows identical values
  4. The comparison page shows a "Configuration Differences" table listing only the economic parameters that differ between two sessions
  5. The comparison prompt evaluates 8 dimensions (5 existing + Banking Stability, Fiscal Effectiveness, Economic Growth) using economic telemetry data when available
**Plans:** 4/4 plans complete
Plans:
- [x] 06-00-PLAN.md — Wave 0 test scaffold (scenarioEntry.test.ts with placeholder tests for fork config, computeParamDiffs, prompt dimensions)
- [x] 06-01-PLAN.md — SessionConfig type extension, EconomyTab component with parameter controls, DesignReview tab wiring
- [x] 06-02-PLAN.md — Fork endpoint upgrade (config preservation), EconomyParamDiff type, comparison route telemetry + param diff
- [x] 06-03-PLAN.md — Comparison prompt expansion (8 dimensions), ConfigDiff UI section, fork button relabeling, end-to-end verification

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6 → 7

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Banking Foundation | 3/3 | Complete |  |
| 2. Capital Markets | 3/3 | Complete | - |
| 3. Fiscal Policy | 5/5 | Complete   | 2026-04-02 |
| 4. Inflation Loop | 0/3 | Not started | - |
| 5. Economic Dashboard | 1/2 | In Progress|  |
| 6. Scenario Entry | 4/4 | Complete   | 2026-04-02 |
| 7. Real-World Scenario Bootstrap | 0/5 | Not started | - |

### Phase 7: Real-World Scenario Bootstrap — location-based data-driven society design for policymakers

**Goal:** Policymakers enter a real-world location, the system fetches demographics, economic indicators, governance structures, and infrastructure data via World Bank API (with web scraping/LLM fallback), then auto-generates a simulation starting point that mirrors reality — including numeric economic parameters, agent role distributions with Gini-based wealth inequality, and institutional rules — giving policymakers an accurate baseline to experiment against with a tab-based scenario builder for A/B policy comparison
**Requirements**: RWB-01, RWB-02, RWB-03, RWB-04, RWB-05, RWB-06, RWB-07
**Depends on:** Phase 6
**Success Criteria** (what must be TRUE):
  1. IdeaInput page shows two parallel modes: "Describe a Society" (existing creative brainstorming) and "Mirror a Real Location" (new data-driven flow); existing flow is fully preserved
  2. Policymaker can search for a real-world location with autocomplete (Photon geocoding), set agent count (20-150), and optionally describe a policy scenario
  3. Bootstrap pipeline fetches all 4 data categories (demographics, economics, governance, infrastructure) from World Bank API with SSE progress events; LLM fallback for missing data
  4. Auto-generated EconomyConfig uses real economic data with correct unit conversions (annual rates / 12 for per-iteration); agent roster reflects real sector employment distribution with Gini-distributed wealth
  5. Design Review shows scenario builder with tab-based UI: Baseline + N scenario tabs with inline diff markers showing parameter divergence from baseline
  6. "Run All Scenarios" creates fork sessions, starts simulations, and auto-navigates to comparison view
  7. Data confidence indicators (API/web/LLM + high/medium/low) are shown per parameter
**Plans:** 5 plans

Plans:
- [ ] 07-01-PLAN.md — Shared types (LocationProfile, DataPoint, ScenarioTab), World Bank API client, Photon geocoder, location cache, Gini distribution algorithm
- [ ] 07-02-PLAN.md — Location data service orchestrator, data-to-simulation bootstrap pipeline, SSE bootstrap route, LLM prompts
- [ ] 07-03-PLAN.md — IdeaInput dual-mode UI, LocationSearch autocomplete, bootstrap progress panel, bootstrapStore
- [ ] 07-04-PLAN.md — ScenarioTabs component, DiffMarker, scenarioStore, DesignReview integration
- [ ] 07-05-PLAN.md — End-to-end integration wiring, polish, human verification

### Phase 8: Live Scenario Comparison — real-time overlaid economic charts during parallel simulation runs

**Goal:** [To be planned]
**Requirements**: TBD
**Depends on:** Phase 7
**Plans:** 0 plans

Plans:
- [ ] TBD (run /gsd:plan-phase 8 to break down)
