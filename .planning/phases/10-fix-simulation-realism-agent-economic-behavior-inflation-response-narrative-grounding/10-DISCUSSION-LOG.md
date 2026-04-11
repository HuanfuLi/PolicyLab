# Phase 10: Fix Simulation Realism — Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-07
**Phase:** 10-fix-simulation-realism-agent-economic-behavior-inflation-response-narrative-grounding
**Areas discussed:** Agent employment & production, CPI & inflation response, Narrative grounding, Banking & credit adoption, Location bootstrap backgrounds, Enterprise output types, Wage-price spiral safeguards

---

## Agent Employment & Production

### Labor Market Structure

| Option | Description | Selected |
|--------|-------------|----------|
| Default self-employment | All agents can PRODUCE_AND_SELL without enterprise. Baseline activity. | |
| Auto-create sector enterprises | Bootstrap creates enterprises per sector from data. Agents pre-assigned jobs. | |
| Multiple small enterprises per sector | Split role groups into 2-3 smaller firms with competition. | |

**User's choice:** Auto-create enterprises from World Bank data, with multiple small enterprises per sector.
**Notes:** User specifically wants new World Bank indicators for firm-level data, not just LLM inference from sector percentages.

### Enterprise Ownership

| Option | Description | Selected |
|--------|-------------|----------|
| Assign elite-role agents as owners | Merchants/foremen become owners. Higher wealth from Gini distribution. | ✓ |
| Virtual entity (no agent owner) | System constructs, no agent controls them. | |
| Bank agent owns all | State capitalism model. | |

**User's choice:** Elite-role agents as owners.

### Idle Agent Fallback

| Option | Description | Selected |
|--------|-------------|----------|
| 2 iterations | After 2 idle turns, auto-produce 5 food. | ✓ |
| 3 iterations | More patience before intervention. | |
| 1 iteration | Immediate fallback. | |

**User's choice:** 2 iterations threshold.

### Enterprise Data Source

| Option | Description | Selected |
|--------|-------------|----------|
| LLM-inferred from sector data | Use existing sector employment percentages. | |
| New World Bank indicators | Fetch additional firm count/size indicators. | ✓ |
| Hardcoded templates per economy type | Pre-built templates. | |

**User's choice:** New World Bank indicators.

### Enterprise Capital

| Option | Description | Selected |
|--------|-------------|----------|
| Seeded from bootstrap data | Capital proportional to GDP per capita. | ✓ |
| Start empty | Zero initial capital. | |
| Owner's wealth split | Owner contributes fraction of wealth. | |

**User's choice:** Seeded from bootstrap data.

### Creative Mode Enterprises

| Option | Description | Selected |
|--------|-------------|----------|
| Central Agent generates during design | One more output in roster generation step. | ✓ |
| Auto-infer at simulation start | Runner scans roles and creates enterprises. | |
| User manually creates in Design Review | Enterprise editor in UI. | |

**User's choice:** Central Agent generates during design.

### Wage Payment

| Option | Description | Selected |
|--------|-------------|----------|
| Pay on WORK action only | No work = no pay. Agent agency central. | ✓ |
| Auto-pay all employed agents | Wages regardless of action choice. | |
| Salary + performance bonus | Base salary + work bonus hybrid. | |

**User's choice:** Pay on WORK only.

### Enterprise Insolvency

| Option | Description | Selected |
|--------|-------------|----------|
| Partial pay + bankruptcy threshold | Pay what affordable, bankrupt after 3 consecutive insufficient iterations. | ✓ |
| Government bailout | Treasury covers shortfall. | |
| Immediate bankruptcy | Can't pay = instant bankruptcy. | |

**User's choice:** Partial pay + bankruptcy threshold.

### Wage Levels

| Option | Description | Selected |
|--------|-------------|----------|
| Config-based minimum + market forces | EconomyConfig minimum wage floor + enterprise discretion above minimum. | ✓ |
| Fixed per-role wage table | Each role has fixed rate. | |
| AMM-derived wage | Wages tied to food price × multiplier. | |

