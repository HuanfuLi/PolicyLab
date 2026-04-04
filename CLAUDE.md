# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**PolicyLab** is a local-first, LLM-powered multi-agent economic simulation platform for policy experimentation. It models micro-societies of 20–150+ "Citizen Agents" using a **Neuro-Symbolic Engine**: LLMs drive intentions and narratives while a deterministic physics/economic engine enforces resource constraints, financial systems, and psychological realism. Designed as a sandbox for policymakers to preview the effects of economic policies before real-world implementation.

Forked from the Ideal World project with a sharper focus on economic realism and policy evaluation.

## Commands

```bash
# Install all workspace dependencies
npm install

# Start backend (Express/tsx watch) and frontend (Vite) concurrently
npm run dev

# Run individual workspaces
npm run dev -w server
npm run dev -w web

# Build all packages in dependency order (shared → server → web)
npm run build

# Lint frontend
npm run lint -w web

# Run server tests (vitest)
npm run test -w server

# Run a single test file
npx vitest run server/src/mechanics/__tests__/some.test.ts
```

## Monorepo Structure

Three npm workspaces with a strict dependency order:
- `shared/` — Zero-dependency TypeScript types consumed by both workspaces. Import as `@policylab/shared`.
- `server/` — Express + SQLite backend. Entry: `src/index.ts`.
- `web/` — React 19 + Vite frontend. Entry: `src/main.tsx`.

Configuration lives in `~/.policylab/config.json` (LLM keys, provider selection). Database is `~/.policylab/policylab.db` (Drizzle ORM + better-sqlite3). Location data cache in `~/.policylab/cache/` (30-day TTL per country).

## Architecture

### Two Design Modes

PolicyLab supports two session creation paths, both converging at Design Review:

1. **Creative Mode** ("Describe a Society") — User writes a freeform idea. Central Agent guides a 5-checklist brainstorming chat (governance, economy, legal, culture, infrastructure), then generates overview → law → agent roster via 3-step LLM pipeline. Entry: `web/src/pages/IdeaInput.tsx` → `Brainstorming.tsx`.

2. **Location Mode** ("Mirror a Real Location") — User enters a real-world location via Photon geocoder autocomplete + a policy scenario text field. System fetches 23 World Bank indicators, converts to `EconomyConfig` + agent roster + law via `dataBootstrapPipeline.ts`, streams progress via SSE. Entry: `web/src/pages/IdeaInput.tsx` → `POST /api/sessions/:id/bootstrap`.

### Session Lifecycle
`Idea → Brainstorming → Designing → Design-Review → Refining → Simulating → Reflecting → Reviewing → Completed`

Each stage is a REST endpoint that advances `session.stage` in the DB.

### Neuro-Symbolic Engine (Core Innovation)

The simulation loop in `server/src/orchestration/simulationRunner.ts` runs three phases per iteration:

1. **Cognitive Phase** — `cognitiveEngine.ts` fetches memories and runs economic self-reflection per agent.
2. **Intent Phase (parallel)** — Each Citizen Agent LLM call produces a **Multi-Action Queue** (up to 3 `ActionCode`s per turn) parsed from structured JSON. Agent prompts include context for banking (deposit balance, loans), capital markets (equity/bond holdings), fiscal policy (budget allocation, public goods quality), and inflation (CPI, trend).
3. **Resolution Phase** — `physicsEngine.ts` applies deterministic deltas (MET metabolism, allostatic load, AMM trades, banking operations, fiscal spending, inflation feedback). A **Physics Trace Log** is injected back into the Central Agent's context, forcing the narrative to match the math.

For sessions with >30 agents, **HMAS Map-Reduce** activates: intents are clustered by role/topology into ~15-agent batches, smaller LLMs draft local resolutions, and the Central Agent merges them into a global narrative.

### Key Mechanical Systems

