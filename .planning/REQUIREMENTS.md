# Requirements: PolicyLab

**Defined:** 2026-04-01
**Core Value:** The deterministic economic engine must be realistic enough that simulation outcomes are meaningful for understanding real-world policy trade-offs.

## v1.0 Requirements

Requirements for the Real Economy Engine milestone. Each maps to roadmap phases.

### Banking

- [x] **BANK-01**: Bank agent role with deposit accounts that track individual agent balances
- [x] **BANK-02**: Reserve requirement enforcement — configurable ratio constrains lending capacity
- [x] **BANK-03**: LEND action creates loan contracts (principal, interest rate, term) and expands M1
- [x] **BANK-04**: Loan repayment destroys M1 symmetrically; interest income flows to bank
- [x] **BANK-05**: Default triggers when borrower cannot repay for K consecutive iterations; bankruptcy seizes collateral
- [x] **BANK-06**: M1/M2 money supply tracked per iteration in telemetry (M0 remains constant)
- [ ] **BANK-07**: Central bank agent observes CPI and M1 growth; adjusts reserve ratio and base interest rate
- [x] **BANK-08**: SFC audit extended to validate M0 constant + M1 = M0 + net loans outstanding

### Capital Markets

- [x] **CMKT-01**: Enterprise equity — share issuance at founding or capital raise, ownership table persisted
- [x] **CMKT-02**: Dividend distribution — enterprise profits distributed pro-rata to shareholders
- [x] **CMKT-03**: Government bonds — treasury issues debt with configurable coupon rate and maturity
- [x] **CMKT-04**: Bond coupon payments from treasury to holders each cycle; maturity redeems principal
- [x] **CMKT-05**: Corporate bonds — enterprises issue debt; reuses government bond instrument schema
- [x] **CMKT-06**: Bond/equity holder ledger persisted to DB for pause/resume and export

### Fiscal Policy

- [x] **FISC-01**: Budget categories (infrastructure, education, defense, welfare) configurable at session design time
- [x] **FISC-02**: Spending multipliers — each category affects specific simulation stats (e.g., education → skill gain rate)
- [x] **FISC-03**: Public goods quality scores [0–100] that increase with spending (diminishing returns) and decay without it
- [x] **FISC-04**: Budget allocation stored in session config and applied each iteration

### Inflation

- [x] **INFL-01**: CPI calculated per iteration from AMM/market price data using weighted basket
- [x] **INFL-02**: M1 growth rate feeds back into price levels via AMM reserve scaling
- [x] **INFL-03**: Inflation expectations injected into agent cognition prompts with CPI trend data
- [x] **INFL-04**: Agents adapt behavior in response to inflation (hoarding, wage demands, saving shifts) — via LLM emergence through prompt context injection

### Configuration

- [x] **CONF-01**: EconomyConfig type in shared types holding all tunable economic parameters
- [x] **CONF-02**: All economic parameters (reserve ratio, interest rates, bond coupon, budget allocation, CPI basket weights) stored as session-level config, not hardcoded
- [x] **CONF-03**: Backward compatibility — existing sessions run with legacy mechanics; new economy activates for new sessions

### Live Scenario Comparison

- [x] **LSC-01**: Simulation page Statistics panel shows all charts as recharts LineCharts with multi-scenario overlaid lines (color + dash patterns), shared crosshair tooltips, live stat badges
- [x] **LSC-02**: Live Feed and Agent Status panels have collapse buttons; Statistics auto-expands to 2-column grid when neighbors collapse
- [ ] **LSC-03**: True parallel simulation execution with separate SSE streams per scenario; multi-progress bars; global pause/resume/abort
- [ ] **LSC-04**: Multi-provider LLM load balancer with round-robin distribution and per-provider rate limits configured in ~/.policylab/config.json
- [x] **LSC-05**: Sessions table groupId + scenarioLabel columns; Home page shows grouped sessions as single card with badge
- [x] **LSC-06**: Reflection page side-by-side society evaluations with cross-scenario data table + LLM narrative; per-agent comparison cards
- [x] **LSC-07**: Review page agent chat with cross-scenario context for multi-scenario questions
- [x] **LSC-08**: Artifacts page per-scenario exports + combined markdown policy brief
- [ ] **LSC-09**: Add new scenarios to existing groups from Design Review; only new scenarios run
- [x] **LSC-10**: "View Full Comparison" button after all scenarios complete, linking to Phase 6 comparison
- [x] **LSC-11**: TelemetryPanel Economic tab removed (inline in Statistics); Classic tab modal preserved

