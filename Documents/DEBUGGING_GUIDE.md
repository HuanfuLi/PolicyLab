# PolicyLab Debugging Guide

> How to diagnose issues without reading the entire codebase.
> Each section is a decision tree: start with the symptom, follow the arrows.

---

## 1. The Golden Rule

**Identify which module owns the bug before touching any code.**

```
Symptom → Module → File → Function → Fix
```

Never grep the whole codebase. Use the module map below to narrow to 1-3 files, then debug within that boundary. If the fix requires changing a different module, that's a design smell — document why.

---

## 2. Symptom → Module Decision Tree

### "Simulation produces wrong numbers"

```
Is the SFC audit failing (drift warning in console)?
  YES → SFC violation. Check in this order:
    1. mechanics/physicsEngine.ts — is resolveAction creating/destroying fiat?
    2. orchestration/simulationRunner.ts — is a subsystem tick miscounting?
    3. mechanics/bankingEngine.ts — loan/deposit accounting off?
    4. mechanics/capitalMarketEngine.ts — share/bond accounting off?
  NO → Wrong but balanced. Check:
    Is a specific stat wrong (wealth/health/happiness)?
      → mechanics/physicsEngine.ts (resolveAction for that action code)
    Is metabolism/starvation wrong?
      → mechanics/allostaticEngine.ts (MET calculation)
    Are prices wrong?
      → mechanics/automatedMarketMaker.ts (buy/sell/spotPrice)
    Are skills progressing wrong?
      → mechanics/skillSystem.ts (processSkills)
    Is fiscal spending wrong?
      → mechanics/fiscalEngine.ts (executeBudget)
    Is inflation wrong?
      → mechanics/inflationEngine.ts (computeInflation)
```

**How to test:** Write a unit test in `mechanics/__tests__/` that calls the function directly with the failing input. No DB, no LLM needed.

```typescript
// Example: debugging a WORK action that gives wrong wealth
import { resolveAction } from '../physicsEngine.js';
const result = resolveAction({
  agent: mockAgent,
  action: 'WORK',
  // ... reproduce the exact scenario
});
console.log(result); // inspect deltas
```

### "Agent makes nonsensical decisions"

```
Is the action code wrong (e.g., starving agent does INVEST)?
  → Check role permissions: mechanics/actionCodes.ts (getAllowedActions)
  → Check prompt context: llm/prompts.ts (buildNaturalIntentPrompt)
  → Check if cognitive context is stale: cognition/cognitiveEngine.ts

Is the action code right but parameters wrong (e.g., buys from dead agent)?
  → Check target validation in simulationRunner.ts (intent collection phase ~L1560-1830)
  → Check parser: parsers/simulation.ts (parseSinglePassIntent)

Is the narrative disconnected from mechanics?
  → Check physics trace injection: simulationRunner.ts (appendTrace calls)
  → Check resolution prompt: llm/prompts.ts (buildResolutionPrompt)
```

**How to test:** Log the prompt messages sent to the LLM:
```typescript
// Temporarily in simulationRunner.ts before the provider.chat call:
console.log(JSON.stringify(messages, null, 2));
```

### "Frontend shows stale/wrong data"

```
Is the SSE stream not updating?
  → Check browser DevTools → Network → EventStream tab
  → Check simulationManager.broadcast() is called: orchestration/simulationManager.ts
  → Check store SSE handler: web/src/stores/simulationStore.ts (connectSSE)

Is data loading but displaying wrong?
  → Check the store's state shape: web/src/stores/<store>.ts
  → Check the API response: browser DevTools → Network → XHR
  → Check the component props: React DevTools

Is a specific chart wrong?
  → Check telemetry data: GET /api/sessions/:id/simulate/telemetry
  → Check chart component: web/src/components/EconomicDashboard.tsx
  → Check telemetry recording: orchestration/telemetryCollector.ts
```

### "Session won't start / gets stuck"

```
Is the session stuck in 'running' state?
  → simulationManager.finish() was never called
  → Check error path in simulationRunner.ts (catch block ~L3870)
  → Check simulationManager.ts state machine

Is the session stuck in 'designing'?
  → Design generation SSE failed silently
  → Check llm/centralAgent.ts (generateDesign)
  → Check routes/design.ts (error rollback to 'brainstorming')

Is bootstrap hanging?
  → Check routes/bootstrap.ts (SSE heartbeat + error handling)
  → Check data/locationDataService.ts (World Bank API timeouts)
  → Check web/src/stores/bootstrapStore.ts (SSE reader)
```

