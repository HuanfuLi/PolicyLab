---
phase: 08-live-scenario-comparison
plan: 08
subsystem: ui, api
tags: [react, express, llm-prompts, multi-scenario, policy-brief, cross-scenario-chat]

requires:
  - phase: 08-live-scenario-comparison
    plan: 01
    provides: Session grouping metadata (groupId, scenarioLabel)
  - phase: 08-live-scenario-comparison
    plan: 03
    provides: Multi-scenario SSE management and parallel execution
provides:
  - Cross-scenario context in AgentReview chat for comparative agent Q&A
  - Combined LLM-generated policy brief from multiple scenario sessions
  - Server endpoints for policy brief and cross-scenario analysis
affects: [agent-review, artifacts-page, reflect-api, post-simulation-experience]

tech-stack:
  added: []
  patterns: [cross-scenario-context-injection, url-param-multi-scenario, policy-brief-generation]

key-files:
  created:
    - server/src/routes/policyBrief.ts
  modified:
    - web/src/pages/AgentReview.tsx
    - web/src/pages/Artifacts.tsx
    - server/src/routes/review.ts
    - server/src/llm/prompts.ts
    - server/src/index.ts
    - server/src/db/schema.ts
    - shared/src/types.ts
    - server/src/db/repos/sessionRepo.ts
    - server/src/routes/importexport.ts
    - server/src/routes/sessions.ts

key-decisions:
  - "Cross-scenario context keyed by agent name (lowercase) since agents across scenario forks share names but have different IDs"
  - "Policy brief endpoint mounted at /api/reflect (not session-scoped) since it takes multiple session IDs"
  - "Config diffs computed on server side relative to first session (baseline) for accurate parameter comparison"

patterns-established:
  - "URL-param multi-scenario pattern: ?scenarios=id1,id2 propagated to both AgentReview and Artifacts pages"
  - "Cross-scenario context passed from frontend to backend in chat request body, injected into LLM system prompt"

requirements-completed: [LSC-07, LSC-08]

duration: 10min
completed: 2026-04-08
---

# Phase 08 Plan 08: Multi-Scenario AgentReview and Policy Brief Summary

**Cross-scenario agent chat context with LLM-generated combined policy brief for post-simulation analysis across parallel scenario runs**

## Performance

- **Duration:** 10 min
- **Started:** 2026-04-08T03:25:00Z
- **Completed:** 2026-04-08T03:35:00Z
- **Tasks:** 2
- **Files modified:** 10

## Accomplishments

- AgentReview reads `?scenarios=id1,id2` from URL and fetches agent data, reflections, and final stats from all scenario sessions. Cross-scenario context is injected into the LLM system prompt so users can ask comparative questions like "How did you fare under Policy A vs Baseline?"
- Artifacts page supports multi-scenario mode: fetches artifacts from all scenario sessions with scenario-label prefixes, and offers a "Generate Policy Brief" button that calls the new `POST /api/reflect/policy-brief` endpoint.
- New `server/src/routes/policyBrief.ts` provides two endpoints: `POST /api/reflect/policy-brief` (combined markdown brief with executive summary, comparison table, findings, agent highlights, recommendations) and `POST /api/reflect/cross-scenario` (concise narrative comparison).
- `buildPolicyBriefPrompt` added to prompts.ts producing structured policy analyst prompt for N-scenario comparison.
- Added `groupId`/`scenarioLabel` to DB schema, shared types, and all mappers as prerequisite from Plan 08-01 (deviation Rule 3).

## Task Commits

Each task was committed atomically:

1. **Task 1: AgentReview cross-scenario context in chat** - `604ae57` (feat)
2. **Task 2: Artifacts combined policy brief with server endpoint** - `eaa4b7a` (feat)

## Files Created/Modified

- `web/src/pages/AgentReview.tsx` -- Multi-scenario context fetching, cross-scenario banner, enriched chat
- `web/src/pages/Artifacts.tsx` -- Multi-scenario artifact loading, policy brief UI with generate/view/download
- `server/src/routes/policyBrief.ts` -- NEW: policy-brief and cross-scenario endpoints
- `server/src/routes/review.ts` -- Accept crossScenarioContext in chat request
- `server/src/llm/prompts.ts` -- buildPolicyBriefPrompt, updated buildReviewChatPrompt signature
- `server/src/index.ts` -- Mount policyBrief router at /api/reflect
- `server/src/db/schema.ts` -- Added groupId, scenarioLabel columns
- `shared/src/types.ts` -- Added groupId, scenarioLabel to Session and SessionMetadata
- `server/src/db/repos/sessionRepo.ts` -- Added groupId, scenarioLabel to mappers
- `server/src/routes/importexport.ts` -- Added groupId, scenarioLabel to export
- `server/src/routes/sessions.ts` -- Added groupId, scenarioLabel to list response

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added groupId/scenarioLabel to schema and types**
- **Found during:** Task 1
- **Issue:** Plan 08-08 depends on Plan 08-01 which adds session grouping fields, but this worktree lacks those changes
- **Fix:** Added groupId/scenarioLabel to DB schema, shared types, sessionRepo mapper, importexport, and sessions route
- **Files modified:** server/src/db/schema.ts, shared/src/types.ts, server/src/db/repos/sessionRepo.ts, server/src/routes/importexport.ts, server/src/routes/sessions.ts
- **Commit:** 604ae57

## Known Stubs

None -- all data flows are wired to real endpoints and LLM calls.

## Verification

- `npx tsc --noEmit -p web/tsconfig.json` -- PASS (zero errors)
- `npx tsc --noEmit -p server/tsconfig.json` -- PASS (only pre-existing simulationRunner errors, no new errors)
- `npm run test -w server -- --run` -- PASS (161 tests, 13 files)

## Self-Check: PASSED

All files verified present. All commit hashes verified in git log.
