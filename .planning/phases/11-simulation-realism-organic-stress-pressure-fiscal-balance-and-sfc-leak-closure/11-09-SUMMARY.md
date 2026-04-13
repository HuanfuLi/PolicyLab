---
phase: 11-simulation-realism-organic-stress-pressure-fiscal-balance-and-sfc-leak-closure
plan: 09
subsystem: ui/frontend/dashboard
tags: [react, recharts, economyTab, economicDashboard, governance, taxPolicy, sfcDrift, lucide, theme-tokens, a11y]

# Dependency graph
requires:
  - phase: 11
    plan: 01
    provides: Wave 0 shared types (TaxPolicy, economyConfig.governanceEnabled, TelemetryLog.sfcDrift + sfcDriftBySubsystem) consumed verbatim by EconomyTab + EconomicDashboard
  - phase: 11
    plan: 05
    provides: Bootstrap-emitted economyConfig.taxPolicy rendered by the new TaxPolicyReadout card
  - phase: 11
    plan: 06
    provides: governanceEnabled toggle wiring on PUT /config that the EconomyTab checkbox writes through
  - phase: 11
    plan: 07
    provides: sfcDrift + sfcDriftBySubsystem telemetry emitted per iteration, surfaced by the new 5th dashboard panel + banner
provides:
  - GovernanceToggle inline sub-component in EconomyTab (D-17) — checkbox with UI-SPEC copy verbatim, disables after isPastCheckpoint
  - TaxPolicyReadout inline sub-component in EconomyTab (D-13) — renders flat rates or progressive brackets; non-interactive; reuses DataConfidenceBadge (source=llm, confidence=medium)
  - SfcDriftChart file-local function in EconomicDashboard — 5th recharts panel; 7-line LineChart (6 subsystems + total overlay with strokeDasharray '5 3'); 220px height; --chart-* token palette
  - SfcDriftBanner inline render in EconomicDashboard — AlertTriangle + red border + smooth-scroll CTA; renders only when |latest.sfcDrift| > 0.1; role='alert' + aria-live='polite'
  - ScenarioTabs + DesignReview passthrough for isPastCheckpoint so the governance toggle locks after simulation start regardless of mode (creative/location)
  - UAT-fix: DataConfidenceBadge tooltip background now uses --bg-color (opaque) instead of --bg-card (translucent); readability fix confirmed in both themes
affects: [11-10]

# Tech tracking
tech-stack:
  added: []  # No new dependencies; recharts + lucide-react + theme tokens already installed via prior phases
  patterns:
    - "Inline sub-component idiom for EconomyTab + EconomicDashboard: both files already contain file-local components (e.g. CpiChart, MoneySupplyChart in EconomicDashboard) — new components stay inline per UI-SPEC §Extraction guidance unless they grow beyond ~40 lines"
    - "Theme-token-only styling discipline: zero hex literals introduced across any of the 4 new UI elements; all colors from --chart-*, --color-*, --text-main, --text-muted, --glass-bg, --glass-border, --panel-alpha-10, --bg-color tokens"
    - "UI-SPEC Copywriting Contract verbatim: every label, description, empty state, banner heading, banner body, and CTA in 11-UI-SPEC.md appears as an exact grep-matchable string in the production source (confirmed via plan acceptance_criteria grep counts)"
    - "Conditional render + smooth-scroll anchor pattern for drift banner: banner renders only when the condition fires; clicking the CTA uses document.getElementById + scrollIntoView rather than a route change, keeping the user in the dashboard context"
    - "a11y baseline for alert banners: role='alert' + aria-live='polite' + AlertTriangle size=16 + color prop on the icon (color='var(--color-red)'), ensuring screen readers announce the drift event and the visual indicator has sufficient contrast in both themes"

