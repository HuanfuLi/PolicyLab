# Roadmap: PolicyLab

## Overview

This milestone transforms PolicyLab from a cash/barter economy into a modern economic system with fractional reserve banking, capital markets, fiscal budget execution, and endogenous inflation dynamics. The four mechanical sub-engines build in strict dependency order — banking underpins M1 measurement, capital markets use banking for settlement, fiscal policy uses bonds for deficit financing, and the inflation loop synthesizes all prior data into emergent price dynamics. A final frontend phase surfaces the economic telemetry as charts for policy experimentation.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Banking Foundation** - Bank agent role, deposit accounts, loan lifecycle (create/repay/default), reserve enforcement, M0/M1 SFC audit, and EconomyConfig foundation
- [x] **Phase 2: Capital Markets** - Enterprise equity (shares + dividends), government bonds (issuance/coupon/maturity), corporate bonds, and holder ledger persistence
- [x] **Phase 3: Fiscal Policy** - Budget categories configurable at design time, per-category spending multipliers, public goods quality state, and per-iteration budget execution (completed 2026-04-02)
- [x] **Phase 4: Inflation Loop** - CPI calculation, M1-to-price-level feedback, central bank policy agent, inflation expectations in agent cognition, and behavioral adaptation
- [x] **Phase 5: Economic Dashboard** - Four recharts panels (CPI, M1/M2, fiscal, bond yield), macro snapshot SSE telemetry field, and simulationStore accumulation

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
**Plans:** 2/2 plans complete
Plans:
- [x] 05-01-PLAN.md — Extend TelemetryLog shared type with Phase 3-4 fields; add macroHistory to simulationStore; install recharts
- [x] 05-02-PLAN.md — Build EconomicDashboard component (4 recharts panels); wire into TelemetryPanel tabs and Simulation page
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
| 1. Banking Foundation | 3/3 | Complete | 2026-04-01 |
| 2. Capital Markets | 3/3 | Complete | 2026-04-01 |
| 3. Fiscal Policy | 5/5 | Complete | 2026-04-02 |
| 4. Inflation Loop | 3/3 | Complete | 2026-04-02 |
| 5. Economic Dashboard | 2/2 | Complete | 2026-04-02 |
| 6. Scenario Entry | 4/4 | Complete | 2026-04-02 |
| 7. Real-World Scenario Bootstrap | 5/5 | Complete | 2026-04-03 |
| 8. Live Scenario Comparison | 6/8 | **REMOVED — descoped to v2** | — |
| 9. Redesign Prompts for All | 5/5 | Complete | 2026-04-07 |
| 10. Fix Simulation Realism | 14/14 | Complete | 2026-04-08 |
| 11. Simulation Realism — Stress + Fiscal + SFC | 15/15 | Complete | 2026-04-13 |
| 12. Labor Market Realism | 5/7 | In Progress|  |
| 13. Central Bank Rate Telemetry Close-out | 0/1 | Planned (gap closure) | — |
| 14. v1.0 Housekeeping | 0/1 | Planned (gap closure) | — |

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
**Plans:** 5/5 plans complete

Plans:
- [x] 07-01-PLAN.md — Shared types (LocationProfile, DataPoint, ScenarioTab), World Bank API client, Photon geocoder, location cache, Gini distribution algorithm
- [x] 07-02-PLAN.md — Location data service orchestrator, data-to-simulation bootstrap pipeline, SSE bootstrap route, LLM prompts
- [x] 07-03-PLAN.md — IdeaInput dual-mode UI, LocationSearch autocomplete, bootstrap progress panel, bootstrapStore
- [x] 07-04-PLAN.md — ScenarioTabs component, DiffMarker, scenarioStore, DesignReview integration
- [x] 07-05-PLAN.md — End-to-end integration wiring, polish, human verification

### Phase 8: Live Scenario Comparison — REMOVED FROM v1.0

**Status:** REMOVED — descoped from the v1.0 milestone on 2026-04-26. Live multi-scenario comparison (real-time overlaid charts, multi-provider LLM load balancing for parallel execution, group-level policy brief) is no longer a v1.0 deliverable. Requirements LSC-01 through LSC-11 moved to v2 in REQUIREMENTS.md.

