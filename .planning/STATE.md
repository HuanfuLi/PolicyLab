---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: Ready to execute
stopped_at: Completed 11-01-PLAN.md (Wave 0 foundation)
last_updated: "2026-04-13T19:40:34.756Z"
progress:
  total_phases: 11
  completed_phases: 6
  total_plans: 62
  completed_plans: 49
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-05)

**Core value:** The deterministic economic engine must be realistic enough that simulation outcomes are meaningful for understanding real-world policy trade-offs.
**Current focus:** Phase 11 — simulation-realism-organic-stress-pressure-fiscal-balance-and-sfc-leak-closure

## Current Position

Phase: 11 (simulation-realism-organic-stress-pressure-fiscal-balance-and-sfc-leak-closure) — EXECUTING
Plan: 2 of 10

## Performance Metrics

**Velocity:**

- Total plans completed: 0
- Average duration: —
- Total execution time: 0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| - | - | - | - |

**Recent Trend:**

- Last 5 plans: —
- Trend: —

*Updated after each plan completion*
| Phase 01-banking-foundation P01 | 25 | 2 tasks | 7 files |
| Phase 01-banking-foundation P02 | 4 | 2 tasks | 3 files |
| Phase 01-banking-foundation P03 | 37 | 2 tasks | 8 files |
| Phase 02-capital-markets P01 | 15 | 2 tasks | 5 files |
| Phase 02-capital-markets P02 | 5 | 2 tasks | 3 files |
| Phase 02-capital-markets P03 | 25 | 2 tasks | 5 files |
| Phase 03-fiscal-policy P01 | 18 | 2 tasks | 4 files |
| Phase 03-fiscal-policy P02 | 12 | 1 tasks | 2 files |
| Phase 03-fiscal-policy P03 | 35 | 2 tasks | 7 files |
| Phase 03-fiscal-policy P05 | 4 | 2 tasks | 2 files |
| Phase 03-fiscal-policy P04 | 3 | 2 tasks | 3 files |
| Phase 04 P01 | 5 | 2 tasks | 6 files |
| Phase 05-economic-dashboard P01 | 527361 | 2 tasks | 4 files |
| Phase 06-scenario-entry P00 | 2 | 1 tasks | 1 files |
| Phase 06-scenario-entry P02 | 15 | 2 tasks | 4 files |
| Phase 06-scenario-entry P01 | 15 | 2 tasks | 4 files |
| Phase 06-scenario-entry P03 | 12 | 2 tasks | 3 files |
| Phase 06-scenario-entry P03 | 12 | 3 tasks | 3 files |
| Phase 07 P01 | 407 | 2 tasks | 9 files |
| Phase 07 P02 | 396 | 2 tasks | 6 files |
| Phase 07 P03 | 4 | 2 tasks | 4 files |
| Phase 07 P04 | 296 | 2 tasks | 5 files |
| Phase 07 P05 | 276 | 1 tasks | 1 files |
| Phase 09 P01 | 688 | 3 tasks | 17 files |
| Phase 09 P03 | 166 | 3 tasks | 4 files |
| Phase 09 P02 | 477 | 4 tasks | 4 files |
| Phase 08 P04 | 4 min | 2 tasks | 9 files |
| Phase 08 P01 | 12 min | 2 tasks | 5 files |
| Phase 08 P08 | 10 | 2 tasks | 10 files |
| Phase 08 P05 | 12 | 2 tasks | 3 files |
| Phase 08 P06 | 410 | 2 tasks | 3 files |
| Phase 10 P01 | 3 | 2 tasks | 6 files |
| Phase 10 P02 | 168 | 1 tasks | 3 files |
| Phase 10 P03 | 388 | 2 tasks | 7 files |
| Phase 10 P04 | 611 | 2 tasks | 7 files |
| Phase 10 P05 | 6 | 3 tasks | 4 files |
| Phase 10 P07 | 387 | 2 tasks | 5 files |
| Phase 10 P05b | 423 | 3 tasks | 4 files |
| Phase 10 P06 | 367 | 2 tasks | 4 files |
| Phase 10 P08 | 453 | 1 tasks | 4 files |
| Phase 10-fix-simulation-realism PGC1 | 8m | 4 tasks | 7 files |
| Phase 10-fix-simulation-realism PGC2 | 6 | 2 tasks | 2 files |
| Phase 10-fix-simulation-realism PGC3 | 8 | 2 tasks | 3 files |
| Phase 11 P01 | 5 min | 5 tasks tasks | 16 files files |

