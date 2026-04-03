# Phase 7: Real-World Scenario Bootstrap - Research

**Researched:** 2026-04-01
**Domain:** External data APIs, geocoding, data-driven simulation bootstrapping, scenario A/B comparison UI
**Confidence:** MEDIUM-HIGH

## Summary

Phase 7 adds a "Mirror a Real Location" design flow parallel to the existing creative brainstorming path. Policymakers enter a real-world location, the system fetches demographic/economic/governance data from the World Bank Open Data API (with web scraping/LLM fallback), then auto-generates an EconomyConfig, agent roster, and law document calibrated to reality. The Design Review page gains a tab-based scenario builder for defining multiple parameter variants before simulation, with inline diff markers showing divergence from the real-world baseline.

The primary technical challenges are: (1) mapping geocoded locations to World Bank ISO country codes for API queries, (2) transforming real-world economic indicators into EconomyConfig parameter space, (3) distributing agent wealth according to a Gini coefficient, (4) building a multi-tab scenario builder UI on top of the existing DesignReview, and (5) orchestrating parallel simulation runs with auto-comparison.

**Primary recommendation:** Build a server-side `locationDataService` that chains Photon geocoding (NOT Nominatim -- see pitfalls) to World Bank API calls, returns a structured `LocationProfile`, and caches results to `~/.policylab/cache/`. A new `dataBootstrapPipeline` converts `LocationProfile` into session artifacts (EconomyConfig, agents, law). Frontend adds mode selection to IdeaInput and scenario tabs to DesignReview.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Primary data source: World Bank Open Data API (free, no key, 200+ countries) + US Census for domestic + OECD for developed nations. Covers demographics, GDP, Gini, inflation, budget data.
- **D-02:** Supplementary/fallback: Web scraping via LLM tools (Firecrawl, Exa MCP) to fill gaps. LLM world knowledge as final fallback for qualitative data.
- **D-03:** All four data categories fetched: demographics (population, age, employment, income distribution), economic indicators (GDP, unemployment, inflation, budget, tax, industries), governance & legal (government type, regulations, property rights, welfare programs), infrastructure & geography (resources, energy, urbanization, housing).
- **D-04:** Data confidence indicators shown per parameter: source (API/web/LLM) + confidence level (high/medium/low). Policymakers know what's grounded in real data vs. LLM inference.
- **D-05:** Two parallel modes on Idea Input page: "Describe a Society" (existing creative brainstorming) and "Mirror a Real Location" (new data-driven flow). Both converge at Design Review. Existing functionality fully preserved.
- **D-06:** Location entry screen: search box with autocomplete (geocoding API) + a "policy scenario" text field where policymaker describes what to test. Scenario shapes parameter deltas applied on top of real-world baseline.
- **D-07:** New structured generation pipeline (NOT reusing existing 3-step narrative pipeline): (1) EconomyConfig from real numbers, (2) Agent roster from demographic distribution, (3) Law document from governance data, (4) Policy scenario mapping to parameter deltas. More mechanical, less narrative.
- **D-08:** Step-by-step progress panel during data fetch: show each category with status. Reuse SSE progress pattern from existing design generation.
- **D-09:** Agent count: user picks (20-150). Role distribution mirrors real demographics proportionally. LLM assigns individual backgrounds within each role bucket.
- **D-10:** Agent initial wealth: normalized scale using location's real Gini coefficient. Total simulation wealth = agentCount x baseFiat. Wealth distributed per Gini to create realistic inequality.
- **D-11:** EconomyConfig: direct parameter injection from real data. Real tax rates -> reserveRequirement, real budget breakdown -> BudgetAllocation fractions, real interest rates -> baseLoanInterestRate. All toggles auto-enabled based on what data was found.
- **D-12:** Policy scenario: LLM interprets scenario text as parameter deltas applied on top of real-world baseline.
- **D-13:** Everything is editable after auto-generation. Nothing locked. Modified values flagged as "diverged from baseline" with inline diff markers.
- **D-14:** Inline diff markers on all edited parameters showing original baseline value alongside current value. Works with existing Phase 6 Fork & Compare infrastructure.
- **D-15:** Scenario builder on Design Review page -- policymaker defines 2+ scenarios BEFORE running any simulation: "Baseline" + "Policy A" + "Policy B". No need to run one simulation first.
- **D-16:** Tab-based UI: tabs at top. Each tab shows full Economy/Agent config. Parameters differing from baseline are highlighted.
- **D-17:** "Run All Scenarios" button launches parallel simulations. Auto-navigates to comparison view when all complete. Reuses Phase 6's comparison infrastructure.
- **D-18:** Autocomplete with geocoding API for unambiguous location selection before fetch starts.
- **D-19:** Cache fetched data per location in ~/.policylab/cache/ with 30-day TTL.

