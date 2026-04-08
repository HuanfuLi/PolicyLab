---
phase: 10-fix-simulation-realism
plan: 06
subsystem: narrative-grounding
tags: [narrative, telemetry, validation, prompts, grounding]
dependency_graph:
  requires: ["10-04", "10-05"]
  provides: ["narrativeValidation", "buildTelemetryDigest", "DATA-DRIVEN GROUNDING directive"]
  affects: ["central-agent.ts prompts", "simulationRunner resolution loop"]
tech_stack:
  added: []
  patterns: ["pre-interpreted telemetry digest", "narrative validation with retry", "3-assertion hard checks"]
key_files:
  created:
    - server/src/llm/narrativeValidation.ts
    - server/src/llm/__tests__/narrativeValidation.test.ts
  modified:
    - server/src/llm/prompts/central-agent.ts
    - server/src/orchestration/simulationRunner.ts
decisions:
  - "TelemetryLog lacks agentsAlive/agentsDied fields; passed as separate params to validateNarrative and buildTelemetryDigest"
  - "Telemetry digest uses previous iteration data for trends since current telemetry is built after physics resolution"
  - "MapReduce path stores groupSummaries at outer scope for narrative retry access"
metrics:
  duration_seconds: 367
  completed: "2026-04-08T20:54:08Z"
  tasks_completed: 2
  tasks_total: 2
  files_created: 2
  files_modified: 2
---

# Phase 10 Plan 06: Narrative Grounding Summary

Data-driven narrative grounding replacing FRICTION FIRST directive with telemetry digest injection, 3-assertion validation, and contradictory narrative re-generation.

## What Was Done

### Task 1: narrativeValidation.ts module (TDD)
Created `server/src/llm/narrativeValidation.ts` with two exports:
- **buildTelemetryDigest**: Produces pre-interpreted summary with Gini trend, avg wealth, CPI, food price, population mood percentages, and death count. Returns "First iteration" sentinel for iteration 1.
- **validateNarrative**: Checks 3 hard assertions against telemetry: (1) death count accuracy (starvation words vs 0 deaths), (2) wealth trend consistency (collapse words vs rising wealth), (3) Gini direction match (equality words vs rising Gini). Returns `NarrativeValidation` with per-check booleans and human-readable failure descriptions.

9 tests covering all D-20 assertions pass green.

### Task 2: Prompt replacement + validation wiring
- Replaced both instances of `NARRATIVE DIRECTIVE -- FRICTION FIRST` with `NARRATIVE DIRECTIVE -- DATA-DRIVEN GROUNDING` in `central-agent.ts`
- Added `telemetryDigest` parameter to `buildResolutionPrompt` and `buildMergeResolutionMessages`
- Injected telemetry digest block into both prompt bodies after physics log section
- Wired `buildTelemetryDigest` call before resolution LLM call in `simulationRunner.ts` using previous iteration telemetry
- Added post-resolution `validateNarrative` check with max 1 re-generation retry on failure
- Stricter retry prompt includes specific failure descriptions ("PREVIOUS NARRATIVE REJECTED -- FACTUAL ERRORS DETECTED")
- Both MapReduce and standard paths covered

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] TelemetryLog missing agentsAlive/agentsDied fields**
- **Found during:** Task 1
- **Issue:** Plan code assumed TelemetryLog has agentsAlive and agentsDied fields, but the actual type in shared/src/types.ts does not include them
- **Fix:** Added agentsAlive and agentsDied as separate function parameters instead of reading from TelemetryLog
- **Files modified:** server/src/llm/narrativeValidation.ts, server/src/llm/__tests__/narrativeValidation.test.ts

## Known Stubs

None -- all functions are fully implemented with real logic.

## Verification

- `npx vitest run server/src/llm/__tests__/narrativeValidation.test.ts`: 9/9 tests pass
- `grep -c "FRICTION FIRST" central-agent.ts`: 0 (removed)
- `grep -c "DATA-DRIVEN GROUNDING" central-agent.ts`: 2 (both replaced)
- `grep "validateNarrative" simulationRunner.ts`: import + 2 calls (initial + retry check)
- Pre-existing inflationEngine test failure unrelated to this plan (rolling mean precision mismatch)

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| 1 | 4fbb113 | narrativeValidation module with telemetry digest and 3-assertion validation |
| 2 | fb7fe73 | Replace FRICTION FIRST with data-driven narrative grounding + validation loop |
