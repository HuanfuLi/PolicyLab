# PolicyLab Problem-Solving Roadmap

**Created:** 2026-04-05
**Scope:** 5 audit rounds + final comprehensive audit + modularity refactoring
**Result:** 65+ issues identified and fixed across 22+ tasks | 195 tests passing | Build clean | 0 type errors

---

## Round 1: Core Logic & Economic Engine Audit

Focused on simulation mechanics, SFC accounting, and calculation correctness.

### Critical (SFC / Economic Integrity)

| # | Issue | Root Cause | Fix | Files |
|---|-------|-----------|-----|-------|
| 1 | Banking: unpaid loan interest vanishes from system | `accrueInterest()` returned 0 deltas when borrower can't pay — fiat silently destroyed | Compound unpaid interest onto `remainingBalance` so fiat is preserved | `bankingEngine.ts` |
| 2 | Banking: default loss not properly modeled | `processDefault()` trace computed loss but never applied correctly | Improved trace message; bank receives collateral, loss is balance sheet write-down on loanAssets | `bankingEngine.ts` |
| 3 | Capital Markets: dividend self-payment | Enterprise owners holding their own shares received dividends from themselves, causing incorrect wealth transfers | Filter out `ownerAgentId === ownerId` from dividend distribution | `capitalMarketEngine.ts` |
| 4 | Telemetry: m2, fiscalSpending, publicGoodsQuality never populated | Dashboard chart panels permanently blank — fields defined in TelemetryLog but never set in simulationRunner | Added `m2` calculation, `categorySpending` to FiscalDelta return type, `publicGoodsQuality` normalized values | `simulationRunner.ts`, `fiscalEngine.ts` |

### High (Broken Functionality)

| # | Issue | Root Cause | Fix | Files |
|---|-------|-----------|-----|-------|
| 5 | Agent age/weightKg not in DB — metabolic personalization broken | Fields defined on Agent type but no DB columns; always fell back to hardcoded 70kg/35yr | Added columns to schema, migration, agentRepo read/write | `schema.ts`, `agentRepo.ts`, `migrate.ts` |
| 6 | Cognitive post-processing used stale health/happiness deltas | Deltas captured during action resolution but never updated after banking/fiscal/capital ticks | Recalculate deltas from final agent stats minus start-of-iteration stats | `simulationRunner.ts` |
| 7 | Cortisol/dopamine not forwarded to memory formation | `CognitivePostInput` lacked cortisol/dopamine fields | Added fields to interface, populated from final stats | `cognitiveEngine.ts`, `simulationRunner.ts` |
| 8 | SSE errors not broadcast to frontend | `runSimulation().catch()` only logged to console; frontend hung forever | Broadcast error events to connected SSE clients | `simulate.ts` |

### Medium (Calculations / Config)

| # | Issue | Root Cause | Fix | Files |
|---|-------|-----------|-----|-------|
| 9 | `govBondCouponRate` default mismatch (0.004 vs 0.008) | `DEFAULT_ECONOMY_CONFIG` had 0.004, UI showed 0.008 | Aligned to 0.008 per documentation | `shared/types.ts` |
| 10 | Skill decay linear instead of proportional | Fixed -0.5/iteration regardless of level | Changed to proportional: `(level - MIN) * (rate / MAX)` | `skillSystem.ts` |
| 11 | AMM has no slippage protection | Any trade accepted regardless of price impact | Added 50% max slippage cap to `quoteBuy()`/`quoteSell()` | `automatedMarketMaker.ts` |
| 12 | Inflation telemetry undefined when disabled | CPI/inflationRate fields missing from telemetry when `inflationEnabled=false` | Initialized with defaults `{cpi: 100, inflationRate: 0, inflationExpectations: 0}` | `simulationRunner.ts` |

### Low (Dead Code / Cleanup)

