---
phase: 09-redesign-prompts-for-all
plan: 01
subsystem: llm/prompts
tags: [refactoring, prompt-architecture, test-scaffolding]
dependency_graph:
  requires: []
  provides: [prompt-modules, prompt-barrel-index, prompt-content-tests]
  affects: [centralAgent, simulationRunner, reflectionRunner, governanceManager, bootstrap, compare, review]
tech_stack:
  added: []
  patterns: [barrel-re-export, domain-module-split]
key_files:
  created:
    - server/src/llm/prompts/index.ts
    - server/src/llm/prompts/shared.ts
    - server/src/llm/prompts/agent-intent.ts
    - server/src/llm/prompts/central-agent.ts
    - server/src/llm/prompts/reflection.ts
    - server/src/llm/prompts/governance.ts
    - server/src/llm/prompts/comparison.ts
    - server/src/llm/prompts/location.ts
    - server/src/llm/__tests__/promptContent.test.ts
  modified:
    - server/src/llm/centralAgent.ts
    - server/src/orchestration/simulationRunner.ts
    - server/src/orchestration/reflectionRunner.ts
    - server/src/orchestration/governanceManager.ts
    - server/src/routes/bootstrap.ts
    - server/src/routes/compare.ts
    - server/src/routes/review.ts
  deleted:
    - server/src/llm/prompts.ts
decisions:
  - "Monolithic prompts.ts (2027 lines) split into 7 domain modules per D-19 design decision"
  - "Template strings kept inline in builder functions per D-20 (no external template files)"
  - "Barrel index.ts re-exports all symbols for backward-compatible import paths"
  - "Helper builders (buildCitizenBankingSection, etc.) exported from shared.ts for cross-module reuse"
metrics:
  duration_seconds: 688
  completed: "2026-04-07T04:52:19Z"
  tasks_completed: 3
  tasks_total: 3
  files_created: 9
  files_modified: 7
  files_deleted: 1
  tests_passing: 187
  tests_skipped: 11
---

# Phase 09 Plan 01: Prompt Module Split Summary

Split monolithic prompts.ts (2027 lines) into 7 domain-specific modules under server/src/llm/prompts/ with barrel re-export, enabling parallel work on citizen intent vs. central agent prompts in Wave 2.

## Task Results

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | Create 7 prompt modules + barrel index | ec466bc | prompts/{shared,agent-intent,central-agent,reflection,governance,comparison,location,index}.ts |
| 2 | Update all consumer import paths | 884c2ea | centralAgent.ts, simulationRunner.ts, reflectionRunner.ts, governanceManager.ts, bootstrap.ts, compare.ts, review.ts |
| 3 | Create prompt content test stubs | 429fb0c | llm/__tests__/promptContent.test.ts |

## Module Breakdown

| Module | Exports | Lines |
|--------|---------|-------|
| shared.ts | ACTION_SCHEMAS, 14 interfaces, 9 builder helpers | ~330 |
| agent-intent.ts | buildIntentPrompt, buildNaturalIntentPrompt | ~340 |
| central-agent.ts | 9 functions (brainstorm, overview, law, roster, resolution, refine, group/merge) | ~460 |
| reflection.ts | 5 functions (reflection pass1/pass2, evaluation, review chat, post-mortem) | ~200 |
| governance.ts | 5 functions (proposal, ballot, vote, franchise, legality) | ~210 |
| comparison.ts | buildComparisonMessages, buildComparisonChatMessages | ~130 |
| location.ts | 3 functions (location roster, law, scenario interpretation) | ~130 |
| index.ts | Barrel re-export of all 7 modules | 7 |

## Verification

- TypeScript build: zero prompt-related errors (pre-existing errors in simulationRunner.ts are out of scope)
- All 186 existing tests pass unchanged
- 1 new active test (barrel export verification) passes
- 11 skipped test stubs ready for Wave 2 unskipping
- No consumer file references old prompts.js path
- Original prompts.ts deleted

## Deviations from Plan

### Minor Adjustments

**1. sfcInflation.test.ts not present** -- Plan referenced `server/src/__tests__/sfcInflation.test.ts` as a consumer to update, but this file does not exist in the worktree. No action needed. The file `sfcFiscal.test.ts` exists but does not import from prompts.

## Known Stubs

None -- this plan is a pure mechanical refactoring with no stubs.

## Self-Check: PASSED

- All 9 created files exist
- All 3 commit hashes verified (ec466bc, 884c2ea, 429fb0c)
- Original prompts.ts confirmed deleted
