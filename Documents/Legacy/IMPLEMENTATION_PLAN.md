# Ideal World — Implementation Plan

Reference: [USER_FLOW.md](./USER_FLOW.md) · [PROJECT_DESIGN.md](./PROJECT_DESIGN.md) · [UI_DESIGNS.md](./UI_DESIGNS.md)

---

## 1. Project Structure

**Current state:** Vite + React 19 frontend prototype at root. All 10 pages exist as UI mockups with hardcoded data. No backend, no shared types, no state management.

Additions marked with `+`:

```
ideal-world/
├── src/                          # Frontend (exists)
│   ├── App.tsx                   #   Router + sidebar layout
│   ├── main.tsx                  #   Entry point
│   ├── pages/                    #   10 page components (mocked)
│   ├── api/               +     #   C7: API client + SSE handler
│   ├── stores/             +     #   C8: Zustand domain stores
│   └── components/         +     #   C9: Reusable UI (chat, charts, etc.)
├── server/                 +     # Backend (Express + TypeScript)
│   ├── index.ts                  #   Server entry
│   ├── db/                       #   C1: SQLite + Drizzle ORM
│   ├── llm/                      #   C2: LLM Gateway
│   ├── prompts/                  #   C3: Prompt builders
│   ├── orchestration/            #   C4: Workflow coordination
│   ├── routes/                   #   C5: Express routes + SSE
│   └── parsers/                  #   C6: LLM response parsers
├── shared/                 +     # Shared types & validators
│   ├── types.ts
│   └── validators.ts
├── package.json                  # (add backend deps + scripts)
├── vite.config.ts                # (add /api proxy to backend)
└── Documents/
```

---

## 2. Components

```
┌──────────── shared/ ────────────┐
│  Types · Validators · Constants │
└───────────┬──────────┬──────────┘
     server/▼          ▼src/
┌───────────────┐  ┌──────────────┐
│ C1 DB ──┐     │  │  C7 API Client│
│ C2 LLM ─┤    │  │       │       │
│ C3 Prompt┼→C4 │  │  C8 Stores   │
│ C6 Parser┘ │  │  │    ┌──┴──┐   │
│        C5 API─┼──┼→ C9 UI C10  │
│        + SSE  │  │  Shared Pages │
└───────────────┘  └──────────────┘
```

| ID | Location | Status | Responsibility |
|----|----------|--------|----------------|
| C1 | `server/db/` | ✅ Done | SQLite schema, Drizzle ORM, repos for CRUD |
| C2 | `server/llm/` | ✅ Done | Provider-agnostic LLM calls, rate limiting, concurrency |
| C3 | `server/prompts/` | ✅ Done (P1-P3) | Pure functions building prompts per stage |
| C4 | `server/orchestration/` | ✅ Done (P1-P3) | Coordinates design gen, simulation loop, reflection |
| C5 | `server/routes/` | ✅ Done (P1-P3) | Express routes + SSE endpoints |
| C6 | `server/parsers/` | ✅ Done (P1-P3) | Extract structured data from LLM JSON responses |
| C7 | `src/api/` | ✅ Done | Fetch wrapper + SSE client |
| C8 | `src/stores/` | ✅ Done (P1-P3) | Zustand stores calling API client |
| C9 | `src/components/` | Skipped (inline) | Reusable chat, markdown, chart, grid components |
| C10 | `src/pages/` | ✅ Done (P1-P3) | 10 pages — rewired for live data (P4 remaining) |

**Build order:** shared → C1, C2, C3, C6 (parallel) → C4 → C5 → C7 → C8 → C9 → C10 (rewire)

---

## 3. Phases

```
Phase 1: Foundation     → DB + LLM + Settings + Sessions (Home + Settings live)  ✅ DONE
Phase 2: Design Flow    → Stages 0–1B (Idea → Brainstorm → Design live)          ✅ DONE
Phase 3: Simulation     → Stage 2 (simulation loop live, ≤30 agents)             ✅ DONE
Phase 4: Reflect+Review → Stages 3–4 (full lifecycle, MVP complete)              ✅ DONE
Phase 5: Polish         → Stage 1C, artifacts, two-pass reflections, comparison, export/import  ✅ DONE
Phase 6: Scale          → Map-reduce >30 agents, Gini coefficient, Compare nav   ✅ DONE
Phase 7: Mechanism Enh. → Neuro-symbolic engine, HMAS clustering, prompt caching  ✅ DONE
Phase 8: Bug Fixes + UI → Data persistence, Live Feed fix, trend graphs, expandable reflection  ✅ DONE
```

**All phases complete.**

