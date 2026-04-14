---
phase: 11-simulation-realism-organic-stress-pressure-fiscal-balance-and-sfc-leak-closure
plan: GC2
type: execute
wave: 1
depends_on: []
files_modified:
  - server/src/orchestration/simulationRunner.ts
  - server/src/llm/prompts/central-agent.ts
  - server/src/__tests__/groupResolutionPromptSize.test.ts
autonomous: true
gap_closure: true
requirements: [GC-01]
decisions_addressed: [GC-01]
must_haves:
  truths:
    - "A 5-iteration 30-agent US session produces groupResolution prompts ≤ 8000 tokens at iteration 5"
    - "Iteration 5 prompt size is within 10% of iteration 2 prompt size (the 50KB saturation is gone)"
    - "The physics log embedded in groupResolution reflects ONLY the previous iteration, matching the prompt header's claim"
  artifacts:
    - path: "server/src/orchestration/simulationRunner.ts"
      provides: "Per-iteration reset of sessionLastPhysicsTraces (OR restoration of .set-based overwrite)"
      contains: "sessionLastPhysicsTraces.set"
    - path: "server/src/llm/prompts/central-agent.ts"
      provides: "8KB cap applied to physicsLog embed in buildGroupResolutionMessages"
      contains: "physicsLog.slice(-8000)"
    - path: "server/src/__tests__/groupResolutionPromptSize.test.ts"
      provides: "Regression test: composed prompt stays ≤ 32KB (≈ 8000 tokens) after 5 iterations of trace accumulation"
  key_links:
    - from: "server/src/orchestration/simulationRunner.ts (iteration entry near line 976)"
      to: "sessionLastPhysicsTraces map"
      via: "read-then-reset pattern: capture prevPhysicsLog from map, then clear the map"
      pattern: "sessionLastPhysicsTraces.set\\(sessionId, ''\\)"
    - from: "server/src/llm/prompts/central-agent.ts:458"
      to: "physicsLog embed"
      via: "slice(-8000) applied before string interpolation"
      pattern: "physicsLog.slice\\(-8000\\)"
---

<objective>
Close G2 context-bloat so the LLM smoke test that verifies G1's fix can actually run. Per forensics-G2: `buildGroupResolutionMessages` at `server/src/llm/prompts/central-agent.ts:458` embeds `physicsLog` verbatim with a 50KB tail cap. Commit `fdcd6ce` (pre-Phase-11 Phase-5+6 refactor) changed per-iteration `.set(...)` overwrites into cross-iteration `appendTrace(...)` accumulation. The 50KB cap saturates within 2-3 iterations; steady-state groupResolution prompt hits ~13.8k tokens, which exceeds the effective input budget on the user's 20k-window local model. Phase 11's 8 new `[TAX]` trace sites marginally accelerate but are NOT the origin.

Fix combines two cheap, safe patches (forensics-G2 §3 Fix A + Fix B):
- **Fix A**: restore per-iteration reset so physicsLog truly reflects "last iteration" as the prompt header claims.
- **Fix B**: add an 8KB hard cap at the prompt boundary as belt-and-suspenders (every other user field here already has a cap).

Rationale per user planning_guidance: G2 is strictly pre-existing but folding it into gap closure is pragmatic — G1's fix (11-GC1) cannot be live-verified without a working LLM loop.

Purpose: Unblock 11-GC5 live smoke verification. Without G2 closure, the user's local-model smoke test returns 400 Context size has been exceeded.

Output: Two tiny patches + one prompt-size regression test.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/STATE.md
@.planning/phases/11-simulation-realism-organic-stress-pressure-fiscal-balance-and-sfc-leak-closure/11-CONTEXT.md
@.planning/phases/11-simulation-realism-organic-stress-pressure-fiscal-balance-and-sfc-leak-closure/forensics-G2-context-bloat.md

<interfaces>
<!-- Extracted from codebase. Executor uses these directly — no exploration needed. -->

From server/src/orchestration/simulationState.ts:74-78:
```typescript
export function appendTrace(sessionId: string, newContent: string): void {
  const existing = sessionLastPhysicsTraces.get(sessionId) ?? '';
  const combined = existing + '\n' + newContent;
  sessionLastPhysicsTraces.set(sessionId, combined.length > 50_000 ? combined.slice(-50_000) : combined);
}
// NOTE: no reset function; the only mutation sites are appendTrace() at line 77 and .delete() in cleanupSessionState at line 147.
```

