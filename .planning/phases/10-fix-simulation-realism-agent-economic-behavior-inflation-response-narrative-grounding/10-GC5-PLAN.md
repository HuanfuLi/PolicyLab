# GC5: Post-Simulation Review Fixes

## Context
After running two simulation sessions (China baseline + forked with 10.5x higher interest rate), human review identified 6 issues that GC1-GC4 did not address:

1. **Dopamine metric stuck** — dopamine decay (-3/iter) nearly cancels all action gains (+1 to +2), making the metric visually inert
2. **Infrastructure/Education quality saturates in 3 iterations** — `totalEconomyFiat` not passed to `executeBudget()`, so GDP-scaled formula was dead code
3. **Central Analysis ignores config diffs** — comparison prompt never included EconomyConfig parameter changes
4. **Narrative mismatch with real data** — LLM lacks per-iteration time-series, invents trends
5. **Bank agent uses citizen actions (REST, STEAL, etc.)** — `BANK_ACTIONS` inherited all `BASE_ACTIONS`
6. **Bank agent narrates personal emotions** — same citizen prompt template used for institutional agents

## Root Cause Analysis
- Issue 1: Dopamine is a redundant axis (cortisol covers stress, happiness covers positive). **Decision: remove entirely.**
- Issue 2: One-line bug — `executeBudget()` call omits `totalEconomyFiat` parameter, causing fallback to legacy formula
- Issues 3-4: Information starvation — LLM cannot attribute differences to config changes or verify trends because the data isn't in the prompt
- Issues 5-6: Bank agents treated as citizens in both action permissions and prompt persona

## Tasks

### Task 1: Wire `totalEconomyFiat` into fiscal tick
- Compute `fiscalTotalEconomyFiat` from `statUpdates` + treasury before `executeBudget()` call
- Pass as `totalEconomyFiat` parameter to activate GDP-scaled public goods quality
- **Files:** `simulationRunner.ts`

### Task 2: Restrict bank agent actions
- Replace `BANK_ACTIONS = [...BASE_ACTIONS, ...]` with institutional-only action set
- Bank actions: ISSUE_LOAN, SET_INTEREST_RATE, POST_BUY_ORDER, POST_SELL_ORDER, DEPOSIT, WITHDRAW, BUY_BOND, NONE
- Central bank: all bank actions + SET_RESERVE_RATIO, SET_BASE_RATE
- **Files:** `actionCodes.ts`

### Task 3: Bank institutional prompt
- Detect `agent.type === 'bank'` or role 'bank'/'central_bank' in intent prompt builder
- Replace citizen persona (health/stress/drive/personality) with institutional mandate
- Mandate: price stability, liquidity management, reserve prudence
- Require institutional perspective in narrative ("The Central Bank..." not "I felt...")
- **Files:** `agent-intent.ts`

### Task 4: Remove dopamine system
- Make `dopamine` optional in `AgentStats` (backward compat with existing DB)
- Remove all dopamine delta calculations from `physicsEngine.ts`
- Remove `dopamineDecay` from `physicsConfig.ts`
- Remove dopamine from allostatic engine, telemetry, prompts, statistics UI
- Remove Dopamine StatCard from Simulation page
- Remove dopamine charts from TelemetryPanel, PhysicsLaboratory, Reflection
- **Files:** ~30 files across shared/, server/, web/

### Task 5: Enrich comparison prompt
- Add `configDiffs` parameter to `buildComparisonMessages()` with explicit instruction to attribute differences
- Add per-iteration time-series data (iter, wealth, health, happiness, gini, cpi, m1)
- Add wealth distribution summary (bottom 25%, median, top 25%)
- Update compare route to gather and pass all new data
- **Files:** `comparison.ts`, `compare.ts`

### Task 6: Expand telemetry digest window
- Change `buildTelemetryDigest()` from single-previous to recent history array (last 3-5 iters)
- Build compact multi-iteration trend table in digest
- Wire digest into resolution prompt call in `simulationRunner.ts`
- Update tests for new signature
- **Files:** `narrativeValidation.ts`, `simulationRunner.ts`, `narrativeValidation.test.ts`
