# Phase 11: Simulation realism — organic stress pressure, fiscal balance, and SFC leak closure - Context

**Gathered:** 2026-04-13
**Status:** Ready for planning

<domain>
## Phase Boundary

Close the remaining utopia-bias gaps in the deterministic economic engine so simulation outcomes reflect policy trade-offs rather than defaulting to improvement. Scope covers five coupled subsystems:

1. **Cortisol stress dynamics** — remove per-action relief, add structural pressures, tighten thresholds.
2. **Happiness symmetry** — same asymmetry fix as cortisol (rewards → structural pressures).
3. **Fiscal loop closure** — only welfare transfers to citizens; infra/edu/defense go to public-goods escrow. Broaden tax base. Central-Agent-chosen taxShape.
4. **Governance mechanic extensions** — user toggle + law text amendment (existing franchise mechanic confirmed complete).
5. **SFC leak closure** — diagnostic per-subsystem telemetry (not bug-hunt); TelemetryLog records `sfcDrift`.

**NOT in scope:** Agent-driven runtime amendment of taxShape, structured JSON law schema, social-network modeling for happiness, hedonic adaptation, full SFC bug-hunt audit. These are deferred.

</domain>

<decisions>
## Implementation Decisions

### Cortisol Stress Model

- **D-01:** Remove **all** per-action cortisol relief in `physicsEngine.ts`. Strip `Δcortisol` from WORK (−3), WORK_AT_ENTERPRISE (−3), REST (−5), PRODUCE_AND_SELL (−2), POST_BUY_ORDER / POST_SELL_ORDER (−1), HELP (−5), DEPOSIT (−2), REPAY_LOAN (−3), BUY_BOND (−1), ISSUE_GOV_BOND (−2), and any other cheap action-reward entries. Keep **outcome-driven** cortisol (STEAL +10, STRIKE +5, unemployment-induced penalties, etc.). Cortisol becomes purely a stress signal.

- **D-02:** Add four continuous per-tick structural cortisol pressures applied to every alive citizen agent (not bank/central):
  - **Inflation surprise:** `+k_inflation × max(0, actual_CPI_growth - expected)` — uses existing `inflationEngine` outputs
  - **Inequality stress (bottom quintile):** `+k_gini × max(0, Gini - threshold)` applied only to agents in the bottom 20% wealth cohort — Gini already computed in `telemetryCollector`
  - **Unemployment / precarity:** `+k_unemp` when agent has no `employmentRegistry` entry AND wealth below a configurable threshold
  - **Underfunded public goods:** `+k_pg × (1 - min(infra, edu, welfare)/50)` — applies to every citizen as generalized service-quality stress

- **D-03:** Cortisol ceiling raised to **95** (from 100). Keeps 5-point headroom so the allostatic strain integrator can still recover. Floor = 3 (existing Phase 10 convention retained).

- **D-04:** Cortisol auto-escalation thresholds raised: `lowWealthThreshold` 20 → **50**, `lowHealthThreshold` 30 → **60**. Middle-class agents now feel financial anxiety; only genuinely healthy agents escape the health cortisol penalty.

- **D-05:** Calibration: ship with **conservative defaults** (low coefficients, e.g., 2–3 cortisol/tick per pressure), exposed as hot-swappable constants in `physicsConfig.ts`. Tune empirically from observed simulation behavior. No literature-driven calibration this phase.

### Happiness Symmetry

- **D-06:** Parallel treatment to cortisol: remove per-action happiness rewards in `physicsEngine.ts` (REST +2, POST_ORDER +1, PRODUCE_AND_SELL +1, etc.). Keep outcome-driven happiness (STRIKE +5, HELP +5 altruistic, etc. — reflects actual social events, not routine).

- **D-07:** Add continuous per-tick structural happiness **pressures** (negative deltas):
  - Peer death penalty: `-k_peer_death × deathsThisTick`
  - Inequality: bottom-quintile agents get `-k_gini_hap × max(0, Gini - threshold)`
  - Unemployment: `-k_unemp_hap` when no employment + low wealth
  - Underfunded welfare: `-k_welfare × (1 - welfareQuality/50)`
  - Inflation surprise: `-k_inflation_hap × max(0, CPI_growth - expected)`

- **D-08:** Happiness clamp tightened to **[5, 95]** (from [0, 100]). Prevents saturation both ends, matches cortisol treatment.

- **D-09:** Calibration same as cortisol — conservative defaults in `physicsConfig.ts`, tune empirically.

### Fiscal Loop Closure