key-files:
  created: []  # No new files — all changes inline in existing components
  modified:
    - web/src/components/EconomyTab.tsx  # GovernanceToggle + TaxPolicyReadout inline sub-components wired into existing layout
    - web/src/components/EconomicDashboard.tsx  # SfcDriftChart 5th panel + SfcDriftBanner conditional render
    - web/src/pages/DesignReview.tsx  # Threaded isPastCheckpoint prop to ScenarioTabs so toggle locking applies across all session modes
    - web/src/components/ScenarioTabs.tsx  # Passthrough of isPastCheckpoint to EconomyTab
    - web/src/components/DataConfidenceBadge.tsx  # UAT-fix: tooltip background var(--bg-card) -> var(--bg-color) for readability; drop shadow deepened slightly
    - web/src/stores/scenarioStore.ts  # Rule 3 blocking fix: cast via 'unknown' to satisfy stricter EconomyConfig narrowing that blocked 'npm run build -w web'
    - .planning/phases/11-simulation-realism-organic-stress-pressure-fiscal-balance-and-sfc-leak-closure/deferred-items.md  # Added "Agent-roster generation issues" section for two out-of-scope UAT findings

key-decisions:
  - "Governance toggle placed directly above the Fiscal section (per UI-SPEC placement guidance) and wired through the existing PUT /config flow via the onEconomyConfigChange callback — no new endpoints, no new stores. Writes economyConfig.governanceEnabled as a partial patch."
  - "Toggle disable pattern mirrors existing Economy controls — opacity 0.5 + cursor not-allowed + title='Locked after simulation starts.' when isPastCheckpoint is true. Threaded the prop through ScenarioTabs so the behavior is identical whether a session uses the direct EconomyTab mount or the scenario-tab wrapper."
  - "TaxPolicyReadout is intentionally non-interactive (no input controls, no click affordances) per UI-SPEC — runtime tax-policy amendment is out of scope for Phase 11 and deferred to a future phase. The card explicitly states 'Runtime amendment is coming in a future phase' so policymakers know it is observation-only."
  - "Empty-state copy for missing taxPolicy ('No tax policy configured — this session predates Phase 11. Default flat 10% will apply.') acknowledges Phase-11-pre sessions and tells the operator the runtime behavior. No silent substitution — the UI surfaces the fallback explicitly."
  - "SfcDriftChart uses 220px height (10% taller than the 200px standard) because 7 series need the vertical room; the total-overlay line uses strokeDasharray='5 3' to match the CpiChart EWMA convention, making the overlay visually distinct without introducing a new pattern."
  - "SfcDriftBanner renders only when |sfcDrift| > 0.1 — threshold pulled verbatim from UI-SPEC + D-23. The banner acknowledges 'The simulation has not been paused' because per D-23 drift is observable-only in this phase (no auto-correction, no hard halt); operators are expected to investigate via the drift panel rather than have the runner fail-fast."
  - "Jump-to-panel CTA uses smooth scrollIntoView on the #sfc-drift-panel anchor rather than a route change — keeps the operator in the dashboard, lets the banner serve as both alert and navigation affordance. The anchor ID is added to the panel container and only used by the banner today; future phase could add deep-linking."
  - "UAT-fix commit ee38f0e: DataConfidenceBadge tooltip background changed from --bg-card (panel-alpha-10, translucent) to --bg-color (solid theme background). The translucent background let body text bleed through the 'Estimate' tooltip, hurting readability in both themes. Drop shadow also deepened from rgba(0,0,0,0.2) 2px 8px to rgba(0,0,0,0.25) 4px 12px for better elevation perception."
  - "Rule 3 blocking fix at scenarioStore.ts: pre-existing build error (TS2352: Type 'EconomyConfig' cannot be cast to Record<string, unknown>) blocked 'npm run build -w web' which is part of 11-09's acceptance criteria. Resolved with 'as unknown as Record<string, unknown>' — pure typing change, zero behavior impact. Required to satisfy the plan's success criterion that web builds succeed."