## Post-Milestone Work (2026-04-05)

### Audit Rounds

- **5 rounds of bug fixes**: 65 issues identified and fixed across 22 tasks (see PROBLEM_SOLVING_ROADMAP.md)
- **Final audit**: 6 critical, 9 high, 14 medium, 8 low issues found and fixed
- **TypeScript**: 0 errors (server + web)
- **Tests**: 195/195 passing (18 test files)
- **Lint**: 24 problems (7 false-positive React Compiler errors, 17 warnings)

### Modularity Refactoring (Phase A + B)

- **A1**: Extracted orderBook DB operations to `db/repos/orderBookRepo.ts`
- **A3**: Removed `getSubconsciousDrive` value import from `llm/prompts.ts` — now passed as parameter
- **A4**: Moved `AMMState` type to `shared/types.ts` — broke db→mechanics cross-layer import
- **B2**: Extracted 14 session state Maps to `orchestration/simulationState.ts` (133 lines)
- **B3**: Extracted telemetry retrieval to `orchestration/telemetryCollector.ts` (45 lines)
- **Created**: `MODULE_MAP.md` — 477-line module registry with exports, tests, dependencies, and isolation guide

### Key Metrics

- **76 source files** in server, **~30 files** in web
- **20 test files**, **195 tests** — 26% file coverage
- **0 circular dependencies** between modules
- **simulationRunner.ts** reduced from 3,985 to 3,854 lines via state extraction

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- Roadmap init: CONF-* requirements assigned to Phase 1 as foundation; EconomyConfig type and backward compatibility established before any financial instrument code
- Roadmap init: BANK-07 (central bank policy agent) assigned to Phase 4 — it observes CPI which is a Phase 4 output
- Roadmap init: Phase 5 is UI-only with no dedicated REQUIREMENTS.md entries; all data it surfaces is produced by Phases 1-4
- [Phase 01-01]: EconomyConfig returns bankingEnabled:false for legacy sessions (null or missing economyConfig key) — ensures zero behavioral change for existing sessions
- [Phase 01-01]: computeSystemFiatTotal new params default to 0 for backward compat; Plan 03 wires the real banking values
- [Phase 01-02]: BankingDelta return pattern: engine functions return deltas rather than mutating DB — Plan 03 applies in batch via bankingRepo
- [Phase 01-02]: Bank reserves modeled as bank agent.currentStats.wealth — single source of truth, avoids SFC double-counting (Pitfall 4)
- [Phase 01-03]: Banking DB writes use sqlite.transaction() directly (not asyncLogFlusher) — once-per-iteration frequency is low enough
- [Phase 01-03]: M0 in codebase = totalFiatSupply (includes deposits+collateral); M1 = totalFiatSupply + loansOutstanding — consistent naming throughout
- [Phase 02-01]: enterpriseOwnerId is agent.id (DB-persisted), NOT in-memory enterpriseId — survives session export/import
- [Phase 02-01]: No bondEscrow in SFC accounting — bond purchase is a direct wealth transfer within the SFC perimeter
- [Phase 02-01]: ISSUE_GOV_BOND restricted to elite roles only; BUY_SHARES/SELL_SHARES/BUY_BOND available to all citizens
- [Phase 02-02]: processCorpBondIssuance wealth goes to enterpriseTreasuryDeltas, not wealthDeltas — Plan 03 (simulationRunner) must route to enterprise owner agent wealth
- [Phase 02-02]: IPO share price fixed at 10 fiat when totalSharesOutstanding === 0 — avoids division by zero
- [Phase 02-02]: capitalMarketEngine.ts has zero DB imports — pure engine, separation of concerns mirroring bankingEngine/bankingRepo pattern
- [Phase 02-03]: processIteration uses separate typed arrays for each request type — matched actual Plan 02-02 implementation, not the generic pendingRequests spec
- [Phase 02-03]: enterpriseTreasuryDeltas (corp bond coupon/maturity) routed to enterprise owner agent wealth in statUpdates — no separate enterprise treasury ledger needed
- [Phase 03-01]: EconomyConfig fiscal fields all optional — fiscalEnabled remains absent in DEFAULT_ECONOMY_CONFIG so existing sessions receive zero behavioral change
- [Phase 03-01]: Budget allocation stored one-per-session (design-time config per FISC-01), not per-iteration — fiscal engine reads latest via getActiveBudget
- [Phase 03-01]: Public goods quality stored per-iteration to enable trend analysis and export/import; getPublicGoodsState returns latest row (highest iterationNumber)
- [Phase 03-02]: All budget categories distribute fiat to agents equally (SFC-compliant); quality scores are side effects of spending, not stores of value
- [Phase 03-02]: Quality gain scale factor 0.264 calibrated: 25 fiat spending (10% of 1000 treasury, 25% alloc) yields ~2.5 quality points
- [Phase 03-03]: Fiscal multipliers applied via 1-iteration lag (sessionFiscalMultipliers map) — realistic: infrastructure improvements take time to materialize
- [Phase 03-03]: skillGainBonus applied in simulationRunner via processSkills skillGainMultiplier parameter — skill processing is runner responsibility, not physics engine
- [Phase 03-fiscal-policy]: fiscalPublicGoodsQuality lifted to outer scope so iterTelemetry (built after fiscal block closes) can read quality values
- [Phase 03-fiscal-policy]: Conditional spread ...(fiscalPublicGoodsQuality ? {...} : {}) keeps fields absent when fiscalEnabled is false
- [Phase 03-fiscal-policy]: Budget validation (non-negative + sum=1.0) before DB writes — invalid PUT /config returns 400 with no side effects
- [Phase 03-fiscal-policy]: economyConfig uses partial merge in PUT /config — callers patch individual fields without overwriting others
- [Phase 04]: [Phase 04-01]: Inflation config extends EconomyConfig only through optional fields so legacy sessions remain backward compatible.
- [Phase 04]: [Phase 04-01]: inflationEngine stays DB-free and falls back to blended inflation when CPI history is too short for a rolling mean.
- [Phase 05-01]: macroHistory populated by polling /simulate/telemetry endpoint (not SSE push) — SSE events lack TelemetryLog; polling is simpler and low-frequency
- [Phase 05-01]: FiscalCategory exported from shared/src/types.ts alongside TelemetryLog — co-location avoids import loops
- [Phase 06-00]: Wave 0 test scaffold: placeholder tests created before implementation plans run — all 8 pass green; Plans 01-03 strengthen in-place
- [Phase 06-scenario-entry]: Fork config uses conditional spread to preserve economyConfig/budgetAllocation only when present — avoids polluting new sessions with stale defaults
- [Phase 06-scenario-entry]: computeParamDiffs is deterministic (no LLM) — structural comparison of EconomyConfig keys for comparison page diff display (D-08)
- [Phase 06-01]: EconomyTab receives economyConfig and budgetAllocation as props from DesignReview — no direct store coupling in the component
- [Phase 06-01]: Soft-limit warnings shown as inline dialog instead of window.confirm for better UX and testability
- [Phase 06-scenario-entry]: SessionSummaryInput telemetry fields optional — sessions without economic config still produce valid prompts, just without telemetry section
- [Phase 06-scenario-entry]: ConfigDiffSection placed before dimension rows — user sees what changed before how outcomes differed, reinforcing A/B causality
- [Phase 06-scenario-entry]: SessionSummaryInput telemetry fields optional — sessions without economic config still produce valid prompts, just without telemetry section
- [Phase 06-scenario-entry]: Fork button shows only when isPastDesign (after first simulation) — intentional design; fork workflow makes sense only with a completed run to diverge from
- [Phase 06-scenario-entry]: Post-checkpoint: tooltip uses theme-aware CSS vars; disabled sections clickable to enable; duplicate Fiscal section removed
- [Phase 07]: Stratified quantile sampling for Pareto distribution improves Gini accuracy with small agent counts
- [Phase 07]: Annual rates from World Bank divided by 12 (ITERATIONS_PER_YEAR); Gini divided by 100 (WB 0-100 to 0-1 scale); budget allocation normalized from real fiscal spending
- [Phase 07]: IdeaInput uses null/creative/location mode state for dual-mode UI; bootstrap SSE uses fetch+ReadableStream reader
- [Phase 07]: DataConfidenceBadge created as minimal stub since plan 07-03 (parallel wave 3) owns the richer version
- [Phase 07]: runAllScenarios runs simulations sequentially per Research open question 3 (LLM cost management)
- [Phase 07]: Pre-existing simulationRunner.ts build errors deemed out of scope for integration plan
- [Phase 09]: Monolithic prompts.ts (2027 lines) split into 7 domain modules per D-19; barrel index.ts re-exports all symbols
- [Phase 09]: D-11/D-12: Roster background changed from 1-2 to 5-8 sentence life stories with economic instinct requirement in both creative and location modes
- [Phase 09]: ammMarketData added as optional last param to buildNaturalIntentPrompt -- Plan 04 wires it
- [Phase 09]: D-15 satisfied by existing economyEvents in memoryStream; D-16 addressed by planner prompt economic goal examples
- [Phase 08]: ConfigDiffHeader only renders scalar EconomyConfig diffs and hides for single-scenario mode. — This keeps the header concise for Plan 05 and avoids misleading output for nested objects until a dedicated formatter exists.
- [Phase 08]: Session grouping stays nullable on the sessions table so existing sessions remain backward compatible.
- [Phase 08]: GET /api/sessions/grouped computes scenarioCount with a correlated SQL count while preserving the flat session list endpoint.
- [Phase 08]: Cross-scenario context keyed by agent name (lowercase) since agents across forks share names but different IDs
- [Phase 08]: Policy brief endpoint at /api/reflect (not session-scoped) since it takes multiple session IDs
- [Phase 08]: URL route /session/:id/simulation?scenarios= matching App.tsx, not /sessions/:id/simulate
- [Phase 08]: Grouped cards use base session (earliest createdAt) for title, stage badge, and navigation target
- [Phase 08]: Multi-scenario Reflection replaces two-panel layout with scrollable single-column for data table, narrative, and agent comparisons
- [Phase 10]: All 16 new EconomyConfig fields are optional with backward-compatible defaults
- [Phase 10]: Enterprise engine follows delta-return pattern (no DB imports) matching bankingEngine and capitalMarketEngine
- [Phase 10]: Laborer agents can own enterprises as fallback when no elite/specialist exists in sector
- [Phase 10]: Bootstrap aborts with SSE error on LLM enrichment failure — no silent fallback to stub backgrounds
- [Phase 10]: Enterprise deposit IDs use ent_ prefix to distinguish from citizen deposits
- [Phase 10]: Liquidity injection adjusts SFC initialFiat baseline to prevent false drift warnings
- [Phase 10]: Taylor Rule converts inflationRate from percentage to decimal (inflationRate/100) for per-iteration rate computation
- [Phase 10]: Reserve ratio adjustment capped at +0.05 per iteration to prevent runaway tightening
- [Phase 10]: StatTrajectoryEntry uses final agent stats since per-iteration stats not persisted; actions from resolvedActions table
- [Phase 10]: assertAgentContext logs warnings instead of throwing to avoid crashing simulations
- [Phase 10]: Income tax collected before budget execution so revenue funds spending
- [Phase 10]: GDP scaling target ratio 10% per category; max gain 75 quality points/iteration
- [Phase 10]: TelemetryLog lacks agentsAlive/agentsDied; passed as separate params to narrative validation functions
- [Phase 10]: EnterpriseBlueprint/EnterpriseSector/EnterpriseCommodity types added to shared (were missing from prior wave merges)
- [Phase 10-fix-simulation-realism]: ALTER TABLE guard pattern for additive SQLite column additions (no migration runner)
- [Phase 10-fix-simulation-realism]: Employment registry populated at simulation init so all agents immediately know their employer
- [Phase 10-fix-simulation-realism]: GC2: value-aware hasBasePrices guard (Object.values.some) detects all-zero cpiBasePrices as uninitialized
- [Phase 10-fix-simulation-realism]: GC2: module-scope NON_FOOD_COMMODITY_BASELINES (tools=12, luxury_goods=12, raw_materials=4) replaces literal 1 in basket price fallback
- [Phase 10-fix-simulation-realism]: GDP_SCALED_MAX_GAIN_PER_ITER reduced from 75 to 6: at China's 1.8% GDP spending gain drops from 22.8 to 1.8 pts/iter, requiring sustained fiscal commitment
- [Phase 10-fix-simulation-realism]: CORTISOL_FLOOR = 3 applied at final stat commit sites only (not runningCortisol accumulator) to prevent cortisol collapsing to zero in well-functioning economies
- [Phase 11]: Wave 0 foundation: no behavior changes; optional shared types + scaffold tests only, so 8 downstream plans unblock in parallel
- [Phase 11]: [Phase 11-01]: publicGoodsEscrow is trailing optional param with default 0 — all 4 existing computeSystemFiatTotal callers unchanged; Plans 03 and 07 wire real values
- [Phase 11]: [Phase 11-01]: DEFAULT_ECONOMY_CONFIG ships flat 15/10/15 tax + governanceEnabled=true; publicGoodsEscrow intentionally absent (materializes at fiscal tick runtime)
- [Phase 11]: [Phase 11-01]: 13 scaffold files (plan said 14 — 14th was a roll-up verification gate, not a file); 11 real assertions in physicsConfig.thresholds.test.ts, 95 it.todo placeholders await downstream waves
- [Phase 11]: [Phase 11-01]: seed coefficients (10 k_*) anchored to 11-RESEARCH.md §10, not literature — matches D-05/D-09 conservative-defaults decision; hot-swappable via PUT /api/settings/physics-config

