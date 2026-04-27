---
phase: 12-labor-market-realism-enterprise-demographic-alignment-wage-discovery-and-subsistence-fallback-for-produce-and-sell
plan: 03
subsystem: data-bootstrap, llm-prompts, test-coverage
tags: [wave-1, creative-mode, enterprise-generation, D-06, D-15, L-02, L-03, retry-with-healing]
dependency_graph:
  requires:
    - "12-02: isEmployableAgent predicate + D-05 invariant design"
    - "12-01: EnterpriseBlueprint.capacity on shared types"
  provides:
    - "server/src/llm/prompts/central-agent.ts: buildEnterpriseBlueprintsPrompt() with JSON schema and D-05 invariants in prompt"
    - "server/src/data/creativeEnterpriseGeneration.ts: generateEnterprisesFromCentralAgent() with 3-attempt retry loop"
    - "server/src/data/creativeEnterpriseGeneration.ts: validateEnterpriseRosterResponse() (exported, reusable)"
    - "server/src/data/__tests__/enterpriseGeneration.test.ts: 3 new D-06 tests replacing it.todo stubs"
  affects:
    - "12-07 umbrella plan: wires generateEnterprisesFromCentralAgent into creative-mode bootstrap"
    - "bootstrap route: on exhaustion, catch the [Phase 12 L-03 creative-mode] error and emit SSE error event"
tech_stack:
  added: []
  patterns:
    - "Custom 3-attempt retry loop with prompt rebuilding — uses buildEnterpriseBlueprintsPrompt(healingFeedback) on each attempt (retryWithHealing API doesn't support prompt rebuilding, so a thin loop is used)"
    - "validateEnterpriseRosterResponse: JSON parse → shape check → D-05 invariant (same logic as 12-02 auto-inflation, different entry point)"
    - "Healing feedback phrasing matches D-06 planner-specified verbatim: 'The roster you generated covers sectors [...] but sectors [...] have ≥5% workforce with zero employers. Total capacity: N. Need ≥ M. ...'"
    - "LLMProvider directly (not a custom EnterpriseLLMClient) — consistent with existing codebase patterns"
key_files:
  created:
    - "server/src/data/creativeEnterpriseGeneration.ts"
  modified:
    - "server/src/llm/prompts/central-agent.ts"
    - "server/src/data/__tests__/enterpriseGeneration.test.ts"
decisions:
  - "Custom retry loop instead of wrapping retryWithHealing: existing retryWithHealing takes (provider, messages, parse, fallback) and appends healing as assistant/user turns — it cannot rebuild the prompt with a healingFeedback param. The plan explicitly says 'adapt the retryWithHealing call shape to the actual signature'; custom loop is the correct adaptation."
  - "validateEnterpriseRosterResponse exported from creativeEnterpriseGeneration.ts: allows tests to call validator directly without mounting the full LLM; also available for 12-07 umbrella wiring"
  - "LLMProvider accepted directly (not EnterpriseLLMClient alias): plan pseudocode showed a custom interface but the project has LLMProvider with chat(messages, options); using the canonical type avoids a redundant alias"
  - "2 original it.todo stubs kept (with updated comment) per non-duplication rule; 3 real assertions live in the new describe block"
metrics:
  duration: "~4 minutes"
  completed_date: "2026-04-27"
  tasks: 3
  files_modified: 3
---

# Phase 12 Plan 03: Creative-Mode Enterprise Generation Summary

Creative-mode enterprise generation: Central Agent emits enterprise blueprints via `buildEnterpriseBlueprintsPrompt` with sector/ownerRole/initialWorkforceSize/wageAnchor schema, validated against the D-05 invariant, with 3-attempt retry loop injecting healing feedback on failure and throwing a labelled error on exhaustion.

## Tasks Completed

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | Prompt builder + JSON schema for enterprise blueprints | 6deaf48 | central-agent.ts |
| 2 | creativeEnterpriseGeneration module with validator + retry loop | bddfaf8 | creativeEnterpriseGeneration.ts |
| 3 | D-06 tests for retry + abort behavior | 53d4a2e | enterpriseGeneration.test.ts |

## What Was Built

### Task 1 — buildEnterpriseBlueprintsPrompt

`server/src/llm/prompts/central-agent.ts`:
- `EnterpriseBlueprintPromptParams` interface: `overview`, `agentRoster`, `baseFiat`, `minimumWage`, optional `healingFeedback`
- `buildEnterpriseBlueprintsPrompt()` returns `LLMMessage[]` (system + user)
- System message: "You are generating the enterprise roster for a PolicyLab simulation society."
- User message: society overview + sector breakdown (employable agents by sector with percentages) + JSON schema block + 3 invariants
- JSON schema explicitly lists: `sector`, `ownerRole`, `initialWorkforceSize`, `capacity`, `wageAnchor` (suggested default = `baseFiat × 0.10`)
- `healingFeedback` appended as `\n\nPREVIOUS ATTEMPT FAILED VALIDATION:\n{feedback}\n\nRegenerate the list so all invariants hold.`
- Employs same NON_EMPLOYEE_ROLES exclusion as `isEmployableAgent` for correct sector counts

