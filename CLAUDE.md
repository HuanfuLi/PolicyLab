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

Configuration lives in `~/.policylab/config.json` (LLM keys, provider selection). Database is `~/.policylab/policylab.db` (Drizzle ORM + better-sqlite3).

## Architecture

### 7-Stage Session Lifecycle
`Idea → Brainstorming → Designing → Design-Review → Refining → Simulating → Reflecting → Reviewing → Completed`

Each stage is a REST endpoint that advances `session.stage` in the DB.

### Neuro-Symbolic Engine (Core Innovation)

The simulation loop in `server/src/orchestration/simulationRunner.ts` runs three phases per iteration:

1. **Cognitive Phase** — `cognitiveEngine.ts` fetches memories and runs economic self-reflection per agent.
2. **Intent Phase (parallel)** — Each Citizen Agent LLM call produces a **Multi-Action Queue** (up to 3 `ActionCode`s per turn) parsed from structured JSON.
3. **Resolution Phase** — `physicsEngine.ts` applies deterministic deltas (MET metabolism, allostatic load, AMM trades). A **Physics Trace Log** is injected back into the Central Agent's context, forcing the narrative to match the math.

For sessions with >30 agents, **HMAS Map-Reduce** activates: intents are clustered by role/topology into ~15-agent batches, smaller LLMs draft local resolutions, and the Central Agent merges them into a global narrative.

### Key Mechanical Systems

| System | File | Description |
|---|---|---|
| MET Metabolism | `allostaticEngine.ts` | Per-tick satiety depletion: `ΔSatiety = (weightKg × MET × AgeModifier) / SatietyKcalPerPoint` |
| Allostatic Load (EMAL) | `allostaticEngine.ts` | Cortisol → Strain (reversible) → Load (irreversible); persisted for pause/resume |
| Constant Product AMM | `automatedMarketMaker.ts` | `x × y = k` for commodities; includes UBI/demurrage cycles |
| SFC Economy | `physicsEngine.ts` + AMM | M0 constant; M1/M2 expand through fractional reserve banking; per-iteration audit validates monetary accounting |
| Action Codes | `mechanics/actionCodes.ts` | ~20+ action types (WORK, REST, BUY, TEACH…) with role-tier permission gates |

### Real-Time Frontend

- **SSE stream** from `server/src/routes/simulate.ts` consumed by `web/src/stores/simulationStore.ts`
- Updates debounced via `requestAnimationFrame` (60 FPS) to avoid per-event re-renders
- Zustand stores are domain-sliced; avoid cross-store coupling

### Database

Schema in `server/src/db/schema.ts`. Key tables: `sessions`, `agents`, `agentIntents`, `resolvedActions`, `iterations`, `reflections`, `agentEconomy`, `marketPrices`.

**`asyncLogFlusher`** batches writes during high-frequency simulation ticks to prevent `SQLITE_BUSY` deadlocks. Always route high-frequency writes through it.

## Key Files

| File | Role |
|---|---|
| `server/src/llm/prompts.ts` | **Single source of truth** for all LLM prompts and JSON output schemas |
| `server/src/orchestration/simulationRunner.ts` | Core simulation loop, Map-Reduce orchestration |
| `server/src/llm/centralAgent.ts` | Central Agent: brainstorming, design generation, law, post-mortem |
| `server/src/mechanics/physicsEngine.ts` | Deterministic delta calculations; narrative grounding trace |
| `server/src/db/repos/agentRepo.ts` | Agent CRUD; complex queries for alive agents with full stats |
| `web/src/stores/simulationStore.ts` | SSE event handling, live simulation telemetry |
| `web/src/pages/DesignReview.tsx` | Agent roster editor, locked-variable controls, simulation start |
| `Documents/CODEBASE_OVERVIEW.md` | Deep-dive architectural reference |

## Development Conventions

- **Shared types**: All cross-workspace data structures live in `shared/src/types.ts`. Import as `@policylab/shared`.
- **Prompt changes**: Add/modify in `prompts.ts` only. All LLM calls must use structured JSON outputs with explicit schemas.
- **New action types**: Register in `mechanics/actionCodes.ts` (enum + role-permission table) before referencing in the physics engine.
- **Economy changes**: Run the SFC audit assertion after any change that touches wealth/fiat transfers. The invariant is M0 constant + M1 = M0 + net loans outstanding.
- **Multi-provider LLM**: The LLM gateway in `server/src/llm/` abstracts Anthropic, OpenAI, Gemini, and Ollama. Provider/model is selected from config, not hardcoded.
- **Economic parameters**: All tunable economic parameters (reserve ratio, interest rates, bond coupon, budget allocation, CPI basket weights) must be stored in session-level config via `EconomyConfig` type, never hardcoded.