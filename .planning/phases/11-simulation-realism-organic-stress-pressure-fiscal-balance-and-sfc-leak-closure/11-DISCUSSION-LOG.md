# Phase 11: Simulation realism — organic stress pressure, fiscal balance, and SFC leak closure - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-13
**Phase:** 11-simulation-realism-organic-stress-pressure-fiscal-balance-and-sfc-leak-closure
**Areas discussed:** Cortisol stress model, Fiscal loop closure, Governance mechanic extensions, SFC leak closure, Happiness symmetry, Calibration method, Escrow accounting, Tax timing, Law amendment diff

---

## Gray-Area Selection

| Option | Description | Selected |
|--------|-------------|----------|
| Cortisol stress model | Remove per-action relief, add structural pressures, thresholds | ✓ |
| Fiscal loop closure | Transfer-only-welfare, tax base, bootstrap bug | ✓ |
| SFC leak closure | Audit depth, threshold, runtime action on drift | ✓ |
| Happiness symmetry | Parallel to cortisol vs defer | ✓ |

**User's choice:** All four areas.

---

## Cortisol Stress Model

### Q1: How should per-action cortisol changes be handled?

| Option | Description | Selected |
|--------|-------------|----------|
| Remove all action relief | Delete all per-action Δcortisol; keep only outcome-driven | ✓ |
| Dampen to ±1 | Keep signed direction, cap magnitude | |
| Keep rewards, rely on floor+structural | No physics change, only add upward pressure | |

### Q2: Which structural cortisol pressures each tick?

| Option | Description | Selected |
|--------|-------------|----------|
| Inflation surprise | +k × max(0, CPI growth − expected) | ✓ |
| Inequality stress (bottom quintile) | +k × max(0, Gini − threshold) | ✓ |
| Unemployment / precarity | +k when no employment + low wealth | ✓ |
| Underfunded public goods | +k × (1 − min(infra,edu,welfare)/50) | ✓ |

### Q3: Cortisol ceiling?

| Option | Description | Selected |
|--------|-------------|----------|
| Ceiling = 95 | Leaves headroom for allostatic strain integrator | ✓ |
| Ceiling = 100 | Current hard max | |
| No change | Clamp [0,100] stays | |

### Q4: Auto-escalation thresholds?

| Option | Description | Selected |
|--------|-------------|----------|
| Raise wealth=50, health=60 | Middle-class anxiety | ✓ |
| Raise wealth only (50), health=30 | Narrower | |
| Keep current | Status quo | |

---

## Fiscal Loop Closure

### Q1: Which budget categories still transfer directly to citizens?

| Option | Description | Selected |
|--------|-------------|----------|
| Welfare only | Infra/edu/defense → escrow | ✓ |
| Welfare + education wages | Ed funds scholar-role wages | |
| All four weighted | Fix allocation bug, keep transfer design | |

### Q2: Extended tax base?

| Option | Description | Selected |
|--------|-------------|----------|
| Citizen AMM sells (PRODUCE_AND_SELL) | Dominant income action | ✓ |
| Enterprise wage income | Worker's wage receipt | ✓ |
| Capital gains (SELL_SHARES profit, matured bonds) | Elite-heavy | ✓ |
| AMM consumption VAT | Flat % on every AMM buy | ✓ |

### Q3: Tax shape?

| Option | Description | Selected |
|--------|-------------|----------|
| Flat across events | Simplest, matches Phase 10 D-32 | |
| Progressive by wealth tier | Bracketed | |
| Flat + enterprise bracket | Hybrid | |
| Other (user free text) | **"Can we make this decided by agents? In Design stage let central agent decide, and let citizen agents decide during legislative sessions."** | ✓ |

**User's notes:** Agent-driven tax policy. Central Agent picks at Design; citizen amendment via legislative sessions.

### Q3-followup-a: Phase 11 scope for agent-driven tax?

| Option | Description | Selected |
|--------|-------------|----------|
| Design-stage only this phase | Central Agent picks taxPolicy at bootstrap; runtime amendment deferred | ✓ |
| Design + basic runtime amendment | + ADJUST_TAX extension for elite/legislator | |
| Full legislative session | New action codes, voting, enactment — own phase | |
| Flat only, agent-driven deferred | Fastest ship | |

### Q3-followup-b: Eligibility for eventual citizen amendment?

| Option | Description | Selected |
|--------|-------------|----------|
| Elite-tier roles only | Governors, legislators, ministers | |
| Any citizen | Democratic | |
| You decide | Defer to planner | |
| Other (user free text) | **"In a previous implementation, we should have implemented: central agent decide how many people have amendment power in Design stage based on user input (1 for monarchy, few rich for Aristocracy, many/all for democracy/commonwealth). Check whether the implementation is complete. Also, the amendment should also be able to change the law. And user should be able to toggle on/off amendments if user want more stable simulation to see policy difference in Design stage."** | ✓ |