### Claude's Discretion
- API response parsing and error handling strategy
- Specific geocoding library choice (Nominatim vs alternatives)
- Cache file format and invalidation mechanics
- SSE event naming for fetch progress steps
- Agent background generation prompts given demographic data
- Law document structure when generated from governance data

### Deferred Ideas (OUT OF SCOPE)
- Live comparison during simulation (Phase 8)
- Map-based location selector
- Pre-built location templates
- Mid-simulation policy injection
</user_constraints>

## Project Constraints (from CLAUDE.md)

- **Shared types**: All cross-workspace data structures live in `shared/src/types.ts`. Import as `@policylab/shared`.
- **Prompt changes**: Add/modify in `prompts.ts` only. All LLM calls must use structured JSON outputs with explicit schemas.
- **Economic parameters**: All tunable economic parameters must be stored in session-level config via `EconomyConfig` type, never hardcoded.
- **Multi-provider LLM**: The LLM gateway abstracts providers. Provider/model is selected from config, not hardcoded.
- **SSE pattern**: Existing SSE pattern in `design.ts` route sends progress events via `res.write()` -- reuse this pattern for data fetch progress.
- **Config storage**: Session config stored as JSON in `sessions.config` column. `PUT /config` uses partial merge.
- **Monorepo**: shared -> server -> web dependency order. Types in shared, logic in server, UI in web.

## Standard Stack

### Core (already in project)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Express | 4.21+ | HTTP server + SSE | Already used for all routes |
| Drizzle ORM | 0.41+ | Database access | Already used for all repos |
| better-sqlite3 | 11+ | SQLite backend | Already used for session/agent data |
| React 19 | 19.2+ | Frontend UI | Already used |
| Zustand 5 | 5.0+ | State management | Already used for all stores |
| Recharts 3 | 3.8+ | Charts | Already used for dashboard |

### New for Phase 7
| Library | Purpose | When to Use |
|---------|---------|-------------|
| Node fetch (built-in) | HTTP calls to World Bank API and Photon | All external API calls |
| fs/promises (built-in) | Cache file I/O in ~/.policylab/cache/ | Read/write location cache |

### No New Dependencies Required

All external API calls use Node's built-in `fetch` (available since Node 18+). Geocoding uses Photon's public HTTP API. No npm packages needed beyond what's already installed.

**Installation:** None needed.

## Architecture Patterns

### Recommended Project Structure
```
server/src/
  data/
    worldBankApi.ts        # World Bank API client (fetch + parse + retry)
    photonGeocoder.ts      # Photon geocoding API client
    locationDataService.ts # Orchestrator: geocode -> fetch all 4 categories -> merge
    locationCache.ts       # File-based cache with 30-day TTL
    dataBootstrapPipeline.ts  # LocationProfile -> EconomyConfig + agents + law
    giniDistribution.ts    # Gini-based wealth distribution algorithm
    indicatorMap.ts        # World Bank indicator codes + mapping to EconomyConfig
  routes/
    bootstrap.ts           # POST /api/sessions/:id/bootstrap (SSE) — new route
shared/src/
  types.ts                 # Add: LocationProfile, DataConfidence, ScenarioTab, etc.
web/src/
  pages/
    IdeaInput.tsx          # Modified: add mode selector + location search
  components/
    LocationSearch.tsx     # Autocomplete search component (Photon API)
    ScenarioTabs.tsx       # Tab-based scenario builder for DesignReview
    DataConfidenceBadge.tsx # Source + confidence indicator
    DiffMarker.tsx         # Inline baseline vs. current diff display
```

