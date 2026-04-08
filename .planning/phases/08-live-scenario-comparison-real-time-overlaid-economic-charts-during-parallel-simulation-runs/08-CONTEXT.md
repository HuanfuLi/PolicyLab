# Phase 8: Live Scenario Comparison - Context

**Gathered:** 2026-04-07
**Status:** Ready for planning

<domain>
## Phase Boundary

Real-time overlaid economic charts during parallel simulation runs. Policymakers see CPI, money supply, fiscal, and bond yield curves from multiple scenarios (up to 4) updating simultaneously on the Simulation page, enabling live A/B comparison as simulations progress. Includes a multi-provider LLM load balancer to support parallel simulation execution, session grouping for scenario management, and multi-scenario adaptations to Reflection, Review, and Artifacts stages.

</domain>

<decisions>
## Implementation Decisions

### Chart Overlay Design
- **D-01:** Overlaid lines on the same chart panels. Each scenario is a different-colored line series on shared axes. No side-by-side or small multiples.
- **D-02:** Scenarios distinguished by color + dash patterns (solid/dashed/dotted) for colorblind accessibility. Consistent colors across all charts.
- **D-03:** M1/M2 money supply chart switches from area format (N=1) to line format (N>1). Reverts to area for single scenario.
- **D-04:** Fiscal budget chart uses grouped bars per category when N>1 (one bar per scenario side by side per category).
- **D-05:** Live stat badges above each chart showing latest value per scenario in scenario colors.
- **D-06:** No divergence zone highlighting between scenario lines — overlaid lines alone show divergence.
- **D-07:** No click-to-focus/highlight-scenario feature. All scenarios always shown at equal visibility.
- **D-08:** Maximum 4 scenarios supported for overlay. Beyond that, colors/lines become indistinguishable.
- **D-09:** Shared crosshair tooltip on hover showing ALL scenarios' values at the hovered iteration. Recharts supports this natively.

### Simulation Orchestration
- **D-10:** True parallel execution — all scenarios run simultaneously with separate SSE streams. Not sequential.
- **D-11:** One SSE connection per running scenario. Frontend tracks each independently. Browser supports 6+ concurrent SSE connections.
- **D-12:** All scenarios forced to same iteration count (set once before launch). Keeps X-axis aligned.
- **D-13:** When one scenario finishes before others (e.g., early stopping), its chart line stays static at final value. Other scenarios continue updating. Small "Complete" badge next to scenario name.
- **D-14:** After ALL scenarios finish, a "View Full Comparison" button appears linking to the Phase 6 comparison page with LLM-scored 8-dimension analysis. Non-intrusive, user chooses whether to go deeper.
- **D-15:** Server-side rate limiting with multi-provider support. Each LLM provider has its own configurable rate limit. Round-robin distribution with rate awareness — when one provider is throttled, others pick up the slack.
- **D-16:** Provider config in `~/.policylab/config.json`: providers array with model, endpoint, apiKey, and rateLimit fields per provider. Local providers (e.g., LM Studio) can have no rate limit cap.

### Page Structure & Navigation
- **D-17:** Enhanced Simulation page — NOT a new page. Same URL pattern: `/sessions/:baseId/simulate?scenarios=id1,id2,id3`.
- **D-18:** Statistics panel (Col 2) becomes the central chart hub. ALL charts (economic + agent stats) displayed inline as recharts LineCharts. Scrollable.
- **D-19:** All existing StatCard sparklines converted to recharts LineCharts for consistent multi-scenario rendering.
- **D-20:** Economic Dashboard data (CPI, M1/M2, Fiscal, Bond Yields) moves from TelemetryPanel modal into Statistics panel inline.
- **D-21:** TelemetryPanel modal: remove Economic tab (now inline in Statistics). Keep Classic tab (SVG charts for fiat, food, prices, calories) as a modal.
- **D-22:** Same layout for N=1 and N>1. Single scenario just shows one colored line. No mode switching.
- **D-23:** Live Feed (Col 1) and Agent Status (Col 3) gain collapse buttons. Collapsed panels shrink to a thin sidebar with expand button. Live Feed collapses to left, Agent Status to right.
- **D-24:** When side panels collapse, Statistics panel auto-expands. Switches to 2-column auto-flow grid for charts when it has more horizontal space.
- **D-25:** Chart order in auto-flow grid: CPI, Money Supply, Fiscal, Bond Yields, Wealth, Health, Happiness, Cortisol, Dopamine, Gini, Trust/Crime. All charts same size.
- **D-26:** In multi-scenario mode, Live Feed and Agent Status panels use tabs (Baseline | A | B) to switch which scenario's narrative/agents are displayed.
- **D-27:** Collapsible config diff header above charts showing which EconomyConfig parameters differ across scenarios with values per scenario.
- **D-28:** Top bar: multi-progress bars (one per scenario, each in scenario color). Controls (pause/resume/abort) apply to ALL scenarios simultaneously.
- **D-29:** Panel collapse state resets each page visit (no localStorage persistence).
- **D-30:** Navigate to Simulation page immediately when "Run All Scenarios" is clicked. Charts initialize as SSE streams connect.
- **D-31:** No drill-down from multi-scenario view to individual session pages.

