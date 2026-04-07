---
phase: 2
slug: capital-markets
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-04-07
updated: 2026-04-07
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 1.x |
| **Config file** | server/vitest.config.ts |
| **Quick run command** | `npx vitest run server/src/mechanics/__tests__/capitalMarket.test.ts` |
| **Full suite command** | `npm run test -w server` |
| **Estimated runtime** | ~2 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run server/src/mechanics/__tests__/capitalMarket.test.ts`
- **After every plan wave:** Run `npm run test -w server`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 2 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 02-01-T1 | 01 | 1 | CMKT-01 | type | `npx tsc --noEmit -p shared/tsconfig.json` | ✅ exists | ✅ green |
| 02-01-T1 | 01 | 1 | CMKT-06 | type | `npx tsc --noEmit -p shared/tsconfig.json` | ✅ exists | ✅ green |
| 02-02-T1 | 02 | 1 | CMKT-01 | unit | `npx vitest run server/src/mechanics/__tests__/capitalMarket.test.ts` | ✅ exists | ✅ green |
| 02-02-T1 | 02 | 1 | CMKT-02 | unit | `npx vitest run server/src/mechanics/__tests__/capitalMarket.test.ts` | ✅ exists | ✅ green |
| 02-02-T1 | 02 | 1 | CMKT-03 | unit | `npx vitest run server/src/mechanics/__tests__/capitalMarket.test.ts` | ✅ exists | ✅ green |
| 02-02-T1 | 02 | 1 | CMKT-04 | unit | `npx vitest run server/src/mechanics/__tests__/capitalMarket.test.ts` | ✅ exists | ✅ green |
| 02-02-T1 | 02 | 1 | CMKT-05 | unit | `npx vitest run server/src/mechanics/__tests__/capitalMarket.test.ts` | ✅ exists | ✅ green |
| 02-03-T2 | 03 | 2 | CMKT-01 | SFC | `npx vitest run server/src/__tests__/sfcCapitalMarkets.test.ts` | ✅ exists | ✅ green |
| 02-03-T2 | 03 | 2 | CMKT-02 | SFC | `npx vitest run server/src/__tests__/sfcCapitalMarkets.test.ts` | ✅ exists | ✅ green |
| 02-03-T2 | 03 | 2 | CMKT-03 | SFC | `npx vitest run server/src/__tests__/sfcCapitalMarkets.test.ts` | ✅ exists | ✅ green |
| 02-03-T2 | 03 | 2 | CMKT-04 | SFC | `npx vitest run server/src/__tests__/sfcCapitalMarkets.test.ts` | ✅ exists | ✅ green |
| 02-03-T2 | 03 | 2 | CMKT-05 | SFC | `npx vitest run server/src/__tests__/sfcCapitalMarkets.test.ts` | ✅ exists | ✅ green |
| 02-03-T2 | 03 | 2 | CMKT-06 | integration | `npx vitest run server/src/__tests__/sfcCapitalMarkets.test.ts` | ✅ exists | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Requirement-to-Test Cross-Reference

| Requirement | Description | Test File(s) | Tests Covering | Status |
|-------------|-------------|--------------|----------------|--------|
| CMKT-01 | Enterprise equity — share issuance, ownership | capitalMarket.test.ts | processSharePurchase (5), processShareSale (2) + SFC share invariant | COVERED |
| CMKT-02 | Dividend distribution pro-rata to shareholders | capitalMarket.test.ts + sfcCapitalMarkets.test.ts | distributeDividends (3) + SFC dividend invariant | COVERED |
| CMKT-03 | Government bonds — issuance, coupon, maturity | capitalMarket.test.ts + sfcCapitalMarkets.test.ts | processGovBondPurchase (2) + gov bond lifecycle SFC | COVERED |
| CMKT-04 | Bond coupon payments + maturity redemption | capitalMarket.test.ts + sfcCapitalMarkets.test.ts | processCoupons (3) + processMaturities (3) + SFC lifecycle | COVERED |
| CMKT-05 | Corporate bonds reusing gov bond schema | capitalMarket.test.ts + sfcCapitalMarkets.test.ts | processCorpBondIssuance (1) + corp bond SFC | COVERED |
| CMKT-06 | Bond/equity holder ledger persisted for pause/resume/export | sfcCapitalMarkets.test.ts | export/import round-trip with ID remapping | COVERED |

**Total: 6/6 Phase 2 requirements covered**

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements.

---

## Manual-Only Verifications

All phase behaviors have automated verification.

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
| Requirements covered | 6/6 |
| Test files | 2 (capitalMarket.test.ts, sfcCapitalMarkets.test.ts) |
| Total tests | 26 (20 + 6) |
| All green | Yes |

*Auditor: Claude (validate-phase orchestrator)*