patterns-established:
  - "Cross-component prop threading for lock state: when a toggle needs to disable after simulation start regardless of session mode, thread isPastCheckpoint from DesignReview -> ScenarioTabs -> EconomyTab rather than coupling EconomyTab to a store. Keeps EconomyTab prop-driven and testable; lock-state logic stays owned by DesignReview."
  - "Observation-only UI surface for design-time-only data: TaxPolicyReadout is the template for any future card that renders a Central-Agent-chosen value without runtime amendment — non-interactive card with DataConfidenceBadge, empty-state copy explaining the fallback, and a trailer like 'Runtime amendment is coming in a future phase' so operators know the field is read-only."
  - "Telemetry-driven conditional banners: SfcDriftBanner reads the latest TelemetryLog entry from macroHistory, checks a threshold, and renders only when the condition fires. This pattern (latest-only + threshold-conditional + smooth-scroll anchor to the relevant panel) is reusable for any future 'watch telemetry X exceed threshold Y' alert."
  - "Theme-token-only CSS discipline: any time a contributor is tempted to use a hex literal, check theme tokens first. UI-SPEC hard rule (grep -cE '#[0-9a-fA-F]{3,6}' returns 0) enforced via plan acceptance_criteria grep counts — prevents palette drift across dark/light themes."
  - "UAT-fix-in-band: readability regressions surfaced during human verification can be addressed in a follow-up commit to the same plan (rather than deferred to a gap-closure plan) when the fix is scoped to a single file + a single token swap. Deferred items table in deferred-items.md still captures out-of-scope UAT findings that cannot be fixed in band."

decisions-addressed: [D-13, D-17, D-21, D-23]
requirements-completed: [D-13, D-17, D-21, D-23]

# Metrics
duration: ~2h (commit span; includes UAT wait)
completed: 2026-04-13
---

# Phase 11 Plan 09: Phase 11 Frontend UI (Governance Toggle, Tax Policy Readout, SFC Drift Panel + Banner) Summary

**Surfaced all four Phase-11 backend capabilities — emergent-governance on/off, Central-Agent-chosen tax policy, per-subsystem SFC drift telemetry, and over-threshold drift alerting — as production-ready UI elements inline in EconomyTab and EconomicDashboard; UI-SPEC copy verbatim, theme tokens only, zero hex literals; human UAT signed off in both dark and light themes with one in-band readability fix (opaque tooltip background) and two out-of-scope roster-generation issues deferred.**

## Performance

- **Duration:** ~2h wall-clock (first production commit `1b597f3` at 2026-04-13T21:09:36Z → UAT-fix commit `ee38f0e` at 2026-04-13T23:01:13Z). Active engineering time ~30min across Tasks 1 + 2 + UAT-fix; remainder was the human UAT cycle.
- **Started:** 2026-04-13T21:09:36Z (Task 1 commit)
- **Completed:** 2026-04-13T23:01:13Z (UAT-fix commit; human sign-off "Other UAT passed" followed)
- **Tasks:** 3 (Task 1 GovernanceToggle + TaxPolicyReadout, Task 2 SfcDriftChart + SfcDriftBanner, Task 3 human-verify checkpoint)
- **Commits:** 3 feature/fix commits + 1 metadata commit (this summary / state / roadmap)
- **Files modified:** 7 (3 primary component files, 2 wiring files for prop threading, 1 badge fix, 1 deferred-items doc)

## Accomplishments

