---
phase: 11-simulation-realism-organic-stress-pressure-fiscal-balance-and-sfc-leak-closure
plan: GC4
subsystem: ui
tags: [react, taxPolicy, form-validation, express]

requires:
  - phase: 11-09
    provides: "GovernanceToggle lock pattern + Fiscal section scaffold"
  - phase: 11-GC3
    provides: "bootstrap taxPolicy derivation (progressive kind for US); sources.taxPolicy='api'"
provides:
  - "Editable TaxPolicyEditor component replacing read-only TaxPolicyReadout"
  - "Server-side validateTaxPolicy on PUT /api/sessions/:id/config"
  - "DataSource 'user' union value for user-edited bootstrap parameters"
  - "Post-simulation lock for tax policy inputs"
affects: [12-*, scenario-builder]

tech-stack:
  added: []
  patterns:
    - "Own-echo detection via ref in controlled form to prevent state reset on prop round-trip"
    - "Client-side validation mirrors server-side validator shape"

key-files:
  created:
    - web/src/components/TaxPolicyEditor.tsx
    - server/src/__tests__/putConfigTaxPolicyValidation.test.ts
  modified:
    - web/src/components/EconomyTab.tsx
    - server/src/routes/sessions.ts
    - shared/src/types.ts
    - .planning/phases/11-.../11-UI-SPEC.md

key-decisions:
  - "Track hasUserEdited locally in the editor because parent store does not persist bootstrapSources through updateEconomyConfig"
  - "Rates stored in percent form (10, 20) inside component state; clamped to [0, 50] and normalized to decimal on emit"
  - "Deep-equality echo detection in sync useEffect to preserve Custom badge across own round-trips"

patterns-established:
  - "Own-echo detection: controlled form stores lastEmittedRef and skips prop-sync when incoming deep-equals own emit"
  - "Post-simulation lock pattern: opacity 0.5 + pointer-events none + disabled inputs + tooltip"

requirements-completed: [GC-02]

duration: ~10min execute + ~15min UAT iteration
completed: 2026-04-13
---

# Plan 11-GC4: TaxPolicyEditor Summary

**Fully editable TaxPolicy form replacing the read-only TaxPolicyReadout — client + server validation, source tracking, post-simulation lock.**

## Performance

- **Duration:** ~25 min total (10 min initial execute, 15 min UAT checkpoint iteration)
- **Tasks:** 3 (+ 2 follow-up UAT fixes)
- **Files created:** 2
- **Files modified:** 4

## Accomplishments
- Server-side `validateTaxPolicy` enforced on PUT /config (10 passing tests covering flat/progressive shapes, bracket monotonicity, missing fields)
- `TaxPolicyEditor` component with flat/progressive kind selector, 3 rate inputs, bracket builder with add/remove and inline validation
- Badge source tracking: fresh bootstrap shows "API"; any user edit flips to "Custom" and stays (own-echo resistant)
- Post-simulation lock mirroring GovernanceToggle from Phase 11-09
- 11-UI-SPEC.md updated from readout contract to editor contract

## Task Commits

1. **Task 0: DataSource 'user' union** — `602c84c`
2. **Task 1a: RED tests for PUT /config taxPolicy validation** — `abbca9d`
3. **Task 1b: GREEN — validateTaxPolicy wired into PUT /config** — `bf59400`
4. **Task 2: TaxPolicyEditor component + EconomyTab wiring** — `3616512`
5. **Task 2: UI-SPEC update** — `c40d8d3`

**UAT iteration (after checkpoint reply):**

6. **UAT fix 1: badge source tracking + bracket default units** — `9ba7f60`
   - Badge never flipped to "Custom" because parent store's `updateEconomyConfig` only writes to `economyConfig`, never to `session.config.bootstrapSources`; the `source` prop never changed. Added local `hasUserEdited` flag OR'd with prop.
   - `nextBracketDefault` returned `rate: 0.20` while component stores rates in percent form; new bracket displayed `0.2%`. Changed to `rate: 20`.

7. **UAT fix 2: own-echo flicker** — `f2ca4c5`
   - Every `onChange` round-trips through the Zustand store producing a new `taxPolicy` reference, which made the `[policy]`-dep effect reset `hasUserEdited` on every keystroke. Badge flashed Custom then reverted to API.
   - Added `lastEmittedRef` + `policyEquals` deep-equality check; effect skips resync when incoming policy matches our last emit.

## Files Created/Modified
- `web/src/components/TaxPolicyEditor.tsx` (created) — controlled form for taxPolicy with client validation, badge, and lock
- `server/src/__tests__/putConfigTaxPolicyValidation.test.ts` (created) — 10 server validation tests
- `web/src/components/EconomyTab.tsx` (modified) — mounts TaxPolicyEditor in Fiscal section
- `server/src/routes/sessions.ts` (modified) — validateTaxPolicy guard on PUT /config
- `shared/src/types.ts` (modified) — DataSource union adds `'user'`
- `.planning/phases/11-.../11-UI-SPEC.md` (modified) — replaces TaxPolicyReadout contract with TaxPolicyEditor contract

## Decisions Made
- Local `hasUserEdited` state preferred over upstream source-tracking refactor because the store's single-field `updateEconomyConfig` API would require deeper surgery to persist `bootstrapSources` updates. Trade-off: badge state is not persisted across page reloads, but that matches user intent (edits are design-stage decisions, not durable "custom" declarations).
- Rate units: component state in percent form for humane input UX; normalization to decimal happens only on emit via `clamp(v)/100`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Badge source tracking broken end-to-end**
- **Found during:** UAT checkpoint iteration 1
- **Issue:** Parent store's `updateEconomyConfig` only persists `economyConfig`, not `bootstrapSources`. The `source: 'user'` sent via onChange never reached DB/store, so the badge prop stayed `'api'` forever.
- **Fix:** Added local `hasUserEdited` flag + own-echo detection via ref.
- **Files modified:** web/src/components/TaxPolicyEditor.tsx
- **Verification:** UAT re-run — badge flips to "Custom" on edit and stays.
- **Committed in:** `9ba7f60`, `f2ca4c5`

**2. [Rule 1 - Bug] Bracket default rate displayed as 0.2%**
- **Found during:** UAT checkpoint iteration 1
- **Issue:** `nextBracketDefault` returned rate in decimal form (0.20) but component holds rates in percent form.
- **Fix:** Changed to `rate: 20`.
- **Committed in:** `9ba7f60`

**Total deviations:** 2 auto-fixed (both surfaced at UAT checkpoint, both single-file UI tweaks).
**Impact on plan:** No scope creep; tightened controlled-form invariants.

## Issues Encountered
- Own-echo flicker through Zustand store — root cause analyzed and fixed via ref-based echo detection.
- Observation (out of scope): all Economy-tab badges show "API" despite varying confidence colors — filed as Phase 11 follow-up in 11-VALIDATION.md.

## User Setup Required
None — no external services touched.

## Next Phase Readiness
- Design-stage tax policy editing is fully wired. Scenario tabs inherit the editor via ScenarioTabs' existing `bootstrapSources` prop chain.
- Lock pattern is reusable for future design-stage-only parameters.

---
*Phase: 11-simulation-realism-organic-stress-pressure-fiscal-balance-and-sfc-leak-closure*
*Plan: GC4*
*Completed: 2026-04-13*
