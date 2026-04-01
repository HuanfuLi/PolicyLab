# Phase 6: Scenario Entry - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-01
**Phase:** 06-scenario-entry
**Areas discussed:** Entry point & flow, Parameter presentation, Validation & guidance, Fork & A/B comparison upgrade

---

## Entry Point & Flow

| Option | Description | Selected |
|--------|-------------|----------|
| New tab in Design Review | Add an 'Economy' tab alongside existing agent roster. Everything in one place. | ✓ |
| Dedicated Scenario page | New page between Design Review and Simulation. Full screen for economic config. | |
| Wizard overlay | Step-by-step wizard that walks through parameters in order. | |

**User's choice:** New tab in Design Review
**Notes:** Keeps everything in one place. Policymakers toggle between agent setup and economic parameters.

---

## A/B Scenario Workflow

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, fork from design | After designing agents, fork into multiple scenarios with different economic params. | ✓ |
| No, one config per session | Each session has one economic config. To compare, create a new session. | |
| You decide | Claude picks the approach. | |

**User's choice:** Yes, fork from design
**Notes:** Leverages existing fork endpoint. Key upgrade: clone EconomyConfig alongside agents.

---

## Parameter Organization

| Option | Description | Selected |
|--------|-------------|----------|
| Grouped panels | Collapsible sections: Banking, Fiscal, Inflation. Simple, flat, scannable. | ✓ |
| Progressive disclosure | Show 3-4 key levers upfront, 'Advanced' for the rest. | |
| Visual economy diagram | Interactive diagram showing money flow. Click nodes to configure. | |

**User's choice:** Grouped panels
**Notes:** None

---

## Input Controls

| Option | Description | Selected |
|--------|-------------|----------|
| Sliders with numeric input | Slider for quick adjustment + numeric field for precision. | ✓ |
| Sliders only | Simpler, prevents invalid values. Less precise. | |
| Numeric inputs with range hints | Text fields with min/max/default. More compact. Power-user friendly. | |

**User's choice:** Sliders with numeric input
**Notes:** Shows min/max/default.

---

## Validation Approach

| Option | Description | Selected |
|--------|-------------|----------|
| Warnings, not blocks | Yellow warnings. User can proceed anyway. | |
| Soft limits with override | Recommended ranges. Going outside shows warning + confirmation. | ✓ |
| Hard constraints | Enforce min/max ranges. Some combinations not allowed. | |

**User's choice:** Soft limits with override
**Notes:** Prevents accidental misconfiguration while preserving experimentation freedom.

---

## Parameter Guidance

| Option | Description | Selected |
|--------|-------------|----------|
| Inline tooltips | Info icon next to each param. Hover/click for explanation + real-world analogy. | ✓ |
| Sidebar context panel | Persistent panel showing explanation for focused parameter. | |
| Minimal — labels only | Keep UI clean. Add docs/help separately. | |

**User's choice:** Inline tooltips
**Notes:** Real-world analogies referencing actual countries/policies.

---

## Parameter Diff in Comparison

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, show param diff | Comparison page shows 'Configuration Differences' section. | ✓ |
| No, just compare outcomes | Focus on outcomes only. Users track changes themselves. | |
| You decide | Claude picks. | |

**User's choice:** Yes, show param diff
**Notes:** Critical for policy analysis — "we changed X, and here's what happened."

---

## Comparison Dimensions

| Option | Description | Selected |
|--------|-------------|----------|
| Expand to 8-10 dimensions | Add Gini, inflation rate, banking stability, fiscal effectiveness. | ✓ |
| Keep 5, add data sidebar | Keep 5 narrative dimensions. Add separate raw economic metrics panel. | |
| You decide | Claude picks. | |

**User's choice:** Expand to 8-10 dimensions
**Notes:** More analysis depth for policymakers.

---

## Claude's Discretion

- Exact slider ranges and defaults for each EconomyConfig parameter
- Panel styling and collapse behavior
- Pre-v1.0 session handling in Economy tab
- Whether to add scenario presets (nice-to-have)
- Exact 8-10 comparison dimension names

## Deferred Ideas

- Scenario presets/templates ("Free Market", "Social Democracy", etc.)
- Multi-session comparison (>2 sessions)
- Branch from iteration N
- Export comparison as policy brief (PDF/markdown)