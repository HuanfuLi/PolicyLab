# PolicyLab Codebase Overview

This document summarizes the current implemented structure of the PolicyLab repository. It is intended as a practical orientation guide for developers and agents working in the codebase now, not as a speculative design document.

## 1. Repository Structure

PolicyLab is an npm workspace with three packages:

- `web`
- `server`
- `shared`

Top-level supporting folders:

- `Documents/`: design notes, changelogs, gap analysis, legacy docs
- `SimulationResult/`: exported or sample simulation result files
- `public/`: static assets used by the frontend

## 2. Package Responsibilities

### `shared/`

`shared/src/types.ts` is the main cross-package contract surface. It defines:

- session stages and session metadata
- agent and stat types
- iteration and telemetry types
- reflection and comparison types
- app settings response contracts

`shared/src/economyTypes.ts` defines the deterministic economy model primitives used by the server.

### `server/`

The backend is an Express app with these main areas:

- `src/routes/`: HTTP API surface
- `src/orchestration/`: long-running workflows and managers
- `src/mechanics/`: deterministic action, economy, and physiology systems
- `src/llm/`: provider integrations, prompts, retries, parsing helpers
- `src/db/`: schema, migrations, repositories, DB helpers
- `src/cognition/`: memory and planning subsystems used during simulation
- `src/parsers/`: parser logic for simulation and reflection outputs

### `web/`

The frontend is a Vite + React app using Zustand stores. The main areas are:

- `src/pages/`: route-level screens
- `src/components/`: reusable UI components
- `src/stores/`: client state and live simulation state
- `src/api/`: typed API wrappers

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

Key files:

- `server/src/mechanics/physicsEngine.ts`
- `server/src/mechanics/allostaticEngine.ts`
- `server/src/mechanics/orderBook.ts`
- `server/src/mechanics/automatedMarketMaker.ts`
- `server/src/mechanics/skillSystem.ts`
- `server/src/mechanics/inventorySystem.ts`
- `server/src/mechanics/actionCodes.ts`
- `server/src/mechanics/physicsConfig.ts`

Implemented concerns include:

- action code validation and role constraints
- stat deltas for wealth, health, happiness, cortisol, dopamine
- metabolism and satiety cost
- allostatic strain/load
- market clearing
- AMM reserve tracking
- skill and inventory progression

## 7. Persistence Model

Primary DB files:

- `server/src/db/schema.ts`
- `server/src/db/migrate.ts`
- `server/src/db/index.ts`

Repository helpers:

- `server/src/db/repos/sessionRepo.ts`
- `server/src/db/repos/agentRepo.ts`
- `server/src/db/repos/iterationRepo.ts`
- `server/src/db/repos/economyRepo.ts`
- `server/src/db/repos/chatMessageRepo.ts`

Persisted entities include:

- sessions
- agents
- iterations
- resolved actions
- agent intents
- reflections
- chat messages
- role changes
- economy snapshots
- market prices
- AMM snapshots

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

Important Zustand stores:

- `sessionDetailStore.ts`: brainstorming, design, session detail
- `simulationStore.ts`: live simulation state, SSE buffering, controls
- `reflectionStore.ts`: reflection workflow state
- `compareStore.ts`: compare-session state
- `sessionsStore.ts`: home/session list state
- `settingsStore.ts`: provider and model settings

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

Workspace commands from the repository root:

```bash
npm install
npm run dev
npm run dev:server
npm run dev:web
npm run build
npm run lint -w web
```

Existing direct test scripts:

```bash
npx tsx server/src/llm/__tests__/phase2.test.ts
npx tsx server/src/cognition/__tests__/phase3.test.ts
npx tsx server/src/mechanics/__tests__/physics_sandbox.ts --json
```

## 11. Practical Notes for Contributors

- The worktree may be dirty; do not assume a clean branch.
- `Documents/Legacy/` contains older design material and may not match the current code.
- Route-level manual object mapping exists in a few places; shared contracts should be checked carefully when changing response shapes.
- High-value integration points are simulation state recovery, import/export fidelity, and frontend/store synchronization with SSE.

## 12. Source of Truth

For current implementation details, prefer:

1. `shared/src/types.ts`
2. `server/src/db/schema.ts`
3. route handlers in `server/src/routes/`
4. orchestration code in `server/src/orchestration/`
5. Zustand stores in `web/src/stores/`

Treat older narrative docs as context, not authority, unless they match the code.