**User's choice:** Config-based minimum + market forces.

### Labor Mobility

| Option | Description | Selected |
|--------|-------------|----------|
| QUIT_JOB + re-apply | New action code. Agents can leave and apply elsewhere. | ✓ |
| Locked employment | Agents stay at enterprise for duration. | |
| Automatic rebalancing | Physics engine redistributes workers. | |

**User's choice:** QUIT_JOB + re-apply.

---

## CPI & Inflation Response

### Wage-Price Transmission

| Option | Description | Selected |
|--------|-------------|----------|
| Enterprise cost pass-through | Higher wage costs → enterprises raise AMM sell prices. | ✓ |
| Direct M1 expansion | Higher wages → more fiat → existing M1-CPI loop. | |
| Both mechanisms | Cost-push + demand-pull. | |

**User's choice:** Enterprise cost pass-through.

### AMM Price Volatility

| Option | Description | Selected |
|--------|-------------|----------|
| Supply/demand via enterprise production | Enterprises sell to AMM, agents buy. Natural volatility. | ✓ |
| External price shocks | Random supply/demand shocks per iteration. | |
| Replace AMM with order book | Full price discovery rewrite. | |

**User's choice:** Supply/demand via enterprise production.

### CPI Basket

| Option | Description | Selected |
|--------|-------------|----------|
| Keep current basket | Food 40%, tools 25%, luxury 20%, raw materials 15%. | ✓ |
| Location-calibrated baskets | Fetch real CPI weights per country. | |
| Dynamic basket weights | Shift based on spending patterns. | |

**User's choice:** Keep current basket.

### Inflation Sensitivity

| Option | Description | Selected |
|--------|-------------|----------|
| Reduce smoothing window | From 3 to 1-2 iterations. Faster shock visibility. | ✓ |
| Keep current smoothing | 3-iteration smoothing. | |
| Configurable per session | User-tunable sensitivity. | |

**User's choice:** Reduce smoothing window.

### Central Bank Response

| Option | Description | Selected |
|--------|-------------|----------|
| Taylor Rule response | Automatic rate adjustment based on CPI vs target. | ✓ |
| Manual policy only | User sets rates at design time. | |
| Rule-based + user override | Taylor Rule default + manual override. | |

**User's choice:** Taylor Rule response.

### Inflation Expectations

| Option | Description | Selected |
|--------|-------------|----------|
| Agents see inflation trend in context | "Inflation running at X%" in per-iteration economic context. | ✓ |
| Expectations drive preemptive buying | Physics engine biases toward BUY on high expectations. | |
| No explicit feedback | Agents respond to current prices only. | |

**User's choice:** Agents see inflation trend in context.

---

## Narrative Grounding

### Narrative Constraint Level

| Option | Description | Selected |
|--------|-------------|----------|
| Hard constraints with validation | Post-gen check for Gini/death/wealth contradictions, re-gen on mismatch. | |
| Structured narrative template | Template-based, guaranteed accurate. | |
| Stronger prompt grounding only | Better prompt, trust LLM compliance. | |

**User's choice:** Investigate root cause of mismatch first. Found: (1) friction-first directive biases narrative to pessimism, (2) aggregates hide fiscal redistribution, (3) agent intents misread as desperation, (4) agents don't receive personal stat history.

### Narrative Tone

| Option | Description | Selected |
|--------|-------------|----------|
| Data-driven + citizen sentiment | Tone matches data, also incorporates how agents feel. | ✓ |
| Keep friction first + accuracy guard | Dramatic bias with accuracy rules. | |
| Remove directive entirely | Neutral narration. | |

**User's choice:** Data-driven but also consider citizen agents' opinions — how people feel overall.

### Telemetry Digest