| # | Issue | Root Cause | Fix | Files |
|---|-------|-----------|-----|-------|
| 13 | `resolveActionQueue()` dead code | Exported, fully implemented, never called | Removed function + 3 unused type interfaces | `physicsEngine.ts` |
| 14 | Deprecated action codes in allostatic engine | Orphaned `SLEEP`, `SET_WAGE`, `PRODUCE` cases; 14 banking/capital codes fell to default | Removed orphaned cases, added explicit handling for all banking/capital actions | `allostaticEngine.ts` |
| 15 | Missing fuzzy matches for deprecated LLM action codes | `TRADE`, `CONSUME`, `EAT` from old prompts normalized to `NONE` | Added fuzzy matches: TRADE->POST_BUY_ORDER, CONSUME/EAT->REST | `actionCodes.ts` |
| 16 | `isCentralAgent` confusing pattern | `row.type === 'central' \|\| undefined` produces `boolean \| undefined` | Changed to ternary for clarity | `agentRepo.ts` |
| 17 | scenarioStore TypeScript cast error | `DEFAULT_ECONOMY_CONFIG as Record<string, unknown>` failed strict check | Added `as unknown as` intermediate cast | `scenarioStore.ts` |

---

## Round 2: UI Display & Frontend-Backend Communication Audit

Focused on chart rendering, SSE event shapes, error handling, and state management.

### Critical (Data Never Reaches UI)

| # | Issue | Root Cause | Fix | Files |
|---|-------|-----------|-----|-------|
| 18 | Bond yields never populated in telemetry | No code computed weighted avg coupon rates from active holdings | Compute gov/corp weighted avg coupons after capital markets tick, add to telemetry | `simulationRunner.ts` |
| 19 | `saveBudgetAllocation()` zero error handling | PUT request with no `res.ok` check, no error state | Added response check + error state propagation | `sessionDetailStore.ts` |
| 20 | `handleStartSimulation()` navigates on failure | `navigate()` runs even if `startSimulation()` throws | Wrapped in try/catch; navigate only on success | `DesignReview.tsx` |
| 21 | `updateEconomyConfig()` optimistic without rollback | Local state updated before API confirmed; failure leaves UI lying | Wrapped in try/catch with error state | `sessionDetailStore.ts` |
| 22 | `forkSimulation()` no response check | Parsed JSON without checking HTTP status | Added `res.ok` check before parsing | `simulationStore.ts` |
| 23 | RAF not cancelled on SSE error | `es.onerror` closed EventSource but left pending requestAnimationFrame | Cancel RAF in error handler | `simulationStore.ts` |
| 24 | `lastSeenId` not reset for new simulation | Old sequence IDs rejected new events as duplicates | Reset `lastSeenId` on `iteration-start` with iteration <= 1 | `simulationStore.ts` |

### High (Race Conditions)

| # | Issue | Root Cause | Fix | Files |
|---|-------|-----------|-----|-------|
| 25 | `loadMacroHistory` race — stale data overwrites fresh | Every iteration-complete triggers async fetch; older responses can arrive after newer ones | Generation counter discards stale responses; added 1000-entry cap | `simulationStore.ts` |
| 26 | Agent stat save clears edit on failure | Edit state cleared regardless of PATCH success | Only clear on success; preserve user value on failure | `DesignReview.tsx` |
| 27 | Optimistic message ID collision | `temp-${Date.now()}` can collide within same millisecond | Changed to `crypto.randomUUID()` | `sessionDetailStore.ts` |
| 28 | `runAllScenarios` no concurrent guard | Double-click starts two overlapping scenario batches | Return early if `runningScenarios` already true | `scenarioStore.ts` |

### Medium (Validation / Cleanup)

| # | Issue | Root Cause | Fix | Files |
|---|-------|-----------|-----|-------|
| 29 | SimulationEvent type mismatches | Server used `unknown[]` and `Record<string, unknown>` where frontend expected typed shapes | Tightened types for `resolution` and `iteration-complete` events | `simulationManager.ts` |
| 30 | Reflection/Artifacts pages silently swallow errors | All catches empty | Added console.warn logging | `Reflection.tsx` |
| 31 | ScenarioTabs initialization timing | Two useEffects with empty deps + config deps out of sync | Merged into single useEffect with proper dependency | `ScenarioTabs.tsx` |
| 32 | DesignReview useEffect missing dependencies | Missing `id` and `navigate` in dependency array | Added missing deps | `DesignReview.tsx` |
| 33 | `agentCount` not validated | No min/max clamping on bootstrap agent count | Clamped to [5, 200] in setter | `bootstrapStore.ts` |
| 34 | `updateLockedVariables` no error handling | Async call without try/catch | Wrapped with error state | `sessionDetailStore.ts` |

