---
phase: 07
slug: real-world-scenario-bootstrap
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-04-02
---

# Phase 07 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest (already configured) |
| **Config file** | server/vitest.config.ts |
| **Quick run command** | `npm run test -w server -- --run` |
| **Full suite command** | `npm run test -w server` |
| **Estimated runtime** | ~2 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm run test -w server -- --run`
- **After every plan wave:** Run `npm run test -w server`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 07-01-01 | 01 | 1 | D-01,D-18,D-19 | unit | `npx vitest run server/src/data/__tests__/worldBankApi.test.ts` | ❌ W0 | ⬜ pending |
| 07-01-02 | 01 | 1 | D-10 | unit | `npx vitest run server/src/data/__tests__/giniDistribution.test.ts` | ❌ W0 | ⬜ pending |
| 07-02-01 | 02 | 2 | D-03,D-04,D-11 | unit | `npx vitest run server/src/data/__tests__/dataBootstrapPipeline.test.ts` | ❌ W0 | ⬜ pending |
| 07-02-02 | 02 | 2 | D-07,D-08,D-12 | integration | `npx vitest run server/src/data/__tests__/locationDataService.test.ts` | ❌ W0 | ⬜ pending |
| 07-03-01 | 03 | 3 | D-05,D-06 | manual | Visual verification of IdeaInput dual-mode | N/A | ⬜ pending |
| 07-03-02 | 03 | 3 | D-18 | manual | LocationSearch autocomplete verification | N/A | ⬜ pending |
| 07-04-01 | 04 | 3 | D-15,D-16 | manual | ScenarioTabs UI verification | N/A | ⬜ pending |
| 07-04-02 | 04 | 3 | D-13,D-14,D-17 | manual | DiffMarker + RunAll verification | N/A | ⬜ pending |
| 07-05-01 | 05 | 4 | All | integration | Full E2E verification | N/A | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `server/src/data/__tests__/worldBankApi.test.ts` — WB API response parsing (mock fetch)
- [ ] `server/src/data/__tests__/giniDistribution.test.ts` — Gini distribution accuracy
- [ ] `server/src/data/__tests__/locationCache.test.ts` — Cache read/write/TTL
- [ ] `server/src/data/__tests__/dataBootstrapPipeline.test.ts` — Profile -> EconomyConfig + confidence

*Note: Plan 01 and 02 use TDD (tests written first within tasks), so Wave 0 files are created during Wave 1-2 execution, not as a separate pre-wave step.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| IdeaInput dual-mode cards | D-05 | Visual UI layout | Verify two mode cards displayed on /session/new/idea |
| LocationSearch autocomplete | D-18 | Requires Photon API network | Type location, verify dropdown suggestions appear |
| ScenarioTabs with diff markers | D-15,D-16 | Visual UI + interaction | Create scenarios, verify tab switching + diff highlights |
| Run All Scenarios parallel | D-17 | Requires simulation runner | Trigger parallel run, verify all scenarios complete |
| Data confidence badges | D-04 | Visual UI element | Verify badges show source + confidence level |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 5s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-04-02
