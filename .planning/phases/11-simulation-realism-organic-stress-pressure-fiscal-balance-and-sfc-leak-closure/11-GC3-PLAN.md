---
phase: 11-simulation-realism-organic-stress-pressure-fiscal-balance-and-sfc-leak-closure
plan: GC3
type: execute
wave: 1
depends_on: []
files_modified:
  - server/src/data/dataBootstrapPipeline.ts
  - server/src/routes/bootstrap.ts
  - server/src/llm/__tests__/centralAgentTaxPolicy.test.ts
  - server/src/__tests__/bootstrapTaxPolicyFixtures.test.ts
autonomous: true
gap_closure: true
requirements: [D-13]
decisions_addressed: [D-13]
must_haves:
  truths:
    - "A US bootstrap session produces a PROGRESSIVE tax policy (not flat), with rates derived from WB indicators"
    - "A Germany bootstrap produces progressive; a Nigeria bootstrap stays flat"
    - "If session.config.locationProfile is set, session.config.sources.taxPolicy MUST equal 'api' (bootstrap-derived) — enforced at bootstrap commit"
  artifacts:
    - path: "server/src/data/dataBootstrapPipeline.ts"
      provides: "Recalibrated heuristic matching WB indicator scale (threshold drop from 30 to 18, or composite)"
      contains: "govExpensePct > 18"
    - path: "server/src/routes/bootstrap.ts"
      provides: "Invariant assertion: locationProfile present → sources.taxPolicy === 'api'"
      contains: "sources.taxPolicy"
    - path: "server/src/__tests__/bootstrapTaxPolicyFixtures.test.ts"
      provides: "Country-fixture suite: US/DE/UK/JP/IN/BR/NG with expected flat vs progressive"
  key_links:
    - from: "server/src/data/dataBootstrapPipeline.ts:222 (heuristic gate)"
      to: "WB-indicator-scale threshold (18 or composite)"
      via: "dropped from 30 to 18 — calibrated against GC.XPN.TOTL.GD.ZS scale"
      pattern: "govExpensePct > 18|govDebtPctGdp > 60"
    - from: "server/src/routes/bootstrap.ts bootstrap commit path"
      to: "paramSources.taxPolicy"
      via: "assertion that sources.taxPolicy === 'api' when locationProfile is set"
      pattern: "sources.*taxPolicy.*api"
---

<objective>
Close G3 tax-heuristic miscalibration so bootstrap-derived taxPolicy matches real-world expectations. Per forensics-G3:

**Issue A (primary):** `dataBootstrapPipeline.ts:222` uses `govExpensePctGdp > 30` as the progressive threshold, but the World Bank `GC.XPN.TOTL.GD.ZS` indicator measures central-government expense only (US=24.9%, DE=26%). The original 30% threshold was calibrated against OECD general-government scale (~37% for US). All modern welfare states fail the 30% gate on the WB indicator.

**Issue B (secondary):** Observed rates `8.7/5/8.7` in the user's US session cannot be produced by the bootstrap derivation (which yields `0.08/0.083/0.08` for US data, or the 5% VAT floor clamp only when `govExpense < 15`). The session was creative-mode, where the LLM free-chose flat. To catch future cases where a location-mode session silently ends up without bootstrap-derived taxPolicy, add a session-level invariant: if `session.config.locationProfile` is set, `session.config.sources.taxPolicy` MUST equal `'api'`.

Fix per forensics-G3 §4a: drop `govExpensePctGdp` threshold to `> 18` OR use composite `govExpensePct > 18 OR taxRevenuePctGdp > 15`. Prefer the composite. Backtest against fixtures for US/DE/UK/JP/IN/BR/NG.

Purpose: Without G3 closure, G4 (editable TaxPolicy) would ship on top of a systematically-wrong default — policymakers would routinely correct the broken heuristic, creating false "user preference" signals. Fix derivation first so the editor is genuine correction, not routine repair.

Output: Heuristic recalibration + invariant assertion + country-fixture test suite (7 fixtures minimum).
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/STATE.md
@.planning/phases/11-simulation-realism-organic-stress-pressure-fiscal-balance-and-sfc-leak-closure/11-CONTEXT.md
@.planning/phases/11-simulation-realism-organic-stress-pressure-fiscal-balance-and-sfc-leak-closure/forensics-G3-taxpolicy-flat-fallback.md
@.planning/phases/11-simulation-realism-organic-stress-pressure-fiscal-balance-and-sfc-leak-closure/11-05-SUMMARY.md