| Option | Description | Selected |
|--------|-------------|----------|
| Pre-interpreted digest | Compute structured digest before LLM call. | ✓ |
| Raw numbers with trend arrows | Numbers + directional indicators. | |
| Keep current raw injection | Fix prompt wording only. | |

**User's choice:** Pre-interpreted digest.

### Numbers in Narrative

| Option | Description | Selected |
|--------|-------------|----------|
| Prose with embedded data points | Readable prose with real numbers woven in. | ✓ |
| Pure prose, no numbers | Literary narrative only. | |
| Data sidebar + prose | Separate data panel alongside. | |

**User's choice:** Prose with embedded data points.

### Validation Assertions

| Option | Description | Selected |
|--------|-------------|----------|
| Gini direction consistency | If Gini fell, can't claim inequality widened. | ✓ |
| Death count accuracy | 0 deaths = no starvation language. | ✓ |
| Employment rate consistency | Employment rate must match narrative. | |
| Wealth trend consistency | Rising wealth != "wealth collapsed." | ✓ |

**User's choice:** Gini direction, death count, wealth trend. Not employment rate.

### Agent Stat Trajectory

| Option | Description | Selected |
|--------|-------------|----------|
| Per-iteration stat trajectory | Full wealth/health/happiness per iteration in reflections. | ✓ |
| Summary deltas only | Start vs end comparison. | |
| No change | Focus on intent/narrative prompts instead. | |

**User's choice:** Per-iteration stat trajectory.

### Agent Data Injection

| Option | Description | Selected |
|--------|-------------|----------|
| Both audit + assertions | Fix data injection AND add runtime assertions. | ✓ |
| Audit and fix only | Verify Phase 9 D-01/D-02 working. | |
| Assertions only | Runtime checks without fixing pipeline. | |

**User's choice:** Both audit + assertions.

---

## Banking & Credit Adoption

### Banking Motivation

| Option | Description | Selected |
|--------|-------------|----------|
| Enterprise-driven demand | Enterprises need loans, workers deposit excess. Organic demand. | |
| Prompt incentive redesign | Rewrite action descriptions to emphasize ROI. | ✓ |
| Mechanical nudges | Physics engine bonuses for banking participation. | |

**User's choice:** Prompt incentive redesign.

### Enterprise Banking

| Option | Description | Selected |
|--------|-------------|----------|
| Enterprises bank through system | Treasury as deposit, payroll as transfer, loans for capital. | ✓ |
| Optional banking | Can operate on cash. | |
| Non-banking entities | Only citizens interact with bank. | |

**User's choice:** Enterprises bank through the system.

### Loan Products

| Option | Description | Selected |
|--------|-------------|----------|
| Business + personal loans | Different terms, rates, collateral requirements. | ✓ |
| One loan type for all | Same product regardless of borrower. | |
| Enterprise-only lending | Bank only lends to enterprises. | |

**User's choice:** Business + personal loans.

### Credit Crunch Response

| Option | Description | Selected |
|--------|-------------|----------|
| Enterprises downsize (layoffs) | Without credit, reduce headcount. | |
| Central bank injects liquidity | Lender of last resort. Inflationary trade-off. | ✓ |
| Reduced capacity | Output reduced proportional to funding gap. | |

**User's choice:** Central bank injects liquidity.

---

## Location Bootstrap Backgrounds

| Option | Description | Selected |
|--------|-------------|----------|
| Retry once, then template | Fallback to template-based background. | |
| Fail the bootstrap entirely | No sessions with stub backgrounds. | ✓ |
| Keep stub but warn user | Stub stays, visible warning in UI. | |

**User's choice:** Fail the bootstrap entirely.

---

## Enterprise Output Types

### Commodity Mapping

| Option | Description | Selected |
|--------|-------------|----------|
| Role-based commodity mapping | Farms→food, Factories→tools+raw_materials, Artisans→luxury. | ✓ |
| All produce sector commodity | 1:1 mapping to CPI basket. | |
| Configurable per enterprise | Set at creation time. | |

