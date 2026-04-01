---
phase: 1
slug: banking-foundation
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-01
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 1.x |
| **Config file** | server/vitest.config.ts |
| **Quick run command** | `npx vitest run server/src/mechanics/__tests__/bankingEngine.test.ts` |
| **Full suite command** | `npm run test -w server` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run server/src/mechanics/__tests__/bankingEngine.test.ts`
- **After every plan wave:** Run `npm run test -w server`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| TBD | TBD | TBD | CONF-01 | unit | `grep EconomyConfig shared/src/types.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | BANK-01 | unit | `npx vitest run bankingEngine.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | BANK-03 | unit | `npx vitest run bankingEngine.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | BANK-04 | unit | `npx vitest run bankingEngine.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | BANK-05 | unit | `npx vitest run bankingEngine.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | BANK-08 | integration | `npx vitest run sfcAudit.test.ts` | ✅ exists | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `server/src/mechanics/__tests__/bankingEngine.test.ts` — stubs for BANK-01 through BANK-06, BANK-08
- [ ] `server/src/mechanics/__tests__/sfcAudit.test.ts` — extend existing SFC tests with M0/M1 assertions

*Existing vitest infrastructure covers framework needs.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Pre-v1.0 sessions unchanged | CONF-03 | Requires loading an old-format session | Start a simulation with no economyConfig in session.config; verify all banking code paths are skipped |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending