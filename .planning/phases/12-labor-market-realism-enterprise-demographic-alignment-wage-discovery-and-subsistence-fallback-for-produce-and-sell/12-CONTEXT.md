# Phase 12: Labor Market Realism - Context

**Gathered:** 2026-04-14
**Status:** Ready for planning

<domain>
## Phase Boundary

Make paid employment the primary livelihood path for citizen agents and PRODUCE_AND_SELL a genuine subsistence fallback for those who cannot find work. Three coupled deliverables:

1. **Demographic-aligned enterprise generation** (both location-mode bootstrap and creative-mode Central Agent) so every employable agent has at least one plausible employer.
2. **Dynamic labor market** — enterprises post wages that adjust per iteration against applicant pressure, vacancy pressure, and P&L, bounded above by marginal revenue product of labor; agents use a reservation-wage anchor derived from last-period self-production.
3. **PRODUCE_AND_SELL recalibration** — physics yield + AMM sell-price drag + prompt copy so the action's expected net proceeds barely cover subsistence food cost and the LLM no longer treats it as an entrepreneurship shortcut.

**SFC invariant:** no monetary injection. All wage flows are transfers inside the perimeter (enterprise treasury ↔ worker wealth). Reservation-wage computation is read-only. Enterprise insolvency (Phase 10) handles enterprises that cannot pay.

</domain>

<carrying_forward>
## Already Locked (prior phases)

- SFC invariant + per-subsystem drift telemetry (Phase 11 D-20..D-23) — Phase 12 must not break the SFC perimeter. Wage adjustments are transfers, not creation.
- Enterprise engine + wage payment + insolvency pipeline (Phase 10) — extend, don't rewrite.
- Tax withholding applies at wage payment site (Phase 11 D-12, D-14) — wage changes flow through existing withholding code.
- Reservation wage anchor = last-period PRODUCE_AND_SELL net proceeds (L-04 in roadmap).
- Marginal revenue product of labor = wage upper bound (L-06 in roadmap).
- Action dictionary will be rewritten (L-08 in roadmap).
- Atomic bootstrap dual-write (post-rebase) — enterprise generation must stay inside the transactional boundary.

</carrying_forward>

<decisions>
## Implementation Decisions

### Wage adjustment rule (L-05, L-06)

**D-01:** Per-iteration hybrid wage adjustment, applied by the enterprise engine in this order:
  1. **Base:** start from last iteration's posted wage (or bootstrap-initialized wage on iter 1).
  2. **Labor-market nudge:** based on (applicants, vacancies) from the previous iteration's matching pass:
     - If applicants > vacancies: `wage × (1 − k × surplus_ratio)`, where `surplus_ratio = (applicants − vacancies) / max(vacancies, 1)` and `k ∈ [0.02, 0.05]` per iteration.
     - If vacancies > applicants: `wage × (1 + k × shortage_ratio)`.
  3. **Profit-share top-up:** if last-iteration P&L > 0, add `α × (P&L / workforce)` where `α ∈ [0.1, 0.3]`. If P&L ≤ 0, no top-up.
  4. **MRP ceiling (hard cap):** `wage ≤ output_price × output_per_worker − per_worker_input_cost`. Any computed wage above this is clamped to MRP.
  5. **Minimum-wage floor (hard floor):** `wage ≥ economyConfig.minimumWage` (existing Phase 10 invariant).

**D-02:** Tuning constants `k` and `α` live in `economyConfig` so future phases can adjust without code changes. Initial values: `k = 0.03`, `α = 0.15`.

**D-03:** "Applicants" and "vacancies" are measured at the end of the APPLY_FOR_JOB matching pass, persisted per-enterprise as `lastApplicants: number` and `lastVacancies: number` for the next iteration's nudge computation.

### Demographic-match strictness (L-01, L-02, L-03)

**D-04:** Location-mode bootstrap generates enterprises such that total vacancies per sector ≈ **110% × sector_workforce**, where `sector_workforce = floor(sectorEmployment_pct × employable_agent_count)`. The 10% slack gives labor market room to move without immediately binding.