### "Import/export loses data"

```
Which data is missing after import?
  → Check routes/importexport.ts — find the table in the export query
  → Is the table included in the Promise.all on export? (lines 39-48)
  → Is there an import handler for that table? (lines 205-436)
  → Check agent ID remapping: agentIdMap (line 200)
```

### "Database errors (SQLITE_BUSY, constraint violations)"

```
Is it during simulation?
  → High-frequency writes should go through asyncLogFlusher: db/asyncLogFlusher.ts
  → Is the write going directly to db instead of the flusher?

Is it during abort-reset?
  → Check routes/simulate.ts eraseSimulationData() — does it delete from all 16 tables?

Is it a FK constraint error?
  → Check db/schema.ts for onDelete: 'cascade' — is it set on the FK?
  → Check db/migrate.ts — was the column added with ALTER TABLE (no FK support)?
```

---

## 3. Module Isolation Testing

The key advantage of the modular architecture: **you can test each module alone**.

### Mechanics (pure functions — easiest to debug)

```bash
# Run existing tests
npx vitest run server/src/mechanics/__tests__/banking.test.ts

# Write a quick one-off test
npx vitest run server/src/mechanics/__tests__/mytest.test.ts
```

These tests need zero setup — no DB, no server, no LLM. Import the function, pass data, check output.

### DB Repos (need SQLite)

```bash
npx vitest run server/src/db/repos/__tests__/agentRepo.test.ts
```

Repo tests use the real SQLite DB. If you need a clean DB, delete `~/.policylab/policylab.db` and restart.

### Routes (need the full server)

```bash
# Start the server
npm run dev -w server

# Test endpoints with curl
curl http://localhost:3000/api/sessions
curl -X POST http://localhost:3000/api/sessions -H 'Content-Type: application/json' -d '{"idea":"test"}'
```

### Frontend Stores (need mock fetch)

Currently no frontend tests exist. To debug stores, use browser DevTools:
```javascript
// In browser console — inspect Zustand store state
window.__ZUSTAND_DEVTOOLS__  // if devtools are enabled

// Or import in a component:
const state = useSimulationStore.getState();
console.log(state);
```

---

## 4. Common Debugging Workflows

### Workflow A: "A specific action code produces wrong results"

1. Find the action code in `mechanics/actionCodes.ts` — is it allowed for this role?
2. Find the physics case in `mechanics/physicsEngine.ts` → `resolveAction` switch statement
3. Check if there's an enterprise handler in `simulationRunner.ts` → `applyEnterpriseAction`
4. Write a unit test reproducing the exact agent state and action
5. Fix in the narrowest scope (physicsEngine if delta is wrong, simulationRunner if routing is wrong)

### Workflow B: "SFC drift detected"

1. Read the console warning: `[SFC] iter=N: drift=X`
2. The drift amount is the clue:
   - Multiple of 10 → INVEST or FOUND_ENTERPRISE routing issue
   - Small fractional → AMM rounding (check automatedMarketMaker assertInvariant)
   - Large → A subsystem tick is miscounting (check banking/capital/fiscal tick blocks)
3. Add temporary logging in the SFC assertion block (~L3663 in simulationRunner.ts) to trace which component changed
4. Fix the leak, verify with `npm run test -w server` (SFC tests will catch regressions)

### Workflow C: "LLM returns garbage / parse error"

1. Check which parser failed: `parsers/simulation.ts` or `parsers/json.ts`
2. Check `retryWithHealing` in `llm/retryWithHealing.ts` — did all retries exhaust?
3. Log the raw LLM response before parsing:
   ```typescript
   console.log('[DEBUG] Raw LLM response:', raw.slice(0, 2000));
   ```
4. Common causes:
   - Prompt too long (context window exceeded) → check token count in prompts.ts
   - Model changed (different JSON format) → update parser expectations
   - Rate limited → check provider error messages

### Workflow D: "Frontend store out of sync with backend"