### Live Interaction Controls
- **D-32:** Pause/resume/abort applies to ALL running scenarios simultaneously. No per-scenario controls.
- **D-33:** No time-range zoom or brush selection on charts. Always show full iteration range.
- **D-34:** "Add More Iterations" and "End & Proceed" post-completion actions apply to all scenarios equally.

### Session Management & Grouping
- **D-35:** Sessions stay independent in DB. Add nullable `groupId` (UUID) column to sessions table. When "Run All Scenarios" forks sessions, all get the same groupId. Non-scenario sessions have null groupId.
- **D-36:** Add nullable `scenarioLabel` column to sessions table (e.g., "Baseline", "Policy A", "High Tax"). Set from scenario tab name when forking. Displayed in charts, legends, progress bars, Home page.
- **D-37:** Home page shows grouped sessions as a single card with scenario count badge (e.g., "3 scenarios"). Clicking navigates to the group's current stage.
- **D-38:** Resume navigation: grouped card opens at the base session's current stage (Simulation → Reflection → Review → Completed). Stage progression tracked on the base session.
- **D-39:** A standalone session (null groupId) uses the same enhanced Simulation page — it's a group of 1. No special casing (consistent with D-22).
- **D-40:** Existing Compare page unchanged — works for any 2 sessions regardless of grouping. Grouping is orthogonal to comparison.
- **D-41:** User can add new scenarios to an existing group by returning to Design Review, adding a new scenario tab, and running. New fork joins the existing group.
- **D-42:** When adding to an existing group, only the new scenario runs. Existing completed scenarios keep their results.

### Post-Simulation Stages (Reflection, Review, Artifacts)
- **D-43:** Reflection page: side-by-side society evaluations for all scenarios. Cross-scenario comparison summary at top with both a data comparison table AND an LLM-generated narrative interpreting the differences.
- **D-44:** Reflection's cross-scenario analysis and Phase 6 Comparison page serve different purposes — both kept. Reflection = "what happened and why" (narrative). Comparison = "8-dimension scoring" (quantitative).
- **D-45:** Agent Reflections panel: per-agent comparison cards showing reflections from ALL scenarios side by side. Each agent card shows how they fared across different policies.
- **D-46:** Reflections run in parallel for all scenarios using the multi-provider load balancer.
- **D-47:** Same stage flow preserved: Reflection → Review → Artifacts. Each page is multi-scenario aware. "Proceed to Review Agents" goes to enhanced multi-scenario Review page.
- **D-48:** Review page (AgentReview): agent chat includes context from ALL scenarios. User can ask cross-scenario questions ("How did you fare under Policy A vs Baseline?"). Single chat per agent, multi-scenario aware.
- **D-49:** Artifacts page: per-scenario exports AND a combined markdown policy brief (executive summary, scenario comparison table, key findings, agent outcome highlights, policy recommendations).

### Claude's Discretion
- Collapsed side panel visual design (thin strip with icon vs floating button)
- Chart color palette selection (4 distinct colors + dash patterns)
- Stat badge layout and styling
- Config diff header design and collapse behavior
- Progress bar stacking layout (stacked vertically or side-by-side)
- Multi-provider load balancer internal architecture (queue design, retry strategy)
- Cross-scenario comparison LLM prompt design
- Combined policy brief structure and content depth
- Home page grouped card visual design and expand/detail interaction

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Simulation Page (primary modification target)
- `web/src/pages/Simulation.tsx` — Current 3-column layout: Live Feed | Statistics | Agent Status. Top bar with progress + controls. TelemetryPanel modal trigger.
- `web/src/components/TelemetryPanel.tsx` — Full-screen modal with Classic (SVG charts) + Economic (recharts EconomicDashboard) tabs. Classic tab stays; Economic tab removed.
- `web/src/components/EconomicDashboard.tsx` — 4 recharts panels (CPI, M1/M2, Fiscal, Bond Yields). Data format and chart structure to be reused in Statistics panel.
- `web/src/stores/simulationStore.ts` — Single-session SSE handling, macroHistory TelemetryLog[], statsHistory. Needs multi-session support.

