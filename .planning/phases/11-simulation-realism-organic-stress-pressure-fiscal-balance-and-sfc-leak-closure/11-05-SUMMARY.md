---
phase: 11-simulation-realism-organic-stress-pressure-fiscal-balance-and-sfc-leak-closure
plan: 05
subsystem: design-time-tax-policy
tags: [typescript, taxPolicy, bootstrap, llm-schema, centralAgent, vitest]

# Dependency graph
requires:
  - phase: 11
    plan: 01
    provides: TaxPolicy shared type, EconomyConfig.taxPolicy optional field, centralAgentTaxPolicy.test.ts scaffold
  - phase: 11
    plan: 04
    provides: computeWithholding consumer — will now receive scenario-calibrated taxPolicy instead of baseline flat default
provides:
  - validateTaxPolicy(input) helper — always returns a valid TaxPolicy; clamps per-rate [0, 0.5]; coerces malformed progressive to flat
  - DEFAULT_TAX_POLICY constant (flat 15/10/15) used as the universal fallback
  - profileToEconomyConfig taxPolicy derivation — progressive for gdpPerCapita > 25k AND govExpense > 30%; flat otherwise; rates scaled from WB lending rate + gov expense %GDP
  - taxPolicy source tracking in paramSources ('api' / 'medium' confidence)
  - buildLawMessages JSON schema extended with taxPolicy alongside law; system prompt documents flat vs progressive shapes, rate semantics, clamp, and emission examples
  - generateDesign law-step parsing extracts LLM taxPolicy, validates, merges into creative-mode economyConfig
affects: [11-06, 11-07, 11-08, 11-09, 11-10]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Defensive validator pattern: validateTaxPolicy always returns a valid TaxPolicy regardless of input shape — caller never branches on validity, just consumes the result"
    - "Per-rate clamp [0, 0.5] applied inside the helper, not at bootstrap ingestion — keeps the contract for TaxPolicy permissive (callers can store whatever) but guarantees runtime effect stays sane; identical pattern to Plan 11-04's computeWithholding"
    - "Bootstrap derivation + defensive re-validation: profileToEconomyConfig computes a TaxPolicy from the heuristic THEN runs it through validateTaxPolicy — if the heuristic ever drifts (e.g. negative rate from bad WB data), the validator catches it"
    - "LLM schema extension strategy: taxPolicy emitted alongside law (not as a separate LLM call) — zero additional tokens beyond the small schema + rule block; reuses existing withRetry + parseJSON flow"
    - "DEFAULT_ECONOMY_CONFIG.taxPolicy as the universal backstop: malformed/missing LLM output → DEFAULT_TAX_POLICY (which IS DEFAULT_ECONOMY_CONFIG.taxPolicy shape) — one source of truth for the flat baseline"

key-files:
  created: []
  modified:
    - server/src/mechanics/economyConfigUtils.ts
    - server/src/data/dataBootstrapPipeline.ts
    - server/src/llm/prompts/central-agent.ts
    - server/src/llm/centralAgent.ts
    - server/src/llm/__tests__/centralAgentTaxPolicy.test.ts

key-decisions:
  - "Extended buildLawMessages (not buildOverviewMessages) to emit taxPolicy — law step is conceptually adjacent to taxation (governance/economic participation rules) and already has a JSON schema that accepts top-level extension without breaking existing parse sites"
  - "taxPolicy emitted as the law LLM call's JSON output, reusing the existing withRetry + parseJSON flow — zero new LLM calls, minimal token cost (~400 chars of schema + rule block in the system prompt)"
  - "validateTaxPolicy is idempotent and total: any input shape is mapped to a valid TaxPolicy — downstream callers (computeWithholding, getEconomyConfig) never have to branch on validity"
  - "Empty brackets or non-increasing upto → return DEFAULT_TAX_POLICY (drop the LLM-provided rates), not `{ kind: 'flat', rates }` — rationale: if the LLM emitted malformed brackets alongside bespoke rates, the rates themselves are suspect; fall back to the known-good baseline entirely. Non-increasing upto BUT otherwise plausible shape (e.g. reversed 200 then 100 with reasonable rates) coerces to flat with rates retained — test coverage differentiates both paths"
  - "profileToEconomyConfig derivation heuristic anchored to 11-RESEARCH.md §5: gdpPerCapita > 25000 AND govExpensePctGdp > 30 → progressive — both thresholds must be met (AND, not OR). A 25k+ GDP country with 15% gov expense (Taiwan, S Korea) stays flat; a 15k GDP country with 35% gov expense is rare in practice but falls flat too (progressive brackets don't make sense without wealth spread)"
  - "Progressive bracket seed uses 500 / 2000 / 10000 wealth tiers — calibrated to bootstrap baseFiat ≈ 10k scale (50-500 initial wealth range, top enterprise owners accumulate into thousands over 10-20 iterations). Scales with incomeSeed so low-tax societies get proportionally smaller bracket spreads"
  - "llmTaxPolicy applied ONLY when existingConfig.economyConfig is absent (i.e. no prior bootstrap config). Location-bootstrap sessions already have a data-driven taxPolicy from profileToEconomyConfig — the creative-mode path doesn't overwrite it"