---

## Round 3: Integration Audit

Focused on cross-phase wiring, session lifecycle, pause/resume continuity, and DB schema consistency.

### Critical (Broken E2E Flows)

| # | Issue | Root Cause | Fix | Files |
|---|-------|-----------|-----|-------|
| 35 | Creative mode: no EconomyConfig — all economy subsystems disabled | `generateDesign()` never creates economyConfig; sessions reach simulation with `config=null` | Inject `DEFAULT_ECONOMY_CONFIG` + bank agent after design generation | `centralAgent.ts` |
| 36 | Enterprise/Employment registries never cleaned or restored | Module-level Maps leaked across sessions; not restored on resume | Added cleanup to all 3 paths (abort, completion, error) | `simulationRunner.ts` |
| 37 | Fiscal multipliers lost on pause/resume | `sessionFiscalMultipliers` never restored from DB | Rebuild from `publicGoodsState` via new `getMultiplierEffectsFromQuality()` | `simulationRunner.ts`, `fiscalEngine.ts` |
| 38 | Inflation state lost on pause/resume | `sessionInflationState` never restored from DB | Restore CPI/rate/expectations from latest `macroSnapshots` row | `simulationRunner.ts` |

### High (Data Integrity)

| # | Issue | Root Cause | Fix | Files |
|---|-------|-----------|-----|-------|
| 39 | `sessionLastActionResults` missing from abort cleanup | Cleaned at completion but not abort | Added to abort cleanup path | `simulationRunner.ts` |
| 40 | `sessionPriceHistory` never cleaned | Missing from all cleanup paths | Added to all 3 cleanup paths | `simulationRunner.ts` |
| 41 | `roleChanges` table never written during simulation | Schema existed, import/export worked, but role_change lifecycle events never persisted | Insert role changes in iteration commit transaction | `simulationRunner.ts` |

---

## Round 4: Final Close Audit

Focused on LLM parsing, action correctness, and remaining logic errors.

### Critical (Incorrect Simulation Results)

| # | Issue | Root Cause | Fix | Files |
|---|-------|-----------|-----|-------|
| 42 | LLM outcome deltas hardcoded to 0 | `parseResolutionStrict()` set `wealthDelta/healthDelta/happinessDelta = 0` instead of parsing | Now uses `clampDelta()` to parse and clamp [-30, 30] | `parsers/simulation.ts` |
| 43 | SUPPRESS penalty lost based on agent ordering | Penalty applied inside per-agent loop via `statUpdates.find()` — target's update may not exist yet | Collect into `pendingSuppressPenalties[]`, apply in separate pass after all agents processed | `simulationRunner.ts` |
| 44 | Empty agentId in parsed outcomes creates unmatchable records | `String(o.agentId ?? '')` accepted empty string | Filter out outcomes with empty agentId | `parsers/simulation.ts` |
| 45 | `buildPersonalStatus` hides enterprise ownership when employed | Employment checked first; owner-entrepreneurs always shown as employees | Check ownership first, then employment | `simulationRunner.ts` |

### High (Data Integrity)

| # | Issue | Root Cause | Fix | Files |
|---|-------|-----------|-----|-------|
| 46 | `asyncLogFlusher` clears queue before transaction commits | `queue.splice(0)` ran before transaction; failed transaction lost rows permanently | Splice only after successful commit; retain on failure for retry | `asyncLogFlusher.ts` |
| 47 | `broadcast()` modifies Set during iteration | `state.clients.delete(client)` inside `for...of` loop | Collect failed clients first, delete in separate loop | `simulationManager.ts` |
| 48 | `fork-simulation` loses full economyConfig | Config replaced with `{totalIterations: N}` discarding all economy params | Merge source config with totalIterations override | `sessions.ts` |
| 49 | Export/Import missing agent age/weightKg | New DB columns not in export/import mapping | Added to both export and import | `importexport.ts` |