### Task 2 — creativeEnterpriseGeneration module

`server/src/data/creativeEnterpriseGeneration.ts`:
- Imports `isEmployableAgent` from `../orchestration/helpers/isEmployableAgent.js` — reuses D-07 predicate
- `validateEnterpriseRosterResponse(raw, ctx)`: JSON parse + shape check (sector enum, capacity ≥ 2, capacity ≥ initialWorkforceSize) + D-05 invariants
- Healing message verbatim per planner spec: `"The roster you generated covers sectors [{covered}] but sectors [{missing}] have ≥5% workforce with zero employers. Total capacity: {sum}. Need ≥ {target}. Add enterprises for the missing sectors and/or raise capacity so every sector with ≥5% workforce has ≥1 enterprise and sum(capacity) ≥ 1.10 × {employable}."`
- `generateEnterprisesFromCentralAgent(params)`: 3-attempt loop, builds fresh prompt with `healingFeedback` on each retry, throws `[Phase 12 L-03 creative-mode] Central Agent failed to generate valid enterprise roster after 3 attempts: <lastError>` on exhaustion
- Accepts `LLMProvider` (canonical project interface)

### Task 3 — D-06 tests

`server/src/data/__tests__/enterpriseGeneration.test.ts`:
- New `describe('Phase 12: Creative-mode enterprise generation (D-06, D-15)', ...)` block
- `buildTestRoster()`: 20 employable agents across 4 sectors (5 each, all ≥5%)
- `buildValidRosterJson()`: 4 enterprises, sum capacity 24 ≥ ceil(20 × 1.10) = 22
- `buildBadRosterJson()`: agriculture only, capacity 2 — fails both invariants
- **Test A**: 3 consecutive bad responses → rejects with `/\[Phase 12 L-03 creative-mode\].*after 3 attempts/`, LLM called exactly 3 times
- **Test B**: First response valid → resolves immediately, LLM called once
- **Test C**: Bad then good → resolves, LLM called twice, second call's user message matches `/PREVIOUS ATTEMPT FAILED VALIDATION/`

## Deviations from Plan

### Design choices made at implementation time

**1. [Rule 1 - Architecture adaptation] Custom retry loop instead of retryWithHealing wrapper**
- **Found during:** Task 2 implementation
- **Issue:** `retryWithHealing` appends healing context as `assistant` + `user` turns to a fixed conversation. Creative-mode enterprise generation needs to rebuild the entire prompt with `healingFeedback` injected into the user message on each attempt — a different healing pattern.
- **Fix:** Implemented a 3-attempt loop in `generateEnterprisesFromCentralAgent` that calls `buildEnterpriseBlueprintsPrompt({ ...healingFeedback })` fresh each attempt. Same semantics (3 attempts, throw on exhaustion), different mechanism.
- **Plan note:** Plan explicitly said "Adapt the `retryWithHealing` call shape to the actual signature found in `retryWithHealing.ts`" — this is that adaptation.
- **Files modified:** `creativeEnterpriseGeneration.ts`

**2. [Rule 2 - Missing validation] Exported validateEnterpriseRosterResponse**
- **Found during:** Task 2 — test file needed direct access to validator
- **Fix:** Exported `validateEnterpriseRosterResponse` from `creativeEnterpriseGeneration.ts`; tests can call it independently

**3. LLMProvider not EnterpriseLLMClient**
- Plan pseudocode showed a custom `EnterpriseLLMClient { complete(system, user) }` interface. The project's canonical `LLMProvider { chat(messages, options) }` interface is already available. Used `LLMProvider` directly to avoid an unnecessary alias.

## Verification Checks

- `npx vitest run server/src/data/__tests__/enterpriseGeneration.test.ts` — 13 passed, 2 todo (original D-06 stubs preserved with updated comment)
- `npx vitest run server/src/orchestration/helpers/__tests__/isEmployableAgent.test.ts` — 13 passed
- `npx tsc --noEmit -p server/tsconfig.json` — exit 0, clean

## Known Stubs

None. `generateEnterprisesFromCentralAgent` is fully wired but not yet called from any bootstrap route — that wiring belongs to 12-07 (umbrella). The function contract is complete and tested.

## Self-Check: PASSED

Files created:
- server/src/data/creativeEnterpriseGeneration.ts — EXISTS
Files modified:
- server/src/llm/prompts/central-agent.ts — EXISTS
- server/src/data/__tests__/enterpriseGeneration.test.ts — EXISTS

Commits:
- 6deaf48 — Task 1 (buildEnterpriseBlueprintsPrompt)
- bddfaf8 — Task 2 (creativeEnterpriseGeneration module)
- 53d4a2e — Task 3 (D-06 tests)
