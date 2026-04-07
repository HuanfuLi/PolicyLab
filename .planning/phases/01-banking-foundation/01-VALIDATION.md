---
phase: 1
slug: banking-foundation
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-04-01
updated: 2026-04-07
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 1.x |
| **Config file** | server/vitest.config.ts |
| **Quick run command** | `npx vitest run server/src/mechanics/__tests__/banking.test.ts` |
| **Full suite command** | `npm run test -w server` |
| **Estimated runtime** | ~2 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run server/src/mechanics/__tests__/banking.test.ts`
- **After every plan wave:** Run `npm run test -w server`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 2 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 01-01-T1 | 01 | 1 | CONF-01 | unit | `npx vitest run server/src/__tests__/economyConfig.test.ts` | ✅ exists | ✅ green |
| 01-01-T1 | 01 | 1 | CONF-02 | unit | `npx vitest run server/src/__tests__/economyConfig.test.ts` | ✅ exists | ✅ green |
| 01-01-T1 | 01 | 1 | CONF-03 | unit | `npx vitest run server/src/__tests__/economyConfig.test.ts` | ✅ exists | ✅ green |
| 01-02-T2 | 02 | 1 | BANK-01 | unit | `npx vitest run server/src/mechanics/__tests__/banking.test.ts` | ✅ exists | ✅ green |
| 01-02-T2 | 02 | 1 | BANK-02 | unit | `npx vitest run server/src/mechanics/__tests__/banking.test.ts` | ✅ exists | ✅ green |
| 01-02-T2 | 02 | 1 | BANK-03 | unit + SFC | `npx vitest run server/src/mechanics/__tests__/banking.test.ts server/src/__tests__/sfcBanking.test.ts` | ✅ exists | ✅ green |
| 01-02-T2 | 02 | 1 | BANK-04 | unit + SFC | `npx vitest run server/src/mechanics/__tests__/banking.test.ts server/src/__tests__/sfcBanking.test.ts` | ✅ exists | ✅ green |
| 01-02-T2 | 02 | 1 | BANK-05 | unit + SFC | `npx vitest run server/src/mechanics/__tests__/banking.test.ts server/src/__tests__/sfcBanking.test.ts` | ✅ exists | ✅ green |
| 01-03-T2 | 03 | 2 | BANK-06 | integration | `npx vitest run server/src/__tests__/sfcBanking.test.ts` | ✅ exists | ✅ green |
| 01-03-T2 | 03 | 2 | BANK-08 | integration | `npx vitest run server/src/__tests__/sfcBanking.test.ts` | ✅ exists | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Requirement-to-Test Cross-Reference

| Requirement | Description | Test File(s) | Tests Covering | Status |
|-------------|-------------|--------------|----------------|--------|
| CONF-01 | EconomyConfig type with tunable params | economyConfig.test.ts | 7 tests (type shape, defaults) | COVERED |
| CONF-02 | Session-level config, not hardcoded | economyConfig.test.ts | 4 tests (getEconomyConfig merge) | COVERED |
| CONF-03 | Backward compat — legacy sessions unchanged | economyConfig.test.ts | 2 tests (null/empty → bankingEnabled:false) | COVERED |
| BANK-01 | Bank agent with deposit accounts | banking.test.ts | 3 tests (accrueDepositInterest) | COVERED |
| BANK-02 | Reserve requirement enforcement | banking.test.ts | 4 tests (canIssueLoan) | COVERED |
| BANK-03 | LEND creates loan, expands M1 | banking.test.ts + sfcBanking.test.ts | 5 unit + 1 SFC invariant | COVERED |
| BANK-04 | Repayment destroys M1 symmetrically | banking.test.ts + sfcBanking.test.ts | 5 unit + 1 SFC invariant | COVERED |
| BANK-05 | Default triggers, collateral seized | banking.test.ts + sfcBanking.test.ts | 3 unit + 1 SFC invariant | COVERED |
| BANK-06 | M1/M2 tracked per iteration in telemetry | sfcBanking.test.ts | 1 test (TelemetryLog fields populated) | COVERED |
| BANK-08 | SFC audit: M0 constant + M1 traceable | sfcBanking.test.ts | 5 tests (M0 constant across loan/repay/default/10-iter/deposit-interest) | COVERED |

**Total: 10/10 Phase 1 requirements covered (BANK-07 assigned to Phase 4)**

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Pre-v1.0 sessions unchanged | CONF-03 | Requires loading an old-format session | Start a simulation with no economyConfig in session.config; verify all banking code paths are skipped |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 15s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** complete

---

## Validation Audit 2026-04-07

| Metric | Count |
|--------|-------|
| Gaps found | 0 |
| Resolved | 0 |
| Escalated | 0 |
| Requirements covered | 10/10 |
| Test files | 3 (economyConfig.test.ts, banking.test.ts, sfcBanking.test.ts) |
| Total tests | 46 (16 + 24 + 6) |
| All green | Yes |

*Auditor: Claude (validate-phase orchestrator)*