### Scenario Infrastructure (from Phases 6-7)
- `web/src/stores/scenarioStore.ts` — Tab management, delta computation, `runAllScenarios()` (currently sequential — needs parallel). `scenarioSessionIds` maps tab.id → forked session ID.
- `web/src/components/ScenarioTabs.tsx` — Scenario builder UI with tab-based editing.
- `web/src/pages/DesignReview.tsx` — "Run All Scenarios" button trigger point.

### Comparison Infrastructure (post-completion)
- `server/src/routes/compare.ts` — Comparison endpoint, LLM-scored 8-dimension analysis.
- `web/src/pages/CompareSessions.tsx` — Post-completion comparison page (linked from "View Full Comparison" button).

### LLM Gateway (multi-provider load balancer)
- `server/src/llm/` — Current multi-provider LLM gateway (Anthropic, OpenAI, Gemini, Ollama). Needs rate-limiting and round-robin dispatch layer.
- `~/.policylab/config.json` — Existing config file for LLM keys and provider selection. Extend with providers array + rateLimit fields.

### Shared Types
- `shared/src/types.ts` — TelemetryLog, EconomyConfig, ScenarioTab, IterationStats types.

### Session Schema & Home Page
- `server/src/db/schema.ts` — Sessions table. Needs `groupId` and `scenarioLabel` columns.
- `server/src/routes/sessions.ts` lines 385-456 — Fork endpoint. Must set groupId and scenarioLabel on forked sessions.
- `web/src/pages/HomePage.tsx` — Session list. Needs grouping logic for scenario cards.
- `web/src/stores/sessionsStore.ts` — Sessions list state. May need group-aware queries.

### Post-Simulation Pages
- `web/src/pages/Reflection.tsx` — Current 2-panel layout: Society Evaluation | Agent Reflections. Needs multi-scenario side-by-side + cross-scenario comparison.
- `web/src/stores/reflectionStore.ts` — Single-session reflection state. Needs multi-session support.
- `web/src/pages/AgentReview.tsx` — Per-agent chat. Needs multi-scenario context in prompts.
- `web/src/pages/Artifacts.tsx` — Session exports. Needs combined policy brief generation.
- `server/src/llm/prompts/comparison.ts` — Comparison prompt (8 dimensions). Reference for cross-scenario analysis prompt design.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **EconomicDashboard** (`EconomicDashboard.tsx`): 4 recharts panels already built. Chart structure (CPI, M1/M2, Fiscal, Bonds) reusable — needs multi-series data input instead of single TelemetryLog[].
- **scenarioStore** (`scenarioStore.ts`): `runAllScenarios()` already forks sessions and tracks `scenarioSessionIds`. Needs parallel execution instead of sequential.
- **simulationStore** (`simulationStore.ts`): SSE connection logic (`connectSSE`), `macroHistory` accumulation, `statsHistory`. Single-session — needs cloning/multiplexing for N sessions.
- **SVGLineChart** (`TelemetryPanel.tsx`): Custom SVG chart supporting 2 series. Being replaced by recharts but Classic tab keeps it.
- **StatCard** (`Simulation.tsx`): Sparkline stat cards with bar history. Being replaced by recharts LineCharts.

### Established Patterns
- **SSE streaming**: `connectSSE()` in simulationStore opens EventSource, dispatches to typed handlers. Pattern replicable for multiple streams.
- **Zustand stores**: Domain-sliced (simulation, scenario, compare). Multi-scenario state likely needs a new store or extended simulationStore.
- **recharts integration**: EconomicDashboard uses ResponsiveContainer, LineChart, AreaChart, BarChart with CSS variable color tokens.
- **Glass panel styling**: `glass-panel` class + inline styles for cards. CSS variables for theming.

### Integration Points
- `DesignReview.tsx` "Run All Scenarios" button → currently calls `scenarioStore.runAllScenarios()` → needs to navigate to Simulation page with scenario session IDs in URL.
- `simulationStore.connectSSE()` → needs to support N concurrent SSE connections, each writing to scenario-keyed macroHistory/statsHistory.
- `~/.policylab/config.json` → provider config extension for multi-provider rate limiting.

</code_context>

<specifics>
## Specific Ideas

- User specifically wants the Statistics panel to be the hero when side panels collapse — auto-expanding to fill available space with a 2-column chart grid.
- Collapse animation: Live Feed collapses to left edge, Agent Status to right edge. Each has a small expand button.
- Multi-provider example: LM Studio (local, no rate limit) + cloud API (20 req/min rate limit) running simultaneously for the same simulation.
- Classic telemetry modal preserved as-is for single-session detailed inspection.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 08-live-scenario-comparison*
*Context gathered: 2026-04-07*
