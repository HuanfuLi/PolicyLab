---
phase: 6
slug: scenario-entry
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-02
---

# Phase 6 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (server), manual (frontend) |
| **Config file** | `server/vitest.config.ts` |
| **Quick run command** | `npx vitest run server/src/__tests__/scenarioEntry.test.ts` |
| **Full suite command** | `npm run test -w server` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run server/src/__tests__/scenarioEntry.test.ts`
- **After every plan wave:** Run `npm run test -w server`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 06-01-01 | 01 | 1 | SessionConfig type | unit | `npx vitest run server/src/__tests__/scenarioEntry.test.ts` | ❌ W0 | ⬜ pending |
| 06-01-02 | 01 | 1 | Fork carries EconomyConfig | unit | `npx vitest run server/src/__tests__/scenarioEntry.test.ts` | ❌ W0 | ⬜ pending |
| 06-02-01 | 02 | 2 | Economy tab renders | manual | Browser: open Design Review, verify Economy tab | N/A | ⬜ pending |
| 06-02-02 | 02 | 2 | Slider + numeric input | manual | Browser: adjust parameters, verify config saved | N/A | ⬜ pending |
| 06-03-01 | 03 | 3 | Comparison dimensions 8-10 | unit | `npx vitest run server/src/__tests__/scenarioEntry.test.ts` | ❌ W0 | ⬜ pending |
| 06-03-02 | 03 | 3 | Config diff display | manual | Browser: compare two sessions with different configs | N/A | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `server/src/__tests__/scenarioEntry.test.ts` — stubs for fork config carry, comparison dimension expansion
- [ ] Shared fixtures for session creation with EconomyConfig

*If none: "Existing infrastructure covers all phase requirements."*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Economy tab renders in Design Review | D-01 | UI component rendering | Open Design Review for economy-enabled session, verify Economy tab visible |
| Slider + numeric input interaction | D-05 | Interactive UI behavior | Adjust slider, verify numeric input updates; type in numeric input, verify slider moves |
| Soft limit warnings | D-06 | Dialog interaction | Set parameter outside recommended range, verify warning dialog appears |
| Inline tooltips | D-07 | Hover/click UI behavior | Hover info icon next to parameter, verify tooltip with explanation appears |
| Config diff table in comparison | D-08 | Multi-session UI flow | Fork session, change params, simulate both, open comparison, verify diff table |

*If none: "All phase behaviors have automated verification."*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
