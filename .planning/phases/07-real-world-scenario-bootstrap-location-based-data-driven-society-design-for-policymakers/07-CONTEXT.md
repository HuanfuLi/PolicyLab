# Phase 7: Real-World Scenario Bootstrap - Context

**Gathered:** 2026-04-02
**Status:** Ready for planning

<domain>
## Phase Boundary

This phase adds a data-driven "Mirror a Real Location" design flow alongside the existing creative brainstorming flow. Policymakers enter a real-world location + policy scenario, the system fetches real demographic/economic/governance data via structured APIs (with LLM+web scraping fallback), auto-generates a simulation starting point calibrated to reality, and presents it in Design Review with full editability, inline diff markers, and a tab-based scenario builder for A/B policy comparison. Parallel simulation runs with auto-comparison after completion.

</domain>

<decisions>
## Implementation Decisions

### Data Sourcing
- **D-01:** Primary data source: World Bank Open Data API (free, no key, 200+ countries) + US Census for domestic + OECD for developed nations. Covers demographics, GDP, Gini, inflation, budget data.
- **D-02:** Supplementary/fallback: Web scraping via LLM tools (Firecrawl, Exa MCP) to fill gaps. LLM world knowledge as final fallback for qualitative data.
- **D-03:** All four data categories fetched: demographics (population, age, employment, income distribution), economic indicators (GDP, unemployment, inflation, budget, tax, industries), governance & legal (government type, regulations, property rights, welfare programs), infrastructure & geography (resources, energy, urbanization, housing).
- **D-04:** Data confidence indicators shown per parameter: source (API/web/LLM) + confidence level (high/medium/low). Policymakers know what's grounded in real data vs. LLM inference.

### Design Flow Mode
- **D-05:** Two parallel modes on Idea Input page: "Describe a Society" (existing creative brainstorming) and "Mirror a Real Location" (new data-driven flow). Both converge at Design Review. Existing functionality fully preserved.
- **D-06:** Location entry screen: search box with autocomplete (geocoding API — Nominatim/open-source) + a "policy scenario" text field where policymaker describes what to test (e.g., "What if we raise minimum wage by 30%?"). Scenario shapes parameter deltas applied on top of real-world baseline.
- **D-07:** New structured generation pipeline (NOT reusing existing 3-step narrative pipeline): (1) EconomyConfig from real numbers, (2) Agent roster from demographic distribution, (3) Law document from governance data, (4) Policy scenario mapping to parameter deltas. More mechanical, less narrative — numbers over prose.
- **D-08:** Step-by-step progress panel during data fetch: show each category with status ("✓ Demographics loaded... ⏳ Fetching economic indicators..."). If a step fails, show fallback source used. Reuse SSE progress pattern from existing design generation.

### Data-to-Simulation Mapping
- **D-09:** Agent count: user picks (20-150). Role distribution mirrors real demographics proportionally. E.g., if 30% of location is manufacturing sector, ~30% of agents get industry-related roles. LLM assigns individual backgrounds within each role bucket.
- **D-10:** Agent initial wealth: normalized scale using location's real Gini coefficient. Total simulation wealth = agentCount × baseFiat. Wealth distributed per Gini to create realistic inequality. Agent wealth reflects role tier.
- **D-11:** EconomyConfig: direct parameter injection from real data. Real tax rates → reserveRequirement, real budget breakdown → BudgetAllocation fractions, real interest rates → baseLoanInterestRate. All toggles (bankingEnabled, fiscalEnabled, etc.) auto-enabled based on what data was found.
- **D-12:** Policy scenario: LLM interprets scenario text as parameter deltas applied on top of real-world baseline. "Raise minimum wage 30%" → specific EconomyConfig overrides. The "what-if" is encoded as parameter changes before simulation starts.

### Policymaker Customization
- **D-13:** Everything is editable after auto-generation. Nothing locked. Real-world data is a starting point, not a constraint. Modified values flagged as "diverged from baseline" with inline diff markers (e.g., "Tax rate: 25% → 35% (Δ+10%)").
- **D-14:** Inline diff markers on all edited parameters showing original baseline value alongside current value. Works with existing Phase 6 Fork & Compare infrastructure.