patterns-established:
  - "LLM prompt schema extension via JSON-schema-first: show the shape in the initial 'You MUST respond with ONLY valid JSON' block AND provide a dedicated rule block with rationale + examples — ensures both the schema-parsing LLMs and the instruction-following LLMs see the addition"
  - "TaxPolicy drops rates on full fallback (DEFAULT) vs retains rates on partial fallback (non-increasing brackets only). Split gives deterministic test semantics for each corruption class"

decisions-addressed: [D-13]

# Metrics
duration: 4min
completed: 2026-04-13
---

# Phase 11 Plan 05: Central-Agent Tax Policy Selection Summary

**Closed Phase 11's design-stage tax policy gap (D-13): both bootstrap paths now land a scenario-calibrated `economyConfig.taxPolicy` before simulation starts. Location-mode derives it from WB lending rate + gov expense %GDP (progressive for developed + big-government, flat otherwise); creative-mode extends the law LLM call's JSON schema so the Central Agent emits a `taxPolicy` alongside the law text. All malformed shapes coerce to flat 15/10/15 via a new `validateTaxPolicy` helper, so Plan 11-04's tax withholding hooks always receive a valid policy.**

## Performance

- **Duration:** 4 min (first commit 20:18:56Z → last commit 20:22:52Z)
- **Started:** 2026-04-13T20:18:38Z
- **Completed:** 2026-04-13T20:22:56Z
- **Tasks:** 2 (Task 1 validateTaxPolicy + bootstrap derivation; Task 2 LLM schema + parse)
- **Files modified:** 5 (4 production + 1 test file converted from Wave-0 scaffold)

## Accomplishments

- **`validateTaxPolicy` helper** in `server/src/mechanics/economyConfigUtils.ts` — always returns a valid `TaxPolicy`. Clamps each rate to `[0, 0.5]`, validates progressive brackets (non-empty + strictly increasing `upto`), coerces malformed inputs to flat 15/10/15. `DEFAULT_TAX_POLICY` constant exported as the universal fallback (matches `DEFAULT_ECONOMY_CONFIG.taxPolicy` shape).
- **Location bootstrap derivation** in `server/src/data/dataBootstrapPipeline.ts` — `profileToEconomyConfig` now derives `taxPolicy` from WB indicators per 11-RESEARCH.md §5:
  - `incomeSeed = clamp(lendingRate × 2, 0.08, 0.30)` scales top marginal rate with monetary tightness
  - `vatSeed = clamp(govExpense / 300, 0.05, 0.20)` scales consumption tax with size of state
  - `gdpPerCapita > 25000 AND govExpense > 30%` → 3-bracket progressive (500 / 2000 / 10000 wealth tiers)
  - otherwise → flat with the same rates
  - Result passed through `validateTaxPolicy` defensively; tracked as `source='api'`, `confidence='medium'` in paramSources
