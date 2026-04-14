---
phase: 11-simulation-realism-organic-stress-pressure-fiscal-balance-and-sfc-leak-closure
plan: GC5
type: execute
wave: 3
depends_on: [GC1, GC2, GC3, GC4]
files_modified:
  - .planning/phases/11-simulation-realism-organic-stress-pressure-fiscal-balance-and-sfc-leak-closure/11-VALIDATION.md
  - .planning/phases/11-simulation-realism-organic-stress-pressure-fiscal-balance-and-sfc-leak-closure/11-GC5-VERIFICATION.md
autonomous: false
gap_closure: true
requirements: [D-20, D-21, D-22, D-13, GC-01, GC-02]
decisions_addressed: [D-20, D-21, D-22, D-13, GC-01, GC-02]
must_haves:
  truths:
    - "A US bootstrap 5-iteration run completes end-to-end with no context-size 400 errors"
    - "Every iteration shows |sfcDrift| ≤ 0.1; no 🚨 CRITICAL drift lines in the console"
    - "[TAX] appendTrace lines appear in the physics trace log (income + VAT + amm_sell events present)"
    - "The bootstrap-derived taxPolicy is 'progressive' for US; the TaxPolicyEditor shows 'Estimate' badge"
    - "TaxPolicyEditor is editable before start, disabled after; server rejects malformed edits"
  artifacts:
    - path: ".planning/phases/11-simulation-realism-organic-stress-pressure-fiscal-balance-and-sfc-leak-closure/11-GC5-VERIFICATION.md"
      provides: "Consolidated gap-closure verification report with iteration-by-iteration drift table and smoke-test transcript"
  key_links:
    - from: "Full server test suite (npm run test -w server)"
      to: "All Phase-11 + all gap-closure tests green"
      via: "no new failures vs pre-existing 5 baseline"
      pattern: "test.*passed.*failed"
    - from: "Live LLM-driven US bootstrap smoke test"
      to: "Zero context-size errors + |sfcDrift| ≤ 0.1 on every iteration"
      via: "Full stack integration verification"
      pattern: "sfcDrift"
---

<objective>
Close the gap-closure cycle with a live smoke test that proves all four gaps (G1-G4) are fixed. The user's original baseline smoke test (US bootstrap, 30 agents, 5 iterations, 20k-window local model) produced:
- G1: −2655.17 fiat drift at iter 1
- G2: 400 Context size has been exceeded on groupResolution cluster calls
- G3: flat 8.7/5/8.7 taxPolicy (expected progressive)
- G4: read-only TaxPolicyReadout (no editability)

After 11-GC1..GC4, re-run the same scenario and verify ALL four conditions flip to passing. Produce a consolidated `11-GC5-VERIFICATION.md` that documents:
- Per-iteration sfcDrift + sfcDriftBySubsystem table (iterations 1-5)
- Full test-suite count (baseline + all GC additions; no regressions)
- [TAX] trace presence verification (at least one income + one VAT + one amm_sell event per iteration)
- TaxPolicy snapshot from the post-bootstrap DB (confirm progressive for US)
- TaxPolicyEditor manual edit proof (snapshot before / after; source transitions 'api' → 'user')
- Server rejection proof (malformed PUT returns 400)

Purpose: This is the final quality gate for Phase 11. Without this plan, the gap-closure cycle produces fixes that are individually tested but never verified together against the scenario that originally failed.

Output: VERIFICATION.md with a checklist-style table + raw evidence excerpts; 11-VALIDATION.md updated to flip `smoke_test_result: failed` → `smoke_test_result: passed` (or `gap_closure_passed`).
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/STATE.md
@.planning/phases/11-simulation-realism-organic-stress-pressure-fiscal-balance-and-sfc-leak-closure/11-VALIDATION.md
@.planning/phases/11-simulation-realism-organic-stress-pressure-fiscal-balance-and-sfc-leak-closure/11-CONTEXT.md
@.planning/phases/11-simulation-realism-organic-stress-pressure-fiscal-balance-and-sfc-leak-closure/forensics-G1-physics-sfc-leak.md
@.planning/phases/11-simulation-realism-organic-stress-pressure-fiscal-balance-and-sfc-leak-closure/forensics-G2-context-bloat.md
@.planning/phases/11-simulation-realism-organic-stress-pressure-fiscal-balance-and-sfc-leak-closure/forensics-G3-taxpolicy-flat-fallback.md
@Results/session-united-states.json