- **GovernanceToggle inline sub-component** added directly above the Fiscal section in `EconomyTab.tsx`. Label "Emergent Governance" with UI-SPEC-verbatim description "When off, agents cannot amend policy mid-simulation. Use for clean A/B policy comparison." Writes `economyConfig.governanceEnabled` via the existing `onEconomyConfigChange` partial-patch callback. Disables with `opacity: 0.5` + `cursor: not-allowed` + `title='Locked after simulation starts.'` when `isPastCheckpoint` is true. `aria-label` toggles between "Enable emergent governance" and "Disable emergent governance" depending on current value. (D-17)
- **TaxPolicyReadout inline sub-component** added at the top of the Fiscal section body. Section heading "Tax Policy (chosen at design)", explanatory line "Selected by the Central Agent from real-world context. Runtime amendment is coming in a future phase.", and three-branch render (flat / progressive brackets / empty). Reuses `DataConfidenceBadge` with `source="llm"` + `confidence="medium"` + `sourceNote="Generated by Central Agent from bootstrap data"`. Non-interactive: no inputs, no click handlers, no keyboard affordances. (D-13)
- **SfcDriftChart** added as the 5th recharts panel in `EconomicDashboard.tsx` after the existing BondYieldChart. 7-line LineChart: `banking` (`--chart-blue`), `capmkt` (`--chart-violet`), `fiscal` (`--chart-green`), `enforcement` (`--chart-orange`), `trade` (`--chart-teal`), `physicsActions` (`--chart-yellow`), `total` (`--chart-red`, `strokeDasharray="5 3"`). 220px height per UI-SPEC. Section title "SFC DRIFT — SUBSYSTEM BALANCE", subtitle "Per-iteration fiat delta by subsystem. All values should approach zero.", empty-state "No drift data yet — start a simulation to observe subsystem balance." Reads `sfcDriftBySubsystem` + `sfcDrift` from `TelemetryLog` via macroHistory. (D-21)
- **SfcDriftBanner** inline render at the top of the EconomicDashboard main return. Conditionally renders when `Math.abs(latest.sfcDrift) > 0.1`. AlertTriangle icon from `lucide-react` (size=16, `color="var(--color-red)"`, `aria-hidden="true"`). Heading "SFC drift over threshold"; body "Iteration {N}: total drift is {X.XX} fiat (threshold 0.10). The simulation has not been paused; review the drift panel below to identify the leaking subsystem." CTA "Jump to drift panel →" smooth-scrolls to `#sfc-drift-panel`. `role="alert"` + `aria-live="polite"`. 1px `--color-red` border + `--panel-alpha-10` background. (D-23)
- **ScenarioTabs + DesignReview prop threading** for `isPastCheckpoint` so the governance toggle's lock state applies whether the EconomyTab is mounted directly (creative mode) or via the scenario-tab wrapper (location-bootstrap mode). Two-line passthrough change in `ScenarioTabs.tsx`; one-line `isPastCheckpoint={!!isPastDesign}` prop addition in `DesignReview.tsx`.
- **UAT-fix commit `ee38f0e`:** DataConfidenceBadge tooltip background changed from translucent `--bg-card` (panel-alpha-10) to opaque `--bg-color`. Drop shadow deepened from `rgba(0,0,0,0.2) 2px 8px` to `rgba(0,0,0,0.25) 4px 12px`. Also logged two UAT-surfaced roster-generation issues (duplicate agent names, all-Hanzi names on China bootstrap) to `deferred-items.md` under "Agent-roster generation issues" as out-of-scope follow-ups.
- **Rule 3 blocking TypeScript fix at `scenarioStore.ts`:** pre-existing TS2352 error (EconomyConfig cannot be cast to `Record<string, unknown>`) blocked `npm run build -w web` which is part of 11-09's success criteria. Resolved with `as unknown as Record<string, unknown>`. Pure typing change, zero runtime impact. Committed inline with Task 2 (commit `8de8d43`).
- **Human UAT pass.** All 9 browser verification steps from the Task 3 checkpoint confirmed in both dark and light themes: governance toggle render + disable behavior, tax-policy readout + DataConfidenceBadge, 5-panel dashboard with 7-line drift chart + tooltip, drift banner conditional rendering + smooth-scroll CTA, theme legibility, a11y attributes on the alert banner. Operator response: "Other UAT passed." recorded alongside three specific findings triaged (1 fixed in-band, 2 deferred).