- **Creative-mode LLM schema extension** in `server/src/llm/prompts/central-agent.ts` — `buildLawMessages` JSON schema now includes `taxPolicy` alongside `law`. System prompt adds a `## Tax Policy (Phase 11 D-13)` section documenting flat vs progressive shapes, rate semantics per kind (income for WORK/AMM sell, vat for AMM buy, capitalGains for SELL_SHARES/bond/dividend/coupon), the [0, 0.5] clamp, and both flat + progressive JSON examples.
- **Creative-mode parsing** in `server/src/llm/centralAgent.ts` — `generateDesign` law step now parses `{ law, taxPolicy? }`, runs taxPolicy through `validateTaxPolicy`, and injects the validated result into `economyConfig` when persisting the creative-mode default config. Location-bootstrap sessions (which already carry a taxPolicy from `profileToEconomyConfig`) are untouched — the merge only fires when `existingConfig.economyConfig` is absent.
- **18 vitest assertions** (up from 5 `it.todo` placeholders in the Wave-0 scaffold): 10 `validateTaxPolicy` unit tests (flat passthrough, rate clamps, null/undefined, empty/non-increasing progressive brackets, valid progressive, bracket rate clamps), 3 `profileToEconomyConfig` derivation tests (progressive/flat threshold, source+confidence tracking), 5 prompt/parsing integration tests (schema mentions, kind/rates/brackets, flat/progressive examples, valid/missing/malformed LLM output). All green in 270ms.

## Task Commits

Each task committed atomically with TDD RED → GREEN:

1. **Task 1 RED** — `test(11-05): add failing tests for validateTaxPolicy + bootstrap taxPolicy derivation` — `2ae4d72`
2. **Task 1 GREEN** — `feat(11-05): add validateTaxPolicy + derive taxPolicy from WB indicators` — `0696d97`
3. **Task 2 RED** — `test(11-05): add failing tests for law prompt taxPolicy schema + parsing` — `1c57246`
4. **Task 2 GREEN** — `feat(11-05): extend law prompt with taxPolicy schema + parse into economyConfig` — `bb3722b`

**Plan metadata commit:** pending (this SUMMARY + STATE + ROADMAP update).

## Files Created/Modified

### Production

- `server/src/mechanics/economyConfigUtils.ts` — Added `validateTaxPolicy(input)` + `DEFAULT_TAX_POLICY` constant + private `clampRate` helper. No change to existing `getEconomyConfig` behavior.
- `server/src/data/dataBootstrapPipeline.ts` — Imported `TaxPolicy` and `validateTaxPolicy`. Added taxPolicy derivation block in `profileToEconomyConfig` between defaultLoanTerm and final config assembly. Added `taxPolicy` field to returned `config`, plus `confidence['taxPolicy'] = 'medium'` and `sources['taxPolicy'] = 'api'` tracking.
- `server/src/llm/prompts/central-agent.ts` — Extended `buildLawMessages` JSON schema block with `taxPolicy` field. Added ~45 lines documenting the Tax Policy section: rationale for flat vs progressive, rate semantics per kind, [0, 0.5] clamp rule, flat + progressive JSON examples. User-message text updated from "Generate the law JSON" to "Generate the law + taxPolicy JSON".
- `server/src/llm/centralAgent.ts` — Imported `TaxPolicy` type + `validateTaxPolicy`. Law-step `parseJSON` now types the response as `{ law: string; taxPolicy?: unknown }`. Extracted + validated taxPolicy stored in `llmTaxPolicy`. Creative-mode economyConfig construction (line 277) now includes `taxPolicy: llmTaxPolicy` in the spread.

### Tests

- `server/src/llm/__tests__/centralAgentTaxPolicy.test.ts` — Converted from 5 `it.todo` placeholders (Wave-0 scaffold) to 18 real passing assertions across 3 describe blocks: `validateTaxPolicy` (10 unit tests), `profileToEconomyConfig taxPolicy derivation` (3 integration tests with minimal LocationProfile fixture), `Central Agent design-generation prompt extension` (5 prompt + parsing integration tests).

## Decisions Made