### Pattern 1: Data Fetch Pipeline (SSE)
**What:** Server-side pipeline that fetches location data, converts to session artifacts, and streams progress via SSE.
**When to use:** When policymaker selects "Mirror a Real Location" and triggers bootstrap.
**Example:**
```typescript
// server/src/routes/bootstrap.ts — mirrors design.ts SSE pattern
router.post('/:id/bootstrap', async (req, res) => {
  const { location, scenario, agentCount } = req.body;
  
  // SSE headers (same as design.ts)
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (data: object) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  // Step 1: Geocode location
  send({ type: 'step_start', step: 'geocoding', stepIndex: 0, totalSteps: 6 });
  const geo = await geocodeLocation(location);
  send({ type: 'step_done', step: 'geocoding', stepIndex: 0 });

  // Step 2-5: Fetch data categories (demographics, economics, governance, infrastructure)
  // Step 6: Generate session artifacts from data
  // ... each step sends SSE progress events
});
```

### Pattern 2: Gini-Based Wealth Distribution
**What:** Given N agents and a target Gini coefficient, distribute total wealth so inequality matches the real-world location.
**When to use:** Agent roster generation (D-10).
**Example:**
```typescript
// Pareto distribution approach: for Gini G, Pareto alpha = (1+G)/(2G) when G > 0
// Generate N samples from Pareto, normalize to sum = N * baseFiat
function distributeWealth(agentCount: number, baseFiat: number, gini: number): number[] {
  if (gini <= 0) return Array(agentCount).fill(baseFiat);
  
  const alpha = (1 + gini) / (2 * gini); // Pareto shape parameter
  const totalWealth = agentCount * baseFiat;
  
  // Generate Pareto-distributed values
  const raw = Array.from({ length: agentCount }, () => {
    const u = Math.random();
    return Math.pow(1 - u, -1 / alpha);
  });
  
  // Normalize to total wealth
  const sum = raw.reduce((a, b) => a + b, 0);
  return raw.map(v => Math.round((v / sum) * totalWealth));
}
```

### Pattern 3: World Bank API Client
**What:** Fetch indicator data for a country code, handling pagination and missing data.
**When to use:** All World Bank data fetching.
**Example:**
```typescript
// server/src/data/worldBankApi.ts
const BASE_URL = 'https://api.worldbank.org/v2';

interface IndicatorResult {
  indicatorCode: string;
  value: number | null;
  year: number;
  confidence: 'high' | 'medium' | 'low';
}

async function fetchIndicator(
  countryCode: string,  // ISO 2-letter code (e.g., 'US', 'BR')
  indicatorCode: string,
  dateRange?: string     // e.g., '2020:2024'
): Promise<IndicatorResult | null> {
  const url = `${BASE_URL}/country/${countryCode}/indicator/${indicatorCode}?format=json&date=${dateRange}&per_page=10&mrv=1`;
  const res = await fetch(url);
  const [meta, data] = await res.json();
  
  if (!data || data.length === 0 || data[0].value === null) return null;
  return {
    indicatorCode,
    value: data[0].value,
    year: parseInt(data[0].date),
    confidence: 'high',
  };
}
```

### Pattern 4: Multi-Tab Scenario State
**What:** Zustand store managing multiple scenario configurations, each a variant of the baseline.
**When to use:** Scenario builder on DesignReview page (D-15, D-16).
**Example:**
```typescript
// web/src/stores/scenarioStore.ts
interface ScenarioTab {
  id: string;
  name: string;
  economyConfig: Partial<EconomyConfig>;
  budgetAllocation: BudgetAllocation;
  isBaseline: boolean;
}

interface ScenarioStore {
  tabs: ScenarioTab[];
  activeTabId: string;
  addScenario: (name: string) => void;       // clone from baseline
  updateScenario: (id: string, patch: Partial<EconomyConfig>) => void;
  removeScenario: (id: string) => void;
  runAllScenarios: (sessionId: string) => Promise<string[]>;  // returns new session IDs
}
```