**User's choice:** Role-based commodity mapping.

### Service Enterprises

| Option | Description | Selected |
|--------|-------------|----------|
| Multiplier effects only | Schools boost education quality, hospitals boost health. No commodity. | ✓ |
| Service commodities | New commodity types for education/healthcare. | |
| Wage-generating only | Pay wages, produce nothing. Government-funded. | |

**User's choice:** Multiplier effects only.

---

## Wage-Price Spiral Safeguards

| Option | Description | Selected |
|--------|-------------|----------|
| Central bank rate ceiling | Max interest rate (e.g., 15%) + direct intervention above ceiling. | ✓ |
| Price controls via fiscal engine | Temporary price controls when CPI exceeds threshold. | |
| AMM reserve injection | Government stockpile injection to drop prices. | |
| Let it spiral | Hyperinflation as valid simulation outcome. | |

**User's choice:** Central bank rate ceiling.

---

## Claude's Discretion

- Taylor Rule parameters (neutral rate, inflation target, response coefficients)
- Enterprise capital allocation algorithm for multiple enterprises per sector
- Central bank liquidity injection trigger threshold
- Narrative validation assertion implementation (regex vs LLM judge vs keyword)
- Enterprise naming during bootstrap

## Deferred Ideas

- Early stopping recalibration with active enterprises — may warrant separate tuning pass
- Order-book pricing as AMM replacement — future milestone
- Dynamic CPI basket weights (Engel's law) — interesting but beyond current needs
- Enterprise merger/acquisition mechanics — beyond current scope

---

## GC5: Post-Simulation Human Review (2026-04-11)

### Issues Found
After running two China sessions (baseline + forked with 10.5x higher interest rate, stopped at iter 5):

1. **Dopamine visually inert** — decay (-3) cancels action gains (+1/+2), net ~-1/iter. On bar charts looks stuck.
2. **Infra/education hit 100% in 3 iterations** — `totalEconomyFiat` not passed to `executeBudget()`, GDP-scaled formula dead code.
3. **Comparison narrative ignores config diffs** — prompt never included EconomyConfig parameters.
4. **Narrative trends hallucinated** — LLM only sees single-iteration delta, invents multi-iteration trends.
5. **Bank uses REST, STEAL, etc.** — `BANK_ACTIONS = [...BASE_ACTIONS, ...]` gives full citizen action set.
6. **Bank narrates "starving on streets"** — citizen prompt template used for institutional agents.

### Decisions

| Issue | Decision | Rationale |
|-------|----------|-----------|
| Dopamine | Remove entirely | Redundant axis — cortisol covers stress, happiness covers positive. No policy insight value. |
| Fiscal saturation | Wire `totalEconomyFiat` | One-line bug fix; GC3 calibration was correct but unreachable |
| Comparison narrative | Inject config diffs + time-series + wealth distribution into prompt | Root cause is information starvation, not LLM misbehavior. Post-assertion is a band-aid. |
| Per-iteration narrative | Expand telemetry digest from 1→4 iteration window | Single-iteration delta insufficient for trend claims |
| Bank actions | Dedicated institutional action set | Banks don't rest, work, steal, or apply for jobs |
| Bank prompt | Institutional persona override | "You are NOT a person" + mandate-based objectives |

### Root Cause Analysis: Narrative Mismatch
User asked: "What is a better way than post-generation assertion?"

**Answer:** Feed the LLM the actual data. An LLM hallucinating is inversely proportional to the data provided. Three layers of information starvation:
1. Per-iteration: only sees current vs previous (1 iter). Fix: show last 4 iterations.
2. Comparison: only sees final snapshot + overview. Fix: inject config diffs, per-iter trajectory, wealth distribution.
3. Post-mortem: similar to comparison. Fix: same enrichment approach.

Post-generation assertions remain as defense-in-depth but the primary fix is data completeness.