**Phase slot retained** to preserve numbering (9-12 keep their numbers; existing artifacts and commits remain valid). Partial implementation on the branch (multi-scenario fork via `scenarioStore.runAllScenarios`, `groupId`/`scenarioLabel` DB columns, `getLoadBalancer` orphan, AgentReview cross-scenario context, Artifacts policy brief) is left in place as inert scaffolding for a potential v2 revival. No further work in v1.0.

Original goal and plan history archived inline below for traceability:

<details>
<summary>Original Phase 8 spec (descoped — for reference only)</summary>

**Original Goal:** Policymakers see CPI, money supply, fiscal, and bond yield curves from up to 4 scenarios updating simultaneously on a redesigned Simulation page with collapsible panels, multi-provider LLM load balancing for parallel execution, session grouping for scenario management, and multi-scenario adaptations to Reflection, Review, and Artifacts stages producing a combined policy brief.

Original Requirements: LSC-01..LSC-11 (now v2)
Original dependency: Phase 7

Plans (frozen state at descope):
- [x] 08-01-PLAN.md — DB schema (groupId/scenarioLabel), shared types, fork endpoint upgrade
- [x] 08-02-PLAN.md — Multi-provider LLM load balancer with token bucket rate limiting
- [x] 08-03-PLAN.md — multiScenarioStore (N SSE connections), scenarioStore parallel execution
- [x] 08-04-PLAN.md — ScenarioChart, CollapsiblePanel, ConfigDiffHeader, ProgressBar, TelemetryPanel cleanup
- [x] 08-05-PLAN.md — Simulation page rewrite with multi-scenario charts, collapsible panels, top bar
- [ ] 08-06-PLAN.md — Home page grouping, Reflection multi-scenario layout (skipped)
- [ ] 08-07-PLAN.md — Load balancer wiring, integration fixes (skipped → drives LSC-04 orphan)
- [x] 08-08-PLAN.md — AgentReview cross-scenario context, Artifacts combined policy brief

</details>

### Phase 9: Redesign Prompts for All

**Goal:** Fix the agent death spiral by giving agents accurate economic knowledge and first-principles reasoning, deepen agent immersion by removing simulation-awareness and mechanical system tags, enrich agent backgrounds with 5-8 sentence life stories for differentiated emergent behavior, and restructure the monolithic prompts.ts into 7 domain-specific modules
**Requirements**: D-01, D-02, D-03, D-04, D-05, D-06, D-07, D-08, D-09, D-10, D-11, D-12, D-13, D-14, D-15, D-16, D-17, D-18, D-19, D-20
**Depends on:** Phase 8
**Plans:** 4 plans

Plans:
- [x] 09-01-PLAN.md — Split prompts.ts into 7 domain modules with barrel re-export index
- [x] 09-02-PLAN.md — Rewrite citizen intent prompt: economic survival signals, immersion, action dictionary
- [x] 09-03-PLAN.md — Enrich agent roster backgrounds (5-8 sentence life stories) and align reflection prompts
- [x] 09-04-PLAN.md — Wire AMM market data in simulationRunner + prompt content verification tests
- [x] 09-05-PLAN.md — Add conditional food profitability signal when prices are high or reserves are low

### Phase 10: Fix simulation realism — agent economic behavior, inflation response, narrative grounding

**Goal:** Make the simulation engine produce economically coherent outcomes by auto-creating enterprises from bootstrap data, wiring enterprise wage/production cycles through the banking system, implementing Taylor Rule central bank feedback with rate ceilings, grounding narratives in pre-interpreted telemetry digests with hard validation, and enriching agent reflections with personal stat trajectories
**Requirements**: D-01, D-02, D-03, D-04, D-05, D-06, D-07, D-08, D-09, D-10, D-11, D-12, D-13, D-14, D-15, D-16, D-17, D-18, D-19, D-20, D-21, D-22, D-23, D-24, D-25, D-26, D-27, D-28, D-29, D-30, D-31, D-32
**Depends on:** Phase 9
**Plans:** 14/14 plans complete

