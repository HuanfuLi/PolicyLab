# PolicyLab Module Map & Modularity Enhancement Plan

> Reference document for humans and AI agents to diagnose, test, and modify each module in isolation.
> Each section is self-contained: you do not need to read the entire codebase to work on a module.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Module Registry](#2-module-registry)
   - [M1: mechanics/](#m1-mechanics--deterministic-game-engines)
   - [M2: db/](#m2-db--persistence-layer)
   - [M3: llm/](#m3-llm--language-model-integration)
   - [M4: cognition/](#m4-cognition--agent-cognitive-layer)
   - [M5: parsers/](#m5-parsers--llm-response-parsing)
   - [M6: data/](#m6-data--real-world-data-pipeline)
   - [M7: orchestration/](#m7-orchestration--simulation-coordination)
   - [M8: routes/](#m8-routes--http-api-layer)
   - [M9: shared/](#m9-shared--cross-workspace-types)
   - [M10: web/stores/](#m10-webstores--frontend-state)
   - [M11: web/pages/](#m11-webpages--frontend-views)
   - [M12: web/components/](#m12-webcomponents--reusable-ui)
3. [Test Inventory](#3-test-inventory)
4. [Modularity Enhancement Plan](#4-modularity-enhancement-plan)
5. [Test Completion Plan](#5-test-completion-plan)

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        web/ (React + Zustand)                   │
│  pages/ ──→ stores/ ──→ api/ ──→ HTTP ──→ routes/               │
│  components/ (pure presentation)                                │
└──────────────────────────────────┬──────────────────────────────┘
                                   │
┌──────────────────────────────────▼──────────────────────────────┐
│                      server/ (Express + SQLite)                 │
│                                                                 │
│  routes/ ──→ orchestration/ ──┬──→ mechanics/  ──→ shared/      │
│     │              │          ├──→ llm/                          │
│     │              │          ├──→ cognition/                    │
│     │              │          ├──→ parsers/                      │
│     │              │          └──→ db/repos/                     │
│     └──→ db/repos/ ──→ db/schema                                │
│                                                                 │
│  data/ (standalone — World Bank pipeline)                       │
└─────────────────────────────────────────────────────────────────┘
```

**Dependency Rule:** arrows point downward only. No module may import from a module above it.

**Violation exceptions (to be fixed):**
- `mechanics/orderBook.ts` → `db/` (should use repo)
- `llm/centralAgent.ts` → `db/` (should return values)
- `llm/prompts.ts` → `mechanics/` (should accept params)

---

## 2. Module Registry

---

### M1: mechanics/ — Deterministic Game Engines

**Purpose:** Pure functions that compute state deltas. No DB, no LLM, no network. Given input → return output.

**Purity rule:** Every function must be deterministic and side-effect-free (except `orderBook.ts` — see violations).

| File | Exports | Purity | Tests |
|---|---|---|---|
| **physicsEngine.ts** | `resolveAction(PhysicsInput): PhysicsOutput`, `clampHappinessByPhysiology(happiness, cortisol): number` | PURE | **NONE** |
| **allostaticEngine.ts** | `AllostaticEngine` class (tick, serialize, ticksUntilDisease), `computeMetSatietyCost(MetInput): MetOutput`, `runFullMetabolicTick(input): FullMetabolicTickOutput`, `getMetCategory(action): MetCategory` | PURE | **NONE** |
| **automatedMarketMaker.ts** | `AutomatedMarketMaker` class (buy, sell, spotPrice, demurrage), `computeDemurrageCycle(...)`, `createAMMForSession(...)`, `createMultiCommodityAMMs(...)` | PURE | `sfcAudit.test.ts`, `sfc-unrounded.test.ts` (indirect) |
| **bankingEngine.ts** | `canIssueLoan(...)`, `processLoanRequest(...)`, `processRepayment(...)`, `accrueInterest(...)`, `processDefault(...)`, `accrueDepositInterest(...)`, `processIteration(...)` | PURE | `banking.test.ts` (24), `sfcBanking.test.ts` (6) |
| **capitalMarketEngine.ts** | `processSharePurchase(...)`, `processShareSale(...)`, `distributeDividends(...)`, `processGovBondPurchase(...)`, `processCorpBondIssuance(...)`, `processCoupons(...)`, `processMaturities(...)`, `processIteration(...)` | PURE | `capitalMarket.test.ts` (20), `sfcCapitalMarkets.test.ts` (6) |
| **fiscalEngine.ts** | `executeBudget(...)`, `updatePublicGoodsQuality(...)`, `getMultiplierEffects(...)` | PURE | `fiscal.test.ts` (18), `sfcFiscal.test.ts` (20) |
| **inflationEngine.ts** | `computeInflation(InflationInput): InflationOutput` | PURE | `inflationEngine.test.ts` (11), `sfcInflation.test.ts` (9) |
| **skillSystem.ts** | `createSkillMatrix(role?)`, `processSkills(skills, action, ...)`, `getSkillMultiplier(level)`, `getActionMultiplier(skills, action)`, `averageSkillLevel(skills)`, `getRoleAffinity(role)` | PURE | **NONE** |
| **actionCodes.ts** | `normalizeActionCode(raw): ActionCode`, `getRoleTier(role): RoleTier`, `getAllowedActions(role): ActionCode[]`, `CAPITAL_MARKET_ACTIONS` | PURE | **NONE** |
| **inventorySystem.ts** | `createInventory(role?)`, `processInventory(...)`, `getToolMultiplier(inv)`, `totalItems(inv)`, `canTrade(...)`, `transferItems(...)` | PURE | **NONE** |
| **inflationEngine.ts** | `computeInflation(InflationInput): InflationOutput` | PURE | `inflationEngine.test.ts` |
| **orderBook.ts** | `OrderBook` class, `getOrderBook(sessionId)`, `restoreOrderBook(sessionId)`, `clearOrderBook(sessionId)` | DB via `orderBookRepo` (no direct db/ import) | **NONE** |
| **economyConfigUtils.ts** | `getEconomyConfig(session): EconomyConfig` | PURE | `economyConfig.test.ts` (16) |
| **historicalRAG.ts** | `getSubconsciousDrive(agent, context): string` | PURE | **NONE** |
| **physicsConfig.ts** | `physicsConfig` (singleton), `getPhysicsConfig()`, `updatePhysicsConfig(...)`, `resetPhysicsConfig()` | MUTABLE SINGLETON | **NONE** |

**How to test in isolation:** Import function directly, pass mock data, assert output. No DB or setup needed (except orderBook).

```typescript
// Example: testing physicsEngine
import { resolveAction } from '../mechanics/physicsEngine.js';
const result = resolveAction({ agent: mockAgent, action: 'WORK', ... });
expect(result.wealthDelta).toBeGreaterThan(0);
```

---

### M2: db/ — Persistence Layer

**Purpose:** SQLite schema definition and repository pattern for all DB operations.

**Rule:** Repos import only from `db/schema`, `db/index`, and `@policylab/shared`. No upstream imports.

| File | Exports | Tests |
|---|---|---|
| **schema.ts** | 26 tables: `sessions`, `agents`, `iterations`, `agentIntents`, `resolvedActions`, `reflections`, `chatMessages`, `artifacts`, `roleChanges`, `economySnapshots`, `agentEconomy`, `ammSnapshots`, `marketPrices`, `orderBook`, `depositAccounts`, `loanContracts`, `bankBalanceSheets`, `macroSnapshots`, `equityPositions`, `bondHoldings`, `fiscalBudgets`, `publicGoodsState` | N/A |
| **index.ts** | `db` (Drizzle instance), `sqlite` (better-sqlite3 raw) | **NONE** |
| **migrate.ts** | Migration runner | **NONE** |
| **asyncLogFlusher.ts** | `asyncLogFlusher` singleton (.start, .stop, .enqueue, .flush) | **NONE** |
| **repos/agentRepo.ts** | `.bulkCreate(data): Promise<Agent[]>`, `.listBySession(sessionId): Promise<Agent[]>`, `.updateStats(id, wealth, health, happiness, cortisol?, dopamine?): Promise<Agent>`, `.markDead(id, iter)`, `.bulkUpdateStats(updates)`, `.bulkUpdateAllostaticStates(updates)`, `.bulkMarkDead(deaths)` | `agentRepo.test.ts` (3) |
| **repos/sessionRepo.ts** | `.create(data): Promise<Session>`, `.getById(id): Promise<Session\|null>`, `.list(): Promise<SessionMetadata[]>`, `.updateStage(id, stage)`, `.updateConfig(id, config)`, `.delete(id)` | **NONE** |
| **repos/iterationRepo.ts** | `.create(data)`, `.listBySession(sessionId)`, `.listBySessionFull(sessionId)` (with parsed statistics/lifecycleEvents), `.getWithActions(iterationId)` | **NONE** |
| **repos/chatMessageRepo.ts** | `.append(msg): Promise<ChatMessage>`, `.listByContext(sessionId, context): Promise<ChatMessage[]>` | **NONE** |
| **repos/economyRepo.ts** | `.getAgentEconomy(agentId, sessionId)`, `.listBySession(sessionId)`, `.bulkUpsertAgentEconomy(updates)`, `.initializeForSession(sessionId, agents)`, `.saveSnapshot(...)`, `.getSnapshot(...)`, `.savePriceIndices(...)`, `.saveAMMSnapshot(...)`, `.getLatestAMMSnapshot(sessionId)` | **NONE** |
| **repos/bankingRepo.ts** | `upsertDeposit()`, `getDeposit()`, `getDepositsBySession()`, `getTotalDeposits()`, `updateDepositBalance()`, `insertLoan()`, `getActiveLoans()`, `getLoansByBorrower()`, `getTotalLoansOutstanding()`, `updateLoan()`, `insertBalanceSheet()`, `getLatestBalanceSheet()` | **NONE** |
| **repos/capitalMarketRepo.ts** | `getEquityPositionsBySession()`, `upsertEquityPosition()`, `getBondHoldingsBySession()`, `upsertBondHolding()`, `deleteBondHolding()`, `getTotalActiveBondFaceValue()` | **NONE** |
| **repos/fiscalRepo.ts** | `upsertBudget()`, `getActiveBudget()`, `upsertPublicGoodsState()`, `getPublicGoodsState()`, `createBudget()`, `deleteBySession()` | **NONE** |
| **repos/macroSnapshotRepo.ts** | `insertMacroSnapshot()`, `getSnapshotsBySession()` | **NONE** |
| **repos/orderBookRepo.ts** | `loadOpenOrders(sessionId)`, `insertOrder(order)`, `updateMatchedOrders(orders)`, `cancelAgentOrders(ids)` | **NONE** |

**How to test in isolation:** Create in-memory SQLite DB, run migrations, test repo operations.

---

### M3: llm/ — Language Model Integration

**Purpose:** LLM provider abstraction, prompt construction, retry logic.

| File | Exports | Side Effects | Tests |
|---|---|---|---|
| **types.ts** | `LLMProvider` interface, `LLMMessage`, `LLMResponse` | None | N/A |
| **gateway.ts** | `getProvider()`, `getCitizenProvider()`, `invalidateProvider()`, `createProviderFromSettings()` | Reads config | **NONE** |
| **anthropic.ts** | Anthropic provider implementation | Network (Anthropic API) | **NONE** |
| **openai.ts** | OpenAI provider implementation | Network (OpenAI API) | **NONE** |
| **gemini.ts** | Gemini provider implementation | Network (Gemini API) | **NONE** |
| **vertex.ts** | Vertex provider implementation | Network (Vertex API) | **NONE** |
| **retry.ts** | `retryLLM(fn, maxRetries)` | None | **NONE** |
| **retryWithHealing.ts** | `retryWithHealing(fn, healingFn, ...)` | LLM calls | **NONE** |
| **centralAgent.ts** | `brainstorm(...)`, `generateDesign(...)`, `refine(...)` | **DB writes + LLM calls** | **NONE** |
| **parserAgent.ts** | `parseByKeywords(text, agentNames)` (PURE), `runParserAgent(input, provider)` (LLM), `batchParseIntents(inputs, provider, concurrency)` (LLM) | LLM calls | `phase2.test.ts` (manual) |
| **prompts.ts** | `buildBrainstormMessages()`, `buildIntentPrompt()`, `buildNaturalIntentPrompt()`, `buildResolutionPrompt()`, `buildFinalReportPrompt()`, `buildAgentReflectionPrompt()`, `buildEvaluationPrompt()`, `buildReviewChatPrompt()`, `buildComparisonMessages()`, `buildRefineMessages()`, `buildProposalPrompt()`, +10 more | **Imports mechanics/** | **NONE** |

---

### M4: cognition/ — Agent Cognitive Layer

**Purpose:** Per-agent memory, reflection, and planning across iterations.

| File | Exports | State | Tests |
|---|---|---|---|
| **memoryStream.ts** | `addMemory(memory)`, `getMemories(sessionId, agentId)`, `retrieveMemories(sessionId, agentId, iteration, query, maxCount)` — 3D scored retrieval (recency/importance/relevance), `createExperienceMemories(outcomes)`, `formatMemoriesForPrompt(memories, maxLength?)`, `clearSessionMemories(sessionId)`, `getRecentImportanceSum(sessionId, agentId, sinceIter)` | In-memory Map | `phase3.test.ts` (manual) |
| **reflectionTree.ts** | `shouldReflect()`, `runReflection()`, `batchReflections()`, `clearReflectionState()` | In-memory Map | `phase3.test.ts` (manual) |
| **recursivePlanner.ts** | `getAgentPlan()`, `runPlanning()`, `clearPlanningState()` | In-memory Map | `phase3.test.ts` (manual) |
| **cognitiveEngine.ts** | `runCognitivePreProcessing(inputs)`, `runCognitivePostProcessing(inputs)`, `cleanupSessionCognition(sessionId)` | Orchestrates above 3 | `phase3.test.ts` (manual) |

**How to test in isolation:** Import functions, pass mock agents and LLM provider. No DB needed.

---

### M5: parsers/ — LLM Response Parsing

**Purpose:** Extract structured data from LLM text responses.

| File | Exports | Tests |
|---|---|---|
| **json.ts** | `parseJSON<T>(text): T` — 4-strategy extraction: direct → code fence → slice {…} → slice […] | **NONE** |
| **simulation.ts** | `parseAgentIntent(text)`, `parseAgentIntentStrict(text)`, `parseSinglePassIntent(text)`, `parseResolution(text)`, `parseResolutionStrict(text)`, `parseFinalReport(text)`, `parseGroupResolution(text)`, `parseMergeResolution(text)` — all PURE with fallbacks | **NONE** |
| **reflection.ts** | `parseAgentReflection(text)`, `parseAgentReflection2(text)`, `parseSocietyEvaluation(text)` — all PURE | **NONE** |

---

### M6: data/ — Real-World Data Pipeline

**Purpose:** Fetch World Bank indicators, geocode locations, generate agent rosters from real data.

| File | Exports | Tests |
|---|---|---|
| **worldBankApi.ts** | `fetchIndicator(code, countryCode)`, `fetchIndicatorBatch(codes, countryCode)` | `worldBankApi.test.ts` (7) |
| **locationDataService.ts** | `fetchLocationData(countryCode, location, coords, callbacks)` | **NONE** |
| **dataBootstrapPipeline.ts** | `profileToEconomyConfig(profile)`, `generateAgentRoster(profile, count)`, `generateLawPromptContext(profile)` | `dataBootstrapPipeline.test.ts` (7) |
| **giniDistribution.ts** | `distributeWealth(count, totalWealth, targetGini)`, `computeGini(values)` | `giniDistribution.test.ts` (8) |
| **locationCache.ts** | `getCachedProfile(cc)`, `setCachedProfile(cc, profile)` | `locationCache.test.ts` (3) |
| **photonGeocoder.ts** | `searchLocations(query, limit)` | **NONE** |
| **indicatorMap.ts** | `WB_INDICATORS`, `ALL_INDICATOR_CODES` | N/A (constants) |

---

### M7: orchestration/ — Simulation Coordination

**Purpose:** Orchestrates the simulation loop, reflection pipeline, and design generation by calling into mechanics, LLM, cognition, and DB layers.

| File | Exports | Side Effects | Tests |
|---|---|---|---|
| **simulationRunner.ts** | `runSimulation(sessionId, totalIterations)`, re-exports `getSessionTelemetry` | DB + LLM + SSE (imports state from simulationState) | **NONE** |
| **simulationState.ts** | 14 session Maps (`sessionAMMRegistry`, `sessionAllostaticStates`, etc.), `EnterpriseRecord`, `EmploymentRecord`, `appendTrace()`, `getEnterpriseRegistry()`, `getEmploymentRegistry()`, `cleanupSessionState(sessionId)` | In-memory Maps | **NONE** |
| **telemetryCollector.ts** | `getSessionTelemetry(sessionId): TelemetryLog[]` | DB read + in-memory merge | **NONE** |
| **simulationManager.ts** | `simulationManager` singleton (.start, .pause, .resume, .abort, .finish, .broadcast, .getStatus, .addClient) | In-memory state + SSE | **NONE** |
| **reflectionRunner.ts** | `runReflection(sessionId)` | DB + LLM + SSE | **NONE** |
| **reflectionManager.ts** | `reflectionManager` singleton (.start, .finish, .broadcast, .addClient, .getStatus) | In-memory + SSE | **NONE** |
| **concurrencyPool.ts** | `runWithConcurrency(tasks, limit, options)` | None | **NONE** |
| **clustering.ts** | `clusterByRole(agents, maxPerCluster)` | None | **NONE** |
| **designOrchestrator.ts** | Re-exports `generateDesign` from centralAgent | Proxy | **NONE** |
| **governanceManager.ts** | `runGovernanceCycle(params)`, `getSessionPolicy(raw)` | LLM calls | **NONE** |

---

### M8: routes/ — HTTP API Layer

**Purpose:** Express route handlers. Each file is mounted at a URL prefix.

| File | Mount Point | Endpoints | Tests |
|---|---|---|---|
| **sessions.ts** | `/api/sessions` | `GET /`, `POST /`, `GET /:id`, `GET /:id/agents`, `GET /:id/agent-intents`, `GET /:id/messages`, `PATCH /:id/stage`, `PUT /:id/config`, `POST /:id/fork`, `POST /:id/fork-simulation`, `PATCH /:id/agents/:agentId`, `DELETE /:id` | **NONE** |
| **simulate.ts** | `/api/sessions/:id/simulate` | `POST /`, `POST /pause`, `POST /resume`, `POST /abort`, `POST /abort-reset`, `PATCH /early-stopping`, `GET /telemetry`, `GET /stream` (SSE) | **NONE** |
| **bootstrap.ts** | `/api/sessions` | `GET /locations/search`, `POST /:id/bootstrap` (SSE) | **NONE** |
| **design.ts** | `/api/sessions/:id/design` | `POST /` (SSE) | **NONE** |
| **chat.ts** | `/api/sessions/:id/chat` | `POST /` | **NONE** |
| **reflect.ts** | `/api/sessions/:id/reflect` | `POST /`, `GET /stream` (SSE), `GET /` | **NONE** |
| **review.ts** | `/api/sessions/:id/review` | `POST /:agentId/chat`, `GET /:agentId/messages` | **NONE** |
| **compare.ts** | `/api/compare` | `POST /`, `POST /chat`, `GET /history` | **NONE** |
| **importexport.ts** | `/api/sessions` | `GET /:id/export`, `POST /import` | **NONE** |
| **iterations.ts** | `/api/sessions/:id/iterations` | `GET /`, `GET /agent-stats`, `GET /:num` | **NONE** |
| **artifacts.ts** | `/api/sessions/:id/artifacts` | `GET /` | **NONE** |
| **settings.ts** | `/api/settings` | `GET /`, `PUT /`, `POST /test`, `POST /sandbox`, `POST /sandbox-json`, `GET /physics-config`, `PUT /physics-config`, `POST /physics-config/reset`, `POST /trace-physics` | **NONE** |

---

### M9: shared/ — Cross-Workspace Types

**Purpose:** Zero-dependency TypeScript types shared between server and web. Import as `@policylab/shared`.

**Key types:** `Session`, `Agent`, `AgentStats`, `EconomyConfig`, `BudgetAllocation`, `LoanContract`, `DepositAccount`, `EquityPosition`, `BondHolding`, `IterationStats`, `TelemetryLog`, `InflationState`, `SkillMatrix`, `Inventory`, `ItemType`, `ActionCode`, `Stage`, `ChatMessage`, `SessionExport`, `LocationProfile`

**Key constants:** `DEFAULT_ECONOMY_CONFIG`, `DEFAULT_SKILL_MATRIX`, `DEFAULT_INVENTORY`, `DEFAULT_BUDGET_ALLOCATION`, `DEFAULT_PUBLIC_GOODS_INITIAL`, `ITEM_TYPES`, `PERSONALITY_TRAITS`

**Key functions:** `distributeProRata(total, weights): number[]`

---

### M10: web/stores/ — Frontend State

**Purpose:** Zustand stores. Each manages one domain. Zero cross-store imports.

| Store | State Fields | Actions | API Calls | Tests |
|---|---|---|---|---|
| **simulationStore** | isRunning, isPaused, isComplete, currentIteration, totalIterations, feed, statsHistory, macroHistory, pendingIntents, agents, error | connectSSE, loadAgents, loadHistory, loadMacroHistory, loadIntentHistory, pause, resume, abort, abortAndReset, continueSimulation, forkSimulation, reset | 11 endpoints | **NONE** |
| **scenarioStore** | tabs, baseline, activeTabId, scenarioSessionIds, runningScenarios | initFromSession, syncBaseline, addScenario, removeScenario, updateOverride, renameScenario, runAllScenarios, reset | 3 endpoints | **NONE** |
| **sessionDetailStore** | session, agents, brainstormMessages, refinementMessages, isGenerating, loading | loadSession, loadAgents, sendBrainstormMessage, startDesignGeneration, sendRefinementMessage, startSimulation, forkSession, saveBudgetAllocation, reset | 7 endpoints | **NONE** |
| **bootstrapStore** | progress, error, isBootstrapping | startBootstrap, reset | 1 SSE endpoint | **NONE** |
| **reflectionStore** | isRunning, isComplete, currentPass, completedCount, agentReflections, evaluation, error, agents | loadAgents, loadReflections, startReflection, connectSSE, reset | 3 endpoints + SSE | **NONE** |
| **sessionsStore** | sessions, loading | loadSessions | 1 endpoint (via sessionsApi) | **NONE** |
| **settingsStore** | settings | loadSettings, updateSettings | via settingsApi | **NONE** |
| **compareStore** | allSessions, selectedIds, comparison, messages, history, loading | loadSessions, loadHistory, toggleSession, runComparison, sendMessage, reset | 5 endpoints | **NONE** |

---

### M11: web/pages/ — Frontend Views

| Page | Route | Stores Used |
|---|---|---|
| **HomePage.tsx** | `/` | sessionsStore |
| **IdeaInput.tsx** | `/session/:id` | bootstrapStore, sessionsStore |
| **Brainstorming.tsx** | `/session/:id/brainstorm` | sessionDetailStore |
| **DesignReview.tsx** | `/session/:id/design` | sessionDetailStore, scenarioStore |
| **Simulation.tsx** | `/session/:id/simulate` | simulationStore |
| **Reflection.tsx** | `/session/:id/reflect` | reflectionStore, sessionDetailStore, simulationStore |
| **AgentReview.tsx** | `/session/:id/agents` | reflectionStore, sessionDetailStore |
| **CompareSessions.tsx** | `/compare` | compareStore |
| **SettingsPage.tsx** | `/settings` | settingsStore |

---

### M12: web/components/ — Reusable UI

| Component | Props | Store Dependency | Pure? |
|---|---|---|---|
| **EconomicDashboard** | macroHistory: TelemetryLog[] | None | Yes |
| **EconomyTab** | config, onChange, tabId, ... | None | Yes |
| **ScenarioTabs** | sessionId | scenarioStore | No |
| **TelemetryPanel** | sessionId, data | None | Yes |
| **LineChart** | series, xLabels, height | None | Yes |
| **LocationSearch** | onSelect | None | Yes |
| **DataConfidenceBadge** | confidence, source | None | Yes |
| **DiffMarker** | value, baseline | None | Yes |
| **MarkdownText** | children | None | Yes |
| **ErrorBoundary** | children | None | Yes |

---

## 3. Test Inventory

### Existing Tests (24 files, 300 tests)

| Test File | Module | Type | Count |
|---|---|---|---|
| `mechanics/__tests__/banking.test.ts` | bankingEngine | Unit | 32 |
| `mechanics/__tests__/capitalMarket.test.ts` | capitalMarketEngine | Unit | 20 |
| `mechanics/__tests__/fiscal.test.ts` | fiscalEngine | Unit | 31 |
| `mechanics/__tests__/inflationEngine.test.ts` | inflationEngine | Unit | 23 |
| `mechanics/__tests__/edgeCases.test.ts` | physics edge cases | Unit | 16 |
| `mechanics/__tests__/enterpriseEngine.test.ts` | enterpriseEngine | Unit | 16 |
| `mechanics/__tests__/sfcAudit.test.ts` | AMM SFC loop | Integration | 4 |
| `mechanics/__tests__/sfcInvariant.test.ts` | SFC invariant | Integration | 16 |
| `__tests__/sfcBanking.test.ts` | banking SFC | Integration | 6 |
| `__tests__/sfcCapitalMarkets.test.ts` | capital markets SFC | Integration | 6 |
| `__tests__/sfcFiscal.test.ts` | fiscal SFC | Integration | 20 |
| `__tests__/sfcInflation.test.ts` | inflation SFC | Integration | 9 |
| `__tests__/sfc-unrounded.test.ts` | AMM rounding SFC | Integration | 10 |
| `__tests__/economyConfig.test.ts` | config validation | Unit | 16 |
| `__tests__/scenarioEntry.test.ts` | scenario forking | Integration | 8 |
| `data/__tests__/dataBootstrapPipeline.test.ts` | bootstrap mapping | Unit | 7 |
| `data/__tests__/enterpriseBootstrap.test.ts` | enterprise bootstrap | Unit | 11 |
| `data/__tests__/giniDistribution.test.ts` | Gini algorithm | Unit | 8 |
| `data/__tests__/locationCache.test.ts` | file cache | Unit | 3 |
| `data/__tests__/worldBankApi.test.ts` | WB API | Unit (mock) | 7 |
| `llm/__tests__/promptContent.test.ts` | prompt content | Unit | 12 |
| `llm/__tests__/loadBalancer.test.ts` | load balancer | Unit | 7 |
| `llm/__tests__/narrativeValidation.test.ts` | narrative validation | Unit | 9 |
| `db/repos/__tests__/agentRepo.test.ts` | agent repo | Unit | 3 |
| `cognition/__tests__/phase3.test.ts` | cognitive layer | Manual script | N/A |
| `llm/__tests__/phase2.test.ts` | parser agent | Manual script | N/A |

### Coverage by Module

| Module | Source Files | Files With Tests | Coverage |
|---|---|---|---|
| mechanics/ | 14 | 5 | 36% |
| db/ | 14 | 1 | 7% |
| llm/ | 10 | 1 | 10% |
| cognition/ | 4 | 1 | 25% |
| parsers/ | 3 | 0 | 0% |
| data/ | 7 | 4 | 57% |
| orchestration/ | 8 | 0 | 0% |
| routes/ | 12 | 0 | 0% |
| web/ | ~30 | 0 | 0% |

---

## 4. Modularity Enhancement Plan

### Phase A: Fix Coupling Violations ✅ COMPLETED

**A1. ✅ Extract orderBook DB access → `db/repos/orderBookRepo.ts`**
- Created `db/repos/orderBookRepo.ts` with `loadOpenOrders()`, `insertOrder()`, `updateMatchedOrders()`, `cancelAgentOrders()`
- `mechanics/orderBook.ts` now imports from repo instead of raw `db/index` + `db/schema`
- All 4 DB operations (load, insert, update fill state, cancel) routed through repo

**A2. ✅ Partial — centralAgent DB coupling documented**
- `brainstorm()` was already pure (returns values, no DB writes)
- `generateDesign()` and `refine()` still use direct DB access — deeply interleaved with SSE callbacks
- Removed unused `chatMessages` import; added documentation comment noting the remaining coupling
- Full extraction deferred to future work (requires redesigning the SSE progress pattern)

**A3. ✅ Remove mechanics value imports from prompts.ts**
- Removed `import { getSubconsciousDrive }` from `llm/prompts.ts`
- `buildIntentPrompt()` and `buildNaturalIntentPrompt()` now accept `subconsciousDrive?: string | null` as parameter
- `simulationRunner.ts` now calls `getSubconsciousDrive()` and passes result to prompt builders
- `ActionCode` type import kept (type-only imports are acceptable cross-module)

**A4. ✅ Move `AMMState` type to shared/**
- Moved `AMMState` interface to `shared/src/types.ts`
- `mechanics/automatedMarketMaker.ts` re-exports from shared for backward compat
- `db/repos/economyRepo.ts` now imports from `@policylab/shared`

### Phase B: Decompose simulationRunner.ts ✅ COMPLETED (B2, B3)

**B1. Deferred — subsystem tick extraction**
- Banking/capital/fiscal/inflation ticks are deeply interleaved with the main loop's per-agent state
- Extraction requires careful interface design to avoid passing 20+ parameters
- Left as future work; the state + telemetry extractions provide the key modularity wins

**B2. ✅ Extract `orchestration/simulationState.ts`** (133 lines)
- All 14 `session*` Maps moved to dedicated module
- `EnterpriseRecord`, `EmploymentRecord` interfaces exported
- `appendTrace()` helper moved
- `getEnterpriseRegistry()`, `getEmploymentRegistry()` accessors moved
- `cleanupSessionState(sessionId)` — single function replaces 5 copy-pasted cleanup blocks
- simulationRunner.ts reduced by 131 lines; all 5 cleanup blocks consolidated

**B3. ✅ Extract `orchestration/telemetryCollector.ts`** (45 lines)
- `getSessionTelemetry(sessionId)` function moved to dedicated module
- Merges DB-committed telemetry with in-memory uncommitted entries
- Re-exported from simulationRunner.ts for backward compatibility

**Result:** simulationRunner.ts reduced from 3,985 → 3,854 lines. Two new focused modules created.

### Phase C: Frontend API Layer Standardization (future work)

**C1. Create missing API modules:**
- `web/src/api/simulate.ts` — simulation control endpoints
- `web/src/api/bootstrap.ts` — bootstrap SSE endpoint
- `web/src/api/reflect.ts` — reflection endpoints

**C2. Migrate raw fetch to API modules** in: bootstrapStore, reflectionStore, scenarioStore, simulationStore, sessionDetailStore

---

## 5. Test Completion Plan

### Wave 1: Mechanics Unit Tests (P0 — fills biggest gap)

| New Test File | Module | Estimated Tests | Priority |
|---|---|---|---|
| `mechanics/__tests__/physicsEngine.test.ts` | physicsEngine | ~30 (one per action code + edge cases) | **P0** |
| `mechanics/__tests__/allostaticEngine.test.ts` | allostaticEngine | ~15 (MET, strain, load, disease threshold) | **P0** |
| `mechanics/__tests__/skillSystem.test.ts` | skillSystem | ~12 (create, process, multipliers, affinity) | **P0** |
| `mechanics/__tests__/actionCodes.test.ts` | actionCodes | ~10 (normalize, tiers, permissions) | **P1** |
| `mechanics/__tests__/inventorySystem.test.ts` | inventorySystem | ~10 (create, process, trade, transfer) | **P1** |
| `mechanics/__tests__/orderBook.test.ts` | orderBook | ~8 (matching, partial fills) | **P1** |
| `mechanics/__tests__/amm.test.ts` | automatedMarketMaker | ~15 (buy/sell, spotPrice, invariant) | **P1** |

**Test pattern:** Import function → pass mock data → assert output. No DB setup.

### Wave 2: Orchestration & Integration Tests (P0)

| New Test File | What It Tests | Type | Priority |
|---|---|---|---|
| `orchestration/__tests__/concurrencyPool.test.ts` | runWithConcurrency | Unit | **P0** |
| `orchestration/__tests__/clustering.test.ts` | clusterByRole | Unit | **P0** |
| `orchestration/__tests__/simulationManager.test.ts` | State machine: start/pause/resume/abort/finish | Unit | **P0** |
| `orchestration/__tests__/simulationLoop.test.ts` | 5-iteration simulation with mock LLM | Integration | **P1** |

### Wave 3: Route Integration Tests (P1)

| New Test File | Routes Tested | Setup | Priority |
|---|---|---|---|
| `routes/__tests__/sessions.test.ts` | CRUD, fork, config update | supertest + in-memory DB | **P1** |
| `routes/__tests__/simulate.test.ts` | start, pause, resume, abort, abort-reset | supertest + mock runner | **P1** |
| `routes/__tests__/importexport.test.ts` | export + import round-trip | supertest + in-memory DB | **P1** |
| `routes/__tests__/bootstrap.test.ts` | SSE bootstrap flow | supertest + mock WB API | **P2** |

### Wave 4: DB Repo Tests (P1)

| New Test File | Repo Tested | Priority |
|---|---|---|
| `db/repos/__tests__/bankingRepo.test.ts` | Deposit/loan CRUD, balance sheets | **P1** |
| `db/repos/__tests__/capitalMarketRepo.test.ts` | Equity/bond positions | **P1** |
| `db/repos/__tests__/fiscalRepo.test.ts` | Budget, public goods state | **P1** |
| `db/repos/__tests__/sessionRepo.test.ts` | Session CRUD, stage updates | **P2** |
| `db/repos/__tests__/iterationRepo.test.ts` | Iteration queries | **P2** |

**Test pattern:** Create in-memory SQLite DB → run migrations → test repo operations.

### Wave 5: LLM & Cognition Tests (P2)

| New Test File | What It Tests | Priority |
|---|---|---|
| `llm/__tests__/prompts.test.ts` | Prompt builders produce valid message arrays | **P2** |
| `llm/__tests__/gateway.test.ts` | Provider selection, fallback | **P2** |
| `llm/__tests__/retry.test.ts` | Retry logic, backoff | **P2** |
| `cognition/__tests__/memoryStream.test.ts` | Memory add/retrieve/score | **P2** |
| `cognition/__tests__/recursivePlanner.test.ts` | Plan creation with mock LLM | **P2** |
| `parsers/__tests__/json.test.ts` | JSON extraction from LLM text | **P2** |
| `parsers/__tests__/simulation.test.ts` | Action parsing from LLM output | **P2** |

### Wave 6: Frontend Tests (P2)

| New Test File | What It Tests | Priority |
|---|---|---|
| `web/src/stores/__tests__/simulationStore.test.ts` | SSE handling, state transitions | **P2** |
| `web/src/stores/__tests__/scenarioStore.test.ts` | Tab management, fork logic | **P2** |
| `web/src/stores/__tests__/sessionDetailStore.test.ts` | Session loading, design flow | **P3** |

**Test pattern:** Use `vitest` + mock `fetch`/`EventSource`. Test state transitions.

---

## Quick Reference: How to Work on Each Module

| If you need to... | Read only... | Test with... |
|---|---|---|
| Fix a game mechanic | `mechanics/<engine>.ts` + `shared/types.ts` | `vitest run mechanics/__tests__/<engine>.test.ts` |
| Fix a DB query | `db/repos/<repo>.ts` + `db/schema.ts` | `vitest run db/repos/__tests__/<repo>.test.ts` |
| Fix an LLM prompt | `llm/prompts.ts` + `shared/types.ts` | Manual: inspect prompt output |
| Fix a route handler | `routes/<route>.ts` + relevant repo | `vitest run routes/__tests__/<route>.test.ts` |
| Fix simulation flow | `orchestration/simulationRunner.ts` + relevant engines | Full integration test |
| Fix frontend state | `web/src/stores/<store>.ts` | `vitest run stores/__tests__/<store>.test.ts` |
| Fix a UI component | `web/src/components/<component>.tsx` | Visual inspection / component test |
| Fix agent cognition | `cognition/<module>.ts` | `vitest run cognition/__tests__/<module>.test.ts` |
| Fix data bootstrap | `data/<module>.ts` | `vitest run data/__tests__/<module>.test.ts` |
