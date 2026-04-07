# Milestones

## v0 — Ideal World Foundation (inherited)

Forked from Ideal World project. All v0 capabilities are inherited:
- Full session lifecycle (idea → brainstorm → design → simulate → reflect → review)
- Neuro-symbolic simulation engine (LLM intents + deterministic physics)
- SFC economy with AMM, order books, enterprise system, demurrage/UBI
- MET metabolism, allostatic load, skill system, inventory
- Multi-provider LLM gateway
- React 19 frontend with SSE streaming
- SQLite persistence with Drizzle ORM

## v1.0 — Real Economy Engine (completed 2026-04-05)

7 phases delivered. 25/25 requirements met (24 complete, 1 partial). 65 bugs fixed across 5 audit rounds. Modularity refactoring (Phase A+B) applied.

**Delivered:**
- Phase 1: Fractional reserve banking (bank agents, deposits, loans, M1 expansion, SFC audit)
- Phase 2: Capital markets (enterprise equity, government/corporate bonds, dividends, coupons)
- Phase 3: Fiscal policy (4 budget categories, spending multipliers, persistent public goods quality)
- Phase 4: Inflation loop (CPI from Laspeyres basket, M1 feedback, central bank action codes)
- Phase 5: Economic dashboard (4 real-time Recharts panels: CPI, M1/M2, fiscal, bond yields)
- Phase 6: Scenario entry (economy parameter UI, fork-based A/B comparison, 8-dimension scoring)
- Phase 7: Real-world bootstrap (World Bank API, Photon geocoder, Gini wealth distribution, scenario builder)

**Post-milestone:**
- 5 audit rounds: 65 issues fixed (6 critical, 9 high, 14 medium, 8 low)
- Modularity: orderBook repo extraction, prompts decoupled from mechanics, AMMState to shared, simulationState extracted
- Documentation: MODULE_MAP.md created (477-line module registry with isolation guide)
- Testing: 195 tests across 18 files (26% file coverage — expansion planned in MODULE_MAP.md)

**Codebase stats:**
- 76 server source files, ~30 web source files, 844-line shared types
- 26 DB tables, 47 API endpoints, 8 Zustand stores, 11 pages
- 0 type errors, 0 circular dependencies