**D-05:** Post-generation invariant check (bootstrap-time, before session is marked design-review):
  - Every sector with ≥5% of the workforce must have at least 1 enterprise.
  - Total vacancies must be ≥ 1.05 × employable_agent_count (system-level slack).
  - If either fails, auto-inflate enterprise count or capacity. Log the correction in the bootstrap trace.

**D-06:** Creative-mode enterprise generation (Central Agent) receives the society overview + target employable agent count in the LLM prompt. LLM outputs enterprise blueprints with sector labels matching language from the overview. Same invariant check from D-05 runs post-LLM; if it fails, the Central Agent is re-prompted with a validator feedback message (mirroring existing retry-with-healing pattern) up to N=3 times; on exhaustion, bootstrap aborts with a clear error.

**D-07:** "Employable" = citizen agents excluding `type: 'bank'`, `role: 'central_bank'`, and role: `'central_agent'` / `'official'` (elites who own enterprises or govern, not employees).

### PRODUCE_AND_SELL margin target (L-07)

**D-08:** Physics yield unchanged: `BASE_FOOD_PRODUCTION = 4` units per call, scaled by `skillMultiplier` (existing in `inventorySystem.ts:40, 182`). No nerf — the issue is framing + sell-price, not yield.

**D-09:** AMM sell-price calibrated so **expected net ≈ 0** over 10 iterations of continuous PRODUCE_AND_SELL:
  - Median net ≈ 0 (small fluctuations around break-even).
  - Bottom-quartile net **negative** (tool wear + raw-material exhaustion + AMM saturation when many sellers present).
  - Top-quartile net slightly positive (fresh tools, raw materials present, few competing sellers).

**D-10:** Variance sources already present — preserve and strengthen:
  - Raw-materials shortage (existing 30% yield fallback at `inventorySystem.ts:188`).
  - Tool wear (existing, breaks tools over time).
  - AMM depth responds to per-iteration seller count — multiple simultaneous sellers compress per-unit price (existing AMM x·y=k mechanic).

**D-11:** Subsistence food cost remains governed by existing MET metabolism + `SatietyKcalPerPoint` formula. If calibration requires raising food cost to hit D-09 target, prefer raising AMM sell-price drag over raising food cost (food cost affects many other actions).

### APPLY_FOR_JOB matching policy (L-04, L-09, L-10)

**D-12:** Reservation wage per agent, computed at the start of each iteration:
  - `reservation_wage = last_period_PRODUCE_AND_SELL_net_proceeds` if the agent used PRODUCE_AND_SELL last iteration.
  - Otherwise `reservation_wage = max(minimumWage × 0.5, small_constant)` — a floor so agents who haven't tried self-production yet don't set reservation=0.
  - Stored per-agent per-iteration; read-only (does not mutate any monetary state).

**D-13:** Per-iteration matching pass (runs after intent resolution, before wage payment):
  1. Collect applicants: agents whose intent included APPLY_FOR_JOB this iteration, plus agents who used QUIT_JOB last iteration (auto-reapply).
  2. For each applicant: filter enterprises by `(vacancy > 0) AND (posted_wage ≥ reservation_wage)`.
  3. Among qualifying, pick the **highest-wage** enterprise; applicant becomes employed there; decrement that enterprise's vacancy count by 1.
  4. Tie-breaker if multiple enterprises offer equal highest wage: choose the enterprise with the lowest current workforce (load-balances).
  5. Unmatched applicants remain unemployed; they fall back to PRODUCE_AND_SELL or idle next iteration.
  6. Persist `lastApplicants` and `lastVacancies` counts on each enterprise for D-03.

**D-14:** QUIT_JOB remains an available action; after quitting, the agent is automatically re-entered into the next iteration's applicant pool (same as unemployed-from-start).

### Creative-mode enterprise generation (folded from defaulted gray area)

**D-15:** Central Agent's location-mode-equivalent path: same generator as D-06. LLM prompt includes a JSON schema for enterprise blueprints (sector, owner role, initial workforce size, wage anchor = `baseFiat × 0.10`). Same 110% vacancy invariant.

### Insolvency displacement (folded from defaulted gray area)

