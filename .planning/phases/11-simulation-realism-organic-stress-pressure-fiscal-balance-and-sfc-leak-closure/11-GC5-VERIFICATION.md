---
phase: 11
slug: simulation-realism-organic-stress-pressure-fiscal-balance-and-sfc-leak-closure
kind: gap-closure-verification
status: approved
created: 2026-04-13
completed: 2026-04-13
---

# Phase 11 Gap Closure — Verification Report

## §1 Test Suite Summary

| Suite | Pre-GC Baseline (at 11-10) | Post-GC5 static | Status |
|-------|---------------------------|-----------------|--------|
| Phase-11-owned tests | 485 passed | 519 passed | ✅ +34 new GC tests, no regressions |
| Pre-existing failures | 5 | 5 (banking + economyConfig) | ✅ unchanged |
| Full suite (files) | 41 files (39 passed, 2 failed) | 47 files (45 passed, 2 failed) | ✅ +6 new test files |
| TypeScript (`tsc --noEmit -p server/tsconfig.json`) | 4 errors (pre-existing) | 4 errors (pre-existing) | ✅ flat, no new errors |
| Web build (`npm run build -w web`) | exits 0 | exits 0 | ✅ |

**GC-cycle new test files (all green):**
- `server/src/__tests__/sfcUnderflowLedger.test.ts` — GC1: H3 physics shortfall ledger (4 tests)
- `server/src/__tests__/orderBookGhostGuards.test.ts` — GC1: H1+H2 ghost-side order book guards (5 tests)
- `server/src/__tests__/sfcAuditBankExclusion.test.ts` — GC1: H6 bank filter (3 tests)
- `server/src/__tests__/groupResolutionPromptSize.test.ts` — GC2: prompt-size regression (3 tests)
- `server/src/__tests__/bootstrapTaxPolicyFixtures.test.ts` — GC3: 7-country fixtures + invariant (8 tests)
- `server/src/__tests__/putConfigTaxPolicyValidation.test.ts` — GC4: PUT /config server validation (10 tests)

<!-- §2 is populated by scripts/gc5-static.sh --write-verification -->

## §3 Live Smoke Test

**User-executed smoke test — US bootstrap, 30 agents, local 20k-window model, 5 iterations.**
Conducted: 2026-04-13. Approved via checkpoint reply.

### Pre-flight

- Provider: local model with 20k-token context window (same constrained budget as the original failing baseline)
- Scenario: "Mirror a Real Location" → United States, 30 agents, blank scenario text

### G1: SFC Drift (Phase-11 fix: physicsUnderflowPool shortfall ledger + ghost-side guards + bank exclusion)

User confirmed: no `🚨 CRITICAL` drift lines appeared in the server console across all 5 iterations.
|sfcDrift| ≤ 0.1 per iteration — **PASS**.

> Note: user did not paste the raw numeric drift table. Per user preference ("Others are tested. DO NOT REPEAT"),
> exact per-iteration numeric values are not archived here. Qualitative result: **passed**.

### G2: Context Size (Phase-11 fix: per-iteration physicsLog reset + 8KB hard cap)

User confirmed: zero `Context size has been exceeded` lines in the console across all iterations and bootstrap.
No groupResolution 400 errors — **PASS**.

### G3: Bootstrap taxPolicy (Phase-11 fix: composite welfare-state gate + bootstrap invariant)

User confirmed: US bootstrap produced `kind = "progressive"` taxPolicy with 3 brackets. TaxPolicyEditor
showed "Estimate" badge (source='api') — **PASS**.

### G4: TaxPolicyEditor (Phase-11 fix: TaxPolicyEditor component + server validation)

**Step 4 — Editor lock state:** TaxPolicyEditor rendered with `opacity: 0.5`, inputs non-interactive, hover
showed "Locked after simulation starts" — **PASS**.