Plans:
- [x] 10-01-PLAN.md — Wave 0: Types, DB schema, EconomyConfig extensions (incl. D-30/D-31/D-32), test scaffolds
- [x] 10-02-PLAN.md — Enterprise engine: wages, insolvency, idle fallback, commodity mapping, cost pass-through
- [x] 10-03-PLAN.md — Enterprise bootstrap: location-mode auto-creation, creative-mode generation, bootstrap failure handling
- [x] 10-04-PLAN.md — Enterprise banking: deposit-mediated payroll, differentiated loans, liquidity injection, simulationRunner wiring
- [x] 10-05-PLAN.md — Inflation response: Taylor Rule, smoothing window, rate ceiling, CPI base price auto-init (D-30), agent context
- [x] 10-05b-PLAN.md — Fiscal realism: income/production tax (D-32), public goods spending-to-GDP scaling (D-31), decay rebalancing
- [x] 10-06-PLAN.md — Narrative grounding: telemetry digest, data-driven directive, validation + re-generation
- [x] 10-07-PLAN.md — Agent context: banking ROI prompts, reflection stat trajectory, runtime assertions
- [x] 10-08-PLAN.md — Integration verification + human approval of simulation realism

### Phase 11: Simulation realism — organic stress pressure, fiscal balance, and SFC leak closure

**Goal:** Simulation outcomes reflect policy trade-offs rather than defaulting to improvement. Cortisol and happiness become signals shaped by macro conditions (inflation surprise, inequality, unemployment, public-goods quality, peer deaths) rather than per-action rewards. Infrastructure/education/defense fiscal spending parks in escrow instead of leaking to agents as de-facto UBI. Taxes withhold at every fiat-bearing event (wages, AMM trades, capital gains, bonds). Central Agent chooses flat-or-progressive taxPolicy at design. Users can disable governance for clean A/B policy comparison; governance can amend law text paragraph-by-paragraph. SFC drift is observable per subsystem so future leaks localize instantly.
**Requirements**: D-01 through D-23 (see 11-CONTEXT.md)
**Depends on:** Phase 10
**Plans:** 15/15 plans executed

Plans:
- [x] 11-01-PLAN.md — Wave 0: shared types, physicsConfig coefficients, sfcAudit extension, 14 test scaffolds
- [x] 11-02-PLAN.md — Wave 1: strip per-action cortisol/happiness + add structural pressure loop (D-01..D-08)
- [x] 11-03-PLAN.md — Wave 1: fiscal escrow ledger (D-10, D-11)
- [x] 11-04-PLAN.md — Wave 2: tax withholding at 5 hook sites (D-12, D-14)
- [x] 11-05-PLAN.md — Wave 3: Central Agent taxPolicy selection at bootstrap (D-13)
- [x] 11-06-PLAN.md — Wave 3: governance toggle + law amendments (D-17, D-18, D-19)
- [x] 11-07-PLAN.md — Wave 4: SFC subsystem drift telemetry (D-20..D-23)
- [x] 11-08-PLAN.md — Wave 4: bootstrap D-15 fix + startup assertion
- [x] 11-09-PLAN.md — Wave 5: frontend UI (governance toggle, taxPolicy readout, SFC drift panel + banner)
- [x] 11-10-PLAN.md — Wave 6: VALIDATION.md sign-off + human-approved smoke run vs US baseline
- [x] 11-GC1-PLAN.md — Gap closure Wave 1: physics SFC leak (shortfall ledger + order-book ghost guards + bank exclusion) (G1)
- [x] 11-GC2-PLAN.md — Gap closure Wave 1: groupResolution prompt bloat fix (trace reset + 8KB cap) (G2)
- [x] 11-GC3-PLAN.md — Gap closure Wave 1: bootstrap taxPolicy heuristic recalibration + locationProfile invariant (G3)
- [x] 11-GC4-PLAN.md — Gap closure Wave 2: editable TaxPolicyEditor + server-side validateTaxPolicy (G4)
- [x] 11-GC5-PLAN.md — Gap closure Wave 3: consolidated verification + live smoke test sign-off

### Phase 12: Labor market realism — enterprise-demographic alignment, wage discovery, and subsistence fallback for PRODUCE_AND_SELL