<interfaces>
<!-- Extracted from codebase. Executor uses these directly — no exploration needed. -->

From server/src/data/dataBootstrapPipeline.ts:209-242 (current heuristic):
```typescript
const lendingRatePct = profile.economics.lendingInterestRate?.value ?? 8;
const govExpensePct = profile.fiscal.govExpensePctGdp?.value ?? 0;
const incomeSeed = Math.max(0.08, Math.min(0.30, (lendingRatePct / 100) * 2));
const vatSeed = Math.max(0.05, Math.min(0.20, govExpensePct / 300));

let taxPolicyDerived: TaxPolicy;
if (gdpPC > 25000 && govExpensePct > 30) {  // ← broken for WB-scale indicators
  // Progressive 3-bracket ...
} else {
  taxPolicyDerived = { kind: 'flat', rates: { income: incomeSeed, vat: vatSeed, capitalGains: incomeSeed } };
}
const taxPolicy = validateTaxPolicy(taxPolicyDerived);
confidence['taxPolicy'] = 'medium';
```

From server/src/data/dataBootstrapPipeline.ts:278-279 (current source tagging):
```typescript
sources['taxPolicy'] = 'api';
```
(Confirms bootstrap path tags 'api'. GC3 must assert this is preserved.)

From forensics-G3 §1 WB cached values (validated against ~/.policylab/cache/):
| Country | gdpPerCapita | govExpensePct | taxRevenuePct | govDebtPct | Expected |
|---------|--------------|---------------|---------------|------------|----------|
| US | 84534 | 24.9 | 10.97 | 117.97 | progressive |
| DE (Germany) | ~52000 | ~26 | ~11 | ~66 | progressive |
| UK | ~48000 | ~39 | ~24 | ~100 | progressive |
| JP (Japan) | ~34000 | ~21 | ~12 | ~260 | progressive |
| IN (India) | ~2500 | ~15 | ~12 | ~83 | flat |
| BR (Brazil) | ~9000 | ~22 | ~13 | ~86 | flat |
| NG (Nigeria) | ~2100 | ~8 | ~7 | ~46 | flat |

Recommended gate (composite): `gdpPC > 25000 && (govExpensePct > 18 || taxRevenuePctGdp > 15 || govDebtPctGdp > 60)` — catches all 4 welfare states, excludes all 3 emerging markets.

From server/src/routes/bootstrap.ts:70 (bootstrap entrypoint) and ~520-540 region (where finalConfig is assembled and persisted):
```typescript
// bootstrap persists economyConfig + bootstrapSources per paramSources
```

From shared types (already in @policylab/shared):
- `LocationProfile` with `fiscal.taxRevenuePctGdp` and `fiscal.govDebtPctGdp` DataPoints
- `EconomyConfig.taxPolicy?: TaxPolicy`
- DataSource = `'api' | 'web' | 'llm' | 'user'` (check actual type in shared/src/types.ts; if 'user' is missing, GC4 adds it)