## Task Commits

Each task committed atomically:

1. **Task 1: GovernanceToggle + TaxPolicyReadout in EconomyTab** — `1b597f3` (feat)
2. **Task 2: SfcDriftChart panel + SfcDriftBanner in EconomicDashboard** — `8de8d43` (feat; also includes the Rule 3 blocking scenarioStore.ts cast fix)
3. **Task 3: Human verification of Phase 11 UI across dark and light themes** — No code commit. Blocking human checkpoint; UAT outcome recorded in the plan close-out (this summary). One UAT-fix commit (see below) surfaced during verification and was applied in-band.

**UAT-fix commit:** `ee38f0e` (fix) — opaque tooltip background on DataConfidenceBadge + deferred-items.md entry for two out-of-scope roster issues.

**Plan metadata commit:** pending (this SUMMARY.md + STATE.md + ROADMAP.md update).

## Files Created/Modified

### Production

- `web/src/components/EconomyTab.tsx` — Inline `GovernanceToggle` sub-component (lines added directly above the Fiscal section) + inline `TaxPolicyReadout` sub-component (rendered at the top of the Fiscal section body). Added `TaxPolicy` import from `@policylab/shared`. Added `isPastCheckpoint?: boolean` prop.
- `web/src/components/EconomicDashboard.tsx` — New file-local `SfcDriftChart` function mirroring the CpiChart / MoneySupplyChart pattern. New inline `SfcDriftBanner` conditional render at the top of the main return. Added `AlertTriangle` import from `lucide-react`. Tooltip formatter tweaked to satisfy recharts stricter types.
- `web/src/pages/DesignReview.tsx` — Added `isPastCheckpoint={!!isPastDesign}` prop to the ScenarioTabs mount so the governance toggle lock applies across all session modes.
- `web/src/components/ScenarioTabs.tsx` — Passthrough of `isPastCheckpoint` from DesignReview to the nested EconomyTab.
- `web/src/components/DataConfidenceBadge.tsx` — UAT-fix: tooltip `background: 'var(--bg-card)'` → `'var(--bg-color)'`; drop shadow tweaked for better elevation.
- `web/src/stores/scenarioStore.ts` — Rule 3 blocking TS fix: `as Record<string, unknown>` → `as unknown as Record<string, unknown>` to unblock `npm run build -w web`.

### Documentation

- `.planning/phases/11-simulation-realism-organic-stress-pressure-fiscal-balance-and-sfc-leak-closure/deferred-items.md` — Added "Agent-roster generation issues (surfaced during Phase 11 UAT, outside scope)" section with two entries: duplicate agent names and all-Hanzi names on China bootstrap. Both flagged for a future roster-generation hardening phase.

## Decisions Made