**D-16:** When an enterprise becomes insolvent (Phase 10 insolvency pipeline triggers), its employees:
  1. Have their `employerId` cleared from the employmentRegistry that iteration.
  2. Are marked unemployed and eligible to re-apply next iteration via the D-13 matching pass.
  3. Are counted in new telemetry field `displacedThisIteration: number` on the iteration stats.
  4. Receive no severance (enterprise's residual treasury goes back to the SFC perimeter per existing insolvency handling).

### Prompt framing (L-08)

**D-17:** WORK_AT_ENTERPRISE action-dictionary description must include the agent's **actual wage** interpolated per-agent. Template:
> "Show up at {employer_name} for this week's {wage} fiat wage. Guaranteed — no market risk. Paid directly to your wealth."

**D-18:** PRODUCE_AND_SELL reframed as subsistence fallback:
> "Farm your land for subsistence (PRODUCE_AND_SELL). You produce ~4 units of food — enough for this week's survival, little or nothing left to sell. Use when you can't find work."

**D-19:** Employment Board block (`agent-intent.ts:396`) augmented to show each vacancy with: enterprise name, sector, posted wage, current workforce / capacity. Agent's reservation_wage shown near the top of the block for comparison.

### Telemetry surface (L-11)

**D-20:** Per-iteration labor-market telemetry emitted on `iteration-complete` SSE event and persisted in `macroSnapshots`:
  - `avgPostedWage: number` (workforce-weighted)
  - `unemploymentRate: number` (employable unemployed / employable total)
  - `reservationWageP50: number`, `reservationWageP25: number`, `reservationWageP75: number`
  - `vacanciesTotal: number`, `applicantsTotal: number`
  - `displacedThisIteration: number`

**D-21:** Dashboard surfaces the four most-actionable: avg wage over time, unemployment rate, vacancies vs applicants (as two lines), and displaced events as vertical markers.

### Claude's Discretion

- Exact choice of sigmoid vs linear for the labor-market nudge function (D-01 step 2) — planner picks.
- Whether to store wage history on each enterprise (for debugging) or only the latest posted wage (for runtime) — planner picks based on storage cost.
- Specific re-prompt phrasing for D-06 creative-mode validator feedback.
- Prompt-level phrasing polish of D-17/D-18 wording beyond the template skeleton.
- Dashboard chart styling (follow existing EconomicDashboard patterns).

</decisions>

<specifics>
## Specific Ideas

- **User's project philosophy** (from session): "not a well working prototype yet — cannot be considered good v1.0" → all labor-market fixes in v1.0, no deferral to v1.1.
- **Realism priority** (from user): *"in real life, only doing produce and sell should barely make a living"* → subsistence framing is the primary lens for D-08..D-11, not just a stylistic choice.
- **Labor market motivation** (from user): *"how can those production reflect market price of labor?"* → the hybrid wage-adjustment rule (D-01) is the direct answer; must produce observable wage convergence to marginal product over iterations in the smoke test.
- **Enterprise generation constraint**: must match demographic information — ties into D-04..D-07; not optional.

</specifics>

<canonical_refs>
## Canonical References

### Roadmap + prior phase anchors

- `.planning/ROADMAP.md` §"Phase 12" — goal, L-01..L-11 requirement list, SFC invariant statement
- `.planning/phases/10-fix-simulation-realism.../10-02-PLAN.md` — Phase 10 enterprise engine origin (processEnterpriseWages, insolvency, cost pass-through)
- `.planning/phases/10-fix-simulation-realism.../10-03-PLAN.md` — Phase 10 enterprise bootstrap (location-mode generation heuristic, owner assignment)
- `.planning/phases/10-fix-simulation-realism.../10-04-PLAN.md` — Phase 10 enterprise banking (treasury as bank deposit, payroll as deposit-to-deposit transfer)
- `.planning/phases/11-simulation-realism.../11-VALIDATION.md` §"Follow-up" — "bootstrapRoster batch spam" and "all-API badge label" entries; Phase 12 may touch these incidentally but does not own them

### Core code

- `server/src/mechanics/enterpriseEngine.ts:75-143` — processEnterpriseWages (where wage payment happens; D-01 extends this)
- `server/src/mechanics/enterpriseEngine.ts:258-290` — processEnterpriseCostPassThrough (existing; D-01 complements but does not replace)
- `server/src/data/dataBootstrapPipeline.ts:440-552` — generateEnterprises (D-04..D-05 extend)
- `server/src/mechanics/inventorySystem.ts:40, 177-190` — PRODUCE_AND_SELL physics (D-08 preserves)
- `server/src/mechanics/automatedMarketMaker.ts` — AMM x·y=k core (D-09 calibration target)
- `server/src/llm/prompts/shared.ts:26-40` — action dictionary (D-17, D-18)
- `server/src/llm/prompts/agent-intent.ts:396, 470` — employmentBoardBlock + enterpriseContext hook (D-19)
- `server/src/orchestration/simulationState.ts:44` — sessionEmploymentRegistry (D-13 extends with lastApplicants/lastVacancies)
- `server/src/orchestration/simulationRunner.ts:1760-1810` — wage payment loop (D-01 integration point)
- `shared/src/types.ts:60-90` — Agent type (D-12 adds reservation_wage as transient computed field; L-11 adds telemetry fields to TelemetryLog)
- `server/src/mechanics/actionCodes.ts` — APPLY_FOR_JOB, QUIT_JOB, WORK_AT_ENTERPRISE definitions (D-13 wires matching pass)

### Reservation-wage and MRP math references

- None external — formulas are defined in D-01, D-09, D-12 above. Plain-English labor-economics references (Walras, Borjas) are not required reading.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable assets

- `employmentRegistry` (`simulationState.ts:44`) — already tracks agent → enterprise linkage; D-13 just extends it with matching-pass hooks.
- `processEnterpriseWages` (`enterpriseEngine.ts:75`) — already handles pro-rata payment + insolvency increment; D-01 runs BEFORE this (sets the wage), not inside it.
- `enterpriseContext` parameter on `buildNaturalIntentPrompt` (`agent-intent.ts:470`) — already accepted by the builder but never populated; D-17/D-19 activate this slot.
- AMM `x·y=k` (`automatedMarketMaker.ts`) — already responds to seller volume. D-09 tunes calibration constants; does not rewrite.
- `retryWithHealing` pattern (existing in LLM gateway) — D-06 creative-mode validator retry reuses this.

### Integration points

- Wage adjustment rule (D-01) is a NEW function called at the top of each iteration, before the intent phase, to finalize this iteration's posted wage per enterprise.
- APPLY_FOR_JOB matching pass (D-13) is a NEW function called after intent resolution, before wage payment.
- Telemetry emission (D-20) hooks into the existing per-iteration TelemetryLog payload.

### Not reusable / needs new

- No existing "reservation wage" concept — D-12 introduces it as a transient per-iteration computation.
- No existing "applicant pool" structure — D-13 introduces it.
- Action-dictionary template interpolation — the current action description is a static string; D-17 requires per-agent wage substitution at prompt build time.

</code_context>

<deferred>
## Deferred / Out of Scope

- **Education / training actions** to increase skill (would affect reservation-wage and MRP but is its own phase).
- **Collective bargaining / unions** — real labor markets include these; not in scope for v1.0.
- **Minimum-wage policy as a simulation variable** — currently set in config; making it a governance-ballot item would belong in a future policy-levers phase.
- **Unemployment benefits** — out of scope; welfare already handled by Phase 11 fiscal.
- **Sector/skill-match filters on APPLY_FOR_JOB** — rejected in discussion; may become useful later if the simple reservation-wage model produces unrealistic cross-sector mobility.
- **Persistent wage history per enterprise** — planner's discretion whether to persist; not required by any L-XX requirement.

</deferred>

<next_steps>
## Next Steps

Run `/gsd:plan-phase 12` to break this into atomic plans. Expected plan shape (for the planner to refine):

1. Demographic-aligned enterprise generation — both modes (D-04..D-07, D-15)
2. Wage-adjustment engine + MRP cap + profit-share (D-01..D-03)
3. Reservation wage + APPLY_FOR_JOB matching pass (D-12..D-14)
4. PRODUCE_AND_SELL recalibration — AMM drag + prompt rewrite (D-08..D-11, D-18)
5. WORK_AT_ENTERPRISE prompt + enterpriseContext wiring (D-17, D-19)
6. Insolvency displacement + telemetry (D-16, D-20, D-21)
7. Umbrella integration test + live smoke verification (standard GSD final plan)

`/clear` first → fresh context window.

</next_steps>
