# Ideal World — Project Design

This document defines the complete technical architecture, data models, component design, and implementation strategy for Ideal World, a multi-agent society simulation platform. It is the engineering counterpart to [USER_FLOW.md](./USER_FLOW.md), which describes the user-facing experience.

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Architecture](#2-architecture)
3. [Tech Stack](#3-tech-stack)
4. [Data Models](#4-data-models)
5. [Central Agent Design](#5-central-agent-design)
6. [Citizen Agent Design](#6-citizen-agent-design)
7. [Stage-by-Stage Implementation](#7-stage-by-stage-implementation)
8. [Prompt Engineering](#8-prompt-engineering)
9. [Concurrency & Orchestration](#9-concurrency--orchestration)
10. [Data Persistence Layer](#10-data-persistence-layer)
11. [Frontend Architecture](#11-frontend-architecture)
12. [API Design](#12-api-design)
13. [Error Handling & Resilience](#13-error-handling--resilience)
14. [Cost Management](#14-cost-management)
15. [Security Considerations](#15-security-considerations)
16. [Testing Strategy](#16-testing-strategy)
17. [Development Phases & Milestones](#17-development-phases--milestones)

---

## 1. System Overview

Ideal World is a local-first web application that allows users to design hypothetical societies and simulate them using LLM-powered agents. The system runs entirely on the user's machine — a local backend server handles orchestration and data storage, while a web UI provides the user interface.

The system has two types of agents:

- **Central Agent:** A meta-agent that facilitates brainstorming, designs the society, resolves agent interactions, adjudicates stat changes, manages agent lifecycle events, summarizes simulation iterations, and generates evaluation reports. There is exactly one Central Agent per session.
- **Citizen Agents:** Individual agents that each represent a person in the simulated society. Each has a unique background, personality, and starting conditions. A session can have 20–150 Citizen Agents. Citizen Agents declare *intentions* — the Central Agent determines *outcomes*.

The simulation runs for a user-specified number of iterations (1–100). Each iteration uses a two-phase model:
1. **Intent Phase:** All Citizen Agents independently declare what they intend to do.
2. **Resolution Phase:** The Central Agent reads all intentions, resolves interactions and conflicts, assigns stat changes, and manages lifecycle events (deaths, births, role changes).

---

## 2. Architecture

### 2.1 High-Level Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                         WEB UI (Browser)                          │
│  React + TypeScript                                               │
│  ┌──────────┐  ┌──────────┐  ┌───────────┐  ┌───────────────┐   │
│  │ Home Page│  │Chat View │  │Simulation │  │ Artifacts     │   │
│  │          │  │(Stage 0, │  │Dashboard  │  │ Page          │   │
│  │          │  │ 1, 4)    │  │(Stage 2)  │  │               │   │
│  └──────────┘  └──────────┘  └───────────┘  └───────────────┘   │
│                          │                                        │
│              ┌───────────▼───────────┐                            │
│              │  State Management     │                            │
│              │  (Zustand Slices)     │                            │
│              └───────────────────────┘                            │
└──────────────────────────┬───────────────────────────────────────┘
                           │ HTTP / SSE
┌──────────────────────────▼───────────────────────────────────────┐
│                    LOCAL BACKEND SERVER                            │
│  Node.js + Express (TypeScript)                                   │
│  ┌───────────────────────────────────────┐                        │
│  │         Orchestration Engine           │                        │
│  │  ┌─────────┐  ┌────────────────────┐  │                        │
│  │  │ Session  │  │  Agent Runner      │  │                        │
│  │  │ Manager  │  │  (Intent→Resolve)  │  │                        │
│  │  └─────────┘  └────────────────────┘  │                        │
│  └───────────────┬───────────────────────┘                        │
│                  │                                                 │
│  ┌───────────────▼───────────────────┐  ┌──────────────────────┐  │
│  │       LLM Gateway                 │  │  SQLite Database     │  │
│  │  Rate limiting, retries,          │  │  (Session storage,   │  │
│  │  prompt construction, response    │  │   agent data,        │  │
│  │  parsing, provider abstraction    │  │   iteration records) │  │
│  └───────────────┬───────────────────┘  └──────────────────────┘  │
└──────────────────┼────────────────────────────────────────────────┘
                   │ API Calls
┌──────────────────▼──────────────────────────────────────────────┐
│                   LLM PROVIDER (configurable)                    │
│  Option A: Local LLM via LM Studio / Ollama (no internet)       │
│  Option B: Claude API (cloud, Anthropic)                         │
│  Option C: OpenAI-compatible API (any provider)                  │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 Local-First Principles

- **No cloud dependency for core functionality:** The application runs entirely on the user's machine. The only external calls are to the LLM provider, which can also be local (LM Studio, Ollama).
- **No account or authentication required:** The app is single-user by design.
- **Data sovereignty:** All session data stays on the user's filesystem in a SQLite database. Nothing is uploaded.
- **Portable:** Sessions can be exported as JSON files and imported on another machine.

### 2.3 LLM Provider Abstraction

The LLM Gateway implements a provider-agnostic interface:

```typescript
interface LLMProvider {
  complete(prompt: LLMPrompt): Promise<LLMResponse>;
  stream(prompt: LLMPrompt): AsyncIterable<string>;
  estimateTokens(text: string): number;
}
```

Supported providers:
- **Local (LM Studio / Ollama):** Connects to `http://localhost:1234/v1` (or configurable URL). Uses the OpenAI-compatible API that LM Studio and Ollama expose. No API key needed. No cost per token.
- **Claude API:** Uses the Anthropic SDK. Requires an API key. Supports streaming and structured output.
- **OpenAI-compatible API:** Any provider that implements the OpenAI chat completions API. Configurable base URL and API key.

The user selects their provider and model in a settings page. Different models can be assigned to the Central Agent vs. Citizen Agents (e.g., a powerful model for the Central Agent, a cheaper/faster model for Citizen Agents).

---

## 3. Tech Stack

| Layer | Technology | Rationale |
|---|---|---|
| **Frontend** | React 18+ with TypeScript | Component-based UI, strong ecosystem, TypeScript for type safety. |
| **Styling** | Tailwind CSS | Rapid UI development, utility-first approach. |
| **State Management** | Zustand (domain slices) | Lightweight, minimal boilerplate. Split into independent stores per domain (session, brainstorm, simulation, review, comparison) to avoid unnecessary re-renders. |
| **Backend** | Node.js + Express (TypeScript) | Shared language with frontend for code reuse (data models, validators). |
| **Database** | SQLite (via better-sqlite3) | Zero-config, file-based, ACID-compliant. No separate database server. Handles the full data volume without size limits. |
| **ORM/Query** | Drizzle ORM | Type-safe SQL queries, lightweight, works well with SQLite. |
| **LLM Integration** | Provider-agnostic gateway | Supports LM Studio (local), Anthropic SDK (Claude), and OpenAI-compatible APIs. |
| **Real-time Updates** | Server-Sent Events (SSE) | One-way streaming from backend to frontend during simulation. Simpler than WebSocket. |
| **Build Tool** | Vite | Fast development server, optimized production builds. |
| **Testing** | Vitest + React Testing Library + Playwright | Unit, component, and E2E testing. |
| **Charting** | Recharts | React-native charting for simulation statistics. |
| **Monorepo** | Turborepo or npm workspaces | Shared packages (data models, validators) between frontend and backend. |

---

## 4. Data Models

### 4.1 Session

```typescript
interface Session {
  id: string;                          // UUID v4
  name: string;                        // User-provided or auto-generated
  seedIdea: string;                    // Original user input from Stage 0
  stage: SessionStage;                 // Current stage
  config: SimulationConfig;            // Simulation parameters
  law: string;                         // Virtual Law Document (markdown)
  societyOverview: string;             // Society Overview Document (markdown)
  timeScale: string;                   // e.g., "1 iteration = 1 month"
  societyEvaluation: string;           // Society Evaluation Report (markdown)
  createdAt: string;                   // ISO 8601 timestamp
  updatedAt: string;                   // ISO 8601 timestamp
  completedAt: string | null;          // ISO 8601 timestamp or null
}

type SessionStage =
  | 'idea-input'          // Stage 0
  | 'brainstorming'       // Stage 1A
  | 'designing'           // Stage 1B (in progress)
  | 'design-review'       // Stage 1B (complete, awaiting user)
  | 'refining'            // Stage 1C (user editing design via chat)
  | 'simulating'          // Stage 2 (in progress)
  | 'simulation-paused'   // Stage 2 (paused by user)
  | 'reflecting'          // Stage 3 (in progress)
  | 'reflection-complete' // Stage 3 (complete)
  | 'reviewing'           // Stage 4
  | 'completed';          // Session finalized

interface SimulationConfig {
  totalIterations: number;             // User-specified (1-100)
  completedIterations: number;         // Progress tracker
  agentCount: number;                  // Current number of living Citizen Agents
  initialAgentCount: number;           // Original count at simulation start
  centralAgentModel: string;           // Model ID for Central Agent
  citizenAgentModel: string;           // Model ID for Citizen Agents
}
```

### 4.2 Agent

```typescript
interface AgentDefinition {
  id: string;                          // UUID v4
  sessionId: string;                   // FK to session
  name: string;                        // Agent's in-world name
  role: string;                        // Their societal role
  background: string;                  // Full system prompt / backstory
  initialStats: AgentStats;            // Starting values
  currentStats: AgentStats;            // Current values (set by Central Agent)
  type: 'central' | 'citizen';        // Agent type
  status: AgentStatus;                 // Lifecycle status
  bornAtIteration: number;             // 0 for original agents, >0 for born-during-sim
  diedAtIteration: number | null;      // null if alive
  roleHistory: RoleChange[];           // Track role changes over time
}

type AgentStatus = 'alive' | 'incapacitated' | 'dead';

interface RoleChange {
  fromRole: string;
  toRole: string;
  atIteration: number;
  reason: string;
}

interface AgentStats {
  wealth: number;                      // 0-100
  health: number;                      // 0-100
  happiness: number;                   // 0-100
}
```

### 4.3 Agent Intent & Resolved Action

```typescript
// What the agent WANTS to do (Step A output)
interface AgentIntent {
  id: string;
  agentId: string;
  sessionId: string;
  iterationNumber: number;
  intendedActions: string;             // What they plan to do
  desiredInteractions: string;         // Who they want to interact with and how
  goals: string;                       // What they hope to achieve
  internalThoughts: string;            // Private thoughts (not shared with other agents)
}

// What ACTUALLY happened (Central Agent resolution, Step B output)
interface ResolvedAction {
  id: string;
  agentId: string;
  sessionId: string;
  iterationNumber: number;
  resolvedOutcome: string;             // What the Central Agent determined happened
  resolvedInteractions: string;        // How interactions were matched/resolved
  statChanges: {
    wealth: { before: number; after: number; reason: string };
    health: { before: number; after: number; reason: string };
    happiness: { before: number; after: number; reason: string };
  };
}
```

### 4.4 Iteration

```typescript
interface IterationRecord {
  id: string;
  sessionId: string;
  iterationNumber: number;             // 1-indexed
  stateSummary: string;                // Central Agent's narrative summary
  statistics: IterationStatistics;     // Aggregate stats
  lifecycleEvents: LifecycleEvent[];   // Deaths, births, role changes
  timestamp: string;                   // ISO 8601
}

interface IterationStatistics {
  populationCount: number;             // Living agents
  avgWealth: number;
  avgHealth: number;
  avgHappiness: number;
  minWealth: number;
  maxWealth: number;
  minHealth: number;
  maxHealth: number;
  minHappiness: number;
  maxHappiness: number;
  wealthDistribution: number[];        // Histogram buckets (10 buckets of 10)
  healthDistribution: number[];
  happinessDistribution: number[];
  wealthGini: number;                  // Gini coefficient for inequality
}

interface LifecycleEvent {
  type: 'death' | 'birth' | 'role-change';
  agentId: string;
  agentName: string;
  details: string;                     // Narrative explanation
  newRole?: string;                    // For role-change events
}
```

### 4.5 Reflections

```typescript
interface AgentReflection {
  id: string;
  agentId: string;
  sessionId: string;

  // Pass 1: Personal-only reflection
  personalReflection: string;          // Full text
  personalAssessment: string;          // How they fared
  behaviorJustification: string;       // Why they behaved as they did
  societyCritique: string;             // Their view on the society
  suggestions: string;                 // What they'd change

  // Pass 2: Post-briefing addendum
  postBriefingAddendum: string;        // Reaction to Final State Report
  perspectiveShift: string;            // What changed after seeing the big picture
}
```

### 4.6 Conversations

```typescript
interface ChatMessage {
  id: string;
  sessionId: string;
  context: ConversationContext;         // Which conversation this belongs to
  agentId: string | null;              // For agent-specific conversations (Stage 4)
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

type ConversationContext =
  | 'brainstorming'      // Stage 1A
  | 'refinement'         // Stage 1C
  | 'review'             // Stage 4 (per-agent)
  | 'comparison';        // Cross-session
```

### 4.7 Artifacts

```typescript
interface Artifact {
  id: string;
  sessionId: string;
  type: ArtifactType;
  title: string;
  content: string;                     // Markdown content
  generatedAt: SessionStage;           // Which stage produced it
  timestamp: string;
  relatedAgentId?: string;             // For agent-specific artifacts
  iterationNumber?: number;            // For iteration-specific artifacts
}

type ArtifactType =
  | 'brainstorming-transcript'
  | 'society-overview'
  | 'agent-roster'
  | 'virtual-law'
  | 'refinement-transcript'
  | 'iteration-summary'
  | 'final-state-report'
  | 'agent-personal-reflection'
  | 'agent-post-briefing'
  | 'society-evaluation'
  | 'qa-transcript'
  | 'cross-session-comparison';
```

---

## 5. Central Agent Design

The Central Agent is the orchestrator of the simulation. It has multiple responsibilities across different stages, each requiring a distinct system prompt and instruction set. Critically, the Central Agent is the **sole authority** on stat changes and lifecycle events — Citizen Agents declare intentions, but the Central Agent determines outcomes.

### 5.1 Responsibilities by Stage

| Stage | Responsibility | Input | Output |
|---|---|---|---|
| 1A | Brainstorm with user | User's seed idea + conversation history | Clarifying questions, suggestions, completeness assessment |
| 1B | Design the society | Full brainstorming transcript | Agent roster, Virtual Law Document, Society Overview, time scale |
| 1C | Refine the design | User's change requests + current design | Updated agents, law, or overview |
| 2 (resolve) | Resolve intents + assign stats | All agent intents for one iteration | Resolved actions, stat assignments, lifecycle events, narrative summary |
| 2 (end) | Final State Report | All iteration summaries | Comprehensive trajectory report |
| 3 | Society Evaluation | All agent reflections (both passes) + Final State Report | Pros/cons synthesis with perspective shift analysis |
| 4 | Answer user questions | All generated documents + Q&A history | In-character responses about the simulation |
| Cross | Compare sessions | Final reports from multiple sessions | Comparison analysis |

### 5.2 System Prompt Structure

The Central Agent's system prompt is recomposed for each stage. The base structure:

```
You are the Central Agent of Ideal World, a society simulation platform.
Your role is to [STAGE-SPECIFIC ROLE].

## Context
[SESSION-SPECIFIC CONTEXT: society description, current state, etc.]

## Instructions
[STAGE-SPECIFIC INSTRUCTIONS]

## Output Format
[STAGE-SPECIFIC FORMAT REQUIREMENTS]
```

### 5.3 Brainstorming Completeness Checklist

During Stage 1A, the Central Agent internally tracks whether the following topics have been sufficiently discussed:

```typescript
interface BrainstormingChecklist {
  governanceModel: boolean;       // Who governs, how decisions are made
  economicSystem: boolean;        // Production, distribution, trade
  socialStructure: boolean;       // Classes, roles, mobility
  legalFramework: boolean;        // Laws, enforcement, penalties
  culturalNorms: boolean;         // Values, taboos, traditions
  environment: boolean;           // Resources, geography, technology level
  conflictResolution: boolean;    // How disputes are handled
  externalFactors: boolean;       // Isolation, neighbors, natural events
}
```

The Central Agent is prompted to assess completeness after each user message. When all (or most) topics are covered, it suggests the user proceed.

### 5.4 Design Generation Strategy

During Stage 1B, the Central Agent generates the society design in multiple sequential LLM calls to manage context and quality:

1. **Call 1 — Society Overview + Time Scale:** Generate the high-level society description. The Central Agent determines the appropriate time scale (e.g., "1 iteration = 1 month") based on the society type.
2. **Call 2 — Virtual Law Document:** Generate the law document, referencing the overview. The time scale is stated prominently.
3. **Call 3 — Agent Roster (roles and count):** Determine how many agents and what roles are needed.
4. **Calls 4–N — Agent Backgrounds:** Generate detailed backgrounds in batches of 10–20 agents per call, ensuring diversity and internal consistency.
5. **Call N+1 — Initial Stats:** Assign initial wealth, health, and happiness to each agent based on their role and background.

Each call includes the outputs of previous calls to maintain coherence.

### 5.5 Intent Resolution Strategy

During Stage 2, the Central Agent resolves all agent intents in a structured process:

1. **Read all intents:** The Central Agent receives all Citizen Agent intents for the iteration.
2. **Match interactions:** Identify compatible intent pairs (e.g., both agents want to trade with each other).
3. **Resolve conflicts:** Determine outcomes when intents conflict (e.g., two agents want the same scarce resource).
4. **Enforce laws:** Check actions against the Virtual Law Document. Note violations and determine consequences.
5. **Assign stats:** Based on resolved outcomes, set each agent's new wealth, health, and happiness. Provide reasoning for each change.
6. **Lifecycle events:** Determine if any agents die (health 0 for 2+ iterations), if new agents should be introduced, or if any agents' roles should change.
7. **Narrate:** Produce the iteration summary combining all of the above.

For large agent counts (>50), this resolution step uses the hierarchical map-reduce approach (see Section 8.2).

### 5.6 Design Refinement

During Stage 1C, the Central Agent processes user change requests:

1. Parse the user's request to identify which artifacts need modification (agents, law, overview).
2. Regenerate only the affected parts, keeping everything else intact.
3. Validate that changes don't create inconsistencies (e.g., removing a role that the law references).
4. Return the updated artifacts for re-rendering.

---

## 6. Citizen Agent Design

### 6.1 Agent Identity

Each Citizen Agent is an LLM call with a carefully constructed prompt. The agent has no persistent memory beyond what is provided in the prompt — all "memory" comes from the context window. Citizen Agents declare *intentions*, not outcomes. They never set their own stats.

### 6.2 Intent Prompt Template

```
You are {agent.name}, a {agent.role} in a simulated society.

## Your Background
{agent.background}

## Your Current State
- Wealth: {agent.currentStats.wealth}/100
- Health: {agent.currentStats.health}/100
- Happiness: {agent.currentStats.happiness}/100

## The Law of This Society
{session.law}

## Time Scale
Each iteration represents {session.timeScale} of in-world time.

## Current State of Society
{previousIterationSummary OR "This is the first day of this society."}

## Instructions
You are living in this society. Based on your background, personality, and
current circumstances, describe what you INTEND to do during this period.

Important: You are declaring your INTENTIONS, not outcomes. The Central Agent
will determine what actually happens based on everyone's intentions combined.

Consider:
- How do you plan to earn or spend resources?
- Who do you want to interact with and why? (Name specific people.)
- Do you plan to follow or break any laws? Why?
- What are your goals for this period?

Do NOT assign yourself new stat numbers. The Central Agent will determine
your updated stats based on the outcomes of everyone's actions.

## Output Format
Respond with a JSON object:
{
  "intendedActions": "What you plan to do this period...",
  "desiredInteractions": "Who you want to interact with and how...",
  "goals": "What you hope to achieve...",
  "internalThoughts": "Your private thoughts and feelings..."
}
```

### 6.3 Agent Consistency

To ensure agents behave consistently with their defined personality:
- The background/system prompt is always included in full — it is never summarized or truncated.
- The agent's own resolved outcome history from previous iterations is included (summarized if the context window is too long).
- Agents do NOT see other agents' internal thoughts — only the Central Agent's public summary.
- Agents see their own stats as set by the Central Agent after the previous iteration.

### 6.4 Stat Boundaries & Lifecycle

- Stats are clamped to 0–100 by the Central Agent during resolution.
- If an agent's health reaches 0, they are marked as "incapacitated." Their intent prompt includes this constraint.
- If an agent's health remains at 0 for 2 consecutive iterations, the Central Agent may declare them dead. Dead agents no longer participate in future iterations but can be questioned in Stage 4.
- The Central Agent may introduce new agents (births, immigration) or change agent roles based on narrative developments. New agents receive a background generated by the Central Agent consistent with the society's current state.

---

## 7. Stage-by-Stage Implementation

### 7.1 Stage 0 — Idea Input

**Frontend:**
- Simple form with a textarea and submit button.
- Example prompts as clickable chips.
- On submit: call backend to create a new session, navigate to Stage 1A.

**Backend:**
- `POST /api/sessions` — Creates session record in SQLite, returns session ID.

### 7.2 Stage 1A — Brainstorming

**Frontend:**
- Chat interface (message list + input box).
- "Start Design" button appears when the Central Agent suggests it.
- Override warning modal if user clicks "Start Design" prematurely.

**Backend / Orchestration:**
- Each user message triggers an LLM call with the Central Agent's brainstorming prompt.
- The completeness checklist is evaluated in each response (the LLM is instructed to include a hidden JSON block with checklist status).
- Conversation history is appended to the prompt for each call.
- Streaming is used for real-time response display.

### 7.3 Stage 1B — Society Design

**Frontend:**
- Progress indicator with steps: "Creating Overview..." → "Drafting Laws..." → "Designing Agents..." → "Complete."
- Rendered documents (markdown viewer).

**Backend / Orchestration:**
- Sequential LLM calls as described in Section 5.4.
- Each generated document is parsed, validated, and stored in SQLite.
- Agent roster is validated for: unique names, valid roles, stats within range.
- Time scale is extracted and stored in the session config.

### 7.4 Stage 1C — Design Refinement

**Frontend:**
- Refinement chat appears below the generated design.
- Design panels re-render after each accepted change.
- Iteration count input + "Start Simulation" button appear when user is ready.

**Backend / Orchestration:**
- User messages are sent to the Central Agent with the current design as context.
- The Central Agent identifies which artifacts need changes and regenerates them.
- Changes are applied atomically — either all affected artifacts update or none do.
- Each change is logged in the refinement transcript artifact.

### 7.5 Stage 2 — Simulation

**Frontend:**
- Simulation dashboard with progress bar, live feed, statistics panel, agent grid.
- Pause/abort controls.
- Agent detail modal (click on agent to see their intent/outcome history).
- Population tracker showing births, deaths, and role changes.

**Backend / Orchestration:**
- For each iteration:
  1. Construct intent prompts for all living Citizen Agents.
  2. Send all intent prompts **concurrently** (with rate limiting).
  3. Collect and parse all intent responses.
  4. Send all intents to the Central Agent for resolution (using map-reduce if >50 agents, see Section 8.2).
  5. Parse the Central Agent's resolution: extract per-agent stat changes, lifecycle events, and narrative.
  6. Update agent records in SQLite (stats, status, role changes).
  7. Insert new agents if the Central Agent created any.
  8. Save iteration record.
  9. Push update to frontend via SSE.
- Repeat for all iterations.
- After all iterations: generate Final State Report (using hierarchical summarization for many iterations).

### 7.6 Stage 3 — Reflection

**Backend / Orchestration:**
1. **Pass 1:** Construct personal reflection prompts for all Citizen Agents (includes their intent/outcome history, NO Final State Report). Send concurrently.
2. Collect and store Pass 1 reflections.
3. **Pass 2:** Construct post-briefing prompts for all Citizen Agents (includes their Pass 1 reflection + Final State Report). Send concurrently.
4. Collect and store Pass 2 addenda.
5. Send all reflections (both passes) to the Central Agent for the Society Evaluation (using map-reduce if needed).
6. Store the Society Evaluation.

**Frontend:**
- Summary page with Society Evaluation, agent reflection list (both passes), and charts.

### 7.7 Stage 4 — Agent Review

**Frontend:**
- Agent selection panel (sidebar). Dead agents listed separately with marker.
- Chat interface per agent.
- "End Session" button.

**Backend / Orchestration:**
- Each user message to an agent triggers an LLM call with:
  - The agent's system prompt + background.
  - Their complete intent/outcome history and both reflection passes.
  - The Final State Report (for context).
  - The Q&A conversation history.
- Streaming responses.
- Dead agents respond in past tense, acknowledging their death.

---

## 8. Prompt Engineering

### 8.1 Prompt Design Principles

1. **Intent-only for agents:** Citizen Agents declare intentions, never outcomes. This prevents self-serving stat manipulation and ensures narrative coherence.
2. **Structured output:** All responses use JSON format with defined schemas. This enables reliable parsing.
3. **Role consistency:** System prompts are detailed and specific. Agents are repeatedly reminded of their identity and constraints.
4. **Context management:** Only relevant context is included in each prompt. Irrelevant history is summarized or omitted.
5. **Bounded creativity:** Agents are instructed to be creative within the bounds of their character and the society's rules.
6. **Temporal grounding:** The time scale is included in every prompt so agents and the Central Agent share a consistent temporal frame.

### 8.2 Hierarchical Map-Reduce for Large Context

When the input exceeds the context window (e.g., 100 agent intents for resolution, or 50 iteration summaries for the Final Report), the system uses a two-level hierarchy:

**For Iteration Resolution (>50 agents):**
```
All 100 agent intents
    ├── Group 1 (agents 1-25)  → Central Agent Sub-Resolution 1
    ├── Group 2 (agents 26-50) → Central Agent Sub-Resolution 2
    ├── Group 3 (agents 51-75) → Central Agent Sub-Resolution 3
    └── Group 4 (agents 76-100)→ Central Agent Sub-Resolution 4
                                         │
                   All 4 sub-resolutions + cross-group interactions
                                         │
                                         ▼
                        Central Agent Final Resolution
                     (merges, resolves cross-group conflicts,
                      produces unified summary + stat assignments)
```

Grouping strategy: Agents are grouped by **social proximity** (agents who interact frequently are placed in the same group) to minimize cross-group interactions. A simple heuristic: group by role clusters (all farmers together, all merchants together, etc.) since same-role agents are likely to interact.

**For Final State Report (>20 iterations):**
```
50 iteration summaries
    ├── Arc 1 (iterations 1-10)  → Arc Summary 1
    ├── Arc 2 (iterations 11-20) → Arc Summary 2
    ├── Arc 3 (iterations 21-30) → Arc Summary 3
    ├── Arc 4 (iterations 31-40) → Arc Summary 4
    └── Arc 5 (iterations 41-50) → Arc Summary 5
                                          │
                        All 5 arc summaries
                                          │
                                          ▼
                          Final State Report
```

**For Society Evaluation (>50 reflections):**
Same pattern — group reflections by role/demographic, produce sub-evaluations, then merge.

### 8.3 Prompt Size Management

| Scenario | Strategy |
|---|---|
| Agent intent (early iterations) | Full context — background + law + previous summary. Fits easily. |
| Agent intent (later iterations) | Background + law + last 3 iteration summaries + condensed earlier history. |
| Central Agent resolution | All intents for this iteration. Use map-reduce if >50 agents. |
| Central Agent Final Report | All iteration summaries. Use hierarchical arc summaries if >20 iterations. |
| Agent reflection Pass 1 | Background + condensed intent/outcome history. No Final State Report. |
| Agent reflection Pass 2 | Pass 1 reflection + Final State Report. |
| Central Agent evaluation | All reflections (both passes). Use map-reduce if >50 agents. |

### 8.4 Output Parsing

- All LLM responses are expected in JSON format (where structured output is needed).
- A JSON schema validator checks each response.
- If parsing fails, the response is retried once with an explicit correction prompt.
- If retry fails, the raw text is stored and the Central Agent is instructed to work with it as-is.

---

## 9. Concurrency & Orchestration

### 9.1 Two-Phase Iteration Model

Each iteration has two sequential phases. The intent phase is parallel; the resolution phase is serial.

```
Iteration i:
  INTENT PHASE (parallel):
    ├── Agent 1 ─────────→ Intent 1 ──┐
    ├── Agent 2 ─────────→ Intent 2 ──┤
    ├── Agent 3 ─────────→ Intent 3 ──┤
    │   ...                            ├──→ Collect all intents
    └── Agent N ─────────→ Intent N ──┘
                                       │
  RESOLUTION PHASE (serial or map-reduce):
    Central Agent resolves all intents
    → Stat assignments + lifecycle events + narrative
    → Save iteration record
    → Push SSE update
```

### 9.2 Rate Limiting

LLM APIs have rate limits (requests per minute, tokens per minute). The orchestration engine implements:

- **Concurrency pool:** Maximum concurrent requests (configurable, default: 10 for cloud APIs, higher for local LLMs).
- **Token budget:** Track tokens per minute and throttle when approaching limits.
- **Backoff:** Exponential backoff on 429 (rate limit) responses.
- **Queue:** A priority queue ensures the Central Agent's requests are processed before Citizen Agent requests when contention exists.
- **Local LLM mode:** When using LM Studio/Ollama, concurrency is typically limited to 1 (single GPU), so agents are processed sequentially. This is slower but free.

### 9.3 Orchestration Engine

```typescript
class OrchestrationEngine {
  private llmGateway: LLMGateway;
  private concurrencyPool: ConcurrencyPool;
  private db: Database;

  async runIteration(
    session: Session,
    iterationNumber: number
  ): Promise<IterationRecord> {
    // 1. Get all living agents
    const agents = await this.db.getLivingAgents(session.id);

    // 2. Build intent prompts for all agents
    const intentPrompts = this.buildIntentPrompts(session, agents, iterationNumber);

    // 3. Execute all intent prompts concurrently (with rate limiting)
    const intents = await this.concurrencyPool.executeAll(
      intentPrompts.map(p => () => this.llmGateway.complete(p))
    );

    // 4. Parse and store intent responses
    const parsedIntents = intents.map(i => this.parseAgentIntent(i));
    await this.db.saveIntents(parsedIntents);

    // 5. Resolution: Central Agent resolves all intents
    let resolution: ResolutionResult;
    if (agents.length > 50) {
      resolution = await this.resolveWithMapReduce(session, parsedIntents, iterationNumber);
    } else {
      resolution = await this.resolveDirectly(session, parsedIntents, iterationNumber);
    }

    // 6. Apply resolved stat changes to agents
    await this.db.applyStatChanges(resolution.agentUpdates);

    // 7. Apply lifecycle events
    await this.db.applyLifecycleEvents(resolution.lifecycleEvents);

    // 8. Compute statistics
    const stats = this.computeStatistics(resolution.agentUpdates);

    // 9. Save and return iteration record
    const record = {
      sessionId: session.id,
      iterationNumber,
      stateSummary: resolution.narrative,
      statistics: stats,
      lifecycleEvents: resolution.lifecycleEvents,
    };
    await this.db.saveIteration(record);
    return record;
  }
}
```

---

## 10. Data Persistence Layer

### 10.1 Storage Architecture

```
┌──────────────────────────────────────────┐
│             Persistence API               │
│  SessionRepo / AgentRepo / IterationRepo  │
│  ArtifactRepo / ConversationRepo          │
└──────────────────┬───────────────────────┘
                   │
        ┌──────────▼──────────┐
        │     SQLite Database  │
        │   (local filesystem) │
        │   ideal-world.db     │
        └─────────────────────┘
```

### 10.2 SQLite Schema

```sql
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  seed_idea TEXT NOT NULL,
  stage TEXT NOT NULL,
  law TEXT,
  society_overview TEXT,
  time_scale TEXT,
  society_evaluation TEXT,
  total_iterations INTEGER DEFAULT 0,
  completed_iterations INTEGER DEFAULT 0,
  initial_agent_count INTEGER DEFAULT 0,
  central_agent_model TEXT,
  citizen_agent_model TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE TABLE agents (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  background TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('central', 'citizen')),
  status TEXT NOT NULL DEFAULT 'alive' CHECK (status IN ('alive', 'incapacitated', 'dead')),
  initial_wealth REAL NOT NULL,
  initial_health REAL NOT NULL,
  initial_happiness REAL NOT NULL,
  current_wealth REAL NOT NULL,
  current_health REAL NOT NULL,
  current_happiness REAL NOT NULL,
  born_at_iteration INTEGER NOT NULL DEFAULT 0,
  died_at_iteration INTEGER,
  created_at TEXT NOT NULL
);

CREATE TABLE agent_intents (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  iteration_number INTEGER NOT NULL,
  intended_actions TEXT NOT NULL,
  desired_interactions TEXT NOT NULL,
  goals TEXT NOT NULL,
  internal_thoughts TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE resolved_actions (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  iteration_number INTEGER NOT NULL,
  resolved_outcome TEXT NOT NULL,
  resolved_interactions TEXT NOT NULL,
  wealth_before REAL NOT NULL,
  wealth_after REAL NOT NULL,
  wealth_reason TEXT NOT NULL,
  health_before REAL NOT NULL,
  health_after REAL NOT NULL,
  health_reason TEXT NOT NULL,
  happiness_before REAL NOT NULL,
  happiness_after REAL NOT NULL,
  happiness_reason TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE iterations (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  iteration_number INTEGER NOT NULL,
  state_summary TEXT NOT NULL,
  statistics_json TEXT NOT NULL,
  lifecycle_events_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(session_id, iteration_number)
);

CREATE TABLE reflections (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  personal_reflection TEXT NOT NULL,
  personal_assessment TEXT NOT NULL,
  behavior_justification TEXT NOT NULL,
  society_critique TEXT NOT NULL,
  suggestions TEXT NOT NULL,
  post_briefing_addendum TEXT,
  perspective_shift TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE chat_messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  context TEXT NOT NULL,
  agent_id TEXT,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE artifacts (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  generated_at_stage TEXT NOT NULL,
  related_agent_id TEXT,
  iteration_number INTEGER,
  created_at TEXT NOT NULL
);

CREATE TABLE role_changes (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  from_role TEXT NOT NULL,
  to_role TEXT NOT NULL,
  at_iteration INTEGER NOT NULL,
  reason TEXT NOT NULL
);

-- Indexes for common queries
CREATE INDEX idx_agents_session ON agents(session_id);
CREATE INDEX idx_intents_session_iter ON agent_intents(session_id, iteration_number);
CREATE INDEX idx_resolved_session_iter ON resolved_actions(session_id, iteration_number);
CREATE INDEX idx_iterations_session ON iterations(session_id);
CREATE INDEX idx_messages_session_context ON chat_messages(session_id, context);
CREATE INDEX idx_artifacts_session ON artifacts(session_id);
CREATE INDEX idx_reflections_session ON reflections(session_id);
```

### 10.3 Data Access Patterns

| Operation | Frequency | Notes |
|---|---|---|
| Save session metadata | After each stage transition | Small payload, single row update. |
| Save agent intents (batch) | After each iteration intent phase | One INSERT per living agent. Use transaction for atomicity. |
| Save resolved actions (batch) | After each iteration resolution | One INSERT per living agent. Transaction. |
| Save iteration record | After each iteration | Single row with JSON blobs for statistics and lifecycle events. |
| Load session + agents | On session resume | Two queries. Agents loaded eagerly since they're needed for most views. |
| Load iteration details | On demand (user clicks iteration) | Query by session_id + iteration_number. Lazy loaded. |
| List all sessions | On Home Page load | Metadata only, no JOINs. |
| Export session | On user request | Multi-table JOIN, serialized as JSON. |

### 10.4 Lazy Loading

- Session list shows only session table metadata.
- Agent roster is loaded when entering Stage 1B/1C review or Stage 4.
- Iteration records, intents, and resolved actions are loaded on demand.
- Chat messages are loaded per-context when the user opens a conversation.

---

## 11. Frontend Architecture

### 11.1 Page / Route Structure

```
/                           → Home Page (session list)
/session/new                → Stage 0 (Idea Input)
/session/:id/brainstorm     → Stage 1A (Brainstorming Chat)
/session/:id/design         → Stage 1B (Design Review)
/session/:id/refine         → Stage 1C (Design Refinement)
/session/:id/simulate       → Stage 2 (Simulation Dashboard)
/session/:id/reflect        → Stage 3 (Reflection Summary)
/session/:id/review         → Stage 4 (Agent Q&A)
/session/:id/artifacts      → Artifacts Page
/compare                    → Cross-Session Comparison
/settings                   → LLM Provider & Model Configuration
```

### 11.2 Component Hierarchy

```
App
├── HomePage
│   ├── SessionList
│   │   └── SessionCard (×N)
│   ├── NewSessionButton
│   └── CompareButton
├── IdeaInputPage
│   ├── IdeaTextArea
│   └── ExamplePrompts
├── BrainstormPage
│   ├── ChatMessageList
│   │   └── ChatBubble (×N)
│   ├── ChatInput
│   └── StartDesignButton
├── DesignReviewPage
│   ├── SocietyOverviewPanel
│   ├── AgentRosterTable
│   │   └── AgentRow (×N)
│   ├── LawDocumentViewer
│   └── ProceedToRefineButton
├── RefinementPage
│   ├── DesignPanels (read-only, re-renders on change)
│   ├── RefinementChat
│   │   ├── ChatMessageList
│   │   └── ChatInput
│   ├── IterationCountInput
│   └── StartSimulationButton
├── SimulationDashboard
│   ├── ProgressBar
│   ├── LiveFeed
│   │   └── IterationSummaryCard (×N)
│   ├── StatisticsPanel
│   │   ├── WealthChart
│   │   ├── HealthChart
│   │   ├── HappinessChart
│   │   └── PopulationChart
│   ├── AgentGrid
│   │   └── AgentTile (×N, color-coded, dead=grayed)
│   ├── LifecycleEventLog
│   └── SimulationControls (Pause/Abort)
├── ReflectionPage
│   ├── SocietyEvaluationReport
│   ├── AgentReflectionList
│   │   └── AgentReflectionCard (×N, shows both passes)
│   └── FinalStatisticsPanel
├── ReviewPage
│   ├── AgentSelector (sidebar, dead agents separated)
│   ├── AgentChat
│   │   ├── ChatMessageList
│   │   └── ChatInput
│   └── EndSessionButton
├── ArtifactsPage
│   ├── ArtifactList
│   │   └── ArtifactCard (×N)
│   ├── ArtifactViewer (markdown renderer)
│   └── SearchBar
├── ComparisonPage
│   ├── SessionSelector (checkboxes)
│   ├── ComparisonReport
│   └── ComparisonChat
└── SettingsPage
    ├── ProviderSelector (Local / Claude / OpenAI-compatible)
    ├── ModelConfig (Central Agent model, Citizen Agent model)
    ├── APIKeyInput (for cloud providers)
    └── LocalEndpointConfig (URL for LM Studio/Ollama)
```

### 11.3 State Management (Zustand Domain Slices)

State is split into independent Zustand stores to prevent unnecessary re-renders and keep each domain manageable:

```typescript
// Store 1: Session management
interface SessionStore {
  sessions: SessionMetadata[];
  currentSession: Session | null;
  loadSessions: () => Promise<void>;
  createSession: (seedIdea: string) => Promise<string>;
  loadSession: (id: string) => Promise<void>;
  deleteSession: (id: string) => Promise<void>;
  advanceStage: (newStage: SessionStage) => void;
}

// Store 2: Brainstorming & Refinement
interface BrainstormStore {
  brainstormMessages: ChatMessage[];
  refinementMessages: ChatMessage[];
  checklist: BrainstormingChecklist;
  sendBrainstormMessage: (content: string) => Promise<void>;
  sendRefinementMessage: (content: string) => Promise<void>;
  loadConversation: (sessionId: string, context: string) => Promise<void>;
}

// Store 3: Simulation
interface SimulationStore {
  progress: number;
  isSimulating: boolean;
  isPaused: boolean;
  currentIterationAgents: AgentDefinition[];
  iterationSummaries: IterationRecord[];
  lifecycleLog: LifecycleEvent[];
  startSimulation: () => Promise<void>;
  pauseSimulation: () => void;
  abortSimulation: () => void;
  resumeSimulation: () => Promise<void>;
  loadAgents: (sessionId: string) => Promise<void>;
}

// Store 4: Review
interface ReviewStore {
  activeAgent: string | null;
  agents: AgentDefinition[];
  messages: Record<string, ChatMessage[]>;
  setActiveAgent: (agentId: string) => void;
  sendMessage: (agentId: string, content: string) => Promise<void>;
  loadReviewData: (sessionId: string) => Promise<void>;
}

// Store 5: Comparison
interface ComparisonStore {
  selectedSessionIds: string[];
  report: string | null;
  messages: ChatMessage[];
  toggleSession: (sessionId: string) => void;
  runComparison: () => Promise<void>;
  sendMessage: (content: string) => Promise<void>;
}

// Store 6: Settings
interface SettingsStore {
  provider: 'local' | 'claude' | 'openai-compatible';
  localEndpoint: string;
  apiKey: string;
  centralAgentModel: string;
  citizenAgentModel: string;
  maxConcurrency: number;
  updateSettings: (partial: Partial<SettingsStore>) => void;
}
```

---

## 12. API Design

### 12.1 REST Endpoints

```
POST   /api/sessions                         Create a new session
GET    /api/sessions                         List all sessions (metadata only)
GET    /api/sessions/:id                     Get session with agents
DELETE /api/sessions/:id                     Delete a session and all related data

POST   /api/sessions/:id/brainstorm          Send a brainstorming message
POST   /api/sessions/:id/design              Trigger society design generation
POST   /api/sessions/:id/refine              Send a refinement message
POST   /api/sessions/:id/simulate            Start or resume simulation
POST   /api/sessions/:id/pause               Pause simulation
POST   /api/sessions/:id/reflect             Trigger reflection generation (both passes)

GET    /api/sessions/:id/agents              List agents for a session
GET    /api/sessions/:id/agents/:agentId     Get agent with full history
POST   /api/sessions/:id/review/:agentId     Send a review question to an agent

GET    /api/sessions/:id/iterations          List iteration records (metadata)
GET    /api/sessions/:id/iterations/:num     Get full iteration details (intents + resolved)

POST   /api/compare                          Generate cross-session comparison

GET    /api/sessions/:id/artifacts           List artifacts for a session
GET    /api/sessions/:id/artifacts/:aid      Get a specific artifact

GET    /api/sessions/:id/stream              SSE endpoint for simulation updates

POST   /api/sessions/:id/export              Export session as JSON file
POST   /api/import                           Import session from JSON file

GET    /api/settings                         Get LLM provider settings
PUT    /api/settings                         Update LLM provider settings
POST   /api/settings/test                    Test LLM connection
```

### 12.2 SSE Events (During Simulation)

```
event: iteration-start
data: { "iteration": 3, "totalIterations": 20 }

event: intent-complete
data: { "agentId": "abc-123", "agentName": "Farmer Chen", "iteration": 3 }

event: resolution-start
data: { "iteration": 3, "agentCount": 98 }

event: iteration-summary
data: { "iteration": 3, "summary": "...", "statistics": {...},
        "lifecycleEvents": [...] }

event: agent-stat-update
data: { "agentId": "abc-123", "wealth": 45, "health": 72, "happiness": 60 }

event: lifecycle-event
data: { "type": "death", "agentId": "xyz-789", "agentName": "Elder Wu",
        "details": "Passed away after prolonged illness" }

event: simulation-complete
data: { "finalReport": "..." }

event: error
data: { "message": "Rate limit exceeded, retrying in 30s..." }
```

---

## 13. Error Handling & Resilience

### 13.1 LLM Call Failures

| Error Type | Handling |
|---|---|
| **Rate limit (429)** | Exponential backoff: 2s, 4s, 8s, 16s, 32s. Max 5 retries. |
| **Timeout** | Retry once with same prompt. If fails again, mark agent intent as "no response" (the Central Agent will resolve them as inactive for this iteration). |
| **Invalid JSON response** | Retry with correction prompt: "Your previous response was not valid JSON. Please respond only with JSON matching this schema: ..." |
| **Context too long** | Truncate oldest context (keep system prompt, law, and most recent summary). Log a warning. |
| **API error (500)** | Retry up to 3 times. If persistent, pause simulation and notify user. |
| **Network error** | Retry up to 4 times with exponential backoff. Notify user if all retries fail. |
| **Local LLM unresponsive** | Check if LM Studio/Ollama is running. Show a message: "Cannot connect to local LLM at {endpoint}. Please ensure LM Studio is running." |

### 13.2 Data Integrity

- All database writes within an iteration use SQLite transactions — either the full iteration (intents + resolution + stat updates + lifecycle events) commits, or none of it does.
- Iteration records are immutable once committed — they are never modified, only appended.
- The `completed_iterations` counter is updated only after the transaction commits.

### 13.3 Idempotency

- If the simulation is resumed after a crash, the engine checks `completed_iterations` and resumes from the next iteration.
- If a partial iteration exists in the database (intents saved but no resolution), the resolution is re-run. Existing intents are reused (not re-generated).
- If no intents exist for the current iteration, the full iteration is re-run from scratch.

---

## 14. Cost Management

### 14.1 Token Usage Estimates

Assumptions: 100 agents, 20 iterations, Claude Sonnet 4.

| Operation | Input Tokens | Output Tokens | Calls | Total Tokens |
|---|---|---|---|---|
| Brainstorming (10 exchanges) | ~2,000/call | ~500/call | 10 | ~25,000 |
| Society Design | ~3,000/call | ~2,000/call | 15 | ~75,000 |
| Refinement (5 changes) | ~5,000/call | ~1,500/call | 5 | ~32,500 |
| Agent Intents (per iteration) | ~2,000/agent | ~300/agent | 100 | ~230,000 |
| Central Agent Resolution (per iter) | ~35,000 | ~5,000 | 1 (or 5 for map-reduce) | ~60,000 |
| **Per Iteration Total** | | | | **~290,000** |
| **20 Iterations Total** | | | | **~5,800,000** |
| Final Report (hierarchical) | ~15,000/arc | ~3,000/arc | 5+1 | ~108,000 |
| Agent Reflections Pass 1 | ~3,000/agent | ~600/agent | 100 | ~360,000 |
| Agent Reflections Pass 2 | ~4,000/agent | ~400/agent | 100 | ~440,000 |
| Society Evaluation | ~80,000 | ~3,000 | 1-3 | ~86,000 |
| **Grand Total** | | | | **~6,926,500** |

At Claude Sonnet 4 pricing (~$3/M input, $15/M output), a full 100-agent, 20-iteration session costs approximately **$30–50**.

### 14.2 Cost Reduction Strategies

1. **Use local LLMs:** With LM Studio or Ollama, cost is $0. Trade-off: slower and lower quality than cloud models.
2. **Hybrid model assignment:** Use a powerful model (Sonnet/Opus) for the Central Agent only, and a cheaper/local model (Haiku or local) for Citizen Agents.
3. **Fewer agents:** 30 agents instead of 100 reduces costs by ~70%.
4. **Shorter outputs:** Constrain agent intent responses to 200 tokens.
5. **Model selection:** Use Haiku for Citizen Agent intents (~10x cheaper than Sonnet).
6. **User controls:** Show estimated cost before starting simulation; let user adjust parameters.

### 14.3 Local LLM Considerations

When using local LLMs:
- **Concurrency is typically 1:** Most consumer GPUs can only process one request at a time. Agent intents are processed sequentially, making each iteration slower.
- **Context window may be smaller:** Some local models have 4K–8K context. The system must use more aggressive summarization for previous iteration context.
- **Quality varies:** Smaller models may produce less coherent agent behavior. The system should validate JSON output more aggressively and retry more often.
- **Estimated time:** 100 agents × ~5s per intent + ~30s resolution = ~8.5 minutes per iteration. 20 iterations ≈ ~3 hours.

---

## 15. Security Considerations

### 15.1 API Key Management

- API keys for cloud providers are stored in a local configuration file (e.g., `~/.idealworld/config.json`) with file permissions restricted to the current user.
- Keys are never sent to the frontend — the backend makes all LLM API calls.
- For local LLMs, no API key is needed.

### 15.2 Prompt Injection

- User input (seed idea, brainstorming messages, review questions) is treated as untrusted.
- System prompts are clearly delineated from user input using proper API message roles.
- Agent responses are not executed — they are displayed as text only.

### 15.3 Data Privacy

- All session data stays on the user's local filesystem. No telemetry, no analytics, no remote storage.
- When using cloud LLM providers, users are informed that their session data (including society ideas and agent conversations) is sent to the provider per the provider's API terms.
- When using local LLMs, no data leaves the machine.

### 15.4 Local Server Security

- The backend listens on `localhost` only (127.0.0.1), not on any external interface.
- No authentication is needed since the server is single-user and local-only.

---

## 16. Testing Strategy

### 16.1 Unit Tests

- **Prompt builders:** Verify correct prompt construction for each stage and agent type, including intent prompts and resolution prompts.
- **Response parsers:** Verify JSON parsing, error recovery, and intent/resolution schema validation.
- **Statistics computation:** Verify aggregate calculations including Gini coefficient.
- **Session state machine:** Verify valid stage transitions (including the new `refining` stage).
- **Map-reduce logic:** Verify agent grouping, sub-resolution merging, and arc summarization.
- **Lifecycle logic:** Verify death conditions, agent creation, role change tracking.

### 16.2 Integration Tests

- **Orchestration engine:** Mock the LLM API, run a full simulation with 5 agents and 3 iterations using the intent→resolve model, verify all data structures are correctly populated in SQLite.
- **Persistence layer:** Write and read sessions, agents, iterations, verify data integrity across all tables.
- **SSE streaming:** Verify events are emitted in correct order with correct data.
- **Design refinement:** Mock LLM, verify that a refinement request correctly updates only the affected artifacts.

### 16.3 End-to-End Tests (Playwright)

- **Full user flow:** Create a session, brainstorm, design, refine (change one agent), simulate (2 iterations, 5 agents), reflect (both passes), review, end session.
- **Session persistence:** Create a session, close browser, reopen, verify session is resumable at the correct stage.
- **Lifecycle events:** Simulate until an agent dies, verify the agent appears grayed out in the grid and can still be questioned in Stage 4.
- **Cross-session comparison:** Complete 2 sessions, run comparison, verify report references both sessions.

### 16.4 LLM Output Tests

- **Schema compliance:** Run actual LLM calls with test prompts, verify output matches expected JSON schemas for intents and resolutions.
- **Intent-only compliance:** Verify that Citizen Agents do not self-assign stat numbers when given the intent prompt.
- **Resolution consistency:** Verify that the Central Agent's stat assignments are internally consistent (e.g., if Agent A trades 10 wealth to Agent B, A's wealth decreases and B's increases by corresponding amounts).
- These tests are non-deterministic and are run manually or in a separate CI pipeline.

---

## 17. Development Phases & Milestones

### Phase 1: Foundation ✅ COMPLETE

- [x] Monorepo scaffolding (Vite + React + TypeScript for frontend, Node.js + Express for backend).
- [x] Shared data models and TypeScript interfaces (shared package).
- [x] SQLite database setup with Drizzle ORM, all table schemas, migrations.
- [x] LLM Gateway module with provider abstraction (local, Claude, OpenAI-compatible).
- [x] Settings page and API for LLM provider configuration.
- [x] Home Page with session list (empty state, create, delete).
- [x] Basic routing structure.

### Phase 2: Brainstorming & Design ✅ COMPLETE

- [x] Stage 0 — Idea Input page.
- [x] Chat interface component (reusable for Stages 1A, 1C, and 4).
- [x] Central Agent brainstorming prompt engineering.
- [x] Brainstorming completeness checklist logic.
- [x] "Start Design" button and override flow.
- [x] Central Agent design generation (multi-step prompt chain with time scale).
- [x] Design Review page (society overview, agent roster table, law viewer).
- [x] Design Refinement page — refinement chat + live-updating design panels.
- [x] Iteration count input, confirmation checkbox, and validation.

### Phase 3: Simulation Engine ✅ COMPLETE

- [x] Orchestration engine with two-phase intent→resolve model.
- [x] Citizen Agent intent prompt construction and response parsing.
- [x] Central Agent resolution prompt (direct mode for ≤50 agents).
- [x] Hierarchical map-reduce resolution (for >50 agents).
- [x] Agent lifecycle management (death, birth, role change).
- [x] Simulation Dashboard UI (progress bar, live feed, charts, agent grid, lifecycle log).
- [x] SSE streaming from backend to frontend.
- [x] Pause/resume/abort simulation with transaction-safe state management.
- [x] Iteration data persistence and auto-save.
- [x] Final State Report generation with hierarchical arc summarization.
- [x] Statistics computation (including Gini coefficient) and charting.

### Phase 4: Reflection & Review ✅ COMPLETE

- [x] Agent reflection Pass 1 prompt engineering and execution (personal-only).
- [x] Agent reflection Pass 2 prompt engineering and execution (post-briefing).
- [x] Society Evaluation Report generation (with perspective shift analysis).
- [x] Reflection Page UI (both passes displayed per agent).
- [x] Agent Review (Stage 4) — agent selector with dead agent section, per-agent chat.
- [x] Review agent prompt construction (includes intent/outcome history, both reflection passes).
- [x] "End Session" flow and session completion.

### Phase 5: Artifacts & Comparison 🔄 IN PROGRESS

- [x] Artifacts Page — on-demand assembly from existing tables, grouped document list, markdown viewer, search, copy, export.
- [ ] Cross-session comparison — session selector, Central Agent comparison prompt.
- [ ] Comparison Page UI with follow-up chat.
- [ ] Session export/import (JSON file, full fidelity).

### Phase 6: Polish & Testing ⏳ NOT STARTED

- [ ] End-to-end testing (Playwright).
- [ ] Unit and integration tests for all new logic (intent/resolve, map-reduce, lifecycle, two-pass reflections).
- [ ] Performance optimization (SQLite query optimization, virtualized lists for large agent counts).
- [ ] Local LLM testing (verify full flow with LM Studio and Ollama).
- [ ] Responsive design and mobile support.
- [ ] Error states and edge case handling.
- [ ] Cost estimation display before simulation start (for cloud providers).

---

## 18. Bug Fixes Applied

### Design Overlay Disappearing on Error
- **Symptom:** After starting design generation, if the LLM returned an error, the design overlay silently disappeared and the user was shown the Brainstorming chat again.
- **Root causes:**
  1. `isDesigning` in `Brainstorming.tsx` didn't account for `designProgress.error` — when `active` became false on error the overlay hid.
  2. `DesignReview.tsx` redirect effect had `loading` used in condition but missing from dependency array `[session?.stage]`.
  3. `startDesignGeneration`'s `complete` handler called `loadSession(id)` concurrently with `DesignReview`'s own `loadSession`, creating race conditions.
- **Fixes:** Added `|| !!designProgress.error` to `isDesigning`; added `loading` to effect dependency array; removed redundant `loadSession` call from the `complete` handler.

### Simulation Crashing on Prose LLM Response
- **Symptom:** Simulation would fail with `parseJSON failed: Agent intentions for this iteration have been fully processed…` — the LLM returning prose instead of JSON for the resolution prompt crashed the entire simulation run.
- **Fix:** Wrapped `parseAgentIntent` and `parseResolution` in `server/src/parsers/simulation.ts` with try/catch. Fallback: treat the prose text as the `narrativeSummary` and return empty `agentOutcomes` / `lifecycleEvents` so the iteration is skipped rather than crashing.

### Session Nav Highlighting Stale Stage
- **Symptom:** The left sidebar would highlight the wrong step (e.g., showing "Design" as active while on Simulation), because `SessionNav` read `session.stage` from `sessionDetailStore` which Simulation/Reflection/Review pages don't update.
- **Fix:** Derived the active nav step from `useLocation()` URL path instead of store state. Used `Math.max(storeProgressIdx, urlProgressIdx)` so nav items remain accessible even when the store is stale. Added active highlight to the Artifacts link.