### Anti-Patterns to Avoid
- **Do NOT reuse the brainstorming pipeline**: D-07 explicitly says the data-driven flow is mechanical, not narrative. Don't call buildBrainstormMessages or buildOverviewMessages for location-based sessions.
- **Do NOT hardcode indicator codes inline**: Put all World Bank indicator codes in a single `indicatorMap.ts` file for maintainability and testability.
- **Do NOT mutate existing EconomyConfig defaults**: The location-based flow generates its own EconomyConfig from real data; the DEFAULT_ECONOMY_CONFIG remains unchanged for creative brainstorming flow.
- **Do NOT use Nominatim for autocomplete**: Nominatim's usage policy explicitly prohibits search-as-you-type. Use Photon instead.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Geocoding autocomplete | Custom geocoder | Photon API (photon.komoot.io) | Free, open-source, explicitly supports search-as-you-type |
| Country economic data | Web scraping | World Bank API v2 | Free, no auth, 200+ countries, structured JSON, well-documented |
| Gini -> wealth distribution | Naive random distribution | Pareto distribution with alpha=(1+G)/(2G) | Mathematically proven to produce target Gini coefficient |
| Session forking for scenarios | Custom clone logic | Existing `POST /sessions/:id/fork` | Already handles agent copy, config copy, budget copy |
| Config comparison/diff | Custom differ | Existing `computeParamDiffs()` in compare.ts | Already computes EconomyConfig diffs with human-readable labels |

**Key insight:** Phase 6 already built the fork + compare infrastructure. Scenarios are implemented as fork-at-design-time with parameter overrides, then compared using existing Phase 6 comparison flow.

## Common Pitfalls

### Pitfall 1: Nominatim Autocomplete Prohibition
**What goes wrong:** Building autocomplete on Nominatim's public API violates their usage policy. They will throttle/ban the client.
**Why it happens:** The CONTEXT.md mentions "Nominatim/open-source" as the geocoding API, but Nominatim explicitly states: "Auto-complete search is not yet supported and you must not implement such a service on the client side using the API."
**How to avoid:** Use Photon (photon.komoot.io) instead. It's also OSM-based, free, supports search-as-you-type, and has no API key requirement. Same data source, different service.
**Warning signs:** Rate limiting errors from Nominatim after deploying autocomplete.

### Pitfall 2: World Bank API Data Gaps
**What goes wrong:** Many indicators have null/missing values for specific countries or years. The most recent data for some indicators can be 2-5 years old.
**Why it happens:** Not all countries report all indicators. Gini data is especially sparse (many countries have no Gini data, or data from 5+ years ago).
**How to avoid:** Use `mrv=1` (Most Recent Value) parameter in API calls. For each indicator, track the data year and mark confidence accordingly: same-year = high, 1-3 years old = medium, >3 years or null = low. Fall back to LLM estimation for null values.
**Warning signs:** API returns `[{page info}, []]` (empty data array) or data with `value: null`.

### Pitfall 3: Country Code Resolution for Sub-National Locations
**What goes wrong:** User enters "California" or "Lagos" -- these are not countries. World Bank API only accepts ISO country codes.
**Why it happens:** Photon returns city/state/region results. World Bank only has country-level data.
**How to avoid:** Extract the `country_code` field from Photon's GeoJSON response. Always use the country code for World Bank API calls. Store the sub-national location name for display and for LLM context (e.g., "Demographics for Brazil, focused on Sao Paulo").
**Warning signs:** 404 or empty results from World Bank API when passing city names.

### Pitfall 4: Gini Scale Mismatch
**What goes wrong:** World Bank Gini is 0-100 scale, but the Pareto formula expects 0-1 scale. Passing 30 instead of 0.30 produces wildly wrong distributions.
**Why it happens:** Different conventions. World Bank uses percentage points (e.g., Brazil = 48.9), simulation code may expect 0-1.
**How to avoid:** Always normalize World Bank Gini to 0-1 scale (divide by 100) before passing to the wealth distribution algorithm. Add a unit test that verifies Gini(distributed_wealth) approximately equals the input Gini.
**Warning signs:** All agents get nearly equal wealth (alpha becomes huge) or one agent gets everything.