### Medium (Robustness)

| # | Issue | Root Cause | Fix | Files |
|---|-------|-----------|-----|-------|
| 50 | Empty LLM response returns '' silently | Provider returned empty string with no error | Throw with `finish_reason` context | `openai.ts` |
| 51 | `retryWithHealing` appends empty assistant message | `lastRaw` still '' when error occurs before chat completes | Only append when `lastRaw` is non-empty | `retryWithHealing.ts` |
| 52 | SFC drift tolerance too lenient at scale | Linear `agents * 0.01` — 100 agents = 1.0 fiat tolerance | Changed to logarithmic `log2(agents) * 0.05` | `simulationRunner.ts` |
| 53 | Prompt says MUST for unenforced employment rule | "MUST include WORK_AT_ENTERPRISE" with no backend enforcement | Changed to SHOULD with explanatory phrasing | `prompts.ts` |
| 54 | Silent catches in `getSessionTelemetry()` | Malformed rows and DB errors silently swallowed | Added `console.warn` logging | `simulationRunner.ts` |

---

## Round 5: Robustness Audit

Focused on NaN propagation, edge cases, error boundaries, and defensive coding.

### P0 (Crash / Corruption Prevention)

| # | Issue | Root Cause | Fix | Files |
|---|-------|-----------|-----|-------|
| 55 | `clampStat()` lacks NaN guard | `Math.max(0, Math.min(100, NaN))` returns NaN | Added `Number.isFinite()` check; returns 50 on NaN | `simulationRunner.ts` |
| 56 | `clampWealth()` lacks NaN guard | `Math.max(0, NaN)` returns NaN | Added `Number.isFinite()` check; returns 0 on NaN | `simulationRunner.ts` |
| 57 | `r4()` rounding lacks NaN guard | `Math.round(NaN * 10000)` returns NaN | Added `Number.isFinite()` check; returns 0 on NaN | `simulationRunner.ts` |
| 58 | Negative enterprise wealth produces negative share price | `calcSharePrice()` divides wealth by shares without checking sign | Added `if (wealth <= 0) return 0` guard | `capitalMarketEngine.ts` |
| 59 | Fiscal SFC violation: treasury spent with no recipients | Treasury deducted when all agents dead — money destroyed | Set `totalSpending = 0` when `agentCount === 0`; explicit `-0` → `0` guard | `fiscalEngine.ts` |
| 60 | Gini coefficient: near-zero mean division | `mean === 0` check insufficient for IEEE-754 floating-point | Use `!Number.isFinite(mean) \|\| mean <= 0`; check result finiteness | `simulationRunner.ts` |

### P1 (Memory / Resource Safety)

| # | Issue | Root Cause | Fix | Files |
|---|-------|-----------|-----|-------|
| 61 | `sessionLastPhysicsTraces` grows unbounded | String concatenation every iteration, never trimmed | `appendTrace()` helper with 50KB cap (keeps most recent) | `simulationRunner.ts` |
| 62 | No React error boundaries | Single component crash kills entire app | `ErrorBoundary` component wrapping all routes | `ErrorBoundary.tsx`, `App.tsx` |
| 63 | Design generation reader not cancellable | ReadableStream reader continues after unmount | AbortController on fetch; `reset()` aborts in-flight stream | `sessionDetailStore.ts` |

### P2 (Defensive Coding)

| # | Issue | Root Cause | Fix | Files |
|---|-------|-----------|-----|-------|
| 64 | Unsafe `!` assertion on `weekStateMap.get()` in telemetry | Could crash if agent somehow absent from map | Safe `.get()` with fallback in `avgSkillLevel` calculation | `simulationRunner.ts` |
| 65 | Missing DB indexes on frequently queried columns | Full table scans on `agent_id`, `(session_id, context)` | Added 4 composite indexes in migration | `migrate.ts` |

---

## Files Modified (Complete List)

### Server