From server/src/orchestration/simulationRunner.ts near iteration entry (line 976-978):
```typescript
const prevIterMetrics = sessionIterationMetrics.get(sessionId) ?? null;
// D4: Physics log from last iteration — grounding data for the narrator
const prevPhysicsLog = sessionLastPhysicsTraces.get(sessionId) ?? null;
```
`prevPhysicsLog` is captured ONCE per iteration here and threaded into buildGroupResolutionMessages at line 989.

From server/src/llm/prompts/central-agent.ts:457-458:
```typescript
const physicsLogSnippet = physicsLog
  ? `\n[PHYSICS LOG — exact mechanical outcomes last iteration]\nYour narrative MUST be consistent with these numbers — do not invent different values.\n${physicsLog}\n` : '';
```
Every other user-controlled field in this prompt has a length cap: `session.law?.slice(0, 400)` (line 430), `previousSummary.slice(0, 400)` (line 460), `allIntentsBrief.slice(0, 800)` (line 466).

From forensics-G2-context-bloat.md §4 acceptance criterion:
- Total prompt tokens ≤ 8,000 (measured: char count / 4)
- physicsLog component ≤ 2,000 tokens (8 KB char cap)
- No growth in steady state — iter 5 prompt size within 10% of iter 2
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: RED — failing prompt-size regression test</name>
  <files>server/src/__tests__/groupResolutionPromptSize.test.ts</files>
  <read_first>
    - server/src/__tests__/groupResolutionPromptSize.test.ts (new — will not exist, confirm)
    - server/src/llm/prompts/central-agent.ts (read lines 400-480 — full buildGroupResolutionMessages signature + body)
    - server/src/orchestration/simulationState.ts (confirm appendTrace + sessionLastPhysicsTraces exports)
    - .planning/phases/11-simulation-realism-organic-stress-pressure-fiscal-balance-and-sfc-leak-closure/forensics-G2-context-bloat.md §1a (token budget table) + §4 (acceptance criterion)
    - server/src/__tests__/sfcPhase11.test.ts (steal fixture helpers — Session/Agent builders)
  </read_first>
  <behavior>
    Test 1: "groupResolution prompt stays under 32KB after 5 iterations of trace accumulation"
      - Fixture: synthetic Session + 15-agent group + 5 iterations of simulated appendTrace() calls emitting ~25KB of trace content each (mimicking real per-iteration volume per forensics §1b: banking/capmkt/fiscal/tax lines)
      - Build the groupResolution messages for iteration 5 using prevPhysicsLog = sessionLastPhysicsTraces.get(sessionId)
      - Assert: `JSON.stringify(messages).length < 32_000` (≈ 8,000 tokens)
      - Assert: `messages[0].content[1].text.indexOf(physicsLog substring) !== -1 || messages[0].content.some(c => c.text?.includes('[PHYSICS LOG'))` — sanity check the embed still renders

    Test 2: "steady-state prompt size is stable across iterations"
      - Build prompts for iter 2 and iter 5 with the same per-iteration trace volume
      - Assert: `|len(iter5) - len(iter2)| / len(iter2) < 0.10` (within 10%)

    Test 3: "physicsLog embed is tail-sliced to 8KB max at the prompt boundary"
      - Build a prompt directly with a 40KB `physicsLog` argument
      - Assert: the composed prompt contains at most 8,000 chars from the physicsLog payload (validate via grep-style substring search for the 8KB prefix vs the 40KB prefix)
  </behavior>
  <action>
    Create `server/src/__tests__/groupResolutionPromptSize.test.ts`:
    - Import `buildGroupResolutionMessages` from `../llm/prompts/central-agent.js` (note .js extension for ESM).
    - Import `appendTrace`, `sessionLastPhysicsTraces` from `../orchestration/simulationState.js`.
    - Use vitest describe/it/expect.
    - Fixture helper: `buildSyntheticTrace(sizeKB: number): string` that emits realistic banking/capmkt/fiscal/tax trace lines.
    - In `beforeEach`, clear `sessionLastPhysicsTraces` to ensure clean state.
    - Test 1 should FAIL TODAY because:
      - Today's 50KB cap × 5 iterations worth of accumulation → prompt composes to ~55KB ≈ 13.8k tokens, well over the 32KB bound.
    - Test 2 should FAIL TODAY because iter 2 is already at 50KB saturation so iter 5 is within 10% — actually this test will coincidentally PASS today by the forensics note ("iter 2 ≈ iter 5 ≈ 13,800 tokens because the cap is saturated"). Mark this test `it.todo` or rewrite it to instead require the iter 2 prompt to be ≤ 32KB (which will fail today). Prefer: assert BOTH iter2 ≤ 32KB AND iter5 ≤ 32KB — the conjunction fails today since iter 2 already saturates.
    - Test 3 will fail today because the physicsLog embed has no slice.

    **Commit message:** `test(11-GC2): add failing prompt-size regression tests for groupResolution`

    **Run after writing:** `npx vitest run server/src/__tests__/groupResolutionPromptSize.test.ts`
    Expected: at least tests 1 and 3 FAIL (RED).
  </action>
  <verify>
    <automated>npx vitest run server/src/__tests__/groupResolutionPromptSize.test.ts 2>&1 | grep -E "FAIL|failed"</automated>
  </verify>
  <acceptance_criteria>
    - grep `groupResolution prompt stays under 32KB` in server/src/__tests__/groupResolutionPromptSize.test.ts returns 1 match
    - grep `physicsLog embed is tail-sliced to 8KB max` in server/src/__tests__/groupResolutionPromptSize.test.ts returns 1 match
    - `npx vitest run server/src/__tests__/groupResolutionPromptSize.test.ts` output contains "FAIL" or "failed"
    - git log -1 --format=%s contains `test(11-GC2)`
  </acceptance_criteria>
  <done>Regression test file committed RED; tests 1 + 3 fail for the expected token-budget reason (not for import/typing errors).</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: GREEN — per-iteration reset (Fix A) + 8KB prompt cap (Fix B)</name>
  <files>server/src/orchestration/simulationRunner.ts, server/src/llm/prompts/central-agent.ts, server/src/__tests__/groupResolutionPromptSize.test.ts</files>
  <read_first>
    - server/src/orchestration/simulationRunner.ts (read lines 970-995 — iteration entry where prevPhysicsLog is captured)
    - server/src/orchestration/simulationState.ts (confirm sessionLastPhysicsTraces is a Map<string, string> exported)
    - server/src/llm/prompts/central-agent.ts (read lines 450-470 — physicsLogSnippet construction site)
    - server/src/__tests__/groupResolutionPromptSize.test.ts (just written in Task 1 — confirm fixture format)
    - .planning/phases/11-simulation-realism-organic-stress-pressure-fiscal-balance-and-sfc-leak-closure/forensics-G2-context-bloat.md §3 (Fix A option (b) + Fix B exact pseudocode)
  </read_first>
  <behavior>
    After this task:
    - groupResolutionPromptSize.test.ts: all tests GREEN (test 1 ≤ 32KB, test 2 iter2 ≈ iter5 within 10%, test 3 8KB slice enforced)
    - Full suite: no regressions. `npm run test -w server` shows ≥ 485 + N new tests (pre-existing 5 failures unchanged).
  </behavior>
  <action>
    Two atomic patches:

    **Patch A — per-iteration reset (simulationRunner.ts):**
    At `simulationRunner.ts:976-978`, the iteration-entry block currently reads:
    ```ts
    const prevIterMetrics = sessionIterationMetrics.get(sessionId) ?? null;
    // D4: Physics log from last iteration — grounding data for the narrator
    const prevPhysicsLog = sessionLastPhysicsTraces.get(sessionId) ?? null;
    ```
    Add a reset LINE AFTER capturing `prevPhysicsLog`:
    ```ts
    const prevIterMetrics = sessionIterationMetrics.get(sessionId) ?? null;
    // D4: Physics log from last iteration — grounding data for the narrator.
    // Capture-then-reset: appendTrace() accumulates within the iteration, but the
    // prompt contract says "last iteration" — clear the buffer so this iteration's
    // traces don't collide with next iteration's read. (11-GC2 / forensics-G2 Fix A)
    const prevPhysicsLog = sessionLastPhysicsTraces.get(sessionId) ?? null;
    sessionLastPhysicsTraces.set(sessionId, '');
    ```
    Import `sessionLastPhysicsTraces` if not already imported in the iteration scope (check top-of-file imports; if missing, add to the existing `import { ... } from './simulationState.js'` line).

    **Patch B — 8KB cap at prompt boundary (central-agent.ts):**
    At `central-agent.ts:457-458`, change:
    ```ts
    const physicsLogSnippet = physicsLog
      ? `\n[PHYSICS LOG — exact mechanical outcomes last iteration]\nYour narrative MUST be consistent with these numbers — do not invent different values.\n${physicsLog}\n` : '';
    ```
    to:
    ```ts
    const physicsLogSnippet = physicsLog
      ? `\n[PHYSICS LOG — exact mechanical outcomes last iteration]\nYour narrative MUST be consistent with these numbers — do not invent different values.\n${physicsLog.slice(-8000)}\n` : '';
    ```
    Single-character diff: add `.slice(-8000)` between `${physicsLog` and `}`. Matches the convention of every other user-controlled field in this function.

    **Do NOT apply Fix C (dropping [TAX] appendTrace sites).** Forensics §3 Fix C is marked "optional; defer if not cheap" and dropping tax-log visibility would make G1 live debugging harder. Skip.

    **Commit messages (atomic):**
    1. `fix(11-GC2): reset physics trace buffer at iteration entry to match prompt contract`
    2. `fix(11-GC2): cap physicsLog embed at 8KB in buildGroupResolutionMessages`

    **Run after each patch:** `npx vitest run server/src/__tests__/groupResolutionPromptSize.test.ts` — verify progressive GREEN.
  </action>
  <verify>
    <automated>npx vitest run server/src/__tests__/groupResolutionPromptSize.test.ts && npm run test -w server</automated>
  </verify>
  <acceptance_criteria>
    - grep `sessionLastPhysicsTraces.set\(sessionId, ''\)` in server/src/orchestration/simulationRunner.ts returns 1 match
    - grep `physicsLog.slice\(-8000\)` in server/src/llm/prompts/central-agent.ts returns 1 match
    - grep `\${physicsLog}` (without slice) in server/src/llm/prompts/central-agent.ts returns 0 matches (old pattern removed)
    - `npx vitest run server/src/__tests__/groupResolutionPromptSize.test.ts` shows all tests passed, 0 failed
    - `npm run test -w server` test count ≥ 488 passed (485 baseline + 3 new GC2), ≤ 5 failed (pre-existing only)
    - git log -2 --format=%s contains two `fix(11-GC2):` commits
    - `tsc --noEmit -p server/tsconfig.json` diff vs base: flat (no new errors)
  </acceptance_criteria>
  <done>Per-iteration reset applied at simulationRunner.ts:~980; 8KB slice applied at central-agent.ts:458; all groupResolutionPromptSize tests GREEN; no Phase-11 test regressions.</done>
