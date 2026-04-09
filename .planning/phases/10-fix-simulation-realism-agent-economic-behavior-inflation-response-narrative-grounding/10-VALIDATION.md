---
phase: 10
slug: fix-simulation-realism-agent-economic-behavior-inflation-response-narrative-grounding
status: compliant
nyquist_compliant: true
wave_0_complete: true
created: 2026-04-07
audited: 2026-04-08
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
| **Estimated runtime** | ~2 seconds |

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
| 10-01-T1 | 01 | 0 | D-01,D-02,D-03,D-28 | unit | `npx vitest run server/src/data/__tests__/enterpriseBootstrap.test.ts` | ✓ | green |
| 10-01-T2 | 01 | 0 | D-06,D-07,D-09 | unit | `npx vitest run server/src/mechanics/__tests__/enterpriseEngine.test.ts` | ✓ | green |
| 10-01-T3 | 01 | 0 | D-20 | unit | `npx vitest run server/src/llm/__tests__/narrativeValidation.test.ts` | ✓ | green |
| 10-02-T1 | 02 | 1 | D-05,D-06,D-07,D-09,D-28,D-29 | unit | `npx vitest run server/src/mechanics/__tests__/enterpriseEngine.test.ts` | ✓ | green |
| 10-03-T1 | 03 | 1 | D-01,D-02,D-03 | unit | `npx vitest run server/src/data/__tests__/enterpriseBootstrap.test.ts` | ✓ | green |
| 10-03-T1 | 03 | 1 | D-04 | manual | See Manual-Only section | N/A | manual-only |
| 10-03-T2 | 03 | 1 | D-27 | manual | See Manual-Only section | N/A | manual-only |
| 10-04-T1 | 04 | 2 | D-25,D-26 | unit | `npx vitest run server/src/mechanics/__tests__/banking.test.ts` | ✓ | green |
| 10-04-T2 | 04 | 2 | D-24 | manual | See Manual-Only section | N/A | manual-only |
| 10-05-T1 | 05 | 3 | D-13,D-14,D-15 | unit | `npx vitest run server/src/mechanics/__tests__/inflationEngine.test.ts` | ✓ | green |
| 10-05-T2 | 05 | 3 | D-16 | manual | See Manual-Only section | N/A | manual-only |
| 10-06-T1 | 06 | 4 | D-20 | unit | `npx vitest run server/src/llm/__tests__/narrativeValidation.test.ts` | ✓ | green |
| 10-06-T2 | 06 | 4 | D-17,D-18,D-19 | manual | See Manual-Only section | N/A | manual-only |
| 10-07-T1 | 07 | 3 | D-21,D-22,D-23 | manual | See Manual-Only section | N/A | manual-only |
| 10-08-T1 | 08 | 5 | D-08 | unit | `npx vitest run server/src/mechanics/__tests__/edgeCases.test.ts` | ✓ | green |
| 10-08-T1 | 08 | 5 | D-11,D-22,D-27 | manual | See Manual-Only section | N/A | manual-only |
| 10-08-T2 | 08 | 5 | all | manual | Human verification of full simulation run | N/A | manual-only |

*Status: pending / green / red / flaky / manual-only*

---

## Test File Coverage Summary

| Test File | Tests | Requirements Covered |
|-----------|-------|---------------------|
| `enterpriseBootstrap.test.ts` | 8 | D-01, D-02, D-03, D-28 |
| `enterpriseEngine.test.ts` | 16 | D-05, D-06, D-07, D-09, D-28, D-29 |
| `narrativeValidation.test.ts` | 9 | D-20 |
| `banking.test.ts` | 32 | D-24 (integration), D-25, D-26 |
| `inflationEngine.test.ts` | 19 | D-13, D-14, D-15 |
| `edgeCases.test.ts` | 19 | D-08 (QUIT_JOB action deltas) |
| **Total** | **277** | **All automatable requirements** |

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Creative mode enterprise generation by Central Agent | D-04 | LLM-dependent — no deterministic unit surface; generated via structured JSON parse post-LLM | Run creative mode session through Design Review; verify agent roster includes enterprise objects alongside citizen agents |
| Telemetry digest + data-driven narrative tone | D-17, D-18, D-19 | LLM output quality requires human judgment | Run simulation, review narrative prose matches telemetry trends and includes real numbers |
| Agent stat trajectory in reflections | D-21, D-22 | LLM reflection quality requires human review | Run simulation, verify agent reflections reference their actual wealth/health trajectory |
| Bootstrap failure on background generation error | D-27 | Requires simulating LLM failure scenario | Temporarily break LLM enrichment call, verify bootstrap aborts cleanly |
| Inflation trend injected into agent context | D-16 | Prompt injection verified structurally; semantic quality requires live run | Run simulation, verify agent prompts include "Inflation is running at X%" in economic context |
| Enterprise treasury = bank deposit; payroll as bank transfer | D-24 | Wired in simulation loop; correct behavior verified by SFC audit passing | Run simulation with banking enabled; verify enterprise fiat flows through deposit accounts |
| Supply/demand shocks via enterprise production | D-11 | AMM volatility behavior requires full simulation run | Run simulation, observe AMM price movement over 5+ iterations with active enterprises |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Manual-Only classification
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 stubs created and passing (8+16+9 tests)
- [x] No watch-mode flags
- [x] Feedback latency < 30s (full suite runs in ~2s)
- [x] `nyquist_compliant: true` set in frontmatter
- [x] D-08 (QUIT_JOB) gap filled: 4 unit tests in `edgeCases.test.ts`
- [x] D-04 (creative mode) classified Manual-Only (LLM-dependent)

**Approval:** 2026-04-08

---

## Validation Audit 2026-04-08

| Metric | Count |
|--------|-------|
| Gaps found | 2 |
| Resolved (automated) | 1 (D-08 — 4 new tests in edgeCases.test.ts) |
| Escalated to manual-only | 1 (D-04 — LLM-dependent) |
| Total tests before audit | 273 |
| Total tests after audit | 277 |
