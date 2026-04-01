# PolicyLab

PolicyLab is a local-first TypeScript platform for simulating, analyzing, and comparing LLM-driven micro-economies with realistic financial systems. It combines LLM-based agent cognition with deterministic economic mechanics for banking, capital markets, fiscal policy, and inflation dynamics.

Forked from the Ideal World project with a sharper focus on economic realism and policy evaluation.

## What It Does

Design a micro-society, configure its economic parameters, simulate it, and analyze the results:

1. **Design** — Define agents, roles, economic rules, and policy parameters
2. **Simulate** — Agents act through LLM cognition; deterministic engines enforce economic reality
3. **Reflect** — Agents and the system analyze what happened
4. **Compare** — Side-by-side policy impact analysis across scenarios

## Core Economic Systems

- **Fractional Reserve Banking** — Bank agents, deposit accounts, lending with money creation (M1 expansion), loan repayment, default/bankruptcy
- **Capital Markets** — Enterprise equity with dividends, government and corporate bonds with coupon/maturity
- **Fiscal Policy** — Budget categories (infrastructure, education, defense, welfare) with spending multipliers and persistent public goods quality
- **Inflation Dynamics** — CPI calculation, money supply feedback on prices, inflation-aware agent cognition
- **Market Infrastructure** — Constant-product AMM, peer-to-peer order book, skill system, MET-based metabolism
- **SFC Accounting** — Stock-flow consistent: M0 (base money) constant, M1/M2 expansion fully traceable through banking

## Tech Stack

- **Frontend**: React 19, Vite, Zustand, React Router, lucide-react
- **Backend**: Express, TypeScript, Drizzle ORM, better-sqlite3
- **Shared**: TypeScript package with session, agent, economy, and financial instrument types
- **Realtime**: Server-Sent Events for live simulation streaming

## Development

```bash
npm install
npm run dev        # Full app (server + web)
npm run dev:server # Backend only
npm run dev:web    # Frontend only
npm run build      # Build all packages
npm run test -w server  # Run tests
```

## License

See [LICENSE](LICENSE).