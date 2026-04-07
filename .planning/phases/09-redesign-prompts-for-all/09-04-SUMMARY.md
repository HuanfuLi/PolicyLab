---
plan: "09-04"
phase: "09-redesign-prompts-for-all"
status: complete
started: 2026-04-07
completed: 2026-04-07
---

## Summary

Wired AMM market data from `simulationRunner.ts` into `buildNaturalIntentPrompt` so citizen agents see live market prices in their personal economic dashboard. Food spot price, food reserve, and fiat reserve are computed once per iteration (outside the per-agent loop) from the primary AMM, then passed as the `ammMarketData` parameter added by Plan 02.

## Tasks

| # | Task | Status |
|---|------|--------|
| 1 | Wire AMM market data in simulationRunner.ts | Done |

## Key Files

### Modified
- `server/src/orchestration/simulationRunner.ts` — AMM data extraction + parameter passing

## Deviations

None. Plan 02 had already added the `ammMarketData` parameter to `buildNaturalIntentPrompt` and the dashboard rendering logic. This plan only needed to connect the data source.

## Self-Check: PASSED

- [x] `ammMarketData` computed once per iteration from `primaryAMMForMI`
- [x] Passed as last parameter to `buildNaturalIntentPrompt`
- [x] TypeScript compiles clean
- [x] All 12 prompt content tests pass