- **D-10:** Change fiscal distribution in `fiscalEngine.ts:371-389`. Only the **welfare** allocation continues to distribute fiat as direct per-agent transfers. Infrastructure, education, and defense fiat is moved into a new **public-goods escrow ledger** (per-session, per-category).

- **D-11:** Public-goods escrow accounting: new `publicGoodsEscrow: { infrastructure, education, defense }` per-session state. Counted in `computeSystemFiatTotal` so M0 stays constant (SFC-neutral). Fiat is parked, visible in telemetry, never leaves the closed-loop perimeter. Quality-score side effects (productivity, skill, enforcement multipliers) remain unchanged — spending still buys quality.

- **D-12:** Tax base extended beyond the existing WORK tax (Phase 10 D-32). Per-tick taxable events:
  - Citizen AMM sell revenue from PRODUCE_AND_SELL (tax applied to the fiat received at trade execution)
  - Enterprise wage income (tax applied to the employee when wage is paid)
  - Capital gains: profit on SELL_SHARES, matured bond payouts
  - AMM consumption VAT: flat k% added to every AMM buy, routed to treasury

- **D-13:** Tax shape selection is **design-stage only this phase**. The Central Agent (at bootstrap / society generation, alongside law + budget) picks `taxPolicy: { kind: 'flat' | 'progressive', rates: {...} }` and persists into `EconomyConfig.taxPolicy`. Fixed menu: **flat** or **progressive**. No other schemes (wealth tax, land tax, open-ended LLM schemes all out of scope). Runtime amendment of taxShape is **deferred** to a future phase.

- **D-14:** Tax collection timing: **inline during each tax-bearing action**. Action dispatchers (`PRODUCE_AND_SELL` trade execution, wage settlement, AMM buy, bond/share matching) withhold the configured tax at the moment of the event. Preserves per-action SFC traceability in the physics trace log.

- **D-15:** Fold in the bootstrap bug: current session `3b25f15c` has no `fiscal_budgets` row despite bootstrap calling `fiscalRepo.createBudget` at `bootstrap.ts:524`. Investigate root cause AND add a startup assertion: when `fiscalEnabled === true`, a `fiscal_budgets` row must exist for the session before `runSimulation` proceeds, else throw with a descriptive error. No silent fallback to `DEFAULT_BUDGET_ALLOCATION` when fiscal is enabled.

### Governance Mechanic Extensions

- **D-16:** Existing governance cycle (`runGovernanceCycle` at every 5th iteration, franchise-size via Central Agent, 3 policy fields with proposal→ballot→vote→ratify) is confirmed complete. **No changes** to the franchise sizing mechanic.

- **D-17:** Add `economyConfig.governanceEnabled` boolean field (default `true`). When `false`, skip `runGovernanceCycle` entirely so users can isolate policy effects for clean A/B comparison. Expose as a checkbox in the Design stage UI (`DesignReview.tsx` economy tab).

- **D-18:** Extend governance to **law text amendment**. Add a new ballot item type `law_amendment` with `{ oldParagraph, newParagraph, description }`. Ratified law amendments apply a paragraph-level diff to `session.law` using the same find-and-replace pattern as `centralAgent.ts:455-467` (existing refine-law chat flow). Silently rejected if `oldParagraph` not found verbatim in current law. Store amendments in history.

- **D-19:** Law amendment scope: **paragraph-level text replacement only**. No structured JSON law schema, no full rewrite. Matches established pattern.

### SFC Leak Closure

- **D-20:** Diagnostic approach (NOT targeted bug-hunt). Instrument each subsystem with per-iteration balance deltas so leaks are discovered via observability. Instrumented subsystems: banking, capital markets, fiscal (incl. escrow), enforcement, trade/AMM, physics-action-resolution.

- **D-21:** Add `sfcDrift` and `sfcDriftBySubsystem: { banking, capmkt, fiscal, enforcement, trade, physicsActions }` fields to `TelemetryLog`. Each subsystem's delta MUST sum to zero within the same iteration (deposits created = deposits paid from, treasury out = citizen in, etc.).

- **D-22:** Drift warning threshold unchanged: **0.1 absolute** fiat per iteration.

- **D-23:** On drift detection: `console.error` the drift (existing behavior) AND record to telemetry (new). **No auto-correction**, **no simulation pause**. User must see issues in dashboard and fix them.

### Claude's Discretion