| System | File | Description |
|---|---|---|
| MET Metabolism | `allostaticEngine.ts` | Per-tick satiety depletion: `ΔSatiety = (weightKg × MET × AgeModifier) / SatietyKcalPerPoint` |
| Allostatic Load (EMAL) | `allostaticEngine.ts` | Cortisol → Strain (reversible) → Load (irreversible); persisted for pause/resume |
| Constant Product AMM | `automatedMarketMaker.ts` | `x × y = k` for commodities; includes UBI/demurrage cycles |
| SFC Economy | `physicsEngine.ts` + AMM | M0 constant; M1/M2 expand through fractional reserve banking; per-iteration audit validates monetary accounting. Bank agents excluded from citizen fiat sum to prevent double-counting with deposits. |
| Banking Engine | `bankingEngine.ts` | Deposit accounts, loan lifecycle (create/repay/default), reserve enforcement, interest accrual |
| Capital Market Engine | `capitalMarketEngine.ts` | Enterprise equity with dividends, government/corporate bonds with coupon/maturity |
| Fiscal Engine | `fiscalEngine.ts` | Budget spending from treasury, public goods quality (gain with diminishing returns, decay), per-category multiplier effects on agent stats |
| Inflation Engine | `inflationEngine.ts` | Laspeyres CPI from commodity basket, M1 blending, AMM goods-reserve feedback, inflation expectations |
| Action Codes | `mechanics/actionCodes.ts` | 25+ action types (WORK, REST, BUY, DEPOSIT, TAKE_LOAN, BUY_SHARES, SET_RESERVE_RATIO…) with role-tier permission gates |
| Skill System | `skillSystem.ts` | Learning-by-doing with education multiplier from fiscal policy |

### Data Bootstrap Pipeline (Phase 7)

When a policymaker bootstraps from a real location:

1. **Geocoding** — Photon API (`photonGeocoder.ts`) resolves location to country code + coordinates
2. **Data Fetch** — `locationDataService.ts` fetches 21 World Bank indicators in batches of 5, grouped by category (demographics, economics, fiscal, infrastructure). Results cached to `~/.policylab/cache/{CC}.json` with 30-day TTL.
3. **Profile Assembly** — `LocationProfile` struct assembled with `DataPoint` per indicator (value + year + source + confidence)
4. **Config Mapping** — `profileToEconomyConfig()` in `dataBootstrapPipeline.ts` converts real-world indicators to `EconomyConfig` params:
   - WB lending rate → `baseLoanInterestRate` (÷12 for per-iteration)
   - WB deposit rate → `depositInterestRate`
   - GDP per capita → `reserveRequirement` (tier heuristic), `baseFiat` (wealth scaling), `defaultLoanTermIterations`
   - CPI inflation → `inflationAmmThreshold`, `inflationAmmCap`, `m1InflationCoeff`
   - GDP growth → `productivityGrowthEstimate`
   - Gov expense % GDP → `budgetSpendingRate`
   - Military/health/education % GDP → `BudgetAllocation` fractions
   - Stock market cap → `dividendPayoutRatio`
   - Gov debt + lending rate → `govBondCouponRate`
5. **Agent Roster** — `generateAgentRoster()` creates proportional micro-sample from sector employment data, with Gini-based wealth distribution. A bank agent (`type: 'bank'`) is inserted when `bankingEnabled`.
6. **LLM Generation** — Law document, agent backgrounds, and society overview generated via LLM with real data context.
7. **Scenario Interpretation** — If user provided a policy scenario text, LLM interprets it as parameter deltas applied on top of the baseline.

Confidence tracking: each mapped param stores its data source (`api`/`web`/`llm`) and confidence level (`high`/`medium`/`low`). Frontend displays `DataConfidenceBadge` per parameter.

### Scenario Builder

For location-bootstrapped sessions, Design Review shows a tab-based scenario builder:
- **Baseline tab** — real-world-calibrated config (read from bootstrap data)
- **Scenario tabs** — user adds N scenario variants, each with parameter overrides. Inline diff markers show divergence from baseline.
- **Run All Scenarios** — forks the session per scenario, patches config, launches parallel simulations, navigates to comparison page.

State managed by `web/src/stores/scenarioStore.ts` with `DEFAULT_ECONOMY_CONFIG` merged into baseline for complete diff coverage.

### Real-Time Frontend

- **SSE stream** from `server/src/routes/simulate.ts` consumed by `web/src/stores/simulationStore.ts`
- `macroHistory: TelemetryLog[]` accumulates per-iteration economic telemetry for chart rendering
- **Economic Dashboard** (`EconomicDashboard.tsx`) — 4 recharts panels: CPI, Money Supply (M0/M1/M2), Fiscal Budget, Bond Yields
- Updates debounced via `requestAnimationFrame` (60 FPS) to avoid per-event re-renders
- Zustand stores are domain-sliced; avoid cross-store coupling

### Database

Schema in `server/src/db/schema.ts`. 26 tables across 6 domains:

**Core**: `sessions`, `agents`, `agentIntents`, `resolvedActions`, `iterations`, `reflections`, `chatMessages`, `artifacts`, `roleChanges`
**Economy**: `economySnapshots`, `agentEconomy`, `ammSnapshots`, `marketPrices`, `orderBook`
**Banking**: `depositAccounts`, `loanContracts`, `bankBalanceSheets`, `macroSnapshots`
**Capital Markets**: `equityPositions`, `bondHoldings`
**Fiscal**: `fiscalBudgets`, `publicGoodsState`

**`asyncLogFlusher`** batches writes during high-frequency simulation ticks to prevent `SQLITE_BUSY` deadlocks. Always route high-frequency writes through it.

## Key Files

| File | Role |
|---|---|
| `server/src/llm/prompts.ts` | **Single source of truth** for all LLM prompts and JSON output schemas (92KB) |
| `server/src/orchestration/simulationRunner.ts` | Core simulation loop, Map-Reduce orchestration, all subsystem ticks (198KB) |
| `server/src/llm/centralAgent.ts` | Central Agent: brainstorming, design generation, law, post-mortem |
| `server/src/mechanics/physicsEngine.ts` | Deterministic delta calculations; narrative grounding trace |
| `server/src/data/dataBootstrapPipeline.ts` | World Bank data → EconomyConfig + agent roster conversion |
| `server/src/data/locationDataService.ts` | Orchestrates World Bank API calls, assembles LocationProfile, manages cache |
| `server/src/routes/bootstrap.ts` | SSE bootstrap endpoint: data fetch → LLM generation → session population |
| `server/src/db/repos/agentRepo.ts` | Agent CRUD; complex queries for alive agents with full stats |
| `web/src/stores/simulationStore.ts` | SSE event handling, live simulation telemetry, macroHistory |
| `web/src/stores/scenarioStore.ts` | Multi-scenario tab management, delta computation, parallel run orchestration |
| `web/src/pages/DesignReview.tsx` | Agent roster editor, economy config, scenario builder, simulation start |
| `web/src/pages/IdeaInput.tsx` | Dual-mode entry: creative brainstorm OR location-based bootstrap |
| `web/src/components/EconomyTab.tsx` | Economy parameter UI with data confidence badges and soft-limit warnings |
| `shared/src/types.ts` | All cross-workspace types: 50+ interfaces (28KB) |

## Development Conventions

- **Shared types**: All cross-workspace data structures live in `shared/src/types.ts`. Import as `@policylab/shared`.
- **Prompt changes**: Add/modify in `prompts.ts` only. All LLM calls must use structured JSON outputs with explicit schemas.
- **New action types**: Register in `mechanics/actionCodes.ts` (enum + role-permission table) before referencing in the physics engine.
- **Economy changes**: Run the SFC audit assertion after any change that touches wealth/fiat transfers. The invariant is M0 constant + M1 = M0 + net loans outstanding. Bank agents are excluded from the citizen fiat sum in `computeSystemFiatTotal` to prevent double-counting with `depositBalances`.
- **Multi-provider LLM**: The LLM gateway in `server/src/llm/` abstracts Anthropic, OpenAI, Gemini, and Ollama. Provider/model is selected from config, not hardcoded.
- **Economic parameters**: All tunable economic parameters (reserve ratio, interest rates, bond coupon, budget allocation, CPI basket weights) must be stored in session-level config via `EconomyConfig` type, never hardcoded.
- **Bootstrap data mapping**: When adding new World Bank indicators, add the code to `indicatorMap.ts`, fetch in `locationDataService.ts`, map in `dataBootstrapPipeline.ts`, and track confidence + source. Add the field to `LocationProfile` in `shared/src/types.ts`.
- **CSS variables**: Use theme tokens from `web/src/index.css` (`--text-main`, `--bg-color`, `--glass-bg`, `--glass-border`, `--primary`, etc.). Both dark and light themes are supported. Phase 7 aliases: `--text`, `--bg-card`, `--border`, `--color-green/yellow/blue/red`.
- **Bank agents**: Bootstrap inserts a `type: 'bank'` agent when `bankingEnabled`. Bank agents are excluded from `citizenAgents` filter (no skills/inventory), excluded from `computeSystemFiatTotal` agent sum (prevents SFC double-count), and shown with a "SYSTEM" badge in the agent roster UI.
