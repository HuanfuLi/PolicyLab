---
phase: 9
slug: redesign-prompts-for-all
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-07
---

# Phase 9 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | server/vitest.config.ts |
| **Quick run command** | `npx vitest run server/src/__tests__` |
| **Full suite command** | `npm run test -w server` |
| **Estimated runtime** | ~2 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run server/src/__tests__`
- **After every plan wave:** Run `npm run test -w server`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 09-01-01 | 01 | 1 | D-19 (split) | build | `npx tsc --noEmit -p server/tsconfig.json` | ✅ | ⬜ pending |
| 09-01-02 | 01 | 1 | D-19 (barrel) | build | `npx tsc --noEmit -p server/tsconfig.json` | ✅ | ⬜ pending |
| 09-02-01 | 02 | 2 | D-06,D-07 | unit | `npx vitest run server/src/__tests__` | ✅ | ⬜ pending |
| 09-02-02 | 02 | 2 | D-01,D-02 | unit | `npx vitest run server/src/__tests__` | ✅ | ⬜ pending |
| 09-03-01 | 03 | 2 | D-11,D-12 | build | `npx tsc --noEmit -p server/tsconfig.json` | ✅ | ⬜ pending |
| 09-04-01 | 04 | 3 | D-17 | unit | `npx vitest run server/src/__tests__` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements. No new test framework needed.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Agent immersion quality | D-06,D-07,D-08 | Prompt tone is subjective | Run a 5-iteration simulation, read agent narratives for simulation-awareness language |
| Life story depth | D-11 | Background richness is qualitative | Create a session with 20+ agents, verify backgrounds are 5-8 sentences with economic philosophy |
| Economic decision quality | D-01,D-02 | Emergent behavior | Run simulation, verify totalCaloriesProduced > 0 in most iterations |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