### Pitfall 5: Scenario Tab State vs. Session DB State
**What goes wrong:** Scenario tabs are local UI state, but simulations need persisted sessions. Running "all scenarios" must create real sessions in the DB.
**Why it happens:** The scenario builder is a design-time UI concept. Simulations require actual session records with config, agents, etc.
**How to avoid:** "Run All Scenarios" calls `POST /sessions/:id/fork` for each non-baseline tab, then patches each fork's config with the scenario overrides, then starts simulation on each fork. The baseline tab IS the current session.
**Warning signs:** Scenarios share mutable state, or starting one scenario corrupts another's config.

### Pitfall 6: SSE Connection Drops During Long Data Fetch
**What goes wrong:** World Bank API can be slow (2-5 seconds per indicator batch). If the total pipeline takes >30 seconds, proxies or browser SSE may disconnect.
**Why it happens:** Default SSE timeouts, especially behind reverse proxies.
**How to avoid:** Send periodic heartbeat events (e.g., `data: {"type":"heartbeat"}\n\n` every 10 seconds). Batch multiple indicators into single API calls using the semicolon-separated format (up to 60 indicators per call).
**Warning signs:** Frontend shows "connection lost" during long fetch operations.

### Pitfall 7: EconomyConfig Parameter Space Mismatch
**What goes wrong:** Real-world interest rates are annual (e.g., 5% per year), but EconomyConfig uses per-iteration rates (e.g., 0.005 per iteration). Direct injection without conversion produces unrealistic simulations.
**Why it happens:** Different time scales. Real data is annual; simulation iterations are not necessarily 1 year each.
**How to avoid:** Build an explicit conversion layer in `dataBootstrapPipeline.ts`. Document the conversion formulas. If a session has 12 iterations per year, divide annual rates by 12. Default to 12 iterations/year if timeScale is ambiguous.
**Warning signs:** Agents paying 25% interest per iteration (real annual rate injected directly).

## Code Examples

### World Bank Indicator Code Map
```typescript
// server/src/data/indicatorMap.ts
// Source: https://data.worldbank.org/indicator

export const WB_INDICATORS = {
  // Demographics
  population: 'SP.POP.TOTL',
  populationGrowth: 'SP.POP.GROW',
  urbanPopulationPct: 'SP.URB.TOTL.IN.ZS',
  lifeExpectancy: 'SP.DYN.LE00.IN',
  ageDepRatio: 'SP.POP.DPND',
  
  // Employment / Sector
  unemployment: 'SL.UEM.TOTL.ZS',
  employmentAgriculture: 'SL.AGR.EMPL.ZS',
  employmentIndustry: 'SL.IND.EMPL.ZS',
  employmentServices: 'SL.SRV.EMPL.ZS',
  laborForceParticipation: 'SL.TLF.CACT.ZS',
  
  // Economic
  gdpPerCapita: 'NY.GDP.PCAP.CD',
  gdpGrowth: 'NY.GDP.MKTP.KD.ZG',
  giniIndex: 'SI.POV.GINI',
  inflationCPI: 'FP.CPI.TOTL.ZG',
  realInterestRate: 'FR.INR.RINR',
  
  // Fiscal
  taxRevenuePctGdp: 'GC.TAX.TOTL.GD.ZS',
  govExpensePctGdp: 'GC.XPN.TOTL.GD.ZS',
  militaryExpPctGdp: 'MS.MIL.XPND.GD.ZS',
  healthExpPctGdp: 'SH.XPD.CHEX.GD.ZS',
  educationExpPctGdp: 'SE.XPD.TOTL.GD.ZS',
  
  // Infrastructure
  electricityAccess: 'EG.ELC.ACCS.ZS',
  internetUsers: 'IT.NET.USER.ZS',
  renewableEnergyPct: 'EG.FEC.RNEW.ZS',
} as const;

// Batch fetchable: all codes joined by semicolon for multi-indicator query
export const ALL_INDICATOR_CODES = Object.values(WB_INDICATORS).join(';');
```