**Goal:** Make paid employment the primary livelihood for citizen agents and PRODUCE_AND_SELL a genuine subsistence fallback for those who cannot find work. Three coupled deliverables: (1) demographic-aligned enterprise generation in both location and creative modes so every employable agent has at least one plausible employer; (2) a dynamic labor market where enterprises post wages that adjust per-iteration against applicant pressure, vacancy pressure, and P&L, bounded by marginal revenue product of labor, with agents using a reservation-wage anchor from last-period self-production; (3) PRODUCE_AND_SELL recalibrated (physics yield + AMM sell-price drag + prompt copy) so its net proceeds barely cover subsistence food cost and the LLM no longer treats it as an entrepreneurship shortcut.

**Requirements**: L-01 through L-11 (see 12-CONTEXT.md)
- L-01 — Location-mode enterprise generation matches WB sectorEmployment distribution
- L-02 — Creative-mode Central Agent generates enterprises matching the designed society's sector breakdown
- L-03 — Every employable citizen has at least one candidate employer after bootstrap (no starved-sector mismatch)
- L-04 — Per-agent reservation wage = last-period PRODUCE_AND_SELL net proceeds
- L-05 — Enterprises adjust posted wage each iteration from (applicants, vacancies, P&L)
- L-06 — Wage upper bound enforced at marginal revenue product of labor
- L-07 — PRODUCE_AND_SELL physics + AMM sell-price calibrated to subsistence-margin only
- L-08 — Action-dictionary prompts rewritten (PRODUCE_AND_SELL subsistence framing; WORK_AT_ENTERPRISE with per-agent wage interpolated)
- L-09 — APPLY_FOR_JOB auto-match from enterprises with open vacancies, wired into sim loop
- L-10 — QUIT_JOB + reapply path so employed agents can migrate to higher-paying work
- L-11 — Wage history + labor-market telemetry (avg posted wage, unemployment rate, reservation-wage distribution)

**Depends on:** Phase 10 (enterprise engine, bootstrap enterprise generation), Phase 11 (structural pressures, fiscal, tax withholding through wages)

**SFC invariant:** No monetary injection. All wage flows are transfers inside the perimeter (enterprise treasury ↔ worker wealth). Reservation-wage computation is read-only. Enterprise insolvency (Phase 10) handles enterprises that cannot pay.

**Plans:** 5/7 plans executed

Plans:
- [x] 12-01-PLAN.md — Wave 0: types, DB schema, EconomyConfig + TelemetryLog + EnterpriseRecord extensions, 4 test scaffolds, session Maps
- [x] 12-02-PLAN.md — Wave 1: demographic-aligned enterprise generation (location mode) with 110% vacancy target + D-05 invariant + auto-inflation
- [x] 12-03-PLAN.md — Wave 1: creative-mode Central Agent enterprise generation with retryWithHealing validator (N=3, same invariant)
- [x] 12-04-PLAN.md — Wave 1: wage-adjustment engine (linear nudge + profit-share + MRP ceiling + min floor) wired at per-iteration preamble
- [x] 12-05-PLAN.md — Wave 2: reservation wage populator + APPLY_FOR_JOB matching pass at line ~1296 + QUIT_JOB auto-reapply
- [ ] 12-06-PLAN.md — Wave 2: PRODUCE_AND_SELL recalibration (ammSubsistenceCalibrationFactor + D-18 subsistence prompt copy)
- [ ] 12-07-PLAN.md — Wave 3: D-17 wage interpolation + D-19 employment board + D-20/21 telemetry & dashboard + D-16 displacement + 20-iter live smoke

### Phase 13: Central Bank Rate Telemetry Close-out

**Goal:** Surface the per-iteration central bank policy rate as a first-class telemetry field and dashboard panel, closing the BANK-07 dead-stub gap that has persisted since the 2026-04-07 audit.

**Requirements**: BANK-07 (partial → satisfied)
**Depends on:** Phase 4 (action codes already wired); no dependency on Phase 12
**Gap closure:** Closes BANK-07 partial gap from `.planning/v1.0-MILESTONE-AUDIT.md` (2026-04-26)

