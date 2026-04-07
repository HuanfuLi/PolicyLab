---
phase: 3
slug: fiscal-policy
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-04-07
updated: 2026-04-07
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 1.x |
| **Config file** | server/vitest.config.ts |
| **Quick run command** | `npx vitest run server/src/mechanics/__tests__/fiscal.test.ts` |
| **Full suite command** | `npm run test -w server` |
| **Estimated runtime** | ~2 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run server/src/mechanics/__tests__/fiscal.test.ts`
- **After every plan wave:** Run `npm run test -w server`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 2 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 03-01-T1 | 01 | 1 | FISC-01 | type | `npx tsc --noEmit -p shared/tsconfig.json` | ✅ exists | ✅ green |
| 03-01-T1 | 01 | 1 | FISC-04 | type | `npx tsc --noEmit -p shared/tsconfig.json` | ✅ exists | ✅ green |
| 03-02-T1 | 02 | 1 | FISC-02 | unit | `npx vitest run server/src/mechanics/__tests__/fiscal.test.ts` | ✅ exists | ✅ green |
| 03-02-T1 | 02 | 1 | FISC-03 | unit | `npx vitest run server/src/mechanics/__tests__/fiscal.test.ts` | ✅ exists | ✅ green |
| 03-03-T1 | 03 | 2 | FISC-02 | SFC | `npx vitest run server/src/__tests__/sfcFiscal.test.ts` | ✅ exists | ✅ green |
| 03-03-T1 | 03 | 2 | FISC-04 | SFC | `npx vitest run server/src/__tests__/sfcFiscal.test.ts` | ✅ exists | ✅ green |
| 03-04-T1 | 04 | 3 | FISC-01 | integration | `npx vitest run server/src/__tests__/sfcFiscal.test.ts` | ✅ exists | ✅ green |
| 03-05-T1 | 05 | 3 | FISC-03 | integration | `npx vitest run server/src/__tests__/sfcFiscal.test.ts` | ✅ exists | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Requirement-to-Test Cross-Reference

| Requirement | Description | Test File(s) | Tests Covering | Status |
|-------------|-------------|--------------|----------------|--------|
| FISC-01 | Budget categories configurable at design time | sfcFiscal.test.ts | 4 SFC invariant tests with varied allocations + distribution test | COVERED |
| FISC-02 | Spending multipliers affect simulation stats | fiscal.test.ts + sfcFiscal.test.ts | getMultiplierEffects (2) + multiplier from quality (4) + executeBudget multiplier | COVERED |
| FISC-03 | Public goods quality [0-100], diminishing returns, decay | fiscal.test.ts + sfcFiscal.test.ts | updatePublicGoodsQuality (3) + quality gain/decay/diminishing (6) | COVERED |
| FISC-04 | Treasury never negative; proportional scaling | fiscal.test.ts + sfcFiscal.test.ts | treasury never negative (3) + proportional scaling (1) + edge cases | COVERED |

**Total: 4/4 Phase 3 requirements covered**

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Budget allocation sliders in DesignReview UI | FISC-01 | Frontend UI interaction cannot be verified programmatically | Navigate to DesignReview, open Economy tab, verify 4 budget sliders sum to 100% |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 2s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** complete

---

## Validation Audit 2026-04-07

| Metric | Count |
|--------|-------|
| Gaps found | 0 |
| Resolved | 0 |
| Escalated | 0 |
| Requirements covered | 4/4 |
| Test files | 2 (fiscal.test.ts, sfcFiscal.test.ts) |
| Total tests | 38 (18 + 20) |
| All green | Yes |

*Auditor: Claude (validate-phase orchestrator)*