### Location Profile Type
```typescript
// shared/src/types.ts — new types for Phase 7

export type DataSource = 'api' | 'web' | 'llm';
export type ConfidenceLevel = 'high' | 'medium' | 'low';

export interface DataPoint<T = number> {
  value: T;
  year?: number;
  source: DataSource;
  confidence: ConfidenceLevel;
  sourceNote?: string;  // e.g., "World Bank WDI 2023"
}

export interface LocationProfile {
  locationName: string;        // Full display name (e.g., "Sao Paulo, Brazil")
  countryCode: string;         // ISO 2-letter code
  countryName: string;
  coordinates: { lat: number; lon: number };
  fetchedAt: string;           // ISO date
  
  demographics: {
    population?: DataPoint;
    urbanPopulationPct?: DataPoint;
    lifeExpectancy?: DataPoint;
    ageDepRatio?: DataPoint;
    unemploymentRate?: DataPoint;
    sectorEmployment?: {
      agriculture?: DataPoint;
      industry?: DataPoint;
      services?: DataPoint;
    };
  };
  
  economics: {
    gdpPerCapita?: DataPoint;
    gdpGrowth?: DataPoint;
    giniIndex?: DataPoint;
    inflationRate?: DataPoint;
    realInterestRate?: DataPoint;
  };
  
  fiscal: {
    taxRevenuePctGdp?: DataPoint;
    govExpensePctGdp?: DataPoint;
    militaryExpPctGdp?: DataPoint;
    healthExpPctGdp?: DataPoint;
    educationExpPctGdp?: DataPoint;
  };
  
  governance?: DataPoint<string>;    // LLM-generated summary
  infrastructure?: DataPoint<string>; // LLM-generated summary
}

export interface ScenarioTab {
  id: string;
  name: string;
  isBaseline: boolean;
  economyConfig: Partial<EconomyConfig>;
  budgetAllocation?: BudgetAllocation;
  /** Parameter overrides relative to baseline. Only non-baseline tabs have this. */
  deltas?: Record<string, { from: number | boolean; to: number | boolean }>;
}

export interface BootstrapProgressEvent {
  type: 'step_start' | 'step_done' | 'step_fallback' | 'complete' | 'error' | 'heartbeat';
  step?: 'geocoding' | 'demographics' | 'economics' | 'governance' | 'infrastructure' | 'generation';
  stepIndex?: number;
  totalSteps?: number;
  fallbackSource?: DataSource;
  message?: string;
}
```

### Data-to-EconomyConfig Conversion
```typescript
// server/src/data/dataBootstrapPipeline.ts
function profileToEconomyConfig(profile: LocationProfile): {
  config: Partial<EconomyConfig>;
  budget: BudgetAllocation;
  confidence: Record<string, ConfidenceLevel>;
} {
  const confidence: Record<string, ConfidenceLevel> = {};
  
  // Reserve requirement: derived from country's banking sophistication
  // Most countries: 0.05-0.15 range. Use real interest rate as proxy.
  const realRate = profile.economics.realInterestRate;
  const reserveReq = realRate 
    ? Math.max(0.03, Math.min(0.20, realRate.value / 100))
    : 0.10;
  if (realRate) confidence.reserveRequirement = realRate.confidence;
  
  // Base loan interest rate: convert annual to per-iteration
  // Assume 12 iterations = 1 year by default
  const ITERATIONS_PER_YEAR = 12;
  const annualRate = profile.economics.realInterestRate?.value ?? 5;
  const perIterRate = annualRate / 100 / ITERATIONS_PER_YEAR;
  
  // Budget allocation from spending data
  const mil = profile.fiscal.militaryExpPctGdp?.value ?? 2;
  const health = profile.fiscal.healthExpPctGdp?.value ?? 5;
  const edu = profile.fiscal.educationExpPctGdp?.value ?? 4;
  const total = mil + health + edu;
  const infra = Math.max(0, 100 - total) * 0.3; // estimate infrastructure as fraction of remainder
  const budgetTotal = mil + health + edu + infra;
  
  const budget: BudgetAllocation = {
    defense: mil / budgetTotal,
    welfare: health / budgetTotal,
    education: edu / budgetTotal,
    infrastructure: infra / budgetTotal,
  };
  
  return {
    config: {
      bankingEnabled: true,
      capitalMarketsEnabled: true,
      fiscalEnabled: true,
      inflationEnabled: true,
      reserveRequirement: Number(reserveReq.toFixed(3)),
      baseLoanInterestRate: Number(perIterRate.toFixed(4)),
      // ... more mappings
    },
    budget,
    confidence,
  };
}
```

