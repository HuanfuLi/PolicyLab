# Phase 8: Live Scenario Comparison - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-07
**Phase:** 08-live-scenario-comparison
**Areas discussed:** Chart overlay design, Simulation orchestration, Navigation & page structure, Live interaction controls

---

## Chart Overlay Design

| Option | Description | Selected |
|--------|-------------|----------|
| Overlaid lines | Same 4 chart panels with different-colored line series per scenario on shared axes | ✓ |
| Side-by-side panels | Each scenario gets its own column of 4 charts | |
| Synchronized small multiples | Grid of mini-charts — one row per metric, one column per scenario | |

**User's choice:** Overlaid lines
**Notes:** Best for direct comparison — divergence visible instantly. Recharts supports multi-series natively.

| Option | Description | Selected |
|--------|-------------|----------|
| Color + legend | Each scenario gets a distinct color with shared legend | |
| Color + dash patterns | Color plus solid/dashed/dotted line styles for accessibility | ✓ |
| You decide | Claude picks | |

**User's choice:** Color + dash patterns
**Notes:** Better for colorblind accessibility.

| Option | Description | Selected |
|--------|-------------|----------|
| Convert M1/M2 to lines when overlaid | Switch area→line for N>1 | ✓ |
| Always lines | Line chart regardless of scenario count | |
| You decide | Claude picks | |

**User's choice:** Lines when overlaid (area for N=1, line for N>1)

| Option | Description | Selected |
|--------|-------------|----------|
| Highlight divergence zones | Shade area between diverging scenario lines | |
| Just the overlaid lines | Lines themselves show divergence, no extra annotations | ✓ |

**User's choice:** Just the overlaid lines

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, live stat badges | Small colored badges above each chart with latest value per scenario | ✓ |
| Tooltip only | Values shown only on hover/crosshair | |

**User's choice:** Live stat badges

| Option | Description | Selected |
|--------|-------------|----------|
| Up to 4 | 4 overlaid series per chart is readable limit | ✓ |
| Up to 6 | More generous limit | |
| No limit | User's choice, may become unreadable | |

**User's choice:** Up to 4

| Option | Description | Selected |
|--------|-------------|----------|
| Grouped bars per category | One bar per scenario side by side per fiscal category | ✓ |
| Stacked + scenario toggle | Keep stacked bar, toggle visibility | |

**User's choice:** Grouped bars per category

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, click-to-focus | Click legend to highlight one scenario, dim others | |
| No, equal visibility | All scenarios always at equal prominence | ✓ |

**User's choice:** No, equal visibility

---

## Simulation Orchestration

| Option | Description | Selected |
|--------|-------------|----------|
| True parallel | Run all scenarios simultaneously with separate SSE streams | ✓ |
| Sequential with live replay | Keep sequential, stream completed alongside active | |
| User-configurable | Let user choose parallel vs sequential | |

**User's choice:** True parallel

| Option | Description | Selected |
|--------|-------------|----------|
| Multiple SSE connections | One SSE per scenario, independent tracking | ✓ |
| Single multiplexed SSE | One connection multiplexing all scenarios | |
| Polling | Poll telemetry endpoints on interval | |

**User's choice:** Multiple SSE connections

| Option | Description | Selected |
|--------|-------------|----------|
| Show completed line, keep updating others | Completed scenario stays static, others continue | ✓ |
| Wait for all, then show comparison | Live view is just progress watching | |
| Both — live stays, then comparison | Live + auto-prompt for comparison after all finish | |

**User's choice:** Show completed line, keep updating others

| Option | Description | Selected |
|--------|-------------|----------|
| Show 'View Full Comparison' button | Non-intrusive button after all runs complete | ✓ |
| Live view is enough | No link to comparison page | |

**User's choice:** Show 'View Full Comparison' button

| Option | Description | Selected |
|--------|-------------|----------|
| Same iteration count | All scenarios run same iterations, set once | ✓ |
| Independent counts | Each scenario can have different iteration count | |

**User's choice:** Same iteration count

| Option | Description | Selected |
|--------|-------------|----------|
| Server-side throttle | Queue LLM calls across parallel sims | |
| No throttle | Fire all concurrently | |

**User's choice:** (Free text) Multi-provider rate limiting with per-provider configurable rate limits. Round-robin distribution with rate awareness. Example: LM Studio (no cap) + cloud API (20 req/min) simultaneously.

| Option | Description | Selected |
|--------|-------------|----------|
| Include in Phase 8 | Build load balancer as part of this phase | ✓ |
| Separate phase | Phase 8 uses single provider, load balancer later | |

**User's choice:** Include in Phase 8

| Option | Description | Selected |
|--------|-------------|----------|
| ~/.policylab/config.json | Extend existing config with providers array + rateLimit | ✓ |
| Per-session in Design Review | Configure providers per session | |
| Both | Global defaults, per-session overrides | |

