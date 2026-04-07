---
phase: 4
slug: inflation-loop
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-04-07
updated: 2026-04-07
---

# Phase 4 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 1.x |
| **Config file** | server/vitest.config.ts |
| **Quick run command** | `npx vitest run server/src/mechanics/__tests__/inflationEngine.test.ts` |
| **Full suite command** | `npm run test -w server` |
| **Estimated runtime** | ~2 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run server/src/mechanics/__tests__/inflationEngine.test.ts`
- **After every plan wave:** Run `npm run test -w server`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 2 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 04-01-T1 | 01 | 1 | INFL-01 | unit | `npx vitest run server/src/mechanics/__tests__/inflationEngine.test.ts` | ✅ exists | ✅ green |
| 04-01-T1 | 01 | 1 | INFL-02 | unit | `npx vitest run server/src/mechanics/__tests__/inflationEngine.test.ts` | ✅ exists | ✅ green |
| 04-02-T1 | 02 | 2 | BANK-07 | SFC | `npx vitest run server/src/__tests__/sfcInflation.test.ts` | ✅ exists | ✅ green |
| 04-03-T1 | 03 | 2 | INFL-01 | SFC | `npx vitest run server/src/__tests__/sfcInflation.test.ts` | ✅ exists | ✅ green |
| 04-03-T1 | 03 | 2 | INFL-02 | SFC | `npx vitest run server/src/__tests__/sfcInflation.test.ts` | ✅ exists | ✅ green |
| 04-03-T1 | 03 | 2 | INFL-03 | integration | `npx vitest run server/src/__tests__/sfcInflation.test.ts` | ✅ exists | ✅ green |
| 04-03-T1 | 03 | 2 | INFL-04 | manual | N/A (LLM emergence) | N/A | ✅ manual |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Requirement-to-Test Cross-Reference

| Requirement | Description | Test File(s) | Tests Covering | Status |
|-------------|-------------|--------------|----------------|--------|
| INFL-01 | CPI from Laspeyres basket per iteration | inflationEngine.test.ts + sfcInflation.test.ts | CPI=100 baseline (1), CPI food-weighted (1), basket anchor (1), 5-iter SFC (1) | COVERED |
| INFL-02 | M1 growth feeds back into AMM prices | inflationEngine.test.ts + sfcInflation.test.ts | M1 blend signal (2), ammFeedback factor/cap (2), SFC AMM reserves (2) | COVERED |
| INFL-03 | Inflation expectations in agent cognition | sfcInflation.test.ts | inflationContext includes CPI (1), expectations smoothing (1) | COVERED |
| INFL-04 | Agents adapt behavior via LLM emergence | — | By design: no hardcoded triggers, LLM decides from prompt context | MANUAL |
| BANK-07 | Central bank adjusts reserve ratio + base rate | sfcInflation.test.ts | SET_RESERVE_RATIO clamping (1), SET_BASE_RATE clamping (1) | COVERED (partial — action codes wired, autonomous agent deferred) |

**Total: 4/5 automated, 1 manual-only (INFL-04 — LLM emergence by design)**

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Agents shift behavior in high-inflation sessions | INFL-04 | LLM emergence — agents receive CPI/trend context and freely choose actions; no deterministic trigger to test | Run a 20+ iteration simulation with high lending activity; observe if agents shift toward hoarding, wage demands, or accelerated purchases in later iterations |
| Central bank autonomous rate adjustments | BANK-07 | Central bank agent must choose SET_BASE_RATE/SET_RESERVE_RATIO via LLM reasoning | Run simulation with central bank agent enabled; observe if rate changes appear in telemetry after CPI spikes |

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
| Requirements covered (automated) | 4/5 |
| Requirements covered (manual) | 1/5 (INFL-04) |
| Test files | 2 (inflationEngine.test.ts, sfcInflation.test.ts) |
| Total tests | 20 (11 + 9) |
| All green | Yes |

*Auditor: Claude (validate-phase orchestrator)*