**Success Criteria** (what must be TRUE):
  1. `iterTelemetry.centralBankRate` is populated every iteration from `persistedEconomyConfig.baseLoanInterestRate` (or the just-applied Taylor Rule output) at `simulationRunner.ts:~3504`
  2. The `EconomicDashboard` renders a Central Bank Rate panel (recharts LineChart) showing the rate timeseries; rate changes from `SET_BASE_RATE` actions or Taylor Rule are visually distinct between iterations
  3. REQUIREMENTS.md BANK-07 checkbox flips from `[ ]` to `[x]` and the partial-status note is removed

**Plans:** 1 plan

Plans:
- [ ] 13-01-PLAN.md — Populate centralBankRate in iterTelemetry; add Central Bank Rate panel to EconomicDashboard; flip REQUIREMENTS.md checkbox

### Phase 14: v1.0 Housekeeping

**Goal:** Close non-blocking tech debt and verification gaps surfaced by the 2026-04-26 audit so the v1.0 milestone can be archived cleanly. Also serves as the merge target for findings from a separate code audit (to be folded in before execution).

**Requirements**: (none — housekeeping phase; no new functional requirements)
**Depends on:** Phase 13 (BANK-07 close-out should land first to keep verification clean)
**Gap closure:** Closes tech-debt items from `.planning/v1.0-MILESTONE-AUDIT.md` (2026-04-26)

**Scope (initial — to be expanded after code audit):**

1. **VERIFICATION.md backfill** — Authoritative goal-backward verification for phases 01, 02, 04, 05, 07, 10, 11. Phase 11 has only the gap-closure verification (`11-GC5-VERIFICATION.md`); needs a top-level goal-backward report.
2. **Phase 03 re-verification** — `03-VERIFICATION.md` is stale (`status=gaps_found` from 2026-04-02 before 03-04 / 03-05 closed both gaps).
3. **VALIDATION.md finalization** — Phase 06 and Phase 09 currently `status=draft`, `nyquist_compliant=false`, `wave_0_complete=false`. Run `/gsd:validate-phase 06` and `/gsd:validate-phase 09`.
4. **Taylor Rule bootstrap mapping** — Map `taylorInflationTarget`, `taylorNeutralRate`, `taylorInflationCoeff`, `taylorOutputCoeff` from World Bank data in `dataBootstrapPipeline.ts`. Currently all location-bootstrapped sessions use generic defaults.
5. **Pre-existing test failures** — Fix 4 failures in `economyConfig.test.ts` (`baseLoanInterestRate` / `depositInterestRate` default mismatch) and 1 failure in `banking.test.ts` (`canIssueLoan` logic change). Logged in Phase 11 `deferred-items.md`.
6. **API client consistency** — Convert `saveBudgetAllocation` raw fetch in `web/src/stores/sessionDetailStore.ts:398-406` to `brainstormApi.patchConfig` (logged in Phase 06 verification).
7. **Real prompt tests** — Strengthen `server/src/__tests__/scenarioEntry.test.ts` comparison-prompt tests: replace hardcoded string assertions with imports of real `buildComparisonMessages` (logged 2026-04-01).
8. **Roster polish** — Name uniqueness pass in `generateAgentRoster()`; romanization for non-Latin scripts (deferred from Phase 11).

**(Reserved for code-audit findings — to be appended before plan creation.)**

**Success Criteria** (what must be TRUE):
  1. Every phase 01-11 has a goal-backward `VERIFICATION.md` with `status=passed` (or `gaps_found` with all gaps either closed or explicitly deferred to v2)
  2. Phase 06 and Phase 09 `VALIDATION.md` show `status=approved` (or equivalent terminal state) and `nyquist_compliant=true`
  3. `npm run test -w server` exits 0 — no pre-existing failures
  4. Location bootstrap with `inflationTarget` data sets non-default Taylor Rule params (verified by smoke test diff against US baseline)
  5. `saveBudgetAllocation` uses `brainstormApi.patchConfig`; no raw `fetch` in any frontend store action that has an API client equivalent
  6. `scenarioEntry.test.ts` imports and exercises real `buildComparisonMessages` for at least one prompt assertion
  7. `generateAgentRoster()` produces no duplicate display names within a single session
  8. (Reserved) all code-audit findings folded into this phase have terminal status

**Plans:** TBD (estimate 3-5 plans; will be authored after code audit results merged)