**User's choice:** ~/.policylab/config.json

| Option | Description | Selected |
|--------|-------------|----------|
| Round-robin with rate awareness | Cycle through providers, skip throttled ones | ✓ |
| Priority-based | User assigns priority order, falls back when rate-limited | |

**User's choice:** Round-robin with rate awareness

---

## Navigation & Page Structure

| Option | Description | Selected |
|--------|-------------|----------|
| New dedicated page | /sessions/:id/live-compare | |
| Enhanced Simulation page | Modify existing Simulation page for multi-scenario | ✓ |
| Modal/drawer overlay | Full-screen overlay on scenario builder | |

**User's choice:** Enhanced Simulation page

**User's choice:** (Free text) Detailed layout vision: Statistics panel becomes central chart hub. All bar charts → line charts. Economic data from Telemetry moves to Statistics inline. Live Feed and Agent Status get collapse buttons (collapse to side edges). Statistics auto-expands to 2-column grid when neighbors collapse.

| Option | Description | Selected |
|--------|-------------|----------|
| Scenario selector dropdown | Dropdown to pick which scenario's data | |
| Always show Baseline | Expanded panels always show Baseline | |
| Tabbed per scenario | Tabs inside panel header (Baseline | A | B) | ✓ |

**User's choice:** Tabbed per scenario

| Option | Description | Selected |
|--------|-------------|----------|
| Remove modal, inline only | All chart data in Statistics panel | |
| Keep as fullscreen option | Inline + modal fullscreen button | |

**User's choice:** (Free text) Remove Economic tab from modal (now inline). Keep Classic tab modal as-is.

| Option | Description | Selected |
|--------|-------------|----------|
| Auto-flow grid | Charts flow into responsive 2-column grid, all same size | ✓ |
| Priority grouping | Economic charts larger, agent stats smaller | |

**User's choice:** Auto-flow grid

| Option | Description | Selected |
|--------|-------------|----------|
| Recharts for all | Convert all StatCard sparklines to recharts LineChart | ✓ |
| Keep SVGLineChart, extend it | Extend custom SVG to support N series | |

**User's choice:** Recharts for all

| Option | Description | Selected |
|--------|-------------|----------|
| Same layout for N=1 and N>1 | Always recharts line charts, 1 or 4 scenarios | ✓ |
| StatCards for N=1, charts for N>1 | Two different visual modes | |

**User's choice:** Same layout for N=1 and N>1

| Option | Description | Selected |
|--------|-------------|----------|
| Persist in localStorage | Remember collapse state across visits | |
| Reset each time | Panels always start expanded | ✓ |

**User's choice:** Reset each time

| Option | Description | Selected |
|--------|-------------|----------|
| Multi-progress bars | One bar per scenario in scenario color, controls apply to all | ✓ |
| Single averaged progress bar | One bar showing average progress | |
| Per-scenario control rows | Individual rows with per-scenario controls | |

**User's choice:** Multi-progress bars

| Option | Description | Selected |
|--------|-------------|----------|
| Thin vertical strip with icon | ~40px strip with panel icon + expand chevron | |
| Floating expand button | Panel disappears, small button at edge | |
| You decide | Claude picks | ✓ |

**User's choice:** You decide

---

## Live Interaction Controls

| Option | Description | Selected |
|--------|-------------|----------|
| All at once only | Pause/resume/abort applies to all scenarios simultaneously | ✓ |
| Individual + all | Global + per-scenario controls | |
| Individual only | Each scenario has own controls | |

**User's choice:** All at once only

| Option | Description | Selected |
|--------|-------------|----------|
| No zoom, show all data | Charts always show full iteration range | ✓ |
| Brush zoom | Recharts Brush for iteration range selection | |

**User's choice:** No zoom, show all data

| Option | Description | Selected |
|--------|-------------|----------|
| Apply to all scenarios | Add More Iterations / End & Proceed for all scenarios | ✓ |
| Per-scenario post-run controls | Each scenario independently | |

**User's choice:** Apply to all scenarios

| Option | Description | Selected |
|--------|-------------|----------|
| All scenarios at once | Shared crosshair tooltip listing every scenario's value | ✓ |
| Closest line only | Tooltip for nearest line | |

**User's choice:** All scenarios at once

---

## Post-Simulation Stages

| Option | Description | Selected |
|--------|-------------|----------|
| Side-by-side society evaluations | Each scenario's evaluation shown side by side with cross-scenario comparison at top | ✓ |
| Single combined evaluation | One LLM call generates a merged evaluation | |
| Tabbed per-scenario | Tabs switch between per-scenario reflection layouts | |

**User's choice:** Side-by-side society evaluations

| Option | Description | Selected |
|--------|-------------|----------|
| LLM-generated comparative analysis | New prompt for cross-scenario narrative | |
| Data-driven only | Automated stat comparison table | |
| Both — data table + LLM narrative | Data comparison plus LLM-generated interpretation | ✓ |