| File | Changes |
|------|---------|
| `server/src/orchestration/simulationRunner.ts` | NaN guards, telemetry population, cognitive deltas, registry cleanup/restore, SUPPRESS ordering, buildPersonalStatus, trace capping, gini safety, SFC tolerance, logging |
| `server/src/mechanics/bankingEngine.ts` | Interest compounding, default trace |
| `server/src/mechanics/capitalMarketEngine.ts` | Dividend self-payment filter, negative share price guard |
| `server/src/mechanics/fiscalEngine.ts` | categorySpending return, getMultiplierEffectsFromQuality, SFC no-agent fix |
| `server/src/mechanics/automatedMarketMaker.ts` | Slippage protection |
| `server/src/mechanics/skillSystem.ts` | Proportional skill decay |
| `server/src/mechanics/allostaticEngine.ts` | Explicit banking/capital action cases |
| `server/src/mechanics/actionCodes.ts` | Deprecated code fuzzy matches |
| `server/src/mechanics/physicsEngine.ts` | Dead code removal |
| `server/src/parsers/simulation.ts` | Outcome delta parsing, empty agentId filtering |
| `server/src/orchestration/simulationManager.ts` | Typed events, safe Set iteration in broadcast |
| `server/src/orchestration/concurrencyPool.ts` | (no changes needed) |
| `server/src/llm/centralAgent.ts` | Creative mode EconomyConfig injection + bank agent |
| `server/src/llm/openai.ts` | Empty response detection |
| `server/src/llm/retryWithHealing.ts` | Empty lastRaw guard |
| `server/src/llm/prompts.ts` | MUST → SHOULD for employment rule |
| `server/src/routes/simulate.ts` | SSE error broadcast |
| `server/src/routes/sessions.ts` | fork-simulation config preservation |
| `server/src/routes/importexport.ts` | Agent age/weightKg in export/import |
| `server/src/db/schema.ts` | Agent age/weightKg columns |
| `server/src/db/migrate.ts` | Column migrations, performance indexes |
| `server/src/db/repos/agentRepo.ts` | age/weightKg read/write, isCentralAgent fix |
| `server/src/db/asyncLogFlusher.ts` | Safe queue splice after commit |
| `server/src/cognition/cognitiveEngine.ts` | cortisolDelta/dopamineDelta in CognitivePostInput |
| `server/src/cognition/__tests__/phase3.test.ts` | Updated test for new interface |
| `server/src/__tests__/sfcFiscal.test.ts` | Updated test for no-agent SFC fix |

### Shared

| File | Changes |
|------|---------|
| `shared/src/types.ts` | govBondCouponRate default aligned to 0.008 |

### Web (Frontend)

| File | Changes |
|------|---------|
| `web/src/stores/simulationStore.ts` | forkSimulation check, RAF cancel, lastSeenId reset, loadMacroHistory race guard, macroHistory cap |
| `web/src/stores/sessionDetailStore.ts` | Error handling (budget, config, locked vars), crypto.randomUUID, design generation abort |
| `web/src/stores/scenarioStore.ts` | Concurrent guard, TypeScript cast fix |
| `web/src/stores/bootstrapStore.ts` | agentCount validation |
| `web/src/pages/DesignReview.tsx` | Navigation error handling, stat save rollback, useEffect deps |
| `web/src/pages/Reflection.tsx` | Error logging instead of silent catches |
| `web/src/components/ScenarioTabs.tsx` | Merged useEffect initialization |
| `web/src/components/ErrorBoundary.tsx` | **New file** — React error boundary |
| `web/src/App.tsx` | ErrorBoundary wrapper around routes |

---

---

## Round 6: Final Comprehensive Audit (2026-04-05)

Full codebase scan with 5 parallel audit agents covering all modules. Found and fixed additional issues missed by rounds 1-5.

### Critical Issues Fixed

