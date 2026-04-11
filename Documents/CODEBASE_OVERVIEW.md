# PolicyLab Codebase Overview

> **Last updated:** 2026-04-05 (after v1.0 milestone completion + modularity refactoring)
>
> For the complete module-by-module API reference with exports, tests, and isolation guide, see [`MODULE_MAP.md`](../MODULE_MAP.md) in the project root.

This document summarizes the current implemented structure of the PolicyLab repository. It is intended as a practical orientation guide for developers and agents working in the codebase now, not as a speculative design document.

## 1. Repository Structure

PolicyLab is an npm workspace with three packages:

- `web` — React 19 + Vite frontend
- `server` — Express + SQLite backend
- `shared` — Zero-dependency TypeScript types

Top-level supporting folders:

- `Documents/`: design notes, changelogs, gap analysis, legacy docs
- `SimulationResult/`: exported or sample simulation result files
- `public/`: static assets used by the frontend

Top-level reference documents:

- `CLAUDE.md`: AI assistant guidance (architecture, commands, conventions)
- `MODULE_MAP.md`: Complete module registry (exports, tests, dependencies, isolation guide)

## 2. Package Responsibilities

### `shared/`

`shared/src/types.ts` (844 lines) is the single cross-package contract surface. It defines:

- Session stages, session metadata, and session config types
- Agent, AgentStats, and personality trait types
- Iteration, telemetry, and lifecycle event types
- Economy types: EconomyConfig, BudgetAllocation, LoanContract, DepositAccount, BankBalanceSheet
- Capital market types: EquityPosition, BondHolding
- Inflation types: InflationState, CpiBasketWeights, PriceIndex
- Market types: AMMState, MarketOrder, TradeMatch, MarketState, Inventory, SkillMatrix
- Location/bootstrap types: LocationProfile, DataPoint, DataConfidence
- Comparison, reflection, and app settings contracts
- Key constants: DEFAULT_ECONOMY_CONFIG, DEFAULT_BUDGET_ALLOCATION, DEFAULT_SKILL_MATRIX, etc.
- Utility functions: distributeProRata()

### `server/`

The backend is an Express app with 76 source files across 8 modules:

- `src/mechanics/` (14 files, 4,899 lines): Pure deterministic engines — physics, banking, capital markets, fiscal, inflation, AMM, skill system, inventory, order book
- `src/orchestration/` (11 files, 4,843 lines): Simulation loop, state management, telemetry, reflection runner, managers
- `src/llm/` (10 files, 3,742 lines): Multi-provider gateway, prompt builders, retry/healing, central agent
- `src/routes/` (12 files, 3,290 lines): Express API with 47 endpoints
- `src/db/` (14 files, 2,415 lines): SQLite schema (26 tables), repository pattern, async log flusher
- `src/cognition/` (4 files, 1,268 lines): Per-agent memory stream, reflection tree, recursive planner
- `src/data/` (7 files, 938 lines): World Bank API, Photon geocoder, bootstrap pipeline, location cache
- `src/parsers/` (3 files, 398 lines): LLM response extraction (JSON, simulation, reflection)

### `web/`

The frontend is a Vite + React app using Zustand stores (~30 files):

- `src/stores/` (8 files): Domain-sliced Zustand stores with zero cross-store coupling
- `src/pages/` (11 files): Route-level screens (zero page-to-page imports)
- `src/components/` (10+ files): Reusable UI components (90% pure presentation)
- `src/api/` (5 files): Typed API wrappers (sessions, settings, brainstorm, compare, client)

## 3. Session Lifecycle

The active shared stage model is defined in `shared/src/types.ts`. Current stages include:

- `idea-input`
- `brainstorming`
- `designing`
- `design-review`
- `refining`
- `simulating`
- `simulation-paused`
- `simulation-complete`
- `reflecting`
- `reflection-complete`
- `reviewing`
- `completed`

Not every page or route uses every stage directly, but the backend and frontend both rely on this lifecycle model.

## 4. Backend Flow by Area

### 4.1 Session and Design APIs

Key routes:

- `server/src/routes/sessions.ts`
- `server/src/routes/design.ts`
- `server/src/routes/chat.ts`
- `server/src/routes/artifacts.ts`

These routes handle:

- session CRUD
- stage updates
- design config updates
- brainstorming and refinement chat
- agent roster fetches
- session fork flows
- artifact retrieval