- Exact coefficient defaults (`k_inflation`, `k_gini`, `k_unemp`, `k_pg`, `k_peer_death`, etc.) — planner picks conservative seed values; D-05 / D-09 anchor the method.
- Structural pressure application order within each tick (before/after action resolution, before/after allostatic engine).
- Whether cortisol ceiling (95) should be enforced on the `runningCortisol` accumulator or only at final stat commit — match the existing floor=3 convention.
- Taxable-event hook placement in the code (which file owns withholding logic).
- Escrow ledger persistence format (new DB table vs extension of existing `public_goods_state` vs in-memory + snapshot).
- Law amendment ballot prompt design — reuse governance proposal prompt pattern.

### Folded Todos

[none folded — `gsd-tools todo match-phase 11` returned zero matches]

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Simulation Engine (core files to modify)
- `server/src/mechanics/physicsEngine.ts` — Action-code Δ lookup; strip cortisol/happiness rewards here (D-01, D-06); layer structural pressures (D-02, D-07)
- `server/src/mechanics/physicsConfig.ts` — Hot-swappable constants; add new `k_*` pressure coefficients, ceiling/floor, raised thresholds (D-03, D-04, D-05, D-08, D-09)
- `server/src/mechanics/allostaticEngine.ts` — Cortisol→strain→load pipeline; understand interaction with new ceiling = 95
- `server/src/mechanics/fiscalEngine.ts` — Spending distribution at lines 371-389 changes per D-10, D-11; multiplier effects stay
- `server/src/mechanics/inflationEngine.ts` — Source of CPI surprise signal for D-02 inflation pressure
- `server/src/mechanics/automatedMarketMaker.ts` — VAT hook point for D-12 AMM consumption tax

### Economy Config & Types
- `shared/src/types.ts` — Add `taxPolicy` (D-13), `governanceEnabled` (D-17), `publicGoodsEscrow` to EconomyConfig / session state
- `shared/src/types.ts` §DEFAULT_BUDGET_ALLOCATION (line ~860) — Note fallback currently masks missing `fiscal_budgets` rows
- `server/src/mechanics/economyConfigUtils.ts` — Config merging / validation

### Orchestration
- `server/src/orchestration/simulationRunner.ts` — Tick-level orchestration; tax-collection timing (D-14); SFC telemetry (D-20, D-21)
- `server/src/orchestration/simulationState.ts` — Where `publicGoodsEscrow` map lives
- `server/src/orchestration/governanceManager.ts` — Governance cycle; extend with law-amendment ballot type (D-18); respect toggle (D-17)
- `server/src/orchestration/enterpriseActionDispatch.ts` — Wage/trade tax withholding hooks (D-12, D-14)
- `server/src/orchestration/telemetryCollector.ts` — Gini already computed; source for D-02 inequality pressure

### Fiscal & DB
- `server/src/db/repos/fiscalRepo.ts` — `createBudget` called from bootstrap; investigate bug at D-15
- `server/src/routes/bootstrap.ts:515-526` — `createBudget` invocation site
- `server/src/db/schema.ts` §fiscalBudgets, §publicGoodsState — escrow persistence decision (D-11)

### Governance LLM Prompts
- `server/src/llm/prompts/governance.ts` — proposal/ballot/vote prompts; extend with law-amendment variant (D-18)
- `server/src/llm/centralAgent.ts:455-467` — refine-law paragraph-diff pattern to reuse (D-18, D-19)

### Bootstrap / Design Stage
- `server/src/data/dataBootstrapPipeline.ts` — Central Agent config generation; add taxPolicy selection (D-13)
- `server/src/routes/bootstrap.ts` — Full bootstrap flow; D-15 startup assertion lives here
- `web/src/pages/DesignReview.tsx` — Design-stage UI; add `governanceEnabled` toggle (D-17)
- `web/src/components/EconomyTab.tsx` — Where the governance toggle checkbox goes

### Prior Phase Context (must read for continuity)
- `.planning/phases/10-fix-simulation-realism-agent-economic-behavior-inflation-response-narrative-grounding/10-CONTEXT.md` — D-31 public goods scaling, D-32 WORK income tax, D-17 narrative grounding. Phase 11 extends these directly.
- `.planning/PROJECT.md` — Core value: deterministic economic engine must be realistic enough for policy trade-off analysis
- `.planning/REQUIREMENTS.md` — Acceptance criteria foundation

### Results / Evidence
- `Results/session-united-states.json` — Apr-13 simulation showing utopia bias (wealth +49%, cortisol 10→2.3, M0 drift −5.9k over 5 iters). Use as baseline; expect post-Phase-11 run to show non-monotonic stats and M0 constant within ±0.1.