- **Extended `buildLawMessages` rather than `buildOverviewMessages`** — overview already returns `economicModel` at a narrative level; the law step is where normative/enforceable rules land, and its JSON schema had natural room for a `taxPolicy` extension. Keeps the 3-step design flow (Overview → Law → Agents) unchanged.
- **Zero new LLM calls** — taxPolicy emitted as part of the existing law step's JSON response. Token cost is the ~400-char schema + rule block in the system prompt; the response-side cost is negligible (flat `taxPolicy` ≈ 80 tokens).
- **`validateTaxPolicy` is total and idempotent** — any input shape (valid TaxPolicy, partial object, null, undefined, wrong kind, malformed brackets, non-numeric rates) maps to a valid TaxPolicy. Downstream callers (Plan 11-04's `computeWithholding`, future runtime config updates) never have to branch on validity.
- **DEFAULT_TAX_POLICY vs flat-with-validated-rates split** — two distinct coercion targets for malformed progressive:
  - Empty brackets → `DEFAULT_TAX_POLICY` (drop LLM rates entirely; assume shape corruption implies rate corruption)
  - Non-increasing upto with otherwise-plausible shape → `{ kind: 'flat', rates }` (retain validated rates; assume only the brackets array was corrupted)
  Distinction is tested explicitly; lets the validator degrade gracefully without discarding signal.
- **Bootstrap derivation anchored to 11-RESEARCH.md §5** — progressive threshold is `gdpPerCapita > 25000 AND govExpensePctGdp > 30` (AND, not OR). This excludes high-GDP low-tax countries (Taiwan, S Korea at ~15% gov expense) and low-GDP high-tax outliers (which would have insufficient wealth spread for meaningful brackets). Rates scale with lending rate (monetary tightness proxy) and gov expense (size-of-state proxy).
- **Progressive bracket seed 500 / 2000 / 10000** — calibrated to bootstrap `baseFiat ≈ 10000` scale with 50-500 initial wealth range per agent. Over a 10-20 iteration run, enterprise owners accumulate into thousands; top bracket catches the top earners without capping median income.
- **Creative-mode merge only fires for absent config** — `llmTaxPolicy` is injected ONLY when `existingConfig.economyConfig` is missing (no prior bootstrap). Location-bootstrap sessions already carry a `taxPolicy` from `profileToEconomyConfig` — the creative-mode path doesn't overwrite it.

## Deviations from Plan

### Minor Scope Adjustments

- **Task 2 action suggested targeting "whichever module currently owns design generation — per Phase 9 split, it's `prompts/central-agent.ts` or `prompts/bootstrap.ts`"** — confirmed via `ls server/src/llm/prompts/` that `prompts/` exists with `central-agent.ts` and no `bootstrap.ts`. Edit targeted `prompts/central-agent.ts` → `buildLawMessages` per plan. WARNING 10 pre-edit check honored.
- **Task 2 action example showed taxPolicy emission alongside `budgetAllocation`** — the creative-mode design path does NOT currently emit `budgetAllocation` via LLM (it uses `DEFAULT_BUDGET_ALLOCATION` at the persistence step). Only `taxPolicy` was wired; plan's mention of budgetAllocation was aspirational and out-of-scope for D-13 (budgetAllocation is addressed elsewhere in Phase 11). No deviation in outcome — the plan objective "prompt the Central Agent to emit taxPolicy alongside law + budgetAllocation" is satisfied by the law-step emission; budgetAllocation remains from defaults.
- **Task 1 behavior bullet `validateTaxPolicy({ kind: 'progressive', rates, brackets: [] })` coerces to "flat 15/10/15"** — implementation coerces empty brackets to DEFAULT_TAX_POLICY (flat 15/10/15 with DROPPED rates), matching the plan literal text. Non-increasing-upto case coerces to `{ kind: 'flat', rates }` (retaining validated rates) per the split rationale above. Both cases tested distinctly; test names disambiguate. This is an interpretation of ambiguous plan wording, not a behavior deviation.

### Auto-fixed Issues

None — plan executed exactly as written. No Rule 1/2/3 auto-fixes triggered.

## Issues Encountered

- **Pre-existing test failures unchanged.** `npm run test -w server` shows 5 failures in 2 files (`economyConfig.test.ts × 4 default-rate mismatches` + `banking.test.ts × 1 canIssueLoan edge case`). Identical to the baseline documented in Plan 11-01's `deferred-items.md` and confirmed unchanged in Plan 11-04. Zero new failures from 11-05: 18 taxPolicy tests all green; 414 tests passing total (same count as post-11-04 baseline + 10 new assertions from this plan).
- **Pre-existing TypeScript errors unchanged.** `tsc --noEmit -p server/tsconfig.json` reports the same 3 errors (`edgeCases.test.ts × 2 satiety` + `reflectionRunner.ts × 1 possibly undefined`). Diff vs base: flat.
- **No auth gates encountered.** Plan executed fully autonomously.
- **No architectural decisions required.** Rule 4 never triggered.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

**Plans 11-06 through 11-10 unblocked.** The design-stage taxPolicy selection is stable and verifiable:

- **Plan 11-06 (governance toggle / law amendment)** — shares `centralAgent.ts` and `shared/src/types.ts` with this plan. Conflict-free: 11-05 only added to `lawData` parsing + creative-mode config merge; 11-06's law-amendment flow extends `refine` and governance ballot handling. If merged together on same file sections, preserve both additions.
- **Plan 11-07+ (SFC subsystem drift telemetry / structural pressure tuning)** — no direct intersection with taxPolicy. All downstream plans can assume `getEconomyConfig(session.config).taxPolicy` returns a valid TaxPolicy for every Phase-11 session (bootstrap or creative).
- **Plan 11-04 (landed)** — `computeWithholding` hooks now receive scenario-calibrated tax policy instead of the baseline 15/10/15 default. Empirical validation ready: a US bootstrap session should show `session.config.economyConfig.taxPolicy` as progressive with ~12% top income rate (US lending ≈ 6%, gov expense ≈ 37%), not the flat baseline.

**Smoke-verification ready:** bootstrap a fresh US session → DB `session.config.economyConfig.taxPolicy` should be progressive (GDP ≈ $70k > 25k, gov expense ≈ 37% > 30%) with 3 brackets. Bootstrap a creative-mode "simple frontier village" session → LLM most likely emits flat; malformed responses fall back to flat 15/10/15 via validateTaxPolicy.

**Blockers:** None.

## Known Stubs

None. All taxPolicy flows wire real values:
- `validateTaxPolicy` is a pure function with no hidden state; consumes real input, produces real output.
- `profileToEconomyConfig` reads real WB-scraped DataPoints (lending rate, gov expense %GDP, GDP per capita); emits real TaxPolicy into the returned `config`.
- `buildLawMessages` prompt is served to the real LLM gateway; response parsed through real `parseJSON` + real `validateTaxPolicy`.
- Creative-mode `economyConfig.taxPolicy` is written to SQLite via the existing `db.update(sessions).set({ config: ... })` pathway — no mocks, no placeholders.

## Self-Check: PASSED

- `server/src/mechanics/economyConfigUtils.ts` contains `export function validateTaxPolicy` — verified via `grep -c` returning 1.
- `DEFAULT_TAX_POLICY` appears 6 times (definition + 5 fallback returns) — verified.
- `server/src/data/dataBootstrapPipeline.ts` contains `taxPolicy` 8 times (import, derivation, validation, config assignment, confidence/sources tracking) — verified.
- `kind: 'progressive'` appears 1 time in bootstrap (3-bracket path) — verified.
- `gdpPC > 25000` gate matches — verified.
- `server/src/llm/prompts/central-agent.ts` mentions `taxPolicy` 4 times — verified.
- `server/src/llm/centralAgent.ts` contains `validateTaxPolicy` 4 times (import + invocation + 2 comments) — verified.
- Prompt contains `"kind": "flat"` (3 occurrences: schema, example, rule block) — verified.
- Prompt contains `"kind": "progressive"` (2 occurrences: schema, example) — verified.
- Commits `2ae4d72`, `0696d97`, `1c57246`, `bb3722b` all present in `git log --oneline -5` — verified.
- `npx vitest run server/src/llm/__tests__/centralAgentTaxPolicy.test.ts` — 18 passed, 0 failed — verified.
- `tsc --noEmit -p server/tsconfig.json` diff vs base: flat (same 3 pre-existing errors).
- `npm run test -w server` shows 414 passed / 5 failed (pre-existing) / 33 todo — +10 passed vs 11-04 baseline; 0 new failures.

---
*Phase: 11-simulation-realism-organic-stress-pressure-fiscal-balance-and-sfc-leak-closure*
*Completed: 2026-04-13*