### 4.2 Simulation APIs

Key routes:

- `server/src/routes/simulate.ts`
- `server/src/routes/iterations.ts`

Simulation route responsibilities:

- start, pause, resume, abort, abort-reset
- SSE stream for live progress
- telemetry endpoint

Iteration route responsibilities:

- list iteration history
- fetch full iteration history with statistics
- per-agent stat history reconstruction
- single-iteration detail fetch

### 4.3 Reflection, Review, and Comparison

Key routes:

- `server/src/routes/reflect.ts`
- `server/src/routes/review.ts`
- `server/src/routes/compare.ts`

These use stored session artifacts plus LLM summaries to generate:

- agent reflections
- society evaluation
- cross-session comparisons
- follow-up Q&A

### 4.4 Import / Export

`server/src/routes/importexport.ts` supports:

- exporting a session snapshot as JSON
- importing a saved session as a new local session

## 5. Simulation Architecture

The main simulation loop lives in:

- `server/src/orchestration/simulationRunner.ts`

Related managers:

- `simulationManager.ts`: run state, pause/resume/abort flags, SSE fanout
- `reflectionManager.ts`: reflection workflow SSE/state
- `governanceManager.ts`: policy update cycles during simulation
- `concurrencyPool.ts`: bounded async concurrency helper
- `clustering.ts`: grouping helpers for larger simulations

### Implemented Loop Shape

At a high level, a simulation iteration does the following:

1. Load live session and agent state
2. Collect intents from citizen agents via provider-specific LLM calls
3. Run resolution through the central agent
4. Apply deterministic mechanics and stat updates
5. Persist agents, iterations, economy state, telemetry, and snapshots
6. Broadcast SSE events to the frontend

The runner also supports:

- pause/resume
- abort-reset behavior
- telemetry persistence
- restart recovery using persisted state
- simulation-paused stage on parser/context failures

## 6. Deterministic Mechanics

All mechanics engines are pure functions (data in → delta out) with no DB or LLM dependencies. The only exception is `orderBook.ts` which uses `db/repos/orderBookRepo.ts` for persistence.

| Engine | File | Purpose |
|---|---|---|
| Physics | `physicsEngine.ts` | Action resolution: 25+ action codes → stat deltas |
| Allostatic | `allostaticEngine.ts` | MET metabolism, cortisol → strain → load → disease |
| AMM | `automatedMarketMaker.ts` | Constant-product x*y=k market maker for commodities |
| Banking | `bankingEngine.ts` | Loans, deposits, reserve enforcement, interest accrual, default |
| Capital Markets | `capitalMarketEngine.ts` | Equity (shares/dividends), bonds (gov/corp, coupon/maturity) |
| Fiscal | `fiscalEngine.ts` | Budget execution, public goods quality, spending multipliers |
| Inflation | `inflationEngine.ts` | CPI from Laspeyres basket, M1 blending, expectations |
| Skills | `skillSystem.ts` | Learning-by-doing, education multiplier, skill decay |
| Inventory | `inventorySystem.ts` | Food/tools/luxury/raw items, spoilage, trade |
| Order Book | `orderBook.ts` | Price/time priority matching for peer-to-peer trade |
| Action Codes | `actionCodes.ts` | 25+ codes with role-tier permission gates |
| Physics Config | `physicsConfig.ts` | Tunable simulation constants (mutable singleton) |

**SFC Accounting:** Total system fiat (agent wealth + AMM reserves + treasury + deposits + collateral) must remain constant. Every engine maintains zero-sum transfers. An SFC assertion runs every iteration.

## 7. Persistence Model

**26 tables** across 6 domains in SQLite (Drizzle ORM + better-sqlite3):

| Domain | Tables |
|---|---|
| **Core** | sessions, agents, agentIntents, resolvedActions, iterations, reflections, chatMessages, artifacts, roleChanges |
| **Economy** | economySnapshots, agentEconomy, ammSnapshots, marketPrices, orderBook |
| **Banking** | depositAccounts, loanContracts, bankBalanceSheets, macroSnapshots |
| **Capital Markets** | equityPositions, bondHoldings |
| **Fiscal** | fiscalBudgets, publicGoodsState |

**Repository pattern:** 10 repos in `db/repos/` (agentRepo, sessionRepo, iterationRepo, chatMessageRepo, economyRepo, bankingRepo, capitalMarketRepo, fiscalRepo, macroSnapshotRepo, orderBookRepo).

