---
phase: 10
slug: fix-simulation-realism-agent-economic-behavior-inflation-response-narrative-grounding
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-07
---

# Phase 10 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (existing) |
| **Config file** | server/vitest.config.ts |
| **Quick run command** | `npm run test -w server -- --run` |
| **Full suite command** | `npm run test -w server` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm run test -w server -- --run`
- **After every plan wave:** Run `npm run test -w server`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 10-01-T1 | 01 | 0 | D-01,D-02,D-03,D-28 | unit stub | `npx vitest run server/src/data/__tests__/enterpriseBootstrap.test.ts -x` | W0 creates | pending |
| 10-01-T2 | 01 | 0 | D-06,D-07,D-09 | unit stub | `npx vitest run server/src/mechanics/__tests__/enterpriseEngine.test.ts -x` | W0 creates | pending |
| 10-01-T3 | 01 | 0 | D-20 | unit stub | `npx vitest run server/src/llm/__tests__/narrativeValidation.test.ts -x` | W0 creates | pending |
| 10-02-T1 | 02 | 1 | D-05,D-06,D-07,D-09,D-28,D-29 | unit | `npx vitest run server/src/mechanics/__tests__/enterpriseEngine.test.ts -x` | Extends W0 stub | pending |
| 10-03-T1 | 03 | 1 | D-01,D-02,D-03,D-04 | unit | `npx vitest run server/src/data/__tests__/enterpriseBootstrap.test.ts -x` | Extends W0 stub | pending |
| 10-03-T2 | 03 | 1 | D-27 | integration | `npm run test -w server -- --run` | Existing infra | pending |
| 10-04-T1 | 04 | 2 | D-25,D-26 | unit | `npx vitest run server/src/mechanics/__tests__/banking.test.ts -x` | Extends existing | pending |
| 10-04-T2 | 04 | 2 | D-24 | integration | `npm run test -w server -- --run` | Existing infra | pending |
| 10-05-T1 | 05 | 3 | D-13,D-14,D-15 | unit | `npx vitest run server/src/mechanics/__tests__/inflationEngine.test.ts -x` | Extends existing | pending |
| 10-05-T2 | 05 | 3 | D-16 | integration | `npm run test -w server -- --run` | Existing infra | pending |
| 10-06-T1 | 06 | 4 | D-20 | unit | `npx vitest run server/src/llm/__tests__/narrativeValidation.test.ts -x` | Extends W0 stub | pending |
| 10-06-T2 | 06 | 4 | D-17,D-18,D-19 | integration | `npm run test -w server -- --run` | Existing infra | pending |
| 10-07-T1 | 07 | 3 | D-21,D-22,D-23 | integration | `npm run test -w server -- --run` | Existing infra | pending |
| 10-08-T1 | 08 | 5 | D-08,D-11,D-22,D-27 | integration | `npx tsc -p server/tsconfig.json --noEmit && npm run test -w server -- --run` | Existing infra | pending |
| 10-08-T2 | 08 | 5 | all | manual | Human verification of full simulation run | N/A | pending |

*Status: pending / green / red / flaky*

---

## Wave 0 Requirements

- [ ] `server/src/data/__tests__/enterpriseBootstrap.test.ts` — stubs for D-01 (enterprise auto-creation), D-02 (elite ownership), D-03 (capital seeding)
- [ ] `server/src/mechanics/__tests__/enterpriseEngine.test.ts` — stubs for D-06 (insolvency), D-07 (minimum wage), D-09 (idle fallback), D-28 (commodity mapping)
- [ ] `server/src/llm/__tests__/narrativeValidation.test.ts` — stubs for D-20 (narrative assertion checks)

*Existing test infrastructure covers: inflationEngine tests (extend for Taylor Rule), banking tests (extend for loan products + liquidity injection)*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Telemetry digest + data-driven narrative tone | D-17, D-18, D-19 | LLM output quality requires human judgment | Run simulation, review narrative prose matches telemetry trends and includes real numbers |
| Agent stat trajectory in reflections | D-21, D-22 | LLM reflection quality requires human review | Run simulation, verify agent reflections reference their actual wealth/health trajectory |
| Bootstrap failure on background generation error | D-27 | Requires simulating LLM failure scenario | Temporarily break LLM enrichment call, verify bootstrap aborts cleanly |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