- **Governance toggle placement: directly above the Fiscal section** — UI-SPEC placement guidance. The toggle affects the entire emergent-policy loop, which intersects most directly with fiscal-policy observation, so grouping them visually reinforces the relationship.
- **Tax-policy readout as observation-only card, not editable form** — UI-SPEC contract. Runtime tax-policy amendment is deferred to a future phase; the card explicitly states this so operators do not hunt for an edit affordance.
- **Empty-state copy for Phase-11-pre sessions is explicit about the fallback** — "No tax policy configured — this session predates Phase 11. Default flat 10% will apply." makes the runtime behavior visible rather than hiding it.
- **7-line LineChart at 220px height** — 6 subsystems + total overlay need vertical room; strokeDasharray='5 3' on the total line keeps it visually distinct without introducing a new chart pattern (mirrors CpiChart's EWMA convention).
- **Drift banner is observation-only, not a pause signal** — D-23 per-subsystem drift is telemetry, not enforcement. Banner body explicitly says "The simulation has not been paused" so operators understand the reporting contract and investigate rather than wait for an auto-halt.
- **Smooth-scroll CTA instead of route change** — Banner + chart live in the same dashboard; keeping the operator in context is better UX than navigating away. `#sfc-drift-panel` anchor ID on the panel container supports future deep-linking if needed.
- **UAT-fix in band rather than a gap-closure plan** — The readability regression was scoped to one file + one token swap. Committing it as part of 11-09 (with the two out-of-scope roster issues deferred) is cleaner than splintering into a follow-up plan. The deferred-items.md section captures what could not be handled in band.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] Fixed pre-existing scenarioStore.ts TS2352 cast error**
- **Found during:** Task 2 (SfcDriftChart wiring — `npm run build -w web` verification)
- **Issue:** Pre-existing TS2352 at `web/src/stores/scenarioStore.ts`: `Type 'EconomyConfig' cannot be cast to type 'Record<string, unknown>'` prevented `npm run build -w web` from succeeding. Plan success criterion requires web build to pass.
- **Fix:** Cast via `unknown` first: `as Record<string, unknown>` → `as unknown as Record<string, unknown>`. Pure typing change, zero runtime impact.
- **Files modified:** `web/src/stores/scenarioStore.ts` (single-line change)
- **Verification:** `npm run build -w web` now exits 0; `npx tsc --noEmit -p web/tsconfig.app.json` unchanged error count minus this one.
- **Committed in:** `8de8d43` (part of Task 2 commit)

### UAT-fix (in band, post-checkpoint)

**2. [UAT — Readability] Opaque tooltip background on DataConfidenceBadge**
- **Found during:** Task 3 human verification (UAT response)
- **Issue:** The "Estimate" tooltip on `DataConfidenceBadge` used `--bg-card` (translucent, panel-alpha-10), allowing body text below it to bleed through and hurting readability in both themes.
- **Fix:** Changed tooltip background from `var(--bg-card)` to `var(--bg-color)` (solid theme background). Drop shadow deepened from `rgba(0,0,0,0.2) 2px 8px` to `rgba(0,0,0,0.25) 4px 12px` for better elevation perception.
- **Files modified:** `web/src/components/DataConfidenceBadge.tsx` (lines 62 + 69 equivalent)
- **Verification:** Human UAT confirmed readability on both dark and light themes after fix.
- **Committed in:** `ee38f0e`

### Out-of-scope deferrals (not fixed; logged)

**3. [Out of scope — Roster generation] Duplicate agent names and all-Hanzi names for China bootstrap**
- **Found during:** Task 3 human verification
- **Issue:** Two roster-generation issues surfaced during UAT on a China location bootstrap: (a) multiple agents share identical display names, (b) all agent names render as Hanzi with no romanization.
- **Disposition:** Not in scope for Phase 11 (stress/fiscal/SFC contract surface). Logged to `.planning/phases/11-.../deferred-items.md` under a new "Agent-roster generation issues" section with a recommendation to address in a future "roster polish" / "agent generation hardening" phase.
- **Committed in:** `ee38f0e` (deferred-items.md update accompanies the tooltip fix)

---

**Total deviations:** 1 auto-fixed (Rule 3 blocking TS2352) + 1 in-band UAT fix (tooltip readability) + 2 out-of-scope deferrals (duplicate names, all-Hanzi names — logged to deferred-items.md).

**Impact on plan:** Rule 3 fix was essential to satisfy the `npm run build -w web` success criterion. UAT-fix was a single-token CSS swap scoped to one file, cleaner to handle in band than escalate to a follow-up plan. Out-of-scope deferrals do not touch Phase 11's contract surface (stress, fiscal, SFC, tax, governance) so they are logged rather than blocking. No scope creep; plan delivered exactly what was specified plus the readability polish.

## Issues Encountered

