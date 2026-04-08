---
phase: 8
slug: live-scenario-comparison
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-04-07
---

# Phase 8 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 3.x |
| **Config file** | server/vitest.config.ts |
| **Quick run command** | `npm run test -w server -- --run` |
| **Full suite command** | `npm run test -w server -- --run` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm run test -w server -- --run`
- **After every plan wave:** Run `npm run test -w server -- --run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 08-02-01 | 02 | 1 | LSC-04 | unit | `npx vitest run server/src/llm/__tests__/loadBalancer.test.ts -x` | Plan 02 creates | pending |
| 08-04-01 | 04 | 1 | LSC-01 | unit | `npx vitest run server/src/__tests__/scenarioDataMerge.test.ts -x` | Plan 04 creates | pending |
| 08-01-01 | 01 | 1 | LSC-05 | compilation | `npx tsc --noEmit -p server/tsconfig.json` | N/A | pending |
| 08-03-01 | 03 | 2 | LSC-03 | compilation | `npx tsc --noEmit -p web/tsconfig.json` | N/A | pending |
| 08-05-01 | 05 | 3 | LSC-02 | compilation | `npx tsc --noEmit -p web/tsconfig.json` | N/A | pending |
| 08-06-01 | 06 | 3 | LSC-06 | compilation | `npx tsc --noEmit -p web/tsconfig.json && npx tsc --noEmit -p server/tsconfig.json` | N/A | pending |
| 08-07-01 | 07 | 4 | LSC-04 | compilation+suite | `npx tsc --noEmit -p server/tsconfig.json && npm run test -w server -- --run` | N/A | pending |
| 08-07-02 | 07 | 4 | all | human-verify | Manual end-to-end test | N/A | pending |

*Status: pending / green / red / flaky*

---

## Wave 0 Requirements

- [ ] `server/src/llm/__tests__/loadBalancer.test.ts` — Plan 02 creates this (TDD task); stubs for LSC-04 (round-robin + rate limits)
- [ ] `server/src/__tests__/scenarioDataMerge.test.ts` — Plan 04 creates this; stubs for LSC-01 (multi-scenario chart data merge)

**Note:** The remaining requirements (LSC-03 batch control, LSC-05 session grouping, LSC-06 cross-scenario reflection, LSC-07 agent review, LSC-08 policy brief, LSC-09 add scenarios, LSC-10 comparison button, LSC-11 telemetry cleanup) are frontend-heavy or integration-level concerns verified by TypeScript compilation + full test suite + human verification in Plan 08-07. Creating unit test stubs for these would require mocking SSE, Zustand stores, and LLM calls, which adds complexity without proportional confidence gain. The compilation checks plus the blocking human-verify checkpoint in 08-07 provide adequate Nyquist sampling.

*Framework install: None needed — vitest already configured and passing 207 tests*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Panel collapse + grid expansion | LSC-02 | CSS layout behavior | Collapse Live Feed, verify Statistics expands to 2-column grid |
| N=1 backward compatibility | LSC-02 | Full page rendering | Run single session, verify same layout with one blue line per chart |
| Agent chat cross-scenario context | LSC-07 | LLM response quality | Ask agent about different scenarios in chat |
| Add scenarios to existing group | LSC-09 | Multi-step UI workflow | Return to Design Review, add tab, run, verify group membership |
| View Full Comparison button | LSC-10 | Post-completion UI state | Run all scenarios to completion, verify button appears |
| TelemetryPanel Economic tab removal | LSC-11 | Visual verification | Open TelemetryPanel, verify only Classic tab exists |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or are covered by compilation + suite
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers test files that plans actually create
- [x] No watch-mode flags
- [x] Feedback latency < 15s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