| # | Issue | Fix | Files |
|---|-------|-----|-------|
| 1 | `AgentReview.tsx:59` — `loadChatHistory` used before `const` declaration | Moved function declaration above useEffect | `AgentReview.tsx` |
| 2 | `Reflection.tsx:62` — `loadSocietyStats` used before declaration | Moved function declaration above useEffect | `Reflection.tsx` |
| 3 | `eraseSimulationData` missing 10 tables on abort-reset | Added orderBook, depositAccounts, loanContracts, bankBalanceSheets, macroSnapshots, equityPositions, bondHoldings, fiscalBudgets, publicGoodsState | `simulate.ts` |
| 4 | Export route missing try-catch + unsafe JSON.parse | Wrapped in try-catch, safe JSON.parse for agent stats | `importexport.ts` |
| 5 | `distributeDividends` no guard for negative wealth | Added `wealth <= 0` early return | `capitalMarketEngine.ts` |
| 6 | `simulationManager.finish()` skipped on error-path exception | Wrapped broadcast in try-catch so finish() always runs | `simulationRunner.ts` |

### High Issues Fixed

| # | Issue | Fix | Files |
|---|-------|-----|-------|
| 7 | Bootstrap SSE missing `req.on('close')` cleanup | Added client disconnect handler | `bootstrap.ts` |
| 8 | `fork-simulation` loses fiscal budget | Added budget copy | `sessions.ts` |
| 9 | Division by zero in newAvgCostBasis | Added `newShares > 0` guard | `capitalMarketEngine.ts` |
| 10 | Infinity in `ticksUntilDisease()` | Added `1e-10` floor + `isFinite` check | `allostaticEngine.ts` |
| 11 | Reflection error not broadcast to SSE | Added error broadcast + finish() call | `reflect.ts` |
| 12 | `createBudget` not transactional with config | Wrapped in try-catch | `sessions.ts` |
| 13 | Stale closure — `id` missing from reflection useEffect deps | Added `id` to dependency array | `Reflection.tsx` |

### Medium + Low Issues Fixed

- asyncLogFlusher retry limit (5 max), bankReserves NaN guard, simulationStore `const macroHistory`, EconomicDashboard EMA refactor, TelemetryPanel `const` fix, 6 unused variables removed, 6 `any` types replaced with proper types

---

## Round 7: Modularity Refactoring (2026-04-05)

Structural improvements to reduce coupling and enable isolated module testing. See MODULE_MAP.md for full details.

| Task | Change | Files |
|---|---|---|
| A1: orderBook DB extraction | Created `db/repos/orderBookRepo.ts`; orderBook no longer imports raw db/ | `orderBookRepo.ts` (new), `orderBook.ts` |
| A3: prompts decoupled | Removed `getSubconsciousDrive` import; parameter passed by caller | `prompts.ts`, `simulationRunner.ts` |
| A4: AMMState to shared | Moved interface to `shared/types.ts` | `types.ts`, `automatedMarketMaker.ts`, `economyRepo.ts` |
| B2: session state extraction | 14 Maps + cleanup moved to `simulationState.ts` | `simulationState.ts` (new), `simulationRunner.ts` |
| B3: telemetry extraction | `getSessionTelemetry` moved to `telemetryCollector.ts` | `telemetryCollector.ts` (new), `simulationRunner.ts` |

---

## Round 8: SSE Race, Governance Persistence, Comparison Calibration (2026-04-13)

Three bugs surfaced during a simulation playthrough: agent action codes failed to populate for iteration 1, governance session narratives vanished from the Live Feed after page reload, and comparison scores collapsed into an indistinguishable low band.

### Critical (User-Facing Display Loss)

| # | Issue | Root Cause | Fix | Files |
|---|-------|-----------|-----|-------|
| 1 | Iter 1 agent action codes never recorded in per-agent history; card headers go blank when iter 2 begins; iter 1 missing from iter 3+ history | Late SSE subscription race — client connects after server has already emitted `iteration-start` for iter 1 (start button → fire-and-forget runner → navigate → page mount → SSE connect). `currentIteration` stays at initial `0`. The `currentIteration > 0` guard on history append silently drops every iter 1 `agent-intent` event. Compounded by an unconditional `pendingActionCodes = {}` wipe at each iteration-start that erased card-header content until the next per-agent intent arrived | Carry `iteration` on the `agent-intent` SSE payload; key history off the event's iteration not the client counter; advance `currentIteration` from `agent-intent` as a fallback when `iteration-start` was missed; stop wiping `pendingActionCodes` at iteration-start; tag pending entries with their iteration and gate "fresh" display on `pending.iteration === currentIteration`, falling back to latest history otherwise | `simulationManager.ts`, `simulationRunner.ts`, `simulationStore.ts`, `Simulation.tsx` |
| 2 | Governance session narratives (every-5-iter legislative cycle) missing from Live Feed after page reload; live view also overwrote regular iter-N resolution | Governance summary was only broadcast via SSE — no DB write. Broadcast also reused `type: 'resolution'` with same iteration number as the regular resolution, so the frontend feed merge `{ ...feed[idx], ...entry }` silently clobbered the original iter-5 narrative during live viewing | Append governance summary to the iteration row's `state_summary` (markdown HR + bold header) so DB carries both halves and reload renders identically to live. New `governance-summary` SSE event type carrying `{ iteration, summary }`; frontend handler appends to `feed[iter].narrativeSummary` rather than overwriting | `simulationManager.ts`, `simulationRunner.ts`, `simulationStore.ts` |