| Feature | Status |
|---------|--------|
| Stages 0, 1A, 1B | ✅ |
| Stage 1C (refinement chat) | ✅ |
| Stage 2 simulation ≤30 agents (standard path) | ✅ |
| Stage 2 simulation >30 agents (map-reduce path) | ✅ Phase 6 |
| Agent lifecycle (death/role change) | ✅ |
| Stage 3 two-pass reflection + evaluation | ✅ |
| Stage 4 agent Q&A | ✅ |
| Home + Settings | ✅ |
| Artifacts page | ✅ |
| Cross-session comparison + follow-up chat | ✅ Phase 5 |
| Session export/import | ✅ Phase 5 |
| Gini coefficient tracking | ✅ Phase 6 |
| Neuro-symbolic physics engine (deterministic stat deltas) | ✅ Phase 7 |
| Action codes (WORK/TRADE/REST/STRIKE/STEAL/HELP/INVEST/CONSUME) | ✅ Phase 7 |
| Cortisol/dopamine hidden neurobiological variables | ✅ Phase 7 |
| Role-based clustering for map-reduce groups | ✅ Phase 7 |
| Prompt caching (Anthropic ContentBlock cache_control) | ✅ Phase 7 |
| Cheaper model for group coordinators (citizenAgentModel) | ✅ Phase 7 |
| Data persistence on page refresh (full iteration restore) | ✅ Phase 8 |
| Live Feed text overlap fix (removed virtualizer) | ✅ Phase 8 |
| Expandable reflection banner in Agent Review | ✅ Phase 8 |
| Society trend line graph in Reflection screen | ✅ Phase 8 |
| Per-agent stats line graph in Reflection screen | ✅ Phase 8 |
| Per-agent stats history API endpoint | ✅ Phase 8 |

---

## 4. Phase Details

### ✅ Phase 1: Foundation — COMPLETE

**Built:** shared types → C1 (DB + repos) → C2 (LLM gateway: claude/openai/gemini/local) → C5 (sessions + settings routes) → C7 (client) → C8 (session + settings stores) → rewired HomePage + SettingsPage

**Key files:** `shared/src/types.ts`, `server/src/db/schema.ts`, `server/src/db/repos/`, `server/src/llm/gateway.ts`, `server/src/routes/sessions.ts`, `server/src/routes/settings.ts`, `web/src/stores/sessionsStore.ts`, `web/src/stores/settingsStore.ts`

### ✅ Phase 2: Design Flow (Stages 0, 1A, 1B) — COMPLETE

**Built:** C3 (brainstorm + overview + law + agent roster + refine prompts) → C6 (JSON parser) → C4 (designOrchestrator) → C5 (chat + design routes) → C8 (sessionDetailStore) → rewired IdeaInput + Brainstorming + DesignReview

**Key files:** `server/src/llm/prompts.ts`, `server/src/parsers/json.ts`, `server/src/orchestration/designOrchestrator.ts`, `server/src/routes/chat.ts`, `server/src/routes/design.ts`, `web/src/stores/sessionDetailStore.ts`

### ✅ Phase 3: Simulation Core (Stage 2) — COMPLETE

**Built:** C3 (intent + resolution + final-report prompts) → C6 (simulation parsers) → C4 (concurrencyPool + simulationManager + simulationRunner) → C5 (simulate routes + SSE stream + iterations routes) → C8 (simulationStore) → rewired Simulation page

**Key files:** `server/src/parsers/simulation.ts`, `server/src/orchestration/simulationRunner.ts`, `server/src/routes/simulate.ts`, `server/src/routes/iterations.ts`, `web/src/stores/simulationStore.ts`

### ✅ Phase 4: Reflection + Review (Stages 3, 4) — COMPLETE

**Built:** C3 (reflection + evaluation + review prompts) → C6 (reflection parser) → C4 (reflection pipeline) → C5 (reflection + review routes) → C8 (review store) → rewired Reflection + AgentReview

**Key files:** `server/src/parsers/reflection.ts`, `server/src/orchestration/reflectionRunner.ts`, `server/src/routes/reflect.ts`, `server/src/routes/review.ts`, `web/src/stores/reflectionStore.ts`

### ✅ Phase 5: Polish + Extras — COMPLETE

**Built:** Artifacts page, cross-session comparison (LLM analysis + follow-up chat), session export/import (full-fidelity JSON)

**Key files:** `server/src/routes/compare.ts`, `server/src/routes/importexport.ts`, `web/src/pages/CompareSessions.tsx`, `web/src/stores/compareStore.ts`, `web/src/api/compare.ts`

### ✅ Phase 6: Scale — COMPLETE