**Async log flusher:** `asyncLogFlusher.ts` batches high-frequency writes (agent intents, resolved actions) during simulation ticks to prevent SQLITE_BUSY deadlocks. Max 5 retry attempts before dropping stuck rows.

The backend mixes Drizzle ORM reads/writes with targeted `better-sqlite3` statements for hot paths and transactional batch updates.

## 8. LLM Layer

Key files:

- `server/src/llm/gateway.ts`
- `server/src/llm/prompts.ts`
- `server/src/llm/centralAgent.ts`
- `server/src/llm/retry.ts`
- `server/src/llm/retryWithHealing.ts`
- provider adapters: `openai.ts`, `anthropic.ts`, `gemini.ts`, `vertex.ts`

Responsibilities:

- provider selection from saved settings
- structured message construction
- prompt composition for design, simulation, reflection, and comparison
- retry and parser-healing flows

## 9. Frontend State and Screens

### Stores

8 Zustand stores with zero cross-store coupling:

- `simulationStore.ts`: Live simulation state, SSE double-buffering (RAF), pause/resume/abort controls, telemetry
- `scenarioStore.ts`: Tab-based scenario management, baseline + N variants, fork orchestration
- `sessionDetailStore.ts`: Brainstorming, design generation (SSE), refinement, agent management
- `bootstrapStore.ts`: Location-based bootstrap progress (SSE), step tracking
- `reflectionStore.ts`: Two-pass reflection workflow, agent reflections, society evaluation
- `sessionsStore.ts`: Home page session list
- `settingsStore.ts`: Provider/model settings, connection testing
- `compareStore.ts`: Cross-session comparison, history, follow-up chat

### Pages

Current route-level pages include:

- `HomePage.tsx`
- `IdeaInput.tsx`
- `Brainstorming.tsx`
- `DesignReview.tsx`
- `Simulation.tsx`
- `Reflection.tsx`
- `AgentReview.tsx`
- `CompareSessions.tsx`
- `Artifacts.tsx`
- `PhysicsLaboratory.tsx`
- `SettingsPage.tsx`

### Realtime UI Model

The simulation UI consumes SSE events from `/simulate/stream`. `simulationStore.ts` batches incoming events behind `requestAnimationFrame` to reduce render pressure during active runs.

## 10. Current Commands

```bash
npm install                # Install all workspace dependencies
npm run dev                # Full app (server + web concurrently)
npm run dev -w server      # Backend only
npm run dev -w web         # Frontend only
npm run build              # Build all packages in dependency order
npm run test -w server     # Run server tests (vitest) — 300 tests
npm run lint -w web        # Lint frontend
```

## 11. Test Coverage

**300 tests** across 24 test files (vitest):
- Mechanics: banking (32), capital markets (20), fiscal (31), inflation (23), enterprise (16), edge cases (16)
- SFC integration: banking (6), capital markets (6), fiscal (20), inflation (9), AMM (14), invariant (16)
- Data: bootstrap pipeline (7), enterprise bootstrap (11), Gini (8), location cache (3), World Bank API (7)
- DB/Other: agentRepo (3), economyConfig (16), scenario entry (8), LLM prompts (12), LLM load balancer (7), LLM narrative (9)

**Not yet tested:** physicsEngine, allostaticEngine, skillSystem, all routes, all orchestration, all frontend stores. See `MODULE_MAP.md` Section 5 for the prioritized test plan.

## 12. Practical Notes for Contributors

- `Documents/Legacy/` contains pre-fork "Ideal World" design material — may not match current code.
- `MODULE_MAP.md` in the project root is the authoritative module reference — consult before modifying any module.
- High-value integration points: simulation state recovery, import/export fidelity, SSE synchronization.
- SFC accounting: any change that touches wealth/fiat transfers must maintain the M0-constant invariant.

## 13. Source of Truth

For current implementation details, prefer:

1. `MODULE_MAP.md` (module boundaries, exports, dependencies)
2. `shared/src/types.ts` (cross-workspace contracts)
3. `server/src/db/schema.ts` (DB structure)
4. `CLAUDE.md` (AI assistant conventions)
5. Route handlers in `server/src/routes/`
6. Orchestration code in `server/src/orchestration/`
7. Zustand stores in `web/src/stores/`

Treat `Documents/Legacy/` and older narrative docs as historical context, not authority.
