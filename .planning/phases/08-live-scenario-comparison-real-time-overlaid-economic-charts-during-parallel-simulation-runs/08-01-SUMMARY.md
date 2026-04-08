---
phase: 08-live-scenario-comparison-real-time-overlaid-economic-charts-during-parallel-simulation-runs
plan: 01
subsystem: api
tags: [sessions, drizzle, express, shared-types, scenario-grouping]
requires:
  - phase: 07-real-world-scenario-bootstrap
    provides: Scenario tab forking and baseline/scenario session creation
provides:
  - Session schema fields for scenario grouping metadata
  - Fork and fork-simulation endpoints that persist groupId and scenarioLabel
  - Grouped session listing and group patch endpoint for scenario management
affects: [home-page-grouping, simulation-routing, reflection-comparison, scenario-store]
tech-stack:
  added: []
  patterns: [nullable-session-grouping-fields, grouped-session-query, fork-metadata-propagation]
key-files:
  created: []
  modified:
    - server/src/db/schema.ts
    - shared/src/types.ts
    - server/src/db/repos/sessionRepo.ts
    - server/src/routes/importexport.ts
    - server/src/routes/sessions.ts
key-decisions:
  - "Session grouping stays nullable on the sessions table so existing sessions remain backward compatible."
  - "GET /api/sessions/grouped computes scenarioCount with a correlated SQL count while preserving the flat session list endpoint."
patterns-established:
  - "Grouping metadata is carried through shared Session/SessionMetadata types and persisted across export/import."
  - "Scenario forks derive their display title from scenarioLabel when present and otherwise fall back to the legacy fork suffix."
requirements-completed: [LSC-05]
duration: 12 min
completed: 2026-04-08
---

# Phase 08 Plan 01: Session Grouping Summary

**Session grouping metadata for scenario forks, grouped session queries, and shared type propagation for multi-scenario management**

## Performance

- **Duration:** 12 min
- **Started:** 2026-04-08T02:28:00Z
- **Completed:** 2026-04-08T02:39:35Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- Added nullable `groupId` and `scenarioLabel` columns to the session schema and exposed them in shared session types.
- Propagated grouping metadata through repository and import/export session mappers so grouped sessions survive API serialization.
- Added `GET /api/sessions/grouped`, `PATCH /api/sessions/:id/group`, and fork metadata persistence for both design and simulation forks.

## Task Commits

Each task was committed atomically:

1. **Task 1: Add groupId/scenarioLabel to DB schema and shared types** - `863fdf4` (feat)
2. **Task 2: Upgrade fork endpoint and add grouped sessions query** - `10283e7` (feat)

## Files Created/Modified
- `server/src/db/schema.ts` - Adds nullable `group_id` and `scenario_label` columns to `sessions`.
- `shared/src/types.ts` - Extends `Session` and `SessionMetadata` with grouping metadata.
- `server/src/db/repos/sessionRepo.ts` - Includes grouping metadata in session row mapping and metadata listing.
- `server/src/routes/importexport.ts` - Preserves `groupId` and `scenarioLabel` during export/import.
- `server/src/routes/sessions.ts` - Returns grouping fields in lists, adds grouped/group patch endpoints, and persists fork metadata.

## Decisions Made
- Kept `groupId` and `scenarioLabel` nullable to satisfy D-35/D-36 without forcing migration defaults onto pre-existing sessions.
- Left `GET /api/sessions` as the flat list endpoint and added `GET /api/sessions/grouped` as the scenario-aware view to avoid breaking existing callers.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- `npx tsc --noEmit -p server/tsconfig.json` is currently blocked by unrelated typing errors in `server/src/llm/__tests__/loadBalancer.test.ts`, which is outside this plan's ownership and was already changing in the parallel workspace.
- `npm run test -w server -- --run` initially failed in the sandbox with `spawn EPERM`; rerunning outside the sandbox succeeded with 21/21 test files and 218/218 tests passing.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Session grouping primitives are in place for Home page grouping and multi-scenario navigation work.
- The flat and grouped session APIs now expose enough metadata for downstream UI plans to treat single sessions and scenario groups consistently.

---
*Phase: 08-live-scenario-comparison-real-time-overlaid-economic-charts-during-parallel-simulation-runs*
*Completed: 2026-04-08*

## Self-Check: PASSED

- FOUND: `.planning/phases/08-live-scenario-comparison-real-time-overlaid-economic-charts-during-parallel-simulation-runs/08-01-SUMMARY.md`
- FOUND: `863fdf4`
- FOUND: `10283e7`