1. Open browser DevTools → Network tab
2. Find the API call that should have updated the state
3. Check the response — does it contain the expected data?
4. If response is correct but UI is wrong → store is not processing it (check the store action)
5. If response is wrong → backend bug (check the route handler)
6. If no API call was made → component didn't trigger the action (check useEffect deps)

---

## 5. File Lookup Quick Reference

**"Where is the code that handles X?"**

| If you're looking for... | Look in... |
|---|---|
| Action resolution (WORK, BUY, STEAL...) | `mechanics/physicsEngine.ts` → `resolveAction` |
| Agent health/metabolism | `mechanics/allostaticEngine.ts` |
| Market prices | `mechanics/automatedMarketMaker.ts` |
| Loan/deposit logic | `mechanics/bankingEngine.ts` |
| Share/bond logic | `mechanics/capitalMarketEngine.ts` |
| Budget spending | `mechanics/fiscalEngine.ts` |
| CPI/inflation | `mechanics/inflationEngine.ts` |
| LLM prompts | `llm/prompts.ts` (2,024 lines — search by function name) |
| Simulation main loop | `orchestration/simulationRunner.ts` (~L1065 = runSimulation) |
| Session state Maps | `orchestration/simulationState.ts` |
| Telemetry retrieval | `orchestration/telemetryCollector.ts` |
| SSE broadcast | `orchestration/simulationManager.ts` |
| Route handlers | `routes/<domain>.ts` (simulate, sessions, bootstrap, etc.) |
| DB table definitions | `db/schema.ts` |
| DB read/write operations | `db/repos/<domain>Repo.ts` |
| Frontend state | `web/src/stores/<domain>Store.ts` |
| Shared types | `shared/src/types.ts` |

For the complete export list per file, see `MODULE_MAP.md`.

---

## 6. Debugging with AI Agents

When asking an AI agent to debug an issue:

1. **Tell it which module** — "The bug is in `mechanics/bankingEngine.ts`, specifically in `processRepayment`"
2. **Give it the symptom** — "Loan repayment reduces deposit by more than the payment amount"
3. **Give it the test** — "Run `npx vitest run server/src/mechanics/__tests__/banking.test.ts`"
4. **Tell it the boundary** — "Only modify `bankingEngine.ts`. Do not touch simulationRunner or any other file."

This prevents the agent from making sprawling changes across modules. The modular architecture makes this possible — each module can be diagnosed and fixed in isolation.

If the agent needs context about how a module is called, point it to `MODULE_MAP.md` rather than having it read the full codebase.

---

## 7. Copy-Paste Prompt Templates

Use these templates with any AI coding agent (Claude Code, Cursor, Copilot, etc.). Fill in the `[bracketed]` placeholders.

---

### Template A: Mechanics Engine Bug