## v2 Requirements

Deferred to future milestones. Tracked but not in current roadmap.

### Governance Enhancement

- **GOV-01**: Budget allocation voted on via governance cycle (currently design-time only)
- **GOV-02**: Separation of powers (executive, legislative, judicial)
- **GOV-03**: Constitutional enforcement with mechanical rule checking
- **GOV-04**: Rule of law — courts and due process replacing SUPPRESS

### Policymaker Tools

- **PLCY-01**: Distributional analysis (deciles, Lorenz curves, Gini in comparison UI)
- **PLCY-02**: Policy-linked A/B scenario comparison
- **PLCY-03**: Structured report export (PDF/markdown policy briefs)
- **PLCY-04**: Role-based outcome breakdown in comparison
- **PLCY-05**: Scenario builder UI for policymaker-friendly parameter entry

### Advanced Economics

- **ECON-01**: Savings accounts with term deposits (M2 distinction)
- **ECON-02**: Bank run mechanics via social network/trust layer
- **ECON-03**: Wage-price spiral telemetry detection

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Derivatives market (options, futures, swaps) | Incompatible with discrete-iteration ABM ticks; ~5x complexity of bonds for marginal insight at 20–150 agent scale |
| Interbank lending market | Meaningless dynamics with 1–2 bank agents; model central bank discount window instead |
| Per-agent credit scores | Wealth history is a sufficient proxy at this simulation scale |
| Hyperinflation caps | Clamping destroys experiment value; let inflation run naturally |
| Full double-entry bookkeeping UI | Frontend scope, not simulation scope; expose data in telemetry JSON instead |
| Dynamic reserve ratio per bank | Leads to regulatory race-to-bottom requiring shadow banking enforcement |
| Stochastic inflation shocks | AMM already has supply/demand volatility; exogenous shocks make inflation unattributable |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| CONF-01 | Phase 1 | Complete |
| CONF-02 | Phase 1 | Complete |
| CONF-03 | Phase 1 | Complete |
| BANK-01 | Phase 1 | Complete |
| BANK-02 | Phase 1 | Complete |
| BANK-03 | Phase 1 | Complete |
| BANK-04 | Phase 1 | Complete |
| BANK-05 | Phase 1 | Complete |
| BANK-06 | Phase 1 | Complete |
| BANK-08 | Phase 1 | Complete |
| CMKT-01 | Phase 2 | Complete |
| CMKT-02 | Phase 2 | Complete |
| CMKT-03 | Phase 2 | Complete |
| CMKT-04 | Phase 2 | Complete |
| CMKT-05 | Phase 2 | Complete |
| CMKT-06 | Phase 2 | Complete |
| FISC-01 | Phase 3 | Complete |
| FISC-02 | Phase 3 | Complete |
| FISC-03 | Phase 3 | Complete |
| FISC-04 | Phase 3 | Complete |
| INFL-01 | Phase 4 | Complete |
| INFL-02 | Phase 4 | Complete |
| INFL-03 | Phase 4 | Complete |
| INFL-04 | Phase 4 | Complete |
| BANK-07 | Phase 4 | Partial — central bank observes CPI/M1 and responds via action codes; full autonomous policy agent deferred |

| LSC-01 | Phase 8 | Planned |
| LSC-02 | Phase 8 | Planned |
| LSC-03 | Phase 8 | Planned |
| LSC-04 | Phase 8 | Planned |
| LSC-05 | Phase 8 | Planned |
| LSC-06 | Phase 8 | Planned |
| LSC-07 | Phase 8 | Planned |
| LSC-08 | Phase 8 | Planned |
| LSC-09 | Phase 8 | Planned |
| LSC-10 | Phase 8 | Planned |
| LSC-11 | Phase 8 | Planned |

**Coverage:**
- v1.0 requirements: 25 total — 24 complete, 1 partial (BANK-07)
- Phase 8 requirements: 11 total — 0 complete
- Unmapped: 0 ✓

---
*Requirements defined: 2026-04-01*
*Last updated: 2026-04-07 after Phase 8 planning*