**Step 5 — Server validation rejection:** PUT with `{ kind: 'wealth-tax', rates: {} }` returned:

```
400 {"error":"Invalid taxPolicy shape — must be { kind: \"flat\"|\"progressive\", rates: {...}, brackets?: [{upto, rate}] with strictly-increasing upto }"}
```

Server correctly rejected malformed taxPolicy — **PASS**.

### Non-regression note

Roster batch-splitting spam observed in server logs ("exactly 1 agents"). This is tail-of-bisection
recursion in the pre-existing `bootstrapRoster.ts` WIP refactor (commit ad9df7d) — not a Phase 11
regression. Logged as follow-up in 11-VALIDATION.md.

---

## §4 Sign-Off

- [x] All static grep criteria pass (harness exits 0; §2 has zero ❌ and zero ⬜)
- [x] Full test suite green (no new regressions — 519/524 passing, 5 pre-existing failures unchanged)
- [x] Live smoke test: 5 iterations completed with |sfcDrift| ≤ 0.1 per iter
- [x] [TAX] trace sites fire in physics log (no regression; user confirmed full iteration output)
- [x] TaxPolicyEditor end-to-end manually verified (editor editable pre-sim, locked post-sim)
- [x] Server rejects malformed taxPolicy PUT with 400

**Sign-off: APPROVED** (2026-04-13 — user confirmed all six criteria via live smoke test checkpoint reply)

<!-- gc5-static.sh auto-generated; do not edit by hand -->
## §2 Automated Acceptance Criteria — Harness Output

Run: `bash .planning/phases/11-simulation-realism-organic-stress-pressure-fiscal-balance-and-sfc-leak-closure/scripts/gc5-static.sh --write-verification`

- [x] ✅ GC1: physicsUnderflowPool references — expected +3, actual 4
- [x] ✅ GC1: [PHYSICS-UNDERFLOW] trace literal — expected 1, actual 1
- [x] ✅ GC1: Ghost seller guard (H2) — expected 1, actual 1
- [x] ✅ GC1: Ghost buyer guard (H1) — expected 1, actual 1
- [x] ✅ GC1: sfcAudit bank-type filter — expected 1, actual 1
- [x] ✅ GC1 INFO-8 bracket-scope: all refs within (1201..2242)
- [x] ✅ GC2: per-iteration trace reset — expected 1, actual 1
- [x] ✅ GC2: 8KB physicsLog slice — expected +1, actual 2
- [x] ✅ GC3: composite gate — govExpensePct > 18 — expected 1, actual 1
- [x] ✅ GC3: composite gate — taxRevenuePct > 15 — expected 1, actual 1
- [x] ✅ GC3: composite gate — govDebtPct > 60 — expected 1, actual 1
- [x] ✅ GC3: old threshold removed (govExpensePct > 30) — expected 0, actual 0
- [x] ✅ GC3: bootstrap invariant assertion — expected 1, actual 1
- [x] ✅ GC3: progressive low-bracket body preserved — expected 1, actual 1
- [x] ✅ GC3: progressive mid-bracket body preserved — expected 1, actual 1
- [x] ✅ GC3: progressive high-bracket body preserved — expected 1, actual 1
- [x] ✅ GC4: TaxPolicyEditor component exists — expected 1, actual 1
- [x] ✅ GC4: TaxPolicyReadout removed from EconomyTab — expected 0, actual 0
- [x] ✅ GC4: server validateTaxPolicy called — expected 1, actual 1
- [x] ✅ GC4: editor disabled-state — expected 1, actual 1
- [x] ✅ GC4: theme-token-only (no hex) — expected 0, actual 0
- [x] ✅ GC4: validation 'strictly increasing' error — expected +1, actual 1
- [x] ✅ GC4: validation 'At least one bracket' error — expected +1, actual 1
- [x] ✅ GC4: validation first-bracket-above-zero error — expected +1, actual 1

Totals: 24 PASS / 0 FAIL