### Roadmap Evolution

- Phase 6 added: Scenario Entry — policymakers configure economic parameters and initial conditions at session design time
- Phase 7 added: Real-World Scenario Bootstrap — location-based data-driven society design for policymakers
- Phase 9 added: redesign prompts for all
- Phase 10 added: Fix simulation realism — agent economic behavior, inflation response, narrative grounding
- Phase 11 added: Simulation realism — organic stress pressure, fiscal balance, and SFC leak closure

### Pending Todos

- Complete test coverage per MODULE_MAP.md Wave 1-6 plan (P0: physicsEngine, allostaticEngine, skillSystem tests)
- Phase B1: Extract subsystem tick functions from simulationRunner (deferred — deeply interleaved)
- Phase C: Frontend API layer standardization (create missing API modules for simulate, bootstrap, reflect)
- Full centralAgent DB extraction (A2 — requires SSE callback redesign)

### Blockers/Concerns

- Phase 4: CPI basket weights and M1/CPI blending coefficient are initial estimates requiring empirical tuning
- Test coverage at 26% file level — critical gaps in physicsEngine, orchestration, routes, and frontend (see MODULE_MAP.md Section 5)

## Session Continuity

Last session: 2026-04-13T19:40:25.945Z
Stopped at: Completed 11-01-PLAN.md (Wave 0 foundation)
Resume file: None