**Built:** Map-reduce simulation for large sessions (>30 agents split into groups of 15, parallel group resolution + merge step), Gini coefficient in IterationStats, Compare link in sidebar nav

**Key files:** `server/src/orchestration/simulationRunner.ts` (map-reduce path, Gini), `server/src/llm/prompts.ts` (buildGroupResolutionMessages, buildMergeResolutionMessages), `server/src/parsers/simulation.ts` (parseGroupResolution, parseMergeResolution)

### ✅ Phase 7: Mechanism Enhancement — COMPLETE

**Built:** Neuro-symbolic engine separating LLM decisions from deterministic physics; role-based HMAS clustering; Anthropic prompt caching

**Key new files:** `server/src/mechanics/actionCodes.ts`, `server/src/mechanics/physicsEngine.ts`, `server/src/orchestration/clustering.ts`

**Key modified files:** `shared/src/types.ts` (cortisol/dopamine in AgentStats), `server/src/llm/types.ts` (ContentBlock), `server/src/llm/anthropic.ts` (cache_control support), `server/src/llm/openai.ts` (flatten ContentBlock[]), `server/src/llm/prompts.ts` (action codes, stress modifiers, static/dynamic split), `server/src/parsers/simulation.ts` (actionCode extraction, delta removal), `server/src/orchestration/simulationRunner.ts` (physics engine integration, clusterByRole, citizenAgentModel for groups), `server/src/db/repos/agentRepo.ts` (cortisol/dopamine in parseStats/updateStats/bulkUpdateStats)

### ✅ Phase 8: Bug Fixes & UI Features — COMPLETE

**Bugs fixed:**
- Live Feed text overlap: removed `@tanstack/react-virtual` virtualizer (absolute positioning caused text overlap); replaced with simple `.map()` rendering
- Data persistence on refresh: `loadHistory()` now fetches `?full=true` to restore feed, statsHistory, totalIterations, and lifecycle events; session stage check marks simulation as complete on revisit; auto-navigation guarded to only trigger during live simulation

**Features added:**
- Expandable reflection banner in AgentReview: `ReflectionStrip` component with expand/collapse animation (max-height CSS transition), shows full pass1+pass2 in scrollable container
- Society trend line graph: SVG `LineChart` component (`web/src/components/LineChart.tsx`) with zero dependencies; shows avg W/H/Hap across iterations in Reflection screen
- Per-agent stats expand: BarChart2 button per agent in Reflection's Agent Reflections panel; lazy-loads per-agent stats history from new API endpoint; animated expand/collapse with per-agent line charts

**Key new files:** `web/src/components/LineChart.tsx`

**Key modified files:** `server/src/routes/iterations.ts` (`?full=true` query, `/agent-stats` endpoint), `server/src/db/repos/iterationRepo.ts` (`listBySessionFull`), `web/src/stores/simulationStore.ts` (full history restore), `web/src/pages/Simulation.tsx` (removed virtualizer, session stage check, auto-nav guard), `web/src/pages/Reflection.tsx` (society trend graph, per-agent expand), `web/src/pages/AgentReview.tsx` (ReflectionStrip component)

---

## 5. Interface Specifications

### 5.1 Core Data Types (`shared/types.ts`)

```typescript
type Stage = 'idea-input' | 'brainstorming' | 'designing' | 'design-review'
  | 'simulating' | 'reflecting' | 'review' | 'completed';

interface Session {
  id: string;
  title: string;
  idea: string;
  stage: Stage;
  createdAt: string;
  updatedAt: string;
}

interface AgentStats {
  wealth: number;       // 0–100
  health: number;       // 0–100
  happiness: number;    // 0–100
  cortisol: number;     // 0–100, hidden stress level
  dopamine: number;     // 0–100, hidden satisfaction
}

interface Agent {
  id: string;
  sessionId: string;
  name: string;
  role: string;
  background: string;
  initialStats: AgentStats;
  currentStats: AgentStats;
  isAlive: boolean;
  isCentralAgent?: boolean;
  status: string;
  type: string;
  bornAtIteration: number | null;
  diedAtIteration: number | null;
}

interface Iteration {
  id: string;
  sessionId: string;
  number: number;       // 1-based
  narrativeSummary: string;
  timestamp: string;
}

interface AgentAction {
  id: string;
  iterationId: string;
  agentId: string;
  intent: string;
  resolvedOutcome: string;
  wealthDelta: number;
  healthDelta: number;
  happinessDelta: number;
}

type ChatContext = 'brainstorm' | 'refinement' | `review:${string}`;

interface ChatMessage {
  id: string;
  sessionId: string;
  context: ChatContext;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

interface SocietyDesign {
  overview: string;       // Markdown
  lawDocument: string;    // Markdown
  agents: Agent[];
  timeScale: string;
}

interface AgentReflection {
  agentId: string;
  sessionId: string;
  pass1: string;
  pass2?: string;         // Phase 5
}

interface SocietyEvaluation {
  sessionId: string;
  verdict: string;
  strengths: string[];
  weaknesses: string[];
  analysis: string;       // Markdown
}

interface IterationStats {
  iterationNumber: number;
  avgWealth: number;   avgHealth: number;   avgHappiness: number;
  minWealth: number;   maxWealth: number;
  minHealth: number;   maxHealth: number;
  minHappiness: number; maxHappiness: number;
  aliveCount: number;  totalCount: number;
  giniWealth?: number;    // 0=equality, 1=inequality
  giniHappiness?: number;
}

interface AppSettings {
  provider: 'openai-compatible' | 'anthropic';
  apiKey?: string;
  baseUrl?: string;
  centralAgentModel: string;
  citizenAgentModel: string;
  maxConcurrentRequests: number;
}
```