### High (LLM Calibration / Cross-Session UX)

| # | Issue | Root Cause | Fix | Files |
|---|-------|-----------|-----|-------|
| 3 | Compare screen frequently shows clustered low scores (e.g. 3 vs 4 on /100), making side-by-side bars visually indistinguishable | Comparison system prompt instructed LLM to "score conservatively" with no rubric anchoring 0/50/100, no calibration baseline, and no anti-clustering directive — LLM defaulted to its internal harsh rubric and collapsed both sessions into the 0–20 band | Added explicit 0–100 rubric bands to the comparison system prompt (severe failure → excellent), calibration anchor ("a small non-collapsed sim should land 40–60"), and directive against collapsing same-band scores to identical numbers. Added a Δ badge per dimension row colored by the leading session. Diagnostic warn-log triggers when ≥5/8 dimensions have both scores < 20, to catch future prompt-calibration regressions | `comparison.ts`, `compare.ts`, `CompareSessions.tsx` |

### Reverted Changes

| Change | Reason |
|--------|--------|
| Relative-spread (local-max) score bar scaling on Compare screen | User preferred absolute 0–100 visualization for direct readability; bars restored to `width: ${score}%`. Δ badge retained as a scale-neutral comparison aid |

### Commits

- `3503cf5` — fix(simulation): agent action codes now persist for iteration 1 and across iteration boundaries
- `8e70ffb` — fix(simulation,compare): persist governance sessions and calibrate comparison scoring
- `8a6f990` — revert(compare): restore absolute 0-100 score bars

---

## Known Remaining Items (Documented, Not Blocking)

These are items identified during audits that are acceptable as-is or deferred for future work:

1. **Export missing 7 non-critical tables** (agentIntents, resolvedActions, economySnapshots, agentEconomy, ammSnapshots, marketPrices, orderBook) — export format would need a version bump; current export captures all configuration and final state needed for replay
2. **`artifacts` table is dead code** — schema exists but never written; remove if not planned for future use
3. **Hardcoded RGBA colors in frontend** — ~15 instances use inline rgba() instead of CSS variables; cosmetic
4. **TelemetryPanel doesn't display error message** — shows "no data" instead of actual error; minor UX
5. **Early stopping thresholds may be too lenient** — avgCortisol >= 95 / avgHappiness <= 5 triggers late; tuning question
6. **No DB migration version tracking** — migrations are idempotent via try-catch/IF NOT EXISTS but lack a formal version table
7. **`asyncLogFlusher` could duplicate on hard process crash** — splice after commit is safe for transaction failure but process crash between commit and splice could cause re-insertion on restart
8. **centralAgent.ts still has direct DB writes** — generateDesign() and refine() interleave LLM + DB; full extraction deferred (requires SSE callback redesign)
9. **simulationRunner.ts still 3,854 lines** — subsystem tick extraction (B1) deferred due to deep interleaving; state + telemetry extracted
10. **Test coverage at 26%** — see MODULE_MAP.md Section 5 for prioritized test plan (Waves 1-6)
11. **7 ESLint errors remaining** — all false positives from React Compiler rules (setState in effects, window.location.href assignment)
12. **Frontend has zero tests** — highest-risk stores: simulationStore, scenarioStore, bootstrapStore