- **Pre-existing dirty working tree at session start** — `.planning/STATE.md`, `package-lock.json`, `server/src/db/migrate.ts`, `server/src/mechanics/orderBook.ts`, `server/src/routes/bootstrap.ts`, `server/src/routes/simulate.ts` carried uncommitted edits from prior sessions (per the ongoing Phase 11 deferred-items notes). None intersect with Plan 11-09's frontend scope. Not committed in this plan.
- **Pre-existing TypeScript errors** unchanged by this plan; the Rule 3 fix at `scenarioStore.ts` reduced the count by 1 but other pre-existing server + test errors remain (documented in 11-01's and 11-02's deferred-items entries).
- **No auth gates encountered** — fully autonomous up to the planned Task 3 human-verify checkpoint.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

**Plan 11-10 (final validation + human-approved smoke run vs US baseline) is unblocked.**

- **Frontend surface is complete.** All four Phase-11 backend capabilities have operator-facing UI: governance toggle (D-17), tax-policy readout (D-13), SFC drift panel (D-21), SFC drift banner (D-23).
- **UI is verified across themes.** Human UAT confirmed dark and light theme legibility, a11y attributes, disable behavior, and conditional rendering.
- **Readability polish landed.** The tooltip fix (ee38f0e) removes the only readability regression surfaced during UAT.
- **Deferred items are explicit.** Two UAT findings (duplicate names, all-Hanzi names) are logged in `deferred-items.md` so Plan 11-10 validation does not need to triage them — they belong to a future roster-generation phase and are pre-existing vs Phase 11.

**Operator workflow for Plan 11-10 smoke run is now:** bootstrap US, verify baseline telemetry in the 5-panel dashboard, toggle governance off for a clean A/B comparison run, observe tax policy in the readout, watch for SFC drift banner firing (expectation: should not fire with Phase 11's subsystem closures in place).

**Blockers:** None.

## Known Stubs

None. All four UI surfaces are fully wired:

- `GovernanceToggle` reads/writes the real `economyConfig.governanceEnabled` field via the existing PUT /config flow — no placeholder state.
- `TaxPolicyReadout` reads the real `economyConfig.taxPolicy` field populated by Plan 11-05's bootstrap + creative-law path — empty-state copy covers Phase-11-pre sessions explicitly.
- `SfcDriftChart` reads real `sfcDrift` + `sfcDriftBySubsystem` from TelemetryLog macroHistory populated by Plan 11-07 — empty-state fires only when no simulation has run yet.
- `SfcDriftBanner` reads the real latest-iteration drift value with a verbatim D-23 threshold (0.1). No mock, no stub, no fallback data.

The only non-production consideration: the banner's `Jump to drift panel →` anchor ID is used by the banner itself only today; future phases could add deep-linking to this anchor (e.g., from a notification center), but the current single-consumer usage is intentional and complete for 11-09's scope.

## Self-Check: PASSED

- `web/src/components/EconomyTab.tsx` contains `function GovernanceToggle` — verified.
- `web/src/components/EconomyTab.tsx` contains `function TaxPolicyReadout` — verified.
- `web/src/components/EconomicDashboard.tsx` contains `function SfcDriftChart` — verified.
- `web/src/components/EconomicDashboard.tsx` contains `function SfcDriftBanner` — verified.
- `web/src/components/DataConfidenceBadge.tsx:62` uses `background: 'var(--bg-color)'` (not `var(--bg-card)`) — verified via grep.
- Commits `1b597f3` (Task 1), `8de8d43` (Task 2), `ee38f0e` (UAT-fix) all present in `git log --oneline --all` — verified.
- `deferred-items.md` contains the "Agent-roster generation issues (surfaced during Phase 11 UAT, outside scope)" section — verified.
- Human UAT response "Other UAT passed." recorded; Task 3 checkpoint signed off by operator — verified per resume_instructions.

---
*Phase: 11-simulation-realism-organic-stress-pressure-fiscal-balance-and-sfc-leak-closure*
*Completed: 2026-04-13*