### Photon Geocoding Client
```typescript
// server/src/data/photonGeocoder.ts
// Source: https://photon.komoot.io

interface PhotonFeature {
  type: 'Feature';
  geometry: { type: 'Point'; coordinates: [number, number] };  // [lon, lat]
  properties: {
    name: string;
    country: string;
    countrycode: string;  // ISO 2-letter
    state?: string;
    city?: string;
    osm_type: string;
    osm_id: number;
    type: string;  // 'city', 'state', 'country', etc.
  };
}

export async function searchLocations(query: string, limit = 5): Promise<PhotonFeature[]> {
  const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=${limit}&lang=en`;
  const res = await fetch(url);
  const data = await res.json();
  return data.features ?? [];
}
```

### Cache File Format
```typescript
// server/src/data/locationCache.ts
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

const CACHE_DIR = path.join(os.homedir(), '.policylab', 'cache');
const TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

interface CacheEntry {
  fetchedAt: string;
  profile: LocationProfile;
}

export async function getCachedProfile(countryCode: string): Promise<LocationProfile | null> {
  const file = path.join(CACHE_DIR, `${countryCode.toUpperCase()}.json`);
  try {
    const raw = await fs.readFile(file, 'utf-8');
    const entry: CacheEntry = JSON.parse(raw);
    const age = Date.now() - new Date(entry.fetchedAt).getTime();
    if (age > TTL_MS) return null; // expired
    return entry.profile;
  } catch {
    return null;
  }
}