**Claude verification:** Existing `governanceManager.ts` has franchise-size mechanic (monarchy=1, aristocracy=few, democracy=many) via Central Agent reasoning — complete. Missing: user toggle, law text amendment. Folded into Q4 below.

### Q3-followup-c: Tax shape menu?

| Option | Description | Selected |
|--------|-------------|----------|
| Fixed menu: flat + progressive | Constrained, simple engine | ✓ |
| + wealth tax | Inequality dynamics | |
| Open-ended LLM-described | Risky for determinism | |

### Q4 (new area): Governance mechanic extensions?

| Option | Description | Selected |
|--------|-------------|----------|
| User toggle in Design stage | economyConfig.governanceEnabled checkbox | ✓ |
| Extend policy fields with taxShape | Governance can amend taxShape at runtime | |
| Law amendment (text-level) | Paragraph diff on session.law | ✓ |
| Defer law amendment to own phase | Ship only toggle + taxShape | |

### Q5: Fold in bootstrap bug (missing fiscal_budgets row)?

| Option | Description | Selected |
|--------|-------------|----------|
| Yes — fix in this phase | Root cause + startup assertion | ✓ |
| Defer to bugfix phase | Separate scope | |
| Only add assertion | Don't hunt root cause | |

---

## SFC Leak Closure

### Q1: Audit scope?

| Option | Description | Selected |
|--------|-------------|----------|
| Targeted physics-engine action-code audit | Focus on Δwealth entries | |
| Full subsystem audit | Banking + capmkt + fiscal + AMM + bankruptcy + death | |
| Add SFC-per-subsystem telemetry | Diagnostic instrumentation; find leaks by observability | ✓ |

### Q2: Drift threshold?

| Option | Description | Selected |
|--------|-------------|----------|
| 0.1 absolute (current) | Catches everything | ✓ |
| 0.01% relative to M0 | Scales with economy | |
| Hybrid max(0.1, M0*1e-6) | Absolute floor + scaling | |

### Q3: Runtime action on drift?

| Option | Description | Selected |
|--------|-------------|----------|
| Log warning only (current) | Status quo | |
| Log + record to telemetry | Surface in dashboard | ✓ |
| Log + auto-correct | Masks root causes | |
| Log + pause | Fatal-style halt | |

---

## Happiness Symmetry

### Q1: Scope?

| Option | Description | Selected |
|--------|-------------|----------|
| Parallel to cortisol treatment | Remove rewards, add structural pressures | ✓ |
| Remove rewards, minimal pressure | Only peer deaths | |
| Keep rewards, add downward pressure | Risk of net flat | |
| Defer to Phase 12 | Social network modeling in own phase | |

### Q2: Happiness ceiling/floor?

| Option | Description | Selected |
|--------|-------------|----------|
| Ceiling 95, floor 5 | Matches cortisol | ✓ |
| Keep 0–100 | No change | |

---

## Secondary Areas

### Structural-pressure calibration

| Option | Description | Selected |
|--------|-------------|----------|
| Conservative defaults, tune empirically | Low coefficients; observe; adjust | ✓ |
| Research-backed psychophysics | Literature-anchored, documented | |
| Aggressive defaults | Strong initial signal | |

### Public-goods escrow accounting

| Option | Description | Selected |
|--------|-------------|----------|
| Per-session escrow ledger + SFC-included | Fiat parked, M0 constant | ✓ |
| Escrow counted as treasury | Reuse existing ledger | |
| Escrow sinks (fiat destroyed) | Breaks closed-loop | |

### Tax collection timing

| Option | Description | Selected |
|--------|-------------|----------|
| After action resolution, before banking | Batch pass | |
| Inline during each tax-bearing action | Per-action traceability | ✓ |
| Planner decides | Claude's discretion | |

### Law amendment diff

| Option | Description | Selected |
|--------|-------------|----------|
| Paragraph-level replacement | Matches refine-law pattern | ✓ |
| Structured JSON law schema | Bigger migration | |
| Full rewrite | Simpler, no audit trail | |

---

## Claude's Discretion

- Exact coefficient defaults for all `k_*` structural pressures (cortisol + happiness)
- Structural pressure application order within each tick
- Whether cortisol ceiling (95) applies to `runningCortisol` accumulator or only at final commit
- Taxable-event hook placement (file ownership)
- Escrow ledger persistence format (DB table vs extension vs in-memory)
- Law amendment ballot prompt design

---

## Deferred Ideas

- Agent-driven runtime amendment of taxShape (legislative sessions vote on tax kind changes)
- Structured JSON law schema (stable clause IDs for deterministic amendments)
- Wealth tax / land tax beyond flat/progressive
- Hedonic adaptation + social-network happiness modeling
- Research-backed psychophysics calibration
- Per-action SFC bug-hunt audit (if telemetry surfaces a specific subsystem)
- Full escrow lifecycle (government contractor role receiving escrow as income)
