# PolicyLab

PolicyLab is a local-first, LLM-powered multi-agent economic simulation platform for policy experimentation. Policymakers design micro-societies of 20-150+ agents, configure economic parameters, run simulations where LLM cognition meets deterministic economic mechanics, and compare policy outcomes side-by-side.

Forked from the Ideal World project with a sharper focus on economic realism and policy evaluation.

## What It Does

### For Policymakers

1. **Bootstrap from Reality** — Enter a real-world location (city, state, country). The system fetches demographics, GDP, Gini coefficient, tax rates, and governance data from the World Bank API, then auto-generates a simulation that mirrors that economy — complete with proportional agent roles, wealth distribution, and calibrated economic parameters.

2. **Design Policy Scenarios** — Use the tab-based scenario builder to create A/B comparisons: "What if Brazil raises tariffs 30%?" vs. "What if Brazil cuts education spending?" Each scenario is a set of parameter overrides applied to the real-world baseline.

3. **Simulate** — Agents act through LLM cognition (intentions, negotiations, plans) while deterministic engines enforce banking rules, market dynamics, fiscal budgets, and inflation mechanics. Every iteration produces traceable economic outcomes.

4. **Compare** — Run all scenarios in parallel, then compare CPI trends, money supply dynamics, employment shifts, and public goods quality across policy variants.

### Two Design Modes

- **Mirror a Real Location** — Data-driven bootstrap from World Bank indicators. Best for policy analysis grounded in real economics.
- **Describe a Society** — Freeform natural-language design with LLM-guided brainstorming. Best for creative exploration and education.

## Core Economic Systems

| System | What It Does |
|---|---|
| **Fractional Reserve Banking** | Bank agents, deposit accounts, lending with M1 expansion, loan repayment, default/bankruptcy |
| **Capital Markets** | Enterprise equity with dividends, government and corporate bonds with coupon/maturity |
| **Fiscal Policy** | Budget categories (infrastructure, education, defense, welfare) with spending multipliers and persistent public goods quality |
| **Inflation Dynamics** | CPI from Laspeyres basket, M1-to-price feedback via AMM, central bank policy rate adjustments |
| **Market Infrastructure** | Constant-product AMM, peer-to-peer order book, skill system, MET-based metabolism |
| **SFC Accounting** | Stock-flow consistent: M0 constant, M1/M2 expansion fully traceable through banking |

## Real-World Data Integration

When bootstrapping from a location, PolicyLab fetches 23 economic indicators from the World Bank Open Data API:

- **Demographics**: Population, urbanization, life expectancy, sector employment (agriculture/industry/services)
- **Economics**: GDP per capita, GDP growth, Gini index, inflation (CPI), lending/deposit interest rates, stock market capitalization
- **Fiscal**: Tax revenue, government expenditure, military/health/education spending as % of GDP, government debt
- **Infrastructure**: Electricity access, internet penetration, renewable energy share

Each parameter in the Economy tab shows a confidence badge (API = from real data, Estimate = derived) so policymakers know what's grounded vs. approximated.

## Architecture

The server is organized into 12 distinct modules with strict dependency rules. See [MODULE_MAP.md](MODULE_MAP.md) for a complete registry of every module, its exports, tests, and how to work on it in isolation.

```
shared/          — Zero-dep TypeScript types (50+ interfaces)
server/
  mechanics/     — Pure deterministic game engines (banking, capital markets, fiscal, inflation, AMM, physics)
  db/            — SQLite schema (26 tables) + repository pattern
  llm/           — Multi-provider LLM gateway + prompt builders
  cognition/     — Per-agent memory, reflection, recursive planning
  parsers/       — LLM response extraction
  data/          — World Bank bootstrap pipeline
  orchestration/ — Simulation loop coordinator
  routes/        — Express API (47 endpoints)
web/
  stores/        — 8 Zustand stores (zero cross-store coupling)
  pages/         — 11 route pages
  components/    — 10+ reusable UI components (90% pure presentation)
```

## Tech Stack

- **Frontend**: React 19, Vite, Zustand, React Router, Recharts, lucide-react
- **Backend**: Express, TypeScript, Drizzle ORM, better-sqlite3
- **Shared**: TypeScript package with 50+ interfaces for sessions, agents, economy, and financial instruments
- **LLM**: Multi-provider gateway (Anthropic, OpenAI, Google Gemini/Vertex, Ollama)
- **Realtime**: Server-Sent Events for live simulation and bootstrap progress streaming
- **Data**: World Bank Open Data API v2, Photon geocoder (OpenStreetMap)
- **Testing**: Vitest (300 tests — SFC invariants, engine unit tests, data pipeline tests)

## Development

```bash
npm install
npm run dev            # Full app (server + web concurrently)
npm run dev -w server  # Backend only
npm run dev -w web     # Frontend only
npm run build          # Build all packages in dependency order
npm run test -w server # Run server tests (vitest)
npm run lint -w web    # Lint frontend
```

Configuration: `~/.policylab/config.json` (LLM API keys, provider selection)
Database: `~/.policylab/policylab.db` (SQLite, auto-migrated)
Location cache: `~/.policylab/cache/` (30-day TTL per country)

## Documentation

| Document | Purpose |
|---|---|
| [CLAUDE.md](CLAUDE.md) | AI assistant guidance — architecture, commands, conventions |
| [MODULE_MAP.md](MODULE_MAP.md) | Complete module registry with exports, tests, dependencies, and isolation guide |
| [.planning/ROADMAP.md](.planning/ROADMAP.md) | Phase-by-phase implementation roadmap |
| [.planning/REQUIREMENTS.md](.planning/REQUIREMENTS.md) | Functional requirements with traceability |
| [.planning/PROJECT.md](.planning/PROJECT.md) | Project scope, constraints, key decisions |

## License

See [LICENSE](LICENSE).