### 5.2 REST API Contract

All endpoints prefixed with `/api`. Bodies are JSON.

**Sessions**

| Method | Endpoint | Body | Response |
|--------|----------|------|----------|
| POST | `/api/sessions` | `{ title, idea }` | `Session` |
| GET | `/api/sessions` | — | `Session[]` |
| GET | `/api/sessions/:id` | — | `Session & { design?, stats? }` |
| DELETE | `/api/sessions/:id` | — | `{}` |
| PATCH | `/api/sessions/:id/stage` | `{ stage }` | `Session` |

**Brainstorm (Stage 1A)** — streaming

| Method | Endpoint | Body | Response |
|--------|----------|------|----------|
| POST | `/api/sessions/:id/brainstorm` | `{ message }` | SSE: `chunk`, `checklist`, `done` |
| GET | `/api/sessions/:id/messages?context=brainstorm` | — | `ChatMessage[]` |

**Design (Stage 1B)** — streaming

| Method | Endpoint | Body | Response |
|--------|----------|------|----------|
| POST | `/api/sessions/:id/design` | — | SSE: `progress`, `design(SocietyDesign)`, `done` |

**Simulation (Stage 2)**

| Method | Endpoint | Body | Response |
|--------|----------|------|----------|
| POST | `/api/sessions/:id/simulate` | `{ iterations }` | `{ ok }` |
| POST | `/api/sessions/:id/simulate/pause` | — | `{ ok }` |
| POST | `/api/sessions/:id/simulate/abort` | — | `{ ok }` |
| GET | `/api/sessions/:id/simulate/stream` | — | SSE (long-lived, see §5.3) |
| GET | `/api/sessions/:id/iterations` | — | `Iteration[]` |
| GET | `/api/sessions/:id/iterations/:num` | — | `Iteration & { actions[] }` |

**Reflection (Stage 3)** — streaming

| Method | Endpoint | Body | Response |
|--------|----------|------|----------|
| POST | `/api/sessions/:id/reflect` | — | SSE: `agent-reflection`, `evaluation`, `done` |

**Review (Stage 4)** — streaming

| Method | Endpoint | Body | Response |
|--------|----------|------|----------|
| POST | `/api/sessions/:id/review/:agentId` | `{ message }` | SSE: `chunk`, `done` |
| GET | `/api/sessions/:id/messages?context=review:<agentId>` | — | `ChatMessage[]` |

**Settings**

| Method | Endpoint | Body | Response |
|--------|----------|------|----------|
| GET | `/api/settings` | — | `AppSettings` |
| PUT | `/api/settings` | `AppSettings` | `AppSettings` |
| POST | `/api/settings/test` | — | `{ ok, model, latencyMs }` |

### 5.3 SSE Event Contract

**Simulation stream** (`GET /api/sessions/:id/simulate/stream`):

| Event | Data | When |
|-------|------|------|
| `iteration-start` | `{ iteration, total }` | Iteration begins |
| `agent-intent` | `{ agentId, agentName, intent }` | Each agent's intent collected |
| `resolution` | `{ iteration, narrativeSummary, actions[] }` | Central Agent resolves |
| `iteration-complete` | `{ iteration, stats: IterationStats }` | Iteration saved |
| `simulation-complete` | `{ finalReport }` | All iterations done |
| `paused` | `{ iteration }` | User paused |
| `error` | `{ message }` | Failure |

**General streaming** (brainstorm, review, reflection):

| Event | Data |
|-------|------|
| `chunk` | `{ text }` |
| `done` | `{}` |

### 5.4 LLM Gateway Interface (`server/llm/gateway.ts`)

```typescript
interface ContentBlock {
  type: 'text';
  text: string;
  cache_control?: { type: 'ephemeral' };  // Anthropic prompt caching
}

interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | ContentBlock[];  // ContentBlock[] enables prompt caching
}

interface LLMOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

interface LLMGateway {
  chat(messages: LLMMessage[], opts?: LLMOptions): Promise<string>;
  chatStream(messages: LLMMessage[], opts?: LLMOptions): AsyncIterable<string>;
  testConnection(): Promise<{ ok: boolean; model: string; latencyMs: number }>;
}
```

Both `openai-compatible` and `anthropic` providers implement this. The orchestration engine only depends on `LLMGateway`, never a specific provider. When `content` is a `ContentBlock[]`, the Anthropic provider passes it directly as the system parameter for prompt caching; other providers flatten to a single string.

### 5.5 Database Repo Interface (`server/db/repos/`)

```typescript
// Base pattern — each repo extends with domain methods
interface SessionRepo {
  create(data: { title: string; idea: string }): Session;
  getById(id: string): Session | null;
  list(): Session[];
  updateStage(id: string, stage: Stage): Session;
  delete(id: string): void;
}

interface AgentRepo {
  bulkCreate(agents: Omit<Agent, 'id'>[]): Agent[];
  listBySession(sessionId: string): Agent[];
  updateStats(id: string, w: number, h: number, ha: number): Agent;
}

interface IterationRepo {
  create(data: Omit<Iteration, 'id'>): Iteration;
  listBySession(sessionId: string): Iteration[];
  getWithActions(iterationId: string): Iteration & { actions: AgentAction[] };
}

interface ChatMessageRepo {
  append(msg: Omit<ChatMessage, 'id'>): ChatMessage;
  listByContext(sessionId: string, context: ChatContext): ChatMessage[];
}
```

### 5.6 Incremental Wiring Strategy

Each phase connects frontend pages to backend services. Pages transition from **mocked → live** by replacing hardcoded data with Zustand store hooks backed by real API calls.

**Phase 1 — Foundation wiring:**

```
vite.config.ts:  proxy { '/api': 'http://localhost:3001' }
package.json:    "dev": "concurrently \"vite\" \"tsx watch server/index.ts\""

SettingsPage ──store──→ api/client ──HTTP──→ /api/settings ──→ config file I/O
HomePage     ──store──→ api/client ──HTTP──→ /api/sessions ──→ session.repo → SQLite

Integration test: create session → appears on home → delete → gone
```

**Phase 2 — Design flow wiring:**

```
IdeaInput    ──store──→ POST /api/sessions { idea } ──→ DB
Brainstorming──store──→ POST /api/sessions/:id/brainstorm
                        → C4 engine → C3 prompts → C2 LLM (stream)
                        ← SSE chunks rendered in chat
DesignReview ──store──→ POST /api/sessions/:id/design
                        → C4 engine → C3 multi-step prompts → C2 LLM
                        ← SSE progress + SocietyDesign → rendered in tabs

Integration test: type idea → brainstorm 3 turns → generate design → see roster
```

**Phase 3 — Simulation wiring:**

```
Simulation   ──store──→ POST /api/sessions/:id/simulate { iterations: 10 }
                        GET  /api/sessions/:id/simulate/stream
                        → C4 runner: for each iteration:
                            C3 intent prompt → C2 LLM (parallel per agent)
                            C6 parse intents
                            C3 resolution prompt → C2 LLM
                            C6 parse resolution → C1 save
                        ← SSE events → store updates → charts, feed, grid

Store state: iterations[], agents[], stats[], isRunning, currentIteration

Integration test: start 5-iteration sim → watch all 5 complete → final report
```

**Phase 4 — Reflection + Review wiring:**

```
Reflection   ──store──→ POST /api/sessions/:id/reflect
                        → C4 pipeline:
                            C3 reflection prompt × N agents (parallel) → C2 LLM
                            C3 evaluation prompt → C2 LLM
                        ← SSE reflections + evaluation → render report

AgentReview  ──store──→ POST /api/sessions/:id/review/:agentId { message }
                        → C3 review prompt (full agent context) → C2 LLM (stream)
                        ← SSE chunks → chat bubbles

Session lifecycle (each transition calls PATCH /api/sessions/:id/stage):
  HomePage → IdeaInput → Brainstorming → DesignReview
           → Simulation → Reflection → AgentReview → completed

Integration test: full Stage 0 → completed lifecycle in one flow
```