From server/src/llm/__tests__/centralAgentTaxPolicy.test.ts: existing test at line ~117 uses synthetic `gdpPerCapita=30000, govExpensePctGdp=35` — GC3 must update this to use real US WB values AND add fixtures for DE/UK/JP/IN/BR/NG.
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: RED — 7-country bootstrap fixture suite + locationProfile invariant test</name>
  <files>server/src/__tests__/bootstrapTaxPolicyFixtures.test.ts</files>
  <read_first>
    - server/src/__tests__/bootstrapTaxPolicyFixtures.test.ts (new — will not exist)
    - server/src/llm/__tests__/centralAgentTaxPolicy.test.ts (read full — steal existing LocationProfile fixture format)
    - server/src/data/dataBootstrapPipeline.ts (read lines 209-280 — current heuristic + sources tagging)
    - shared/src/types.ts (grep for `LocationProfile` + `DataPoint` + `TaxPolicy` — confirm fixture shape)
    - ~/.policylab/cache/US.json (verify cache format; use actual shape for fixture construction)
    - .planning/phases/11-simulation-realism-organic-stress-pressure-fiscal-balance-and-sfc-leak-closure/forensics-G3-taxpolicy-flat-fallback.md §4a (fix direction + country table)
  </read_first>
  <behavior>
    Test 1: "profileToEconomyConfig: US → progressive taxPolicy"
      - Fixture: minimal LocationProfile with `economics.gdpPerCapita=84534`, `economics.lendingInterestRate=3.25`, `fiscal.govExpensePctGdp=24.9`, `fiscal.taxRevenuePctGdp=10.97`, `fiscal.govDebtPctGdp=117.97`
      - Assert: returned `config.taxPolicy.kind === 'progressive'`
      - Assert: returned `sources.taxPolicy === 'api'`
      - Expected to FAIL today (current heuristic: 24.9 ≤ 30 → flat)
    Test 2: "profileToEconomyConfig: Germany → progressive"
      - Fixture: gdpPerCapita=52000, lendingInterestRate=4.0, govExpensePctGdp=26, taxRevenuePctGdp=11, govDebtPctGdp=66
      - Assert: `progressive`
      - FAIL today (26 ≤ 30 → flat)
    Test 3: "profileToEconomyConfig: UK → progressive"
      - Fixture: gdpPerCapita=48000, lendingInterestRate=5.25, govExpensePctGdp=39, taxRevenuePctGdp=24, govDebtPctGdp=100
      - Assert: `progressive`
      - Passes today AND after (39 > 18 and > 30) — sanity regression guard
    Test 4: "profileToEconomyConfig: Japan → progressive"
      - Fixture: gdpPerCapita=34000, lendingInterestRate=1.5, govExpensePctGdp=21, taxRevenuePctGdp=12, govDebtPctGdp=260
      - Assert: `progressive`
      - FAIL today (21 ≤ 30 → flat)
    Test 5: "profileToEconomyConfig: India → flat"
      - Fixture: gdpPerCapita=2500, lendingInterestRate=9.0, govExpensePctGdp=15, taxRevenuePctGdp=12, govDebtPctGdp=83
      - Assert: `flat` (low GDP excludes from progressive)
      - Passes today AND after (2500 < 25000) — regression guard
    Test 6: "profileToEconomyConfig: Brazil → flat"
      - Fixture: gdpPerCapita=9000, lendingInterestRate=10, govExpensePctGdp=22, taxRevenuePctGdp=13, govDebtPctGdp=86
      - Assert: `flat`
      - Passes today AND after — regression guard
    Test 7: "profileToEconomyConfig: Nigeria → flat"
      - Fixture: gdpPerCapita=2100, lendingInterestRate=12, govExpensePctGdp=8, taxRevenuePctGdp=7, govDebtPctGdp=46
      - Assert: `flat`
      - Passes today AND after — regression guard
    Test 8: "invariant: locationProfile set → sources.taxPolicy === 'api'"
      - Simulate the bootstrap path result: feed a US-like profile through profileToEconomyConfig
      - Assert: the returned `paramSources` (or whatever the actual export is) has `.taxPolicy === 'api'`, not `'llm'` or `'user'`
      - This test PASSES today and after — it's a regression guard protecting the bootstrap-source tagging invariant that forensics §4b called for.
  </behavior>
  <action>
    Create `server/src/__tests__/bootstrapTaxPolicyFixtures.test.ts`:
    - Import `profileToEconomyConfig` from `../data/dataBootstrapPipeline.js`.
    - Import `LocationProfile`, `DataPoint` types from `@policylab/shared`.
    - Fixture builder helper: `buildProfile(overrides: Partial<{ gdpPerCapita, lendingInterestRate, govExpensePctGdp, taxRevenuePctGdp, govDebtPctGdp, inflationRate, gdpGrowth, stockMarketCap, depositInterestRate, militaryExpPctGdp, healthExpPctGdp, educationExpPctGdp }>): LocationProfile` that fills in plausible defaults for non-specified fields (cross-reference cache/US.json for realistic padding).
    - All 7 country fixtures + the invariant test.
    - At minimum 7 test cases grouped under `describe('profileToEconomyConfig country-fixture suite')`.

    **Commit message:** `test(11-GC3): add 7-country bootstrap taxPolicy fixtures + sources invariant`

    **Run after writing:** `npx vitest run server/src/__tests__/bootstrapTaxPolicyFixtures.test.ts`
    Expected: tests 1, 2, 4 FAIL (RED) — US, Germany, Japan should be progressive but heuristic says flat. Tests 3, 5, 6, 7, 8 pass.
  </action>
  <verify>
    <automated>npx vitest run server/src/__tests__/bootstrapTaxPolicyFixtures.test.ts 2>&1 | grep -E "FAIL|failed"</automated>
  </verify>
  <acceptance_criteria>
    - grep `US → progressive` in server/src/__tests__/bootstrapTaxPolicyFixtures.test.ts returns 1 match
    - grep `Germany → progressive` in server/src/__tests__/bootstrapTaxPolicyFixtures.test.ts returns 1 match
    - grep `Japan → progressive` in server/src/__tests__/bootstrapTaxPolicyFixtures.test.ts returns 1 match
    - grep `sources.taxPolicy === 'api'` in server/src/__tests__/bootstrapTaxPolicyFixtures.test.ts returns 1+ match
    - `npx vitest run server/src/__tests__/bootstrapTaxPolicyFixtures.test.ts` output contains "3 failed" OR at least 3 individual test failures (US/DE/JP)
    - git log -1 --format=%s contains `test(11-GC3)`
  </acceptance_criteria>
  <done>Test file committed RED: 7 country fixtures + 1 invariant test = 8 tests total; at least 3 fail (US, DE, JP) because the 30% heuristic is miscalibrated.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: GREEN — composite heuristic recalibration + locationProfile → sources.taxPolicy='api' invariant</name>
  <files>server/src/data/dataBootstrapPipeline.ts, server/src/routes/bootstrap.ts, server/src/llm/__tests__/centralAgentTaxPolicy.test.ts, server/src/__tests__/bootstrapTaxPolicyFixtures.test.ts</files>
  <read_first>
    - server/src/data/dataBootstrapPipeline.ts (read full — understand the profileToEconomyConfig return shape and heuristic block at lines 209-242)
    - server/src/routes/bootstrap.ts (read lines 70-130 and the region where finalConfig is assembled — typically near lines 500-540; find the bootstrap commit site where locationProfile + economyConfig + paramSources are persisted together)
    - server/src/llm/__tests__/centralAgentTaxPolicy.test.ts (read full — update any synthetic test fixtures that used the old 30% threshold)
    - server/src/__tests__/bootstrapTaxPolicyFixtures.test.ts (just written in Task 1)
    - .planning/phases/11-simulation-realism-organic-stress-pressure-fiscal-balance-and-sfc-leak-closure/forensics-G3-taxpolicy-flat-fallback.md §4 (fix direction for 4a + 4b)
  </read_first>
  <behavior>
    After this task:
    - bootstrapTaxPolicyFixtures.test.ts: all 8 tests GREEN (US/DE/UK/JP progressive; IN/BR/NG flat; invariant test PASS).
    - centralAgentTaxPolicy.test.ts: existing tests still GREEN after any fixture updates (synthetic gdpPerCapita=30000, govExpensePctGdp=35 still progressive under new rules).
    - Full suite: no regressions.
    - At the server route layer (bootstrap.ts), a runtime assertion throws early if a bootstrapped session commits with `locationProfile` set but `sources.taxPolicy !== 'api'`.
  </behavior>
  <action>
    Two patches:

    **Patch A — Recalibrate heuristic (dataBootstrapPipeline.ts:209-242):**

    The existing block at lines 221-238 reads (CURRENT — verbatim from codebase):
    ```ts
    let taxPolicyDerived: TaxPolicy;
    if (gdpPC > 25000 && govExpensePct > 30) {
      // Progressive — 3 brackets tiered on wealth percentiles (bootstrap baseFiat ≈ 10k scale)
      taxPolicyDerived = {
        kind: 'progressive',
        rates: { income: incomeSeed, vat: vatSeed, capitalGains: incomeSeed },
        brackets: [
          { upto: 500,   rate: Math.max(0.05, incomeSeed / 2) },      // low bracket
          { upto: 2000,  rate: Math.max(0.10, incomeSeed * 0.8) },    // mid bracket
          { upto: 10000, rate: incomeSeed },                           // high bracket (top marginal)
        ],
      };
    } else {
      taxPolicyDerived = {
        kind: 'flat',
        rates: { income: incomeSeed, vat: vatSeed, capitalGains: incomeSeed },
      };
    }
    ```

    Replace with (NEW — only gate changes; progressive body and flat body byte-preserved):
    ```ts
    // Phase 11 GC3 / forensics-G3 §4a: WB-scale heuristic recalibration.
    // WB `GC.XPN.TOTL.GD.ZS` measures central-gov expense only (US=24.9%, DE=26%),
    // not OECD general-gov scale (~37% US). 30% threshold missed all modern welfare states.
    // Composite signal: high GDP + EITHER sizable central-gov expense OR meaningful tax
    // revenue share OR substantial public debt — catches US/DE/UK/JP; excludes IN/BR/NG.
    const taxRevenuePct = profile.fiscal.taxRevenuePctGdp?.value ?? 0;
    const govDebtPct = profile.fiscal.govDebtPctGdp?.value ?? 0;
    const isWelfareState = govExpensePct > 18 || taxRevenuePct > 15 || govDebtPct > 60;
    let taxPolicyDerived: TaxPolicy;
    if (gdpPC > 25000 && isWelfareState) {
      // Progressive — 3 brackets tiered on wealth percentiles (bootstrap baseFiat ≈ 10k scale)
      taxPolicyDerived = {
        kind: 'progressive',
        rates: { income: incomeSeed, vat: vatSeed, capitalGains: incomeSeed },
        brackets: [
          { upto: 500,   rate: Math.max(0.05, incomeSeed / 2) },      // low bracket
          { upto: 2000,  rate: Math.max(0.10, incomeSeed * 0.8) },    // mid bracket
          { upto: 10000, rate: incomeSeed },                           // high bracket (top marginal)
        ],
      };
    } else {
      taxPolicyDerived = {
        kind: 'flat',
        rates: { income: incomeSeed, vat: vatSeed, capitalGains: incomeSeed },
      };
    }
    ```

    **Byte-preservation invariant (WARNING 4 fix):** The progressive body (lines 224-232 in the NEW block) and flat body (lines 234-237) are identical byte-for-byte to the CURRENT block. Only the gate condition on line 222 and the three new variable extractions (lines inserted before `let taxPolicyDerived`) change. Do NOT reformat, re-indent, or reorder the progressive brackets. Verify with `git diff server/src/data/dataBootstrapPipeline.ts` — the hunk should show exactly 1 line removed (old gate) + 4 lines added (3 variable extractions + new gate) relative to the original; progressive/flat body lines should be untouched.

    **Patch B — bootstrap.ts invariant assertion:**
    Locate the bootstrap commit path in `server/src/routes/bootstrap.ts` (near the `economyConfig: finalConfig` persistence, typically lines 500-540). After finalConfig + paramSources are assembled and BEFORE the DB write, add:
    ```ts
    // Phase 11 GC3 / forensics-G3 §4b: when bootstrap runs (locationProfile set),
    // taxPolicy MUST be bootstrap-derived. Catches silent regressions where a
    // downstream mutation (scenario LLM override, creative-mode collision) bypasses
    // the derivation.
    if (locationProfile && sources.taxPolicy !== 'api') {
      throw new Error(
        `Bootstrap invariant violation: locationProfile is set but sources.taxPolicy='${sources.taxPolicy}' (expected 'api'). ` +
        `Check profileToEconomyConfig output and scenario-override guard (forensics-G3 §4c).`
      );
    }
    ```
    If the exact variable names differ (e.g., `paramSources` vs `sources`, `session.config.locationProfile` vs a local `profile` ref), adapt; the invariant is the contract, not the variable names.

    **Patch C — update centralAgentTaxPolicy.test.ts synthetic fixtures:**
    Review test cases at lines ~117-140 that use synthetic `gdpPerCapita=30000, govExpensePctGdp=35` to ensure they still exercise the intended path under the new heuristic. `govExpensePctGdp=35 > 18` still fires progressive; sanity-check one of these is still meaningful, and if any test relies on the precise 30% threshold (not the 18% one), update the fixture to clearly exercise either above-18 OR below-18 for explicit coverage. Add one ADDITIONAL test case explicitly verifying the new `taxRevenuePct > 15` path: `{ gdpPerCapita: 40000, govExpensePctGdp: 10, taxRevenuePctGdp: 20 }` should still return progressive under the composite gate.

    **Commit messages (atomic):**
    1. `fix(11-GC3): recalibrate bootstrap taxPolicy heuristic for WB indicator scale`
    2. `fix(11-GC3): assert locationProfile sessions commit with sources.taxPolicy='api'`

    **Run after each patch:** `npx vitest run server/src/__tests__/bootstrapTaxPolicyFixtures.test.ts server/src/llm/__tests__/centralAgentTaxPolicy.test.ts`
  </action>
  <verify>
    <automated>npx vitest run server/src/__tests__/bootstrapTaxPolicyFixtures.test.ts server/src/llm/__tests__/centralAgentTaxPolicy.test.ts && npm run test -w server</automated>
  </verify>
  <acceptance_criteria>
    - grep `govExpensePct > 18` in server/src/data/dataBootstrapPipeline.ts returns 1 match
    - grep `taxRevenuePct > 15` in server/src/data/dataBootstrapPipeline.ts returns 1 match
    - grep `govDebtPct > 60` in server/src/data/dataBootstrapPipeline.ts returns 1 match
    - grep `govExpensePct > 30` in server/src/data/dataBootstrapPipeline.ts returns 0 matches (old threshold removed)
    - **WARNING 4 byte-preservation (progressive body untouched):** grep exact-literal strings from the original progressive brackets — each should still return 1 match:
      - `grep "upto: 500,   rate: Math.max(0.05, incomeSeed / 2)"`: 1 match (low bracket byte-preserved)
      - `grep "upto: 2000,  rate: Math.max(0.10, incomeSeed \* 0.8)"`: 1 match (mid bracket byte-preserved)
      - `grep "upto: 10000, rate: incomeSeed"`: 1 match (high bracket byte-preserved)
      - `git diff server/src/data/dataBootstrapPipeline.ts` hunk size: ≤ 10 lines changed in this block (gate replacement only)
    - grep `Bootstrap invariant violation` in server/src/routes/bootstrap.ts returns 1 match
    - `npx vitest run server/src/__tests__/bootstrapTaxPolicyFixtures.test.ts` shows 8 passed, 0 failed
    - `npx vitest run server/src/llm/__tests__/centralAgentTaxPolicy.test.ts` shows all passing (18+ tests; no regressions from Plan 11-05)
    - `npm run test -w server` ≥ 501 passed (485 baseline + 8 GC3 fixtures + 8 GC1 + 3 GC2 = 504 total new; may be higher if test count differs), ≤ 5 failed (pre-existing only)
    - git log -2 --format=%s contains two `fix(11-GC3):` commits
    - `tsc --noEmit -p server/tsconfig.json` diff vs base: flat
  </acceptance_criteria>
  <done>Heuristic composite gate applied (1-line gate change; progressive/flat body bytes preserved per WARNING-4 invariant); US/DE/JP now derive progressive; invariant assertion throws on silent fallback; full test suite green. D-13 is now co-owned by 11-05 (original prompt schema + validator) and 11-GC3 (heuristic recalibration + locationProfile invariant) — GC5 Task 3 Step 4 updates Decisions Coverage to reflect this.</done>
</task>

</tasks>

<verification>
- Country-fixture tests: US/DE/UK/JP → progressive; IN/BR/NG → flat; 8/8 tests passing
- Invariant assertion at bootstrap.ts fires ONLY when locationProfile is set AND sources.taxPolicy !== 'api'
- Existing centralAgentTaxPolicy.test.ts suite still green (no regressions)
- Full suite: ≥ 501 tests passed
</verification>

<success_criteria>
- A fresh US bootstrap via `POST /api/sessions/:id/bootstrap` commits `session.config.economyConfig.taxPolicy.kind === 'progressive'` (not flat).
- A fresh Nigeria bootstrap commits `flat` (regression guard for the emerging-market path).
- Bootstrap route throws early with a descriptive error if any downstream mutation sets `sources.taxPolicy` to something other than `'api'` while `locationProfile` is set.
- 11-GC4 (editable taxPolicy) can proceed knowing the default is correct for ~80% of developed-world locations.
</success_criteria>

<output>
After completion, create `.planning/phases/11-simulation-realism-organic-stress-pressure-fiscal-balance-and-sfc-leak-closure/11-GC3-SUMMARY.md` with:
- Commits list (expected: 1 test commit + 2 fix commits)
- Country-fixture coverage matrix (which fixtures flipped from flat → progressive)
- Confirmation the invariant assertion is reachable (write one unit test that proves throw behavior)
- Full suite test count after GC3
- Hand-off note: 11-GC4 editor plan can now ship on top of a correct default
</output>