</task>

</tasks>

<verification>
- grep `sessionLastPhysicsTraces.set\(sessionId, ''\)` server/src/orchestration/simulationRunner.ts: 1 match
- grep `physicsLog.slice\(-8000\)` server/src/llm/prompts/central-agent.ts: 1 match
- `npx vitest run server/src/__tests__/groupResolutionPromptSize.test.ts`: 3 passed, 0 failed
- `npm run test -w server`: ≥ 488 passed, ≤ 5 failed (pre-existing only)
- Phase 11 existing test suites (sfcPhase11, sfcTaxation, sfcEscrow, structuralPressures, centralAgentTaxPolicy, etc.): no regressions
- `tsc --noEmit -p server/tsconfig.json`: same pre-existing errors only, no new errors
</verification>

<success_criteria>
- Steady-state `groupResolution` prompt for a 5-iter 30-agent US session is ≤ 8000 tokens.
- Physics log embed reflects ONLY the previous iteration's trace content, matching the prompt's own "last iteration" claim.
- 11-GC5 live smoke test can execute without hitting 400 Context size has been exceeded on the user's 20k-window local model.
- **Concurrency risk with 11-GC1:** Both plans edit `simulationRunner.ts`. 11-GC1 touches lines 1190-2210 (physicsActions bracket region) and helpers/sfcAudit.ts. 11-GC2 touches lines 976-980 (iteration entry) + central-agent.ts. No line overlap; merge-safe.
</success_criteria>

<output>
After completion, create `.planning/phases/11-simulation-realism-organic-stress-pressure-fiscal-balance-and-sfc-leak-closure/11-GC2-SUMMARY.md` with:
- Commits list (expected: 1 test commit + 2 fix commits)
- Confirmation of prompt-size acceptance criterion (iter 5 ≤ 8K tokens, iter 5 within 10% of iter 2)
- Full suite test count after GC2
- Note that Fix C (drop [TAX] trace sites) was intentionally NOT applied
- Hand-off note: 11-GC5 live smoke test unblocked from the context-size side
</output>
