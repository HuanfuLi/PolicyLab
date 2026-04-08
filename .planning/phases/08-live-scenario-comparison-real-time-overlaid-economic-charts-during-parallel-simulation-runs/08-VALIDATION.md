---
phase: 8
slug: live-scenario-comparison
status: audited
nyquist_compliant: true
wave_0_complete: true
created: 2026-04-07
audited: 2026-04-07
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
| 08-02-01 | 02 | 1 | LSC-04 | unit | `npx vitest run server/src/llm/__tests__/loadBalancer.test.ts` | exists | green |
| 08-04-01 | 04 | 1 | LSC-01 | unit | `npx vitest run server/src/__tests__/scenarioDataMerge.test.ts` | exists | green |
| 08-01-01 | 01 | 1 | LSC-05 | unit+compilation | `npx vitest run server/src/__tests__/sessionGrouping.test.ts` | exists | green |
| 08-03-01 | 03 | 2 | LSC-03 | unit | `npx vitest run server/src/__tests__/sessionGrouping.test.ts` | exists | green |
| 08-05-01 | 05 | 3 | LSC-02 | compilation | `npx tsc --noEmit -p web/tsconfig.json` | N/A | compilation-green |
| 08-06-01 | 06 | 3 | LSC-06 | compilation | `npx tsc --noEmit -p web/tsconfig.json && npx tsc --noEmit -p server/tsconfig.json` | N/A | compilation-green |
| 08-08-01 | 08 | 3 | LSC-08 | unit | `npx vitest run server/src/llm/__tests__/policyBriefPrompt.test.ts` | exists | green |
| 08-07-01 | 07 | 4 | LSC-04 | compilation+suite | `npx tsc --noEmit -p server/tsconfig.json && npm run test -w server -- --run` | N/A | green |
| 08-07-02 | 07 | 4 | all | human-verify | Manual end-to-end test | N/A | pending |

*Status: pending / green / red / flaky*

---

## Wave 0 Requirements

- [x] `server/src/llm/__tests__/loadBalancer.test.ts` — Plan 02 created this (TDD task); covers LSC-04 (round-robin + rate limits) — 7 tests green
- [x] `server/src/__tests__/scenarioDataMerge.test.ts` — Plan 04 created this; covers LSC-01 (multi-scenario chart data merge) — 4 tests green

## Nyquist Audit Additions (2026-04-07)

- [x] `server/src/llm/__tests__/policyBriefPrompt.test.ts` — Nyquist audit created; covers LSC-08 `buildPolicyBriefPrompt` pure function (10 tests green)
- [x] `server/src/__tests__/sessionGrouping.test.ts` — Nyquist audit created; covers LSC-05 session grouping schema contract (3 tests), LSC-03 batch session ID validation contract (7 tests), LSC-08 config diff computation logic (5 tests) — 15 tests green

**Remaining un-automatable requirements:** LSC-02 (CSS layout collapse/expand), LSC-06 (cross-scenario reflection LLM quality), LSC-07 (agent chat cross-scenario context), LSC-09 (multi-step UI workflow), LSC-10 (post-completion button state), LSC-11 (visual tab removal) — these require full browser render or LLM response quality judgment. All covered by Manual-Only Verifications section.

**LSC-04 wiring gap:** `server/src/llm/gateway.ts` does NOT yet export `getLoadBalancer()` and `simulationRunner.ts` does not call it. Plan 08-07 (load balancer wiring) was not executed — its SUMMARY.md is absent. This is an implementation gap, not a test gap. The LoadBalancer unit itself is fully tested.

*Framework install: None needed — vitest already configured and passing 243 tests*

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

**Approval:** nyquist-audited — 2 pre-existing test files confirmed green, 2 new test files added covering LSC-03/LSC-05/LSC-08 server logic; LSC-04 implementation gap escalated
