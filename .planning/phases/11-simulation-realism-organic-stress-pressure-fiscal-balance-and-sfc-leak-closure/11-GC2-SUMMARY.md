---
phase: 11-simulation-realism-organic-stress-pressure-fiscal-balance-and-sfc-leak-closure
plan: GC2
subsystem: llm-prompts, simulation-runner
tags: [context-bloat, physics-trace, prompt-size, gap-closure, tdd]
dependency_graph:
  requires: [11-GC1]
  provides: [context-bloat-fix, prompt-size-regression-test]
  affects: [groupResolution-prompt, buildResolutionPrompt, sessionLastPhysicsTraces]
tech_stack:
  added: []
  patterns: [capture-then-reset-buffer, prompt-boundary-cap]
key_files:
  created:
    - server/src/__tests__/groupResolutionPromptSize.test.ts
  modified:
    - server/src/orchestration/simulationRunner.ts
    - server/src/llm/prompts/central-agent.ts
decisions:
  - "Fix A: capture-then-reset physicsLog buffer at iteration entry (simulationRunner.ts:978-982)"
  - "Fix B: 8KB hard cap at prompt boundary for both buildGroupResolutionMessages and buildResolutionPrompt"
  - "Fix C (drop [TAX] appendTrace sites) intentionally NOT applied — tax-log visibility aids G1 live debugging"
metrics:
  duration: "3 min 28 sec"
  completed: "2026-04-13"
  tasks: 2
  files: 3
---

# Phase 11 Plan GC2: LLM Context Bloat Closure Summary

**One-liner:** Per-iteration physics trace reset + 8KB prompt-boundary cap closes the 50KB→~14K-token groupResolution context bloat introduced by the fdcd6ce Phase-5/6 `.set→appendTrace` regression.

## What Was Built

Two cheap, safe patches that together reduce `groupResolution` prompt size from ~54KB (~13.8K tokens) to ~10KB (~2.5K tokens), unblocking 11-GC5 live smoke verification on 20k-window local models.

### Patch A — Per-iteration reset (simulationRunner.ts:978-982)

At iteration entry, after capturing `prevPhysicsLog`, immediately clear the buffer:

```typescript
const prevPhysicsLog = sessionLastPhysicsTraces.get(sessionId) ?? null;
sessionLastPhysicsTraces.set(sessionId, '');
```

This restores the original per-iteration semantics that commit `fdcd6ce` (Phase 5+6 refactor) accidentally broke by changing `.set(...)` overwrites to `appendTrace(...)` accumulation. The prompt header "exact mechanical outcomes last iteration" is now accurate.

### Patch B — 8KB cap at prompt boundary (central-agent.ts:294, 458)

Applied `.slice(-8000)` to `physicsLog` in both prompt builders:

- `buildGroupResolutionMessages` (HMAS map-reduce path) — line 458
- `buildResolutionPrompt` (single-pass path) — line 294

Matches the convention of every other user-controlled field in these functions (`law.slice(0,400)`, `previousSummary.slice(0,400)`, `allIntentsBrief.slice(0,800)`).

### Fix C — NOT applied

`appendTrace` call sites for `[TAX]` trace lines were intentionally preserved. Dropping them would reduce context by ~1,000 tokens but would impair visibility for live debugging of G1 fixes. Per forensics-G2 §3 Fix C: "optional; defer if not cheap."

## Prompt-Size Acceptance Criterion

| Metric | Before GC2 | After GC2 |
|--------|-----------|-----------|
| Composed prompt chars (iter 5, 15-agent group) | ~54,700 | ~9,800 |
| Equivalent tokens (chars / 4) | ~13,675 | ~2,450 |
| physicsLog component | 50KB (accumulated) | ≤8KB (sliced) |
| Steady-state stability (iter5 vs iter2) | saturated — equal at wrong level | ≤10% diff, both within budget |

All three clauses of the acceptance criterion pass:
- Total prompt ≤ 8,000 tokens: YES (~2.5K tokens)
- physicsLog ≤ 2,000 tokens: YES (~2,000 tokens from 8KB cap)
- iter5 within 10% of iter2: YES (both now similarly small post-fix)

## Commits

| # | Hash | Message |
|---|------|---------|
| 1 | dd526e6 | test(11-GC2): add failing prompt-size regression tests for groupResolution |
| 2 | 0a09374 | fix(11-GC2): reset physics trace buffer at iteration entry to match prompt contract |
| 3 | e6e6e83 | fix(11-GC2): cap physicsLog embed at 8KB in buildGroupResolutionMessages |
| 4 | 0853f98 | fix(11-GC2): cap physicsLog embed at 8KB (also covers buildResolutionPrompt) |

## Full Suite Test Count After GC2

| Category | Count |
|----------|-------|
| Test files | 46 (44 passed, 2 failed pre-existing) |
| Total tests | 514 |
| Passing | 509 |
| Failing (pre-existing) | 5 (banking.test.ts + economyConfig.test.ts) |

The 5 pre-existing failures are: `canIssueLoan` edge case (banking.test.ts) and 4 EconomyConfig defaults (economyConfig.test.ts). None are related to GC2 changes.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing] Applied 8KB cap to `buildResolutionPrompt` in addition to `buildGroupResolutionMessages`**

- **Found during:** Task 2, verifying the acceptance criterion `grep \${physicsLog} returns 0 matches`
- **Issue:** `buildResolutionPrompt` (single-pass resolution path, central-agent.ts:294) also embeds `physicsLog` verbatim without a cap — same pattern, same vulnerability
- **Fix:** Applied `.slice(-8000)` to the physicsLog embed in `buildResolutionPrompt` as well
- **Files modified:** `server/src/llm/prompts/central-agent.ts`
- **Commit:** 0853f98

## Hand-off Note

11-GC5 live smoke test is now unblocked from the context-size side. The `groupResolution` prompt for a 5-iteration 30-agent US session is ~2,500 tokens — well within the 14k-token effective input budget of a 20k-context local model (with 4K output reservation and provider overhead).

The per-iteration reset (Patch A) additionally ensures the physics trace is semantically correct: the LLM narrator now receives only the previous iteration's mechanical outcomes, not a 50KB historical tail mixed across multiple iterations.

## Known Stubs

None. Both patches are complete functional fixes with no placeholder or stub content.