export async function setCachedProfile(countryCode: string, profile: LocationProfile): Promise<void> {
  await fs.mkdir(CACHE_DIR, { recursive: true });
  const file = path.join(CACHE_DIR, `${countryCode.toUpperCase()}.json`);
  const entry: CacheEntry = { fetchedAt: new Date().toISOString(), profile };
  await fs.writeFile(file, JSON.stringify(entry, null, 2));
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Nominatim for autocomplete | Photon geocoder | Ongoing (Nominatim policy) | Nominatim prohibits autocomplete; Photon explicitly supports it |
| World Bank API v1 | World Bank API v2 | 2020+ | v1 deprecated, must use v2 with `/v2/` in URL |
| Manual society design only | Data-driven + creative dual mode | Phase 7 (new) | Policymakers get reality-calibrated baselines |

**Deprecated/outdated:**
- World Bank API v1: No longer supported. All calls must use `/v2/`.
- Nominatim autocomplete: Explicitly prohibited by usage policy.

## Open Questions

1. **Iterations-per-year assumption for rate conversion**
   - What we know: EconomyConfig uses per-iteration rates. Real data is annual.
   - What's unclear: The simulation doesn't have a fixed iterations-per-year constant. `timeScale` is a freeform string.
   - Recommendation: Default to 12 iterations/year for location-based sessions. Allow policymaker to override in scenario config. Document the assumption clearly.

2. **Sub-national data granularity**
   - What we know: World Bank only provides country-level data. Users may enter cities or states.
   - What's unclear: How to handle US states (US Census has state-level data) or EU regions.
   - Recommendation: For v1, always use country-level World Bank data. Add the sub-national location name to LLM context so agent backgrounds reflect the specific location. US Census integration can be a follow-up enhancement.

3. **Parallel simulation resource consumption**
   - What we know: "Run All Scenarios" launches N simulations simultaneously (D-17). Each simulation uses LLM calls.
   - What's unclear: With 3+ scenarios, this could be 3x the LLM API cost and concurrent requests.
   - Recommendation: Run sequentially with progress indicators rather than truly parallel unless maxConcurrency allows it. Show per-scenario progress in the UI.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js fetch | World Bank API calls | Yes (Node 18+) | Built-in | -- |
| fs/promises | Cache file I/O | Yes | Built-in | -- |
| World Bank API | Economic data | Yes (external) | v2 | LLM world knowledge |
| Photon API | Geocoding autocomplete | Yes (external) | Public | Nominatim single-search (no autocomplete) |
| Internet connectivity | All external APIs | Required | -- | Cache-only mode for repeat locations |

**Missing dependencies with no fallback:** None -- all are built-in or external HTTP APIs.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (already configured) |
| Config file | server/vitest.config.ts |
| Quick run command | `npm run test -w server -- --run` |
| Full suite command | `npm run test -w server` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| D-01 | World Bank API fetch + parse indicators | unit | `npx vitest run server/src/data/__tests__/worldBankApi.test.ts -x` | No - Wave 0 |
| D-03 | All 4 data categories fetched | unit | `npx vitest run server/src/data/__tests__/locationDataService.test.ts -x` | No - Wave 0 |
| D-04 | Data confidence indicators per parameter | unit | `npx vitest run server/src/data/__tests__/dataBootstrapPipeline.test.ts -x` | No - Wave 0 |
| D-10 | Gini-based wealth distribution | unit | `npx vitest run server/src/data/__tests__/giniDistribution.test.ts -x` | No - Wave 0 |
| D-11 | Real data -> EconomyConfig mapping | unit | `npx vitest run server/src/data/__tests__/dataBootstrapPipeline.test.ts -x` | No - Wave 0 |
| D-19 | Cache with 30-day TTL | unit | `npx vitest run server/src/data/__tests__/locationCache.test.ts -x` | No - Wave 0 |

### Sampling Rate
- **Per task commit:** `npm run test -w server -- --run`
- **Per wave merge:** Full server test suite
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `server/src/data/__tests__/worldBankApi.test.ts` -- WB API response parsing (mock fetch)
- [ ] `server/src/data/__tests__/giniDistribution.test.ts` -- Gini distribution accuracy
- [ ] `server/src/data/__tests__/locationCache.test.ts` -- Cache read/write/TTL
- [ ] `server/src/data/__tests__/dataBootstrapPipeline.test.ts` -- Profile -> EconomyConfig + confidence

## Sources

### Primary (HIGH confidence)
- [World Bank API v2 Documentation](https://datahelpdesk.worldbank.org/knowledgebase/articles/898599-indicator-api-queries) - Indicator query format, JSON responses, country codes
- [World Bank Country API](https://datahelpdesk.worldbank.org/knowledgebase/articles/898590-country-api-queries) - ISO code resolution, metadata
- [Nominatim Usage Policy](https://operations.osmfoundation.org/policies/nominatim/) - Autocomplete prohibition confirmed
- [Photon Geocoder](https://photon.komoot.io/) - API endpoint, search-as-you-type support, GeoJSON response format
- Existing codebase: `design.ts` SSE pattern, `compare.ts` computeParamDiffs, `EconomyConfig` type, `fork` endpoint

### Secondary (MEDIUM confidence)
- [Gini coefficient - Wikipedia](https://en.wikipedia.org/wiki/Gini_coefficient) - Pareto distribution relationship to Gini
- [World Bank Gini Index](https://data.worldbank.org/indicator/SI.POV.GINI) - Data availability and coverage

### Tertiary (LOW confidence)
- US Census and OECD API specifics (not researched in depth -- D-01 mentions as supplementary but World Bank is primary)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - no new dependencies, all patterns reuse existing project infrastructure
- Architecture: HIGH - clear mapping from decisions to implementation structure; existing SSE/fork/compare patterns directly reusable
- Pitfalls: HIGH - Nominatim prohibition verified against official policy; World Bank data gaps confirmed from API documentation
- Data mapping: MEDIUM - EconomyConfig conversion formulas are reasonable estimates but need empirical calibration
- Gini distribution: MEDIUM - mathematical relationship is well-established but implementation needs unit test verification

**Research date:** 2026-04-01
**Valid until:** 2026-05-01 (stable external APIs, unlikely to change)
