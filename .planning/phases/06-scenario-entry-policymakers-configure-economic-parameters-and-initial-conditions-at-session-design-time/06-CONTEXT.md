# Phase 6: Scenario Entry — Context

**Gathered:** 2026-04-01
**Status:** Ready for planning

<domain>
## Phase Boundary

Policymakers configure economic parameters and initial conditions at session design time through a new Economy tab in Design Review. Includes fork-based A/B scenario workflow and upgraded comparison system to surface economic metrics and parameter diffs.

This phase builds on the EconomyConfig type and economic engine from Phases 1–4 and the dashboard from Phase 5. It is the UI/UX layer that makes those systems accessible to non-technical policymakers.

</domain>

<decisions>
## Implementation Decisions

### Entry Point & Flow
- **D-01:** Economy tab added to Design Review page alongside existing Overview/Agents/Law tabs. No separate page or wizard.
- **D-02:** Fork-from-design enables A/B scenario comparison. After designing agents, user forks the session, changes economic parameters in the Economy tab, then re-simulates. Comparison page shows both runs side-by-side.
- **D-03:** Existing `POST /api/sessions/:id/fork` endpoint already clones agents + design and sets stage to `design-review`. Upgrade it to also clone EconomyConfig so users can modify economic params before re-simulating.

### Parameter Presentation
- **D-04:** Parameters organized in collapsible grouped panels within the Economy tab: Banking, Fiscal, Inflation sections. Each section contains its EconomyConfig parameters.
- **D-05:** Input controls are sliders with numeric input fields. Slider for quick adjustment, numeric field for precision. Show min/max/default for each parameter.

### Validation & Guidance
- **D-06:** Soft limits with override — parameters have recommended ranges. Going outside shows a warning + "I understand the risks" confirmation dialog. Never hard-block experimentation.
- **D-07:** Inline tooltips — info icon next to each parameter. Hover/click shows 1-2 sentence explanation + real-world analogy (e.g., "Reserve ratio: US banks typically hold 10%").

### Fork & A/B Comparison Upgrade
- **D-08:** Comparison page shows a "Configuration Differences" section listing exactly which economic parameters differ between the two sessions. Critical for policy analysis — "we changed X, and here's what happened."
- **D-09:** Comparison dimensions expanded from 5 to 8-10, adding economic metrics: Gini coefficient, inflation rate, banking stability, fiscal spending effectiveness alongside existing Economic Equality, Citizen Wellbeing, Social Cohesion, Governance Effectiveness, Long-term Stability.
- **D-10:** `POST /fork-simulation` endpoint exists but is not exposed in UI. Evaluate whether to surface it for "branch from iteration N" scenarios.

### Claude's Discretion
- Exact slider ranges and default values for each EconomyConfig parameter (derive from research and existing physicsConfig.ts patterns)
- Panel collapse/expand behavior and visual styling (follow existing Design Review patterns)
- How to handle the Economy tab for pre-v1.0 sessions (likely hide it or show disabled state)
- Whether to add scenario presets ("Free Market", "Social Democracy") — nice-to-have, not required
- Exact 8-10 comparison dimension names and scoring methodology for new economic dimensions

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Design Review Integration
- `web/src/pages/DesignReview.tsx` — Current tab structure (Overview/Agents/Law), action bar, fork button logic. Economy tab inserts here.
- `web/src/stores/sessionDetailStore.ts` — Session state management, config patching, fork actions
- `server/src/routes/sessions.ts` lines 307-409 — Config PATCH endpoint + fork endpoint. Both need EconomyConfig support.
- `server/src/routes/design.ts` — Design generation flow, config validation

### Comparison System
- `server/src/routes/compare.ts` — Comparison endpoint, loadSessionSummary, LLM prompt construction. Needs economic metric extraction.
- `web/src/pages/CompareSessions.tsx` — Comparison UI. Needs param diff section + new dimension display.
- `web/src/stores/compareStore.ts` — Comparison state management
- `server/src/llm/prompts.ts` lines ~1150 — Comparison prompt with 5 fixed dimensions. Expand to 8-10.

### Economic Engine (from Phases 1-4)
- `shared/src/types.ts` — EconomyConfig type definition (Phase 1 output)
- `server/src/mechanics/physicsConfig.ts` — Existing config patterns for parameter ranges/defaults

### Session Config
- `server/src/db/schema.ts` line 8 — `config: text('config')` JSON blob
- `shared/src/types.ts` — SessionConfig interface (needs EconomyConfig field)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **DesignReview tab system**: Already has Overview/Agents/Law tabs with content switching. Economy tab follows exact same pattern.
- **Fork endpoint** (`POST /fork`): Clones agents, resets stats, sets stage to `design-review`. Just needs to also clone `economyConfig` field.
- **Fork-simulation endpoint** (`POST /fork-simulation`): Clones everything including iteration data. Not exposed in UI but exists.
- **Comparison chat**: Fully functional follow-up Q&A on comparison results. Can be reused for economic-specific questions.
- **Advanced Control dropdown**: Existing collapsible panel pattern in Design Review for locked variables. Economy panels can follow same UX.
- **LineChart component** (`web/src/components/LineChart.tsx`): Existing SVG chart for iteration trends. Reusable for economic metric visualization.

### Established Patterns
- **Config patching**: `PUT /api/sessions/:id/config` accepts partial config updates. EconomyConfig patches follow this pattern.
- **Session config structure**: JSON blob in `session.config` column. EconomyConfig becomes a nested field.
- **Comparison dimensions**: 5 hardcoded dimensions in prompts.ts with score1/score2/analysis structure. Extend array, keep same shape.

### Integration Points
- **Economy tab**: New tab in DesignReview.tsx tab array (line ~200). Renders grouped panels with EconomyConfig controls.
- **Fork button**: Existing in DesignReview.tsx bottom bar (lines 525-534). Already navigates to `/session/${newId}/design` after fork.
- **Comparison loadSessionSummary**: compare.ts lines 23-69. Needs to also extract economic telemetry (Gini, CPI, M1) from last iteration.
- **Comparison prompt**: prompts.ts ~line 1151. Dimension list needs expansion from 5 to 8-10.

</code_context>

<specifics>
## Specific Ideas

- The "Configuration Differences" section in comparison should be a table showing parameter name, Session A value, Session B value, and whether it changed. Only show parameters that differ to keep it focused.
- Real-world analogies in tooltips should reference actual countries/policies where possible (e.g., "Reserve ratio: US = 10%, China = 12.5%, EU = 1%").
- The fork workflow should make it obvious that the user is creating an A/B experiment: "Fork & Change Policy" button label, not just "Fork".

</specifics>

<deferred>
## Deferred Ideas

- **Scenario presets/templates** ("Free Market", "Social Democracy", "Austerity") — could be added as a follow-up enhancement. Save/share custom presets for teams.
- **Multi-session comparison** (>2 sessions) — current comparison is hardcoded to exactly 2. Expanding to N-way comparison is a separate effort.
- **Branch from iteration N** — fork-simulation endpoint exists but surfacing "what if we changed policy at iteration 15?" is a separate UX challenge.
- **Export comparison as policy brief** (PDF/markdown) — deferred to policymaker tools milestone.

</deferred>

---

*Phase: 06-scenario-entry*
*Context gathered: 2026-04-01*