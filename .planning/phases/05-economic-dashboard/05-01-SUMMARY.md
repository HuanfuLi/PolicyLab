---
phase: 05-economic-dashboard
plan: "01"
subsystem: shared-types + frontend-store
tags: [telemetry, zustand, recharts, types, macroHistory]
dependency_graph:
  requires: [phase-03-fiscal-policy, phase-04-inflation-loop]
  provides: [TelemetryLog-extended, macroHistory-store-slice, recharts-installed]
  affects: [web/src/stores/simulationStore.ts, shared/src/types.ts]
tech_stack:
  added: [recharts@^3.8.1]
  patterns: [SSE-polling-hybrid, zustand-async-action, TelemetryLog-accumulation]
key_files:
  created: []
  modified:
    - shared/src/types.ts
    - web/src/stores/simulationStore.ts
    - web/src/pages/DesignReview.tsx
decisions:
  - "macroHistory populated by polling /simulate/telemetry endpoint (not SSE push) — SSE events lack TelemetryLog; polling is simpler and low-frequency"
  - "needMacroReload flag mirrors needAgentReload pattern — triggers one fetch per iteration-complete, not per SSE event"
  - "FiscalCategory exported from shared/src/types.ts alongside TelemetryLog — co-location avoids import loops"
metrics:
  duration_minutes: 20
  completed_date: "2026-04-01"
  tasks_completed: 2
  files_modified: 4
---

# Phase 05 Plan 01: TelemetryLog Extension + macroHistory Store Slice

Extended TelemetryLog with Phase 3-4 economic fields (m2, fiscalSpending, publicGoodsQuality, centralBankRate, bondYields) and wired simulationStore to accumulate per-iteration telemetry in a typed macroHistory array with polling on each iteration-complete event.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Extend TelemetryLog with Phase 3-4 economic fields | aec4915 | shared/src/types.ts |
| 2 | Add macroHistory to simulationStore + install recharts | 99ae58b | web/src/stores/simulationStore.ts, web/package.json, package-lock.json, web/src/pages/DesignReview.tsx |

## What Was Built

**Task 1 — TelemetryLog extension:**
- Added `FiscalCategory` type export: `'infrastructure' | 'education' | 'defense' | 'welfare'`
- Added `m2?`, `fiscalSpending?` (Partial<Record<FiscalCategory, number>>), `publicGoodsQuality?` (Partial<Record<FiscalCategory, number>>) for fiscal policy telemetry
- Added `centralBankRate?` and `bondYields?: { governmentYield?, corporateYield? }` for inflation/bond telemetry
- All fields are optional — existing sessions without Phase 3-4 emit no errors

**Task 2 — simulationStore macroHistory:**
- Installed recharts@^3.8.1 in web workspace dependencies
- Added `macroHistory: TelemetryLog[]` to SimulationStore interface and initialState
- Added `loadMacroHistory(sessionId)` action that fetches `/api/sessions/:id/simulate/telemetry` and sets `macroHistory`
- `loadHistory` now calls `loadMacroHistory` after the iteration history load
- `flushBuffer` in `connectSSE` sets `needMacroReload = true` on `iteration-complete` events, triggering a macro reload after each tick

## Decisions Made

- **Polling vs SSE push for macroHistory:** The SSE `iteration-complete` event carries `IterationStats` but not `TelemetryLog`. Rather than change the server SSE shape (which would be a server-side change outside this plan's scope), `macroHistory` is populated by polling the existing `/simulate/telemetry` endpoint. One poll per iteration-complete is acceptable latency.
- **needMacroReload pattern:** Follows the existing `needAgentReload` double-buffer pattern exactly — declared before the batch loop, set in `iteration-complete` case, acted on after `set()` returns outside the Zustand updater.
- **FiscalCategory in shared types:** The type is defined adjacent to TelemetryLog in `shared/src/types.ts` rather than in server-side types, making it available to both web chart components and server-side fiscal engine without import loops.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed pre-existing TS2352 type assertion in DesignReview.tsx**
- **Found during:** Task 2 (first web build attempt)
- **Issue:** `session.config as Record<string, unknown>` caused a TypeScript 2352 error — the types don't overlap sufficiently for a direct assertion
- **Fix:** Changed to `session.config as unknown as Record<string, unknown>` (double assertion through `unknown`)
- **Files modified:** web/src/pages/DesignReview.tsx (line 78)
- **Commit:** 99ae58b (included in Task 2 commit)

## Known Stubs

None — no data flows are stubbed. `macroHistory` populates from the live `/simulate/telemetry` endpoint which is wired in Phase 1-4.

## Verification

- `npm run build -w shared` exits 0
- `npm run build -w web` exits 0
- `grep "cpi?" shared/src/types.ts` matches (line 269)
- `grep "macroHistory" web/src/stores/simulationStore.ts` matches 6 lines
- `grep "recharts" web/package.json` matches

## Self-Check: PASSED

Files exist:
- shared/src/types.ts — modified with FiscalCategory and new TelemetryLog fields
- web/src/stores/simulationStore.ts — modified with macroHistory

Commits exist:
- aec4915 — feat(05-01): extend TelemetryLog with Phase 3-4 economic fields
- 99ae58b — feat(05-01): add macroHistory to simulationStore + install recharts
