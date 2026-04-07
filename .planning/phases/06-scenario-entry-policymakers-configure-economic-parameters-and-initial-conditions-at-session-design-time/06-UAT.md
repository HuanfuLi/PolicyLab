---
status: testing
phase: 06-scenario-entry
source: [06-01-SUMMARY.md, 06-02-SUMMARY.md, 06-03-SUMMARY.md]
started: 2026-04-02T14:30:00Z
updated: 2026-04-02T14:30:00Z
---

## Current Test

number: 1
name: Economy Tab Access
expected: |
  In Design Review, click the "Economy" tab (DollarSign icon).
  Economy tab renders with parameter controls across 4 sections:
  Banking, Fiscal Policy, Capital Markets, Inflation.
  Banking and Fiscal sections are expanded by default.
  Capital Markets and Inflation show "Click to enable" until toggled.
awaiting: user response

## Tests

### 1. Economy Tab Access
expected: In Design Review, click "Economy" tab. 4 sections render: Banking, Fiscal Policy, Capital Markets, Inflation. Banking and Fiscal expanded by default; Capital Markets and Inflation show "Click to enable".
result: [pending]

### 2. Slider + Numeric Input Sync
expected: Move Reserve Ratio slider. Numeric input updates in sync. Type a value in numeric input — slider moves to match.
result: [pending]

### 3. Soft-Limit Warning
expected: Set Reserve Ratio to 0.40 (outside soft range 0.05–0.20). Inline warning appears with "I understand the risks" and "Revert" buttons. Clicking "Revert" restores previous value. Clicking "I understand" persists the extreme value.
result: [pending]

### 4. Feature Toggle Pills
expected: Click "Capital Markets" toggle pill at top. Capital Markets section becomes enabled and expands. Click again — section disables and greys out.
result: [pending]

### 5. Collapsible Sections
expected: Click Banking section header — it collapses. Click again — it expands. State toggles smoothly.
result: [pending]

### 6. Budget Allocation
expected: In Fiscal section, adjust Infrastructure slider up. Other categories (Education, Defense, Welfare) redistribute proportionally downward. Total stays at ~100%.
result: [pending]

### 7. Tooltip on Hover
expected: Hover info icon next to Reserve Ratio. Tooltip appears showing "Fraction of deposits banks must hold in reserve. US: 10%, EU: 1%, China: 12.5%". Tooltip respects current theme (light or dark).
result: [pending]

### 8. Config Persistence
expected: Change a parameter (e.g., Loan Interest Rate), navigate away from Design Review, come back. The changed value persists (not reset to default).
result: [pending]

### 9. Fork Preserves Economy Config
expected: Edit economy parameters in a session. Click "Fork & Change Policy" (visible after simulation). In the forked session, open Economy tab — same parameter values from the source session appear.
result: [pending]

### 10. Fork Button Label & Visibility
expected: Before simulation: no fork button visible. After simulation (session past design stage): button reads "Fork & Change Policy" with GitFork icon.
result: [pending]

### 11. Param Diff in Comparison
expected: Fork a session, change Reserve Ratio in the fork, simulate both, compare them. Comparison page shows a "Configuration Differences" table listing Reserve Ratio with both values.
result: [pending]

### 12. 8-Dimension Comparison
expected: Compare two simulated sessions. LLM analysis shows 8 dimensions including Banking Stability, Fiscal Effectiveness, Economic Growth (in addition to existing 5).
result: [pending]

### 13. No Diff When Configs Match
expected: Compare two sessions with identical economy parameters. No "Configuration Differences" section appears.
result: [pending]

### 14. Pre-v1.0 Session Handling
expected: Open Economy tab for a pre-economy session (no economyConfig set). Banner appears: "Economy features were not configured for this session." Default values shown.
result: [pending]

## Summary

total: 14
passed: 0
issues: 0
pending: 14
skipped: 0
blocked: 0

## Gaps

[none yet]