<interfaces>
<!-- Existing verification baseline to compare against — from 11-VALIDATION.md frontmatter: -->
<!--   smoke_test_result: failed -->
<!--   smoke_test_findings: G1/G2/G3/G4 (all four) -->
<!-- After GC1-GC4 land, GC5 re-runs the same scenario and flips these findings to "closed". -->

<!-- US baseline expectations (Results/session-united-states.json) — pre-Phase-11 drift for compare: -->
<!-- wealth +49%, cortisol 10→2.3, M0 drift −5.9k over 5 iters — utopia-bias pattern. -->
<!-- Phase 11 success = non-monotonic stats; M0 constant within ±0.1/iter. -->
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Run full server suite + grep-verify all gap-closure acceptance criteria</name>
  <files>.planning/phases/11-simulation-realism-organic-stress-pressure-fiscal-balance-and-sfc-leak-closure/11-GC5-VERIFICATION.md</files>
  <read_first>
    - .planning/phases/11-simulation-realism-organic-stress-pressure-fiscal-balance-and-sfc-leak-closure/11-GC1-PLAN.md (acceptance_criteria section)
    - .planning/phases/11-simulation-realism-organic-stress-pressure-fiscal-balance-and-sfc-leak-closure/11-GC2-PLAN.md (acceptance_criteria section)
    - .planning/phases/11-simulation-realism-organic-stress-pressure-fiscal-balance-and-sfc-leak-closure/11-GC3-PLAN.md (acceptance_criteria section)
    - .planning/phases/11-simulation-realism-organic-stress-pressure-fiscal-balance-and-sfc-leak-closure/11-GC4-PLAN.md (acceptance_criteria section)
    - .planning/phases/11-simulation-realism-organic-stress-pressure-fiscal-balance-and-sfc-leak-closure/11-GC1-SUMMARY.md
    - .planning/phases/11-simulation-realism-organic-stress-pressure-fiscal-balance-and-sfc-leak-closure/11-GC2-SUMMARY.md
    - .planning/phases/11-simulation-realism-organic-stress-pressure-fiscal-balance-and-sfc-leak-closure/11-GC3-SUMMARY.md
    - .planning/phases/11-simulation-realism-organic-stress-pressure-fiscal-balance-and-sfc-leak-closure/11-GC4-SUMMARY.md
  </read_first>
  <action>
    Create `.planning/phases/11-simulation-realism-organic-stress-pressure-fiscal-balance-and-sfc-leak-closure/11-GC5-VERIFICATION.md` with this structure:

    ```markdown
    ---
    phase: 11
    slug: simulation-realism-organic-stress-pressure-fiscal-balance-and-sfc-leak-closure
    kind: gap-closure-verification
    status: pending-smoke-test
    created: {today}
    ---

    # Phase 11 Gap Closure — Verification Report

    ## 1. Test Suite Summary

    | Suite | Pre-GC Baseline | Post-GC5 | Status |
    |-------|-----------------|----------|--------|
    | Phase-11-owned tests | 485 passed | {actual} | ✅ / ❌ |
    | Pre-existing failures | 5 | {actual} | ✅ unchanged / ❌ regressed |
    | Full suite | 485/498 | {actual} | ✅ / ❌ |
    | TypeScript (`tsc --noEmit -p server/tsconfig.json`) | 3 errors (pre-existing) | {actual} | ✅ flat / ❌ new errors |

    ## 2. Automated Acceptance Criteria — Per-Plan

    ### 11-GC1 (physics SFC leak)
    - [ ] `grep physicsUnderflowPool server/src/orchestration/simulationRunner.ts`: 3+ matches
    - [ ] `grep '\[PHYSICS-UNDERFLOW\]' server/src/orchestration/simulationRunner.ts`: 1 match
    - [ ] `grep ORDER-BOOK-SKIP server/src/orchestration/simulationRunner.ts`: 2 matches
    - [ ] `grep "agent.type !== 'bank'" server/src/orchestration/helpers/sfcAudit.ts`: 1 match
    - [ ] `npx vitest run server/src/__tests__/sfcUnderflowLedger.test.ts server/src/__tests__/orderBookGhostGuards.test.ts server/src/__tests__/sfcAuditBankExclusion.test.ts`: 8 passed / 0 failed

    ### 11-GC2 (context bloat)
    - [ ] `grep "sessionLastPhysicsTraces.set(sessionId, '')" server/src/orchestration/simulationRunner.ts`: 1 match
    - [ ] `grep "physicsLog.slice(-8000)" server/src/llm/prompts/central-agent.ts`: 1 match
    - [ ] `npx vitest run server/src/__tests__/groupResolutionPromptSize.test.ts`: all passed

    ### 11-GC3 (taxPolicy heuristic)
    - [ ] `grep "govExpensePct > 18" server/src/data/dataBootstrapPipeline.ts`: 1 match
    - [ ] `grep "govExpensePct > 30" server/src/data/dataBootstrapPipeline.ts`: 0 matches
    - [ ] `grep "Bootstrap invariant violation" server/src/routes/bootstrap.ts`: 1 match
    - [ ] `npx vitest run server/src/__tests__/bootstrapTaxPolicyFixtures.test.ts`: 8 passed / 0 failed

    ### 11-GC4 (editable TaxPolicy)
    - [ ] `grep "export function TaxPolicyEditor" web/src/components/TaxPolicyEditor.tsx`: 1 match
    - [ ] `grep TaxPolicyReadout web/src/components/EconomyTab.tsx`: 0 matches (old component removed)
    - [ ] `grep "validateTaxPolicy(incoming.taxPolicy)" server/src/routes/sessions.ts`: 1 match
    - [ ] `grep "#[0-9a-fA-F]\{3,6\}" web/src/components/TaxPolicyEditor.tsx`: 0 matches (theme-token-only)
    - [ ] `npm run build -w web`: exits 0
    - [ ] `npx vitest run server/src/__tests__/putConfigTaxPolicyValidation.test.ts`: 5 passed / 0 failed

    ## 3. Live Smoke Test (populated in Task 2)
    _See Task 2 output._

    ## 4. Sign-Off

    - [ ] All static grep criteria ✅
    - [ ] Full test suite green (no new regressions)
    - [ ] Live smoke test: 5 iterations completed with |sfcDrift| ≤ 0.1 per iter
    - [ ] [TAX] trace sites fire in physics log
    - [ ] TaxPolicyEditor end-to-end manually verified
    ```

    **Execute all grep checks and full test suite NOW**. For each item on the checklist, run the command and record ✅/❌ in the VERIFICATION.md. If any criterion fails, STOP and report the failure — do not proceed to Task 2 until all static checks pass.

    **Commands to run:**
    ```bash
    # Full server suite
    npm run test -w server

    # TypeScript
    npx tsc --noEmit -p server/tsconfig.json

    # Web build
    npm run build -w web

    # All individual grep acceptance criteria from each GC plan (see list above)
    ```

    Record each result verbatim into the VERIFICATION.md checklist (exact pass/fail, actual test counts, any unexpected output).

    **Commit message:** `docs(11-GC5): static verification report — all GC plan acceptance criteria ✅`
  </action>
  <verify>
    <automated>npm run test -w server && npm run build -w web && npx tsc --noEmit -p server/tsconfig.json</automated>
  </verify>
  <acceptance_criteria>
    - File `.planning/phases/11-simulation-realism-organic-stress-pressure-fiscal-balance-and-sfc-leak-closure/11-GC5-VERIFICATION.md` exists
    - grep `## 2. Automated Acceptance Criteria` in 11-GC5-VERIFICATION.md returns 1 match
    - grep `✅` in 11-GC5-VERIFICATION.md returns ≥ 15 matches (all listed criteria checked)
    - `npm run test -w server` exits 0
    - `npm run build -w web` exits 0
    - git log -1 --format=%s contains `docs(11-GC5)`
  </acceptance_criteria>
  <done>All static/automated acceptance criteria from GC1-GC4 verified in a single report. Full test suite green. No web/tsc regressions.</done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <name>Task 2: Live smoke test — US bootstrap, 5 iterations, local 20k model, observe drift + taxPolicy + editor</name>
  <what-built>
    Full stack: G1 shortfall ledger + ghost guards + bank exclusion; G2 trace reset + 8KB cap; G3 heuristic recalibration + bootstrap invariant; G4 TaxPolicyEditor + server validation.
  </what-built>
  <how-to-verify>
    **Pre-flight:**
    - Check `~/.policylab/config.json` uses a local model with a 20k-token context window (the same setup that failed the original baseline). Do NOT switch to a larger cloud model — the test is precisely to verify G2's fix under the constrained budget.
    - Ensure no prior session state contaminates: `rm -rf ~/.policylab/policylab.db.lock` (if present).
    - Start the app: `npm run dev`. Wait for "ready" on both server and web.

    **Smoke test steps:**

    1. **Bootstrap United States.** Open the app → "Mirror a Real Location" → search "United States" → select the first result → 30 agents → scenario text: leave blank → Start Bootstrap.
       - **Expected (G2):** progress SSE events complete without 400 Context size errors. All data-fetch phases complete.
       - **Expected (G3):** on design review, TaxPolicyEditor shows `kind = progressive` with 3 brackets. Badge says "Estimate" (source='api').

    2. **Optional G4 interaction before start.** In the Fiscal section's TaxPolicyEditor:
       - Change any single rate (e.g., income from 8% → 10%). Confirm the badge transitions "Estimate" → "Custom" immediately.
       - Revert the change (optional). The badge stays "Custom" (manual edits don't auto-untag).
       - Confirm the full editor is responsive — no dropdown/bracket-row crashes.

    3. **Start the simulation.** Run for 5 iterations. Do not pause.
       - **Expected (G1):** Console does NOT print any `🚨 CRITICAL` SFC drift line on iter 1 through 5.
       - **Expected (G1):** Console DOES print `[SFC] iter=N total drift=±X.XXXX` with `|X.XXXX| ≤ 0.1` for every iteration (the subsystem breakdown may be non-zero inside but total stays bounded).
       - **Expected (G2):** Console does NOT print `Context size has been exceeded` on any `groupResolution` retry.
       - **Expected (Phase-11 baseline):** [TAX] trace lines appear in the simulation's physics log (visible in dev console or via a query of sessionLastPhysicsTraces); cortisol/happiness are non-monotonic; wealth trajectory is non-monotonic (not uniformly +49% as in Results/session-united-states.json).

    4. **Verify editor lock state.** Navigate back to Design Review after the simulation has advanced past iter 1. Confirm the TaxPolicyEditor now renders with `opacity: 0.5`, inputs are non-interactive, and hover shows "Locked after simulation starts."

    5. **Verify server validation.** In DevTools console, run:
       ```js
       fetch(`/api/sessions/${sessionId}/config`, {
         method: 'PUT',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify({ economyConfig: { taxPolicy: { kind: 'wealth-tax', rates: {} } } })
       }).then(r => r.status)
       ```
       - **Expected:** 400
       - If 200 → GC4 Task 1 regressed; stop and flag.

    6. **Capture evidence.** Copy the following into Task 3 output:
       - Terminal output showing `[SFC] iter=1` through `iter=5` (full 5-line breakdown per iteration)
       - First ~20 lines of the iter-1 physics trace log showing `[TAX]` entries
       - A screenshot or console dump of `session.config.economyConfig.taxPolicy` (confirm progressive)
       - The status code from step 5 (expected 400)

    **If any expectation fails**, do NOT approve. Describe the exact failure (step number + observed line/behavior) as the resume signal; a follow-up gap-closure plan may be needed.
  </how-to-verify>
  <resume-signal></resume-signal>
  <action>See how-to-verify above. Executor pauses; user performs the verification steps manually; user responds with approval or describes issues.</action>
  <verify>Manual human verification per how-to-verify steps; no automated command (this is a checkpoint).</verify>
  <done>User types "approved" after confirming all listed verification steps pass.</done>
</task>

<task type="auto">
  <name>Task 3: Finalize VERIFICATION.md with smoke-test evidence + flip VALIDATION.md status</name>
  <files>.planning/phases/11-simulation-realism-organic-stress-pressure-fiscal-balance-and-sfc-leak-closure/11-GC5-VERIFICATION.md, .planning/phases/11-simulation-realism-organic-stress-pressure-fiscal-balance-and-sfc-leak-closure/11-VALIDATION.md</files>
  <read_first>
    - .planning/phases/11-simulation-realism-organic-stress-pressure-fiscal-balance-and-sfc-leak-closure/11-GC5-VERIFICATION.md (from Task 1)
    - .planning/phases/11-simulation-realism-organic-stress-pressure-fiscal-balance-and-sfc-leak-closure/11-VALIDATION.md (full — understand frontmatter + findings table)
    - User's Task 2 resume-signal output (smoke-test evidence)
  </read_first>
  <action>
    **Step 1 — Append Task 2 smoke-test results to VERIFICATION.md §3 Live Smoke Test.** Populate:
    - Pre-flight state (model provider, context window, bootstrap scenario)
    - Per-iteration sfcDrift table:
      ```
      | Iter | Total sfcDrift | banking | capmkt | fiscal | enforcement | trade | physicsActions |
      |------|----------------|---------|--------|--------|-------------|-------|----------------|
      |   1  |       ?.???    |  ?.???  | ?.???  | ?.???  |    ?.???    | ?.??? |      ?.???     |
      ```
      Fill in from the user-provided console output.
    - Bootstrap-derived taxPolicy snapshot (kind + rates + brackets if progressive)
    - [TAX] trace excerpt
    - G4 server-rejection verification (status code from step 5)
    - G4 editor lock verification (observed vs expected)

    **Step 2 — Mark §4 Sign-Off checklist.** Tick all boxes that passed; leave unticked with a note any that failed. If all ticked, write a "Sign-off: APPROVED" line at the bottom.

    **Step 3 — Update 11-VALIDATION.md frontmatter:**
    - Flip `smoke_test_result: failed` → `smoke_test_result: passed`
    - Add line: `gap_closure_completed: true`
    - Append to `smoke_test_findings:` a note that all 4 findings (G1-G4) are closed, or move them to a new `smoke_test_findings_closed:` section with the GC plan that addressed each.
    - Update `updated:` to today's date.

    **Step 4 — Update 11-VALIDATION.md §Phase-Suite Baseline:** Add a new subsection "Gap-Closure Cycle Baseline (at 11-GC5 verification)" with:
    - Updated test count (expected 485 + N_GC additions)
    - Note that pre-existing failures unchanged
    - Commits referenced for each GC plan

    **Commit message:** `docs(11-GC5): verify gap closure complete — G1/G2/G3/G4 all passed live smoke test`
  </action>
  <verify>
    <automated>grep -c "Sign-off: APPROVED" .planning/phases/11-simulation-realism-organic-stress-pressure-fiscal-balance-and-sfc-leak-closure/11-GC5-VERIFICATION.md && grep -c "smoke_test_result: passed" .planning/phases/11-simulation-realism-organic-stress-pressure-fiscal-balance-and-sfc-leak-closure/11-VALIDATION.md</automated>
  </verify>
  <acceptance_criteria>
    - grep `smoke_test_result: passed` in 11-VALIDATION.md returns 1 match
    - grep `gap_closure_completed: true` in 11-VALIDATION.md returns 1 match
    - grep `Sign-off: APPROVED` in 11-GC5-VERIFICATION.md returns 1 match
    - The Per-iteration sfcDrift table in 11-GC5-VERIFICATION.md contains 5 data rows (iter 1-5) with numeric values, not placeholder `?.???`
    - git log -1 --format=%s contains `docs(11-GC5)`
  </acceptance_criteria>
  <done>VERIFICATION.md populated with live smoke-test evidence; VALIDATION.md flipped to passed; Phase 11 gap closure cycle closed.</done>
</task>

</tasks>

<verification>
- grep `smoke_test_result: passed` 11-VALIDATION.md: 1 match
- grep `Sign-off: APPROVED` 11-GC5-VERIFICATION.md: 1 match
- Full npm run test -w server: no new regressions vs baseline
- Live US bootstrap 5-iter smoke test: |sfcDrift| ≤ 0.1 per iter, no context-size 400s, progressive taxPolicy, editor works end-to-end
</verification>

<success_criteria>
- Every acceptance criterion from GC1, GC2, GC3, GC4 ticks ✅ in a single consolidated report.
- Live smoke test reproduces the ORIGINAL failing scenario (US bootstrap, 30 agents, 5 iters, 20k-window local model) and shows ALL four gaps closed.
- 11-VALIDATION.md status flipped to `passed`; gap closure cycle documented.
- Phase 11 can be marked complete; user proceeds to Phase 12 planning.
</success_criteria>

<output>
After completion, create `.planning/phases/11-simulation-realism-organic-stress-pressure-fiscal-balance-and-sfc-leak-closure/11-GC5-SUMMARY.md` with:
- Commits list (expected: 1 docs report commit + 1 docs validation-flip commit; likely one combined)
- Smoke-test outcome summary (drift values per iteration; taxPolicy kind; [TAX] trace presence)
- Handoff note: Phase 11 gap closure cycle CLOSED; ROADMAP.md entry can be marked ✅ for 11-10 + GC cycle.
- Forward pointer: any deferred items from the UAT (if a G4 interaction issue surfaced and got deferred) logged to deferred-items.md.
</output>