### Module Map
- `MODULE_MAP.md` — Module registry; check before modifying to understand boundaries

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `allostaticEngine.ts` AllostaticEngine class — continuous cortisol→strain→load pipeline already correct; structural cortisol pressures feed into its input
- `telemetryCollector.ts` Gini coefficient + crime rate already computed per tick — reuse for D-02 inequality pressure, no recomputation needed
- `inflationEngine.ts` CPI surprise = `actual - expected` — already tracked; expose for D-02 pressure input
- `fiscalEngine.ts` multiplier effects (productivity, skillGain, enforcement) — unchanged, keep firing from quality scores even after escrow redirect
- `governanceManager.ts` franchise sizing + proposal/ballot/vote pattern — extend for law amendment (D-18); add toggle check before cycle fires
- `centralAgent.ts:455-467` paragraph-level law diff pattern — copy for D-18 ratified law amendments
- `physicsConfig.ts` hot-swap pattern for `k_*` coefficients — add new pressure constants here

### Established Patterns
- SFC invariant: M0 constant + M1 = M0 + loansOutstanding. Every new fiat flow must either stay in the perimeter or be audited at subsystem boundaries.
- Engine modules are DB-free (delta-return pattern); repos handle persistence. Follow for any new subsystems.
- `asyncLogFlusher` for high-frequency writes; direct `sqlite.transaction()` for once-per-iteration batch writes.
- EconomyConfig uses optional fields + defaults for backward compatibility. New taxPolicy / governanceEnabled / escrow fields should follow.
- Bootstrap aborts with SSE error on LLM failures (D-28 Phase 10) — no silent fallbacks. D-15 assertion follows the same philosophy.

### Integration Points
- Physics action resolution layers `economyDeltas` on top of action archetype deltas (`physicsEngine.ts:500-509`). Structural pressures (D-02, D-07) should plug in at a similar layer, applied after action resolution but before clamping.
- Tax withholding hooks (D-14) live at the point each taxable event completes — AMM trade execution, wage settlement, share/bond match.
- Governance toggle (D-17) gates the `if (iterNum % 5 === 0 ...)` block at `simulationRunner.ts:2835`.
- SFC telemetry (D-20, D-21) plugs into `TelemetryLog` construction at `simulationRunner.ts:2595-2660` region.

</code_context>

<specifics>
## Specific Ideas

- **Utopia-baseline evidence:** Phase 11 success is measured against `Results/session-united-states.json`. Post-phase re-run of the same bootstrap should show: cortisol trajectory non-monotonic (not just decaying to floor), wealth trajectory non-monotonic (should decline under poor policy, grow under good policy), SFC drift ≤ 0.1/iter, and measurable difference between scenarios with different fiscal allocations.
- **User vision for governance evolution:** Tax shape decided by Central Agent at Design; future phases open the door for citizen-initiated amendments (deferred). User also wants policy amendments to be able to change law text, not just scalar policy fields — hence D-18.
- **User-driven toggle philosophy:** The governance toggle is intentional UX: users running policy A/B comparisons want the ability to disable emergent governance to isolate the policy variable being studied. Aligns with project's core scenario-builder value.
- **Escrow semantics:** Escrow is not destruction. Fiat stays in M0. Quality score is the only "effect" of spending. Future phases could introduce escrow-to-citizen-flow (government contractor payments), but Phase 11 keeps it a static sink with multiplier effects.

</specifics>

<deferred>
## Deferred Ideas

- **Agent-driven runtime amendment of taxShape** — Phase 12+. Citizen legislative sessions propose/vote on tax kind (flat↔progressive) and bracket changes at runtime.
- **Structured JSON law schema** — Phase 12+. Migrate session.law from freeform text to sections/clauses with stable IDs so amendments can target specific clauses deterministically.
- **Wealth tax / land tax** — Phase 12+. Extend tax kinds beyond flat/progressive.
- **Hedonic adaptation + social-network happiness modeling** — separate phase. Peer-group comparisons, relative status, friendship graphs.
- **Research-backed psychophysics calibration** — if empirical defaults in Phase 11 prove too noisy, a future phase can anchor coefficients to allostatic-load literature.
- **Per-action SFC bug-hunt audit** — if Phase 11 telemetry surfaces a consistent non-zero subsystem delta, a follow-up phase targets the specific subsystem.
- **Full escrow lifecycle (government contracts)** — escrow currently static; future phase could introduce "government contractor" role that receives escrow spending as income.

### Reviewed Todos (not folded)

[none — `todo match-phase 11` returned zero matches]

</deferred>

---

*Phase: 11-simulation-realism-organic-stress-pressure-fiscal-balance-and-sfc-leak-closure*
*Context gathered: 2026-04-13*
