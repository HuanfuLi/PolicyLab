---
phase: 11
slug: simulation-realism-organic-stress-pressure-fiscal-balance-and-sfc-leak-closure
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-13
---

# Phase 11 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (server), jest (web if touched) |
| **Config file** | server/vitest.config.ts |
| **Quick run command** | `npx vitest run server/src/mechanics/__tests__/sfcInvariant.test.ts server/src/mechanics/__tests__/edgeCases.test.ts` |
| **Full suite command** | `npm run test -w server` |
| **Estimated runtime** | ~15 seconds (quick), ~60 seconds (full) |

---

## Sampling Rate

- **After every task commit:** Run quick run command
- **After every plan wave:** Run full suite command
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 60 seconds

---

## Per-Task Verification Map

*Populated by gsd-planner per task; gsd-nyquist-auditor verifies coverage post-planning.*

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| TBD-by-planner | — | — | D-XX | unit/integration | TBD | — | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

*Populated by gsd-planner if new test scaffolds required. Expected Wave 0 deliverables:*

- [ ] `server/src/__tests__/sfcPhase11.test.ts` — structural pressure invariants, escrow SFC closure, tax collection totals
- [ ] `server/src/mechanics/__tests__/structuralPressure.test.ts` — per-pressure unit tests (inflation, Gini, unemployment, public-goods)
- [ ] `server/src/orchestration/__tests__/governance.test.ts` — toggle + law-amendment ballot handling

*If existing infrastructure covers requirements, Wave 0 may be minimal.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Utopia-bias baseline comparison | D-01..D-09 | Requires full LLM-driven simulation run + visual telemetry comparison | Bootstrap "United States" scenario, run 10 iterations, compare cortisol/wealth/M0 trajectories against `Results/session-united-states.json` baseline. Success = non-monotonic stats. |
| Law amendment ratification flow | D-18 | LLM-driven; deterministic test would require mocked provider | Run governance-enabled simulation to iter 5, observe law text change in session.law after ratified amendment. |
| Central-Agent taxPolicy generation | D-13 | LLM-driven | Bootstrap fresh session, inspect EconomyConfig.taxPolicy in DesignReview UI. |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