**User's choice:** Both — data table + LLM narrative

| Option | Description | Selected |
|--------|-------------|----------|
| Per-agent comparison cards | Each agent card shows reflections from ALL scenarios side by side | ✓ |
| Tabbed per-scenario agent list | Tabs switch which scenario's agents shown | |

**User's choice:** Per-agent comparison cards

| Option | Description | Selected |
|--------|-------------|----------|
| Parallel reflections | All scenarios' reflections run simultaneously | ✓ |
| Sequential | Run reflection for each scenario in order | |

**User's choice:** Parallel

| Option | Description | Selected |
|--------|-------------|----------|
| Same flow: Reflection → Review → Artifacts | Each page multi-scenario aware | ✓ |
| Reflection → Comparison → Review | Insert Comparison between stages | |
| Flexible — user picks next step | Buttons for multiple paths | |

**User's choice:** Same flow

| Option | Description | Selected |
|--------|-------------|----------|
| Keep Reflection and Comparison as separate purposes | Reflection = narrative, Comparison = quantitative scoring | ✓ |
| Replace Comparison with Reflection's analysis | Reflection subsumes Comparison | |

**User's choice:** Keep both as separate purposes

| Option | Description | Selected |
|--------|-------------|----------|
| Scenario context in agent chat | Agent's prompt includes ALL scenarios' context, cross-scenario questions possible | ✓ |
| Per-scenario agent chat | Chat scoped to one scenario at a time | |
| Skip Review adaptation | Review stays single-session | |

**User's choice:** Scenario context in agent chat

| Option | Description | Selected |
|--------|-------------|----------|
| Per-scenario artifacts + combined | Individual exports AND a combined markdown policy brief | ✓ |
| Combined scenario report only | Single export covering all scenarios | |
| Defer artifacts adaptation | Artifacts stays single-session for now | |

**User's choice:** Per-scenario artifacts + combined
**Notes:** Combined report is a markdown policy brief: executive summary, scenario comparison table, key findings, agent outcome highlights, policy recommendations.

---

## Session Management & Grouping

| Option | Description | Selected |
|--------|-------------|----------|
| Scenario group (new concept) | New parent entity linking sessions via groupId | |
| Keep separate sessions, add grouping UI | Sessions stay independent, grouped via column | ✓ |
| Single session with scenario data inside | One session holds all scenario data internally | |

**User's choice:** Keep separate sessions, add grouping UI

| Option | Description | Selected |
|--------|-------------|----------|
| groupId column in sessions table | Nullable UUID, set when forking from scenario tabs | ✓ |
| Naming convention only | Group by shared name prefix | |
| Metadata JSON field | Store in config JSON blob | |

**User's choice:** groupId column

| Option | Description | Selected |
|--------|-------------|----------|
| scenarioLabel column | Nullable column with tab name (Baseline, Policy A, etc.) | ✓ |
| Use session title suffix | Append scenario name to title | |

**User's choice:** scenarioLabel column

| Option | Description | Selected |
|--------|-------------|----------|
| Single card with scenario count badge | Grouped sessions as ONE card, expand for details | ✓ |
| Nested cards | Group header with indented child cards | |

**User's choice:** Single card with scenario count badge

| Option | Description | Selected |
|--------|-------------|----------|
| Resume at group's current stage | Navigate to base session's current stage | ✓ |
| Always go to Simulation page | Grouped cards always open Simulation | |

**User's choice:** Resume at group's current stage

| Option | Description | Selected |
|--------|-------------|----------|
| Same page, N=1 | Standalone sessions use enhanced Simulation page as group of 1 | ✓ |
| Standalone stays legacy | Only grouped sessions get enhanced page | |

**User's choice:** Same page, N=1

| Option | Description | Selected |
|--------|-------------|----------|
| Compare page unchanged | Works for any 2 sessions regardless of grouping | ✓ |
| Compare only within groups | Compare restricted to same-group sessions | |

**User's choice:** Compare page unchanged

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, add scenarios from Design Review | Return to base session, add tab, run new scenario into existing group | ✓ |
| No, group fixed at creation | New experiment needed for more variants | |
| Defer capability | Not in Phase 8 | |

**User's choice:** Yes, from Design Review

| Option | Description | Selected |
|--------|-------------|----------|
| Only run the new scenario | Existing completed scenarios keep results | ✓ |
| Re-run all scenarios | All re-run from scratch | |
| User chooses | Prompt to decide | |

**User's choice:** Only run the new scenario

---

## Claude's Discretion

- Collapsed side panel visual design
- Chart color palette (4 colors + dash patterns)
- Stat badge layout and styling
- Config diff header design
- Progress bar stacking layout
- Multi-provider load balancer architecture
- Cross-scenario comparison LLM prompt design
- Combined policy brief structure
- Home page grouped card visual design

## Deferred Ideas

None — discussion stayed within phase scope.