### A/B Scenario Builder
- **D-15:** Scenario builder on Design Review page — policymaker defines 2+ scenarios BEFORE running any simulation: "Baseline" (real-world data) + "Policy A" (parameter overrides) + "Policy B" (different overrides). No need to run one simulation first, then fork.
- **D-16:** Tab-based UI: tabs at top ("Baseline" | "Scenario A" | "+ Add Scenario"). Each tab shows full Economy/Agent config. Parameters differing from baseline are highlighted with inline diff markers.
- **D-17:** "Run All Scenarios" button launches parallel simulations. Auto-navigates to comparison view when all complete. Reuses Phase 6's comparison infrastructure for post-completion analysis.

### Location Resolution & Caching
- **D-18:** Autocomplete with geocoding API (Nominatim — free, open-source) for unambiguous location selection before fetch starts.
- **D-19:** Cache fetched data per location in ~/.policylab/cache/ with 30-day TTL. Subsequent sessions for the same location skip API calls. Reduces costs and enables faster repeat use.

### Claude's Discretion
- API response parsing and error handling strategy
- Specific geocoding library choice (Nominatim vs alternatives)
- Cache file format and invalidation mechanics
- SSE event naming for fetch progress steps
- Agent background generation prompts given demographic data
- Law document structure when generated from governance data

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Session Design Flow
- `server/src/llm/centralAgent.ts` — Current brainstorming + generateDesign pipeline (to understand what Phase 7 parallels)
- `server/src/llm/prompts.ts` — buildBrainstormMessages, buildOverviewMessages, buildLawMessages, buildAgentRosterMessages (existing prompt structure)
- `server/src/routes/sessions.ts` — Session creation + PUT /config endpoint
- `server/src/routes/chat.ts` — Stage advancement logic (brainstorming → designing → design-review)

### Frontend Design Pages
- `web/src/pages/IdeaInput.tsx` — Entry point where "Mirror a Real Location" mode will be added
- `web/src/pages/Brainstorming.tsx` — Existing creative flow (preserved, not modified)
- `web/src/pages/DesignReview.tsx` — Where scenario builder tabs and diff markers will live
- `web/src/components/EconomyTab.tsx` — Existing economy config UI with toggle pills + sliders

### Economy & Agent Types
- `shared/src/types.ts` — EconomyConfig, BudgetAllocation, Agent, SessionConfig interfaces
- `server/src/mechanics/economyConfigUtils.ts` — DEFAULT_ECONOMY_CONFIG, getEconomyConfig

### Phase 6 Comparison Infrastructure
- `server/src/routes/compare.ts` — Fork endpoint + computeParamDiffs (reusable for scenario comparison)
- `web/src/pages/CompareSessions.tsx` — ConfigDiffSection component (reusable for diff display)

### Database
- `server/src/db/schema.ts` — sessions table (config JSON field stores EconomyConfig)
- `server/src/db/repos/agentRepo.ts` — Agent CRUD for roster generation

</canonical_refs>

<specifics>
## Specific Ideas

- World Bank Open Data API as primary structured data source (free, no API key, 200+ country coverage)
- Nominatim for geocoding (free, open-source, no API key)
- Gini coefficient-based wealth distribution for realistic inequality modeling
- Policy scenario text interpreted by LLM as EconomyConfig parameter deltas
- Data confidence indicator per parameter: source (API/web search/LLM estimate) + confidence (high/medium/low)
- Tab-based scenario builder with "Baseline" + N scenario tabs, each showing full config with diff highlights
- "Run All Scenarios" → parallel simulations → auto-compare after completion

</specifics>

<deferred>
## Deferred Ideas

- **Live comparison during simulation (Phase 8):** Show all scenarios' Economic Dashboard charts overlaid in real-time as they run in parallel. Policymakers watch divergence happen live. Requires multi-SSE stream handling, chart overlay logic, and frontend store changes. Captured as Phase 8 scope.
- **Map-based location selector:** Interactive map where policymaker clicks a region with auto-detected boundaries. Requires mapping library (Leaflet/Mapbox) and adds significant frontend complexity.
- **Pre-built location templates:** Cached profiles for major world cities/regions so data fetch is instant. Could be a community-contributed dataset.
- **Mid-simulation policy injection:** Scenario applied as a mid-simulation event rather than at design time. Would require runtime parameter mutation support.

</deferred>

---

*Phase: 07-real-world-scenario-bootstrap*
*Context gathered: 2026-04-02 via discuss-phase*
