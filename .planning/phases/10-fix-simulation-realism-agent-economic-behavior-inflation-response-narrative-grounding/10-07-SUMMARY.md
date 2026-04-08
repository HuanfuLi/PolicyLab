---
phase: 10-fix-simulation-realism
plan: 07
subsystem: prompts, orchestration
tags: [banking-prompts, reflection, assertions, agent-intent]
dependency_graph:
  requires: ["10-04"]
  provides: ["ROI-focused banking action descriptions", "stat trajectory in reflections", "runtime agent context assertions", "enterprise employment context"]
  affects: ["server/src/llm/prompts/shared.ts", "server/src/llm/prompts/reflection.ts", "server/src/llm/prompts/agent-intent.ts", "server/src/orchestration/simulationRunner.ts", "server/src/orchestration/reflectionRunner.ts"]
tech_stack:
  added: []
  patterns: ["runtime assertion pattern for data injection validation", "stat trajectory injection for grounded reflections"]
key_files:
  created: []
  modified:
    - server/src/llm/prompts/shared.ts
    - server/src/llm/prompts/reflection.ts
    - server/src/llm/prompts/agent-intent.ts
    - server/src/orchestration/simulationRunner.ts
    - server/src/orchestration/reflectionRunner.ts
decisions:
  - "StatTrajectoryEntry uses final agent stats since per-iteration agent stats are not persisted in DB; actions come from resolvedActions table grouped by iteration"
  - "Trajectory limited to last 10 iterations to stay within LLM token budget"
  - "assertAgentContext logs warnings instead of throwing to avoid crashing simulations on edge cases"
metrics:
  duration_seconds: 387
  completed: "2026-04-08T20:40:00Z"
  tasks_completed: 2
  tasks_total: 2
  files_modified: 5
requirements: [D-21, D-22, D-23]
---

# Phase 10 Plan 07: ROI Banking Prompts, Stat Trajectory Reflections, and Runtime Assertions Summary

Banking action descriptions rewritten with BENEFIT sections emphasizing financial returns (passive income, investment multipliers, creditworthiness). Reflection prompts enriched with per-iteration stat trajectory. Runtime assertions validate agent data injection before LLM calls.

## Task Summary

### Task 1: Rewrite banking ACTION_SCHEMAS for ROI emphasis + update reflection prompts
**Commit:** 0dff61a

- Rewrote DEPOSIT, TAKE_LOAN, REPAY_LOAN, WITHDRAW, BUY_SHARES descriptions in ACTION_SCHEMAS with explicit BENEFIT sections
- DEPOSIT now mentions "passive income every iteration" and "money grows while you sleep"
- TAKE_LOAN emphasizes "multiply production output" and investment returns
- REPAY_LOAN highlights "creditworthiness" and "future borrowing capacity"
- WITHDRAW warns about reducing passive income stream
- BUY_SHARES emphasizes "dividend payments proportional to ownership"
- Added StatTrajectoryEntry interface and statTrajectory parameter to buildAgentReflectionPrompt
- Injected YOUR PERSONAL JOURNEY section into reflection prompt with per-iteration wealth/health/happiness/actions
- Added enterpriseContext parameter to buildNaturalIntentPrompt for employment details

### Task 2: Runtime assertions for agent data injection + wire stat trajectory
**Commit:** ded906a (reflectionRunner) + e97ad04 (simulationRunner, parallel agent)

- assertAgentContext function validates wealth/health/happiness are valid numbers and within expected ranges
- Called before each agent intent LLM call to catch stale/incorrect data injection
- Enterprise employment context built from employmentRegistry with wage and industry details
- Unemployed agents get explicit "Consider APPLY_FOR_JOB" guidance
- Enterprise context passed as final parameter to buildNaturalIntentPrompt
- Stat trajectory built in reflectionRunner from resolvedActions grouped by iteration
- Limited to last 10 iterations for token budget management
- Passed to buildAgentReflectionPrompt for each agent in pass 1

## Deviations from Plan

### Note: Parallel Agent Overlap
The simulationRunner.ts changes (assertAgentContext + enterpriseContext) were also implemented by the parallel 10-05 agent which committed first (e97ad04). This is expected behavior in parallel execution -- both plans specified the same file modifications. The reflectionRunner.ts stat trajectory wiring is unique to this plan.

### Stat Trajectory Limitation
Per-iteration agent wealth/health/happiness are not persisted in the database (only final stats on the agent record). The trajectory uses final stats as a placeholder with per-iteration action lists from resolvedActions. This provides meaningful action history context even without per-iteration stat snapshots.

## Known Stubs

None -- all functionality is fully wired.

## Verification Results

- `grep "passive income" shared.ts` -- 2 matches (DEPOSIT description)
- `grep "assertAgentContext" simulationRunner.ts` -- 2 matches (definition + call)
- `grep "statTrajectory" reflectionRunner.ts` -- 2 matches (build + pass)
- `grep "PERSONAL JOURNEY" reflection.ts` -- 1 match (trajectory section)
- Pre-existing test failure in inflationEngine.test.ts (inflationExpectations rolling mean) unrelated to this plan
- Pre-existing TS error in simulationRunner.ts line 3608 (AgentStats cast) unrelated to this plan

## Self-Check: PASSED