> **Context:** Read `MODULE_MAP.md` Section M1 and `Documents/DEBUGGING_GUIDE.md` Section 2.
>
> **Bug:** The `[ACTION_CODE]` action in `server/src/mechanics/[ENGINE_FILE].ts` produces wrong results. Specifically: [DESCRIBE WHAT'S WRONG — e.g., "wealth delta is -10 but should be 0 because the economy layer handles the cost"].
>
> **Reproduce:** Call `[FUNCTION_NAME]` with these inputs:
> ```
> [PASTE THE INPUT DATA OR DESCRIBE THE SCENARIO]
> ```
> Expected output: [WHAT YOU EXPECT]
> Actual output: [WHAT YOU GET]
>
> **Scope:** Only modify `server/src/mechanics/[ENGINE_FILE].ts`. Do not touch simulationRunner.ts or any other file. If the fix requires changes elsewhere, tell me which file and why instead of making the change.
>
> **Verify:** Run `npx vitest run server/src/mechanics/__tests__/[TEST_FILE].test.ts` and confirm all tests pass. If no test covers this case, write one.

**Example filled in:**

> **Context:** Read `MODULE_MAP.md` Section M1 and `Documents/DEBUGGING_GUIDE.md` Section 2.
>
> **Bug:** The `WORK` action in `server/src/mechanics/physicsEngine.ts` produces wrong results. Specifically: agents with the "farmer" role get wealth +5 but should get +8 based on the skill multiplier.
>
> **Reproduce:** Call `resolveAction` with a farmer agent who has farming skill level 3 and the WORK action. Expected wealthDelta: 8. Actual: 5.
>
> **Scope:** Only modify `server/src/mechanics/physicsEngine.ts`. Do not touch simulationRunner.ts or any other file.
>
> **Verify:** Run `npx vitest run server/src/mechanics/__tests__/edgeCases.test.ts` and add a test case for farmer WORK with skill level 3.

---

### Template B: SFC Violation

> **Context:** Read `MODULE_MAP.md` Section M1 and the SFC accounting rules in `CLAUDE.md`. The economy is closed-loop: M0 must remain constant, M1 = M0 + net loans outstanding. Bank agents are excluded from citizen fiat sum in `computeSystemFiatTotal`.
>
> **Bug:** The SFC audit is reporting drift of [AMOUNT] per iteration. Console shows: `[SFC] iter=[N]: drift=[X]`.
>
> The drift amount suggests: [YOUR HYPOTHESIS — e.g., "multiples of 40, which is the FOUND_ENTERPRISE cost" or "small fractional amounts, likely AMM rounding"].
>
> **Investigate:** Read `server/src/orchestration/simulationRunner.ts` around the SFC assertion block (~search for "SFC assertion"). Trace where fiat enters/leaves the system for the suspected subsystem. Check these files in order:
> 1. `server/src/mechanics/[SUSPECTED_ENGINE].ts`
> 2. The corresponding tick block in `simulationRunner.ts`
>
> **Scope:** Fix the fiat leak. Every wealth transfer must be zero-sum. Do not suppress the drift warning — fix the root cause.
>
> **Verify:** Run `npm run test -w server` — all 195 tests must pass, especially the SFC test suites (`sfcBanking`, `sfcCapitalMarkets`, `sfcFiscal`, `sfcInflation`, `sfc-unrounded`).

---

### Template C: LLM / Prompt Issue

> **Context:** Read `MODULE_MAP.md` Section M3. All prompts are in `server/src/llm/prompts.ts`. The simulation uses `buildNaturalIntentPrompt` for agent decisions and `buildResolutionPrompt` for narrative synthesis.
>
> **Bug:** [DESCRIBE — e.g., "Agents keep choosing REST even when starving" or "The narrative contradicts the physics trace" or "JSON parse error on agent intent"].
>
> **Investigate:**
> 1. Read the relevant prompt builder function in `server/src/llm/prompts.ts`: `[FUNCTION_NAME]`
> 2. Check if the context being passed is correct (economy context, cognitive context, allowed actions, etc.)
> 3. If it's a parse error, check `server/src/parsers/simulation.ts` — is the parser expecting the right JSON schema?
>
> **Scope:** Only modify `server/src/llm/prompts.ts` and/or `server/src/parsers/simulation.ts`. Prompt changes must not change the function signature — only the message content. If the function signature needs to change, the caller in `simulationRunner.ts` must also be updated.
>
> **Verify:** Run `npm run test -w server` and manually inspect the prompt output by temporarily logging it.

---

### Template D: Frontend State / UI Bug

> **Context:** Read `MODULE_MAP.md` Sections M10-M12. Frontend uses 8 Zustand stores with zero cross-store coupling. SSE streams are consumed by `simulationStore` and `reflectionStore`.
>
> **Bug:** [DESCRIBE — e.g., "The economic dashboard shows flat lines during simulation" or "Pause button doesn't work" or "Bootstrap progress bar stuck at step 2"].
>
> **Investigate:**
> 1. Check the store: `web/src/stores/[STORE_NAME].ts` — is the state being updated correctly?
> 2. Check the API response: what does `[API_ENDPOINT]` return?
> 3. If SSE: check the `connectSSE` method in the store — is it handling the event type?
> 4. If component: check `web/src/[pages|components]/[COMPONENT].tsx` — is it reading from the right store field?
>
> **Scope:** Only modify files in `web/src/`. Do not modify server files. If the server response is wrong, tell me which endpoint and what's wrong instead of fixing it.
>
> **Verify:** Run `npx tsc --noEmit -p web/tsconfig.app.json` (zero type errors) and `npm run lint -w web` (no new errors). Test manually in the browser.

---

### Template E: Route / API Bug

> **Context:** Read `MODULE_MAP.md` Section M8. Routes are in `server/src/routes/`. Each route file is mounted at a URL prefix listed in the module map.
>
> **Bug:** The endpoint `[METHOD] [URL]` returns [WRONG BEHAVIOR — e.g., "500 error", "missing field in response", "doesn't persist to DB"].
>
> **Investigate:**
> 1. Find the handler in `server/src/routes/[ROUTE_FILE].ts`
> 2. Check the DB query — is it reading/writing the correct table? Check `server/src/db/repos/[REPO].ts` if it uses a repo.
> 3. Check the response shape — does it match what the frontend expects? Check `shared/src/types.ts` for the contract.
>
> **Scope:** Only modify `server/src/routes/[ROUTE_FILE].ts` and possibly the corresponding repo in `server/src/db/repos/`. Do not modify mechanics engines or the simulation loop.
>
> **Verify:** Run `npx tsc --noEmit -p server/tsconfig.json` and test the endpoint with curl:
> ```bash
> curl -X [METHOD] http://localhost:3000[URL] -H 'Content-Type: application/json' -d '[BODY]'
> ```

---

### Template F: Database / Migration Issue

> **Context:** Read `MODULE_MAP.md` Section M2. Schema is in `server/src/db/schema.ts` (26 tables). Migrations are in `server/src/db/migrate.ts` (idempotent via IF NOT EXISTS / try-catch). DB file is at `~/.policylab/policylab.db`.
>
> **Bug:** [DESCRIBE — e.g., "New column missing after restart" or "SQLITE_BUSY during simulation" or "FK constraint violation on import"].
>
> **Investigate:**
> 1. Check the table definition in `server/src/db/schema.ts`
> 2. Check if there's a migration in `server/src/db/migrate.ts` that adds the column
> 3. If SQLITE_BUSY: check if the write should go through `server/src/db/asyncLogFlusher.ts` instead of direct db access
> 4. If FK error: check if `onDelete: 'cascade'` is set on the FK in schema.ts
>
> **Scope:** Only modify files in `server/src/db/`. Schema changes require a corresponding migration in `migrate.ts`.
>
> **Verify:** Delete `~/.policylab/policylab.db`, restart the server (auto-migrates), and test the operation.

---

### Template G: General Investigation (don't know the module yet)

> **Context:** Read `MODULE_MAP.md` for the full module architecture and `Documents/DEBUGGING_GUIDE.md` for the symptom decision tree.
>
> **Bug:** [DESCRIBE THE SYMPTOM IN DETAIL — what you see, what you expected, and when it happens].
>
> **DO NOT fix anything yet.** Instead:
> 1. Use the symptom decision tree in DEBUGGING_GUIDE.md Section 2 to identify which module owns this bug
> 2. Read only the files in that module (listed in MODULE_MAP.md)
> 3. Report back: which file, which function, what's wrong, and what the fix should be
> 4. Wait for my approval before making changes
>
> **Boundary:** Do not read or modify files outside the identified module. Do not run the full test suite yet — just identify the root cause.

---

### Template H: Write a Test for Untested Code

> **Context:** Read `MODULE_MAP.md` Section 5 (Test Completion Plan). The file `server/src/[MODULE]/[FILE].ts` currently has no tests.
>
> **Task:** Write a test file at `server/src/[MODULE]/__tests__/[FILE].test.ts` that covers:
> 1. The happy path for each exported function
> 2. Edge cases: zero/null/empty inputs, boundary values
> 3. Error cases: invalid inputs that should be rejected
>
> **Pattern:** Follow the existing test pattern in `server/src/mechanics/__tests__/banking.test.ts`:
> - Use `import { describe, it, expect } from 'vitest'`
> - Create mock data inline with `makeAgent()` / `makeConfig()` helpers
> - Test pure functions directly — no DB, no LLM, no server
> - For DB repos: use the real SQLite DB (see `agentRepo.test.ts` for pattern)
>
> **Scope:** Only create the new test file. Do not modify the source file being tested.
>
> **Verify:** Run `npx vitest run server/src/[MODULE]/__tests__/[FILE].test.ts` — all tests should pass.
