# Feature Research

**Domain:** Agent-based economic simulation — fractional reserve banking, capital markets, fiscal budget, inflation dynamics
**Researched:** 2026-04-01
**Confidence:** HIGH (banking/inflation mechanics), MEDIUM (fiscal multiplier values, capital market design), LOW (LLM-specific behavioral adaptation patterns)

---

## Context: Existing Foundation

The simulation already has:
- Constant-product AMM (food + commodities), order book matching engine
- SFC-conserved total fiat with demurrage/UBI cycle
- Enterprise system (found, hire, produce, sell) with role-based wages
- Governance cycle: 3-lever policy (tax_rate, ubi_allocation, enforcement_level)
- 20+ action codes, skill system, inventory, allostatic load

The new features must extend — not replace — these. All new financial instruments must preserve SFC integrity. M0 (base money) must remain constant; M1/M2 expansion must be fully traceable.

---

## Feature Landscape

### Table Stakes (Users Expect These)

These are non-negotiable for the milestone. Missing any one of these leaves the "real economy engine" incomplete.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Bank agent role with deposit accounts | Core institutional structure of any modern economy; the literal definition of "fractional reserve banking" | MEDIUM | One `bank` agent type per session (or a central bank + 1–2 commercial banks). Deposit accounts are just balance sheet entries: liabilities to depositors, assets from loans. |
| Loan creation via LEND action | Money creation is the defining behavior of fractional reserve banking; without it the feature is just a savings account | HIGH | Each loan creates a new deposit (liability) backed by a fractional reserve. Must update M1 tracking. SFC: loan asset on bank balance sheet offsets new deposit liability. |
| Reserve requirement enforcement | The "fractional" in fractional reserve; controls money multiplier and system stability | MEDIUM | Reserve ratio (e.g., 10%) constrains how much the bank can lend relative to M0 held. Central bank sets this as a policy lever. |
| Loan repayment with interest | Loans without repayment are transfers, not debt instruments | MEDIUM | Amortization schedule over N iterations. Interest income flows to bank; repayment destroys the corresponding deposit (SFC: money destruction symmetric to creation). |
| Default and bankruptcy mechanics | Without consequences for non-repayment, loans are free money; kills simulation realism | HIGH | Triggers when borrower wealth < outstanding debt for K consecutive iterations. Collateral seizure, credit downgrade, reduced future LEND eligibility. |
| M1/M2 money supply tracking | Required to measure banking system effect and provide data for inflation calculation | MEDIUM | M0 = base fiat (constant). M1 = M0 + demand deposits. M2 = M1 + term deposits/savings. Track per-iteration as a telemetry stat. |
| Enterprise equity (share issuance + dividends) | Enterprise system already exists; equity gives ownership stakes meaning and enables capital formation beyond cash | HIGH | Enterprises issue shares at founding or via capital raise action. Shareholders receive pro-rata dividend from enterprise profit. Must track ownership table. |
| Government bonds (treasury issuance + coupon) | Standard fiscal instrument; allows government to deficit-spend without immediate tax increase | HIGH | Treasury issues bonds (fungible instruments); agents/bank can hold them. Coupon paid each cycle from treasury. Maturity redeems principal. Ties into existing treasury account in SFC balance sheet. |
| CPI calculation from market data | Without a price index the simulation cannot measure inflation, making the inflation feedback loop impossible | MEDIUM | Basket of goods drawn from existing AMM/order book price data (food, tools, luxury goods, raw materials). Weighted by typical consumption shares. Computed per-iteration, stored in telemetry. |
| Money supply → price level feedback | The core causal chain: lending expansion → M1 growth → inflationary pressure | MEDIUM | Simple quantity-theory-informed formula: if M1 growth rate exceeds real output growth, inject an inflationary pressure scalar that multiplies AMM spot prices by (1 + inflation_rate * factor). Must not break constant-product invariant — adjust reserves proportionally. |
| Fiscal budget categories with spending effects | Governance already controls tax_rate/UBI; fiscal categories make the spending side meaningful | MEDIUM | 3–4 categories (infrastructure, education/skills, welfare, enforcement). Each has a defined effect on a simulation stat (e.g., education spending → skill gain rate multiplier). Budget allocation voted on via existing governance cycle. |
| Inflation expectations in agent cognition | Without behavioral response, inflation is just a number; agents ignoring prices breaks realism | MEDIUM | Inject current CPI and inflation trend into citizen agent prompt context. Agents may choose to hoard, demand wage increases, accelerate purchases. No new action code required — existing actions cover the behaviors. |

### Differentiators (Competitive Advantage)

Features that go beyond the baseline and make the simulation distinctively useful for policy experimentation.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Corporate bonds (enterprise debt issuance) | Enterprises can raise debt capital separate from equity; enables leveraged growth and boom/bust cycles | HIGH | Enterprise issues a bond (fixed coupon, maturity). Bank or agents can hold it. Proceeds fund expanded production. Default propagates to bondholder losses. |
| Central bank as policy agent with interest rate lever | Central bank as a real actor (not just a rule) — can raise/lower reserve rate and discount rate in response to inflation, enabling monetary policy experiments | MEDIUM | Add `central_bank` agent type. It observes CPI and M1 growth; LLM or rule-based response adjusts reserve requirement and sets interbank rate. This is the main monetary policy dial for users. |
| Savings accounts with term deposits | Distinguishes M1 (demand deposits) from M2 (term savings); enables yield curve emergence | MEDIUM | Agents can lock wealth in term deposits at a higher rate than demand deposits. Bank's liability structure gains duration risk. Feeds into M2 calculation. |
| Public goods quality as persistent state | Spending on infrastructure/education creates durable quality scores that compound over time, enabling "investment vs. austerity" policy experiments | MEDIUM | Each spending category has a quality_score [0–100] that increases with spending (diminishing returns) and decays slowly each iteration. Quality score acts as a multiplier on relevant agent stats. |
| Wage-price spiral detection | Emergent macro phenomenon: agents demand higher wages in response to inflation, which increases production costs, which increases prices further | LOW | Not a feature per se — emerges from combining inflation expectations in cognition + wage bargaining in governance proposals. Flag in telemetry when CPI growth rate AND average wage increase both exceed threshold. |
| Bank run mechanics via social network | Bank insolvency scenarios where withdrawal panic cascades through agent social links | HIGH | Defer: requires implementing agent-to-agent trust/communication layer not yet present. Flag as future milestone candidate. |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Full derivatives market (options, futures, swaps) | Seems like the "logical next step" after bonds/equity | Derivatives pricing requires continuous-time models (Black-Scholes etc.) that are incompatible with discrete-iteration ABM ticks. Implementation complexity is ~5x bonds with marginal simulation insight for a 20–150 agent society. | Defer to future milestone. Use bond yield spread as a proxy for risk pricing. |
| Interbank lending market | Banks lending to each other seems realistic | With 1–2 commercial bank agents, an interbank market has no meaningful dynamics (market of one is a bilateral agreement). Adds schema complexity for near-zero emergent value. | Model central bank discount window as a single-parameter lending backstop instead. |
| Dynamic reserve ratio per bank | Each bank setting its own reserve ratio sounds more realistic | Regulatory races-to-the-bottom emerge that require shadow banking enforcement to manage; with small agent counts this just produces single-bank monopoly formation. | Set reserve ratio as a central bank policy lever (one value, all banks). |
| Stochastic inflation shocks (exogenous supply shocks) | Real economies have oil shocks, crop failures etc. | The simulation already has AMM price volatility from supply/demand; adding exogenous shocks double-counts supply disruption and makes inflation causes unattributable, destroying the policy experiment value. | Use AMM reserve manipulation (food shortage scenarios set in Design Review) to achieve the same effect endogenously. |
| Full double-entry bookkeeping UI | Academics love seeing T-accounts | Implementing a visible balance sheet ledger for every entity in the frontend is frontend scope, not simulation scope. Adds weeks of UI work with zero impact on simulation dynamics. | Expose balance sheet data in telemetry JSON; let power users inspect it. Do not build a dedicated ledger UI. |
| Hyperinflation runaway protection cap | "Safety cap" on inflation rate to prevent the simulation from becoming unrealistic | Caps artificially prevent legitimate simulation outcomes (Weimar-scenario experiments). Clamping inflation destroys the experiment value of the feature. | Document expected parameter ranges instead. Let inflation run; the simulation is a sandbox, not a stability guarantee. |
| Per-agent credit scores with detailed history | Realistic-sounding credit risk model | With 20–150 agents and N iterations, agent wealth history IS the credit model. A separate credit score system just re-derives what wealth history already captures, adding code without insight. | Use consecutive iterations below debt threshold as the default proxy. |

---

## Feature Dependencies

```
[M0/M1/M2 Money Supply Tracking]
    └──requires──> [Bank Agent Role + Deposit Accounts]
                       └──requires──> [Loan Creation via LEND action]
                                          └──requires──> [Reserve Requirement Enforcement]
                                                             └──requires──> [Default + Bankruptcy Mechanics]

[CPI Calculation]
    └──requires──> [AMM Price History] (already exists)
    └──requires──> [Market Price Telemetry] (already exists via marketPrices table)

[Money Supply → Price Level Feedback]
    └──requires──> [M1/M2 Tracking]
    └──requires──> [CPI Calculation]

[Inflation Expectations in Agent Cognition]
    └──requires──> [CPI Calculation]
    └──requires──> [Money Supply → Price Level Feedback]

[Government Bonds]
    └──requires──> [Treasury account in SFC] (already exists in SFC balance sheet)
    └──enhances──> [Fiscal Budget Categories] (debt financing enables deficit spending)

[Enterprise Equity]
    └──requires──> [Enterprise System] (already exists)
    └──requires──> [Ownership table in schema] (new)

[Corporate Bonds]
    └──requires──> [Enterprise System] (already exists)
    └──requires──> [Government Bonds] (reuse bond instrument schema)

[Fiscal Budget Categories]
    └──requires──> [Governance Cycle] (already exists)
    └──enhances──> [Public Goods Quality] (spending → quality score)

[Central Bank as Policy Agent]
    └──requires──> [Bank Agent Role]
    └──requires──> [M1/M2 Tracking]
    └──requires──> [CPI Calculation]
    └──enhances──> [Reserve Requirement Enforcement]

[Savings Accounts / Term Deposits]
    └──requires──> [Bank Agent Role + Deposit Accounts]
    └──enhances──> [M1/M2 Tracking] (term deposits = M2 component)
```

### Dependency Notes

- **M1/M2 Tracking requires Bank Agent + LEND action:** Without actual loan creation, M1 is always equal to M0 — tracking it is pointless.
- **CPI requires price history:** This dependency is already satisfied by the existing `marketPrices` table. No new data infrastructure needed.
- **Inflation feedback requires both CPI and M1/M2:** Price-level dynamics need both demand-side (money supply growth) and supply-side (market price index) signals to be meaningful.
- **Corporate bonds require government bonds first:** Reuse the bond instrument type, maturity/coupon data structures, and holder ledger. Build government bonds to establish the pattern, then extend to enterprise issuers.
- **Fiscal budget categories require existing governance cycle:** The vote/ratification path already exists. Budget allocation just becomes a new type of ballot item with different downstream effects.
- **Central bank as active agent requires CPI + M1/M2:** Without observable data the LLM (or rule-based) central bank has nothing to react to.

---

## MVP Definition

### Launch With (v1 — this milestone)

Minimum needed to make "real economy engine" meaningful and internally coherent.

- [ ] Bank agent role with deposit accounts and reserve requirement — establishes banking as an institution
- [ ] LEND action with loan contract (principal, rate, term) — enables money creation
- [ ] Loan repayment with interest + default/bankruptcy mechanics — gives lending consequences
- [ ] M1/M2 money supply tracking per iteration — makes banking measurable
- [ ] Enterprise equity: share issuance, ownership table, dividend distribution — gives enterprise ownership meaning
- [ ] Government bonds: issuance, coupon, maturity, holder ledger — enables fiscal deficit financing
- [ ] Fiscal budget categories (3–4): spending allocation via governance vote, per-category effect on simulation stats — makes fiscal policy an active lever
- [ ] CPI calculation from existing price data — enables inflation measurement
- [ ] Money supply → price level feedback into AMM reserves — makes inflation emergent
- [ ] Inflation expectations injected into citizen agent prompt context — enables behavioral response

### Add After Validation (v1.x)

Features to add once the core banking + capital markets + fiscal loop is working and testable.

- [ ] Corporate bonds — add enterprise as bond issuer once government bond schema is proven; reuse instrument type
- [ ] Central bank as active policy agent — add monetary policy experiments once CPI and M1 are observable
- [ ] Savings accounts / term deposits — add M2 depth once M1 dynamics are tuned
- [ ] Public goods quality as persistent state — add compound investment dynamics once budget categories are wired

### Future Consideration (v2+)

- [ ] Bank runs via social network — requires agent trust/communication layer not yet designed; high complexity, high reward
- [ ] Wage-price spiral telemetry flag — emerges from v1 features; add detection once behavioral patterns are observable
- [ ] Policymaker comparison tools — deferred per PROJECT.md (out of scope for this milestone)
- [ ] Full derivatives market — defer indefinitely for the reasons stated in Anti-Features

---

## Feature Prioritization Matrix

| Feature | Simulation Value | Implementation Cost | Priority |
|---------|-----------------|---------------------|----------|
| Bank agent + deposit accounts + reserve requirement | HIGH | MEDIUM | P1 |
| LEND action + loan contract + repayment | HIGH | HIGH | P1 |
| Default + bankruptcy mechanics | HIGH | HIGH | P1 |
| M1/M2 money supply tracking | HIGH | MEDIUM | P1 |
| CPI calculation | HIGH | LOW | P1 |
| Money supply → price level feedback | HIGH | MEDIUM | P1 |
| Inflation expectations in agent cognition | HIGH | MEDIUM | P1 |
| Government bonds | HIGH | HIGH | P1 |
| Enterprise equity + dividends | HIGH | HIGH | P1 |
| Fiscal budget categories + governance vote | HIGH | MEDIUM | P1 |
| Corporate bonds | MEDIUM | MEDIUM | P2 |
| Central bank as active policy agent | MEDIUM | MEDIUM | P2 |
| Savings accounts / term deposits | MEDIUM | LOW | P2 |
| Public goods quality as persistent state | MEDIUM | MEDIUM | P2 |
| Bank run mechanics | HIGH | HIGH | P3 |
| Full derivatives market | LOW | VERY HIGH | P3 (anti-feature) |

**Priority key:**
- P1: Required for this milestone's coherent delivery
- P2: Add after v1 core is validated and stable
- P3: Future milestone or do not build

---

## SFC Accounting Constraints Per Feature

This table maps each new feature to its SFC bookkeeping requirement. Every new instrument must balance to zero across all sectors at all times.

| Feature | New Asset | New Liability | SFC Rule |
|---------|-----------|---------------|----------|
| Loan creation | Loan asset (bank) | Deposit liability (bank) = new deposit for borrower | On creation: bank.loans_outstanding += principal; borrower.deposits += principal. Net new money = principal, M1 increases. |
| Loan repayment | — | — | borrower.deposits -= payment; bank.loans_outstanding -= principal_portion; bank.interest_income += interest_portion. Net money destroyed = principal repaid, M1 decreases. |
| Loan default | Loan asset written off | — | bank.loans_outstanding -= principal; bank.equity -= principal (loss to bank shareholders). Borrower deposit is zeroed. M1 decreases. |
| Bond issuance | Bond asset (holder) | Bond liability (issuer: treasury or enterprise) | issuer.cash += principal; holder.bonds_held += principal. Net: wealth shifts, no new money created. |
| Bond coupon | — | — | issuer.cash -= coupon; holder.cash += coupon. Net zero transfer. |
| Bond maturity | — | — | issuer.cash -= principal; holder.bonds_held -= principal; holder.cash += principal. |
| Equity issuance | Equity asset (shareholder) | — | enterprise.equity_raised += shares * price; shareholder.cash -= shares * price; shareholder.shares[enterprise_id] += shares. |
| Dividend | — | — | enterprise.retained_earnings -= dividend_total; each shareholder.cash += pro_rata_dividend. Net zero transfer. |
| AMM inflation adjustment | — | — | When price level rises, scale both AMM reserves by inflation factor. k = x*y invariant preserved. Agent wealth is not changed — relative prices shift. |

---

## Comparison to Published ABM Literature

| Feature | Threadneedle (Iiim) | Godley-Lavoie SFC | ABBA (IMF 2017) | Our Approach |
|---------|--------------------|--------------------|----------------|--------------|
| Banking | Full double-entry bookkeeping per agent | Sector-aggregate balance sheets | Bank agents with balance sheets | Simplified bank balance sheet per bank agent (not full double-entry ledger UI) |
| Money creation | Endogenous via lending | Endogenous via circuit | Endogenous via lending | Endogenous via LEND action |
| Capital markets | Bonds only | Bonds + equities | Bonds | Bonds + equities |
| Fiscal policy | Not modeled | Government budget sector | Not modeled | Budget categories voted on via governance cycle |
| Inflation | Exogenous price level | Endogenous via markup + wages | Not modeled | Endogenous: M1 growth + market price index → CPI |
| Agent cognition | Simple rules | Representative agent | Heterogeneous rules | LLM-driven with economic context injection |

Our approach most closely resembles Godley-Lavoie for accounting rigor plus ABBA for agent heterogeneity, with the unique differentiator of LLM-driven agent cognition responding to injected economic context.

---

## Sources

- [Threadneedle: Fractional Reserve Banking Simulation](http://threadneedle.iiim.is/fractional.html)
- [Simulating Fractional Reserve Banking with Agent-Based Modelling (NetLogo)](https://annals-csis.org/Volume_8/pliks/373.pdf)
- [A Basic Macroeconomic Agent-Based Model for Analyzing Monetary Regime Shifts (PMC)](https://pmc.ncbi.nlm.nih.gov/articles/PMC9779001/)
- [ABBA: An Agent-Based Model of the Banking System (IMF WP/17/136)](https://www.imf.org/-/media/Files/Publications/WP/2017/wp17136.ashx)
- [Stock-Flow Consistent Macroeconomic Models: A Survey (Levy Institute WP 891)](https://www.levyinstitute.org/pubs/wp_891.pdf)
- [Godley-Lavoie Monetary Economics SFC Models](http://models.sfc-models.net/gl2007/)
- [Fiscal Multipliers in Agent-Based Models (IDEAS/RepEc 2025)](https://ideas.repec.org/p/ssa/lemwps/2025-10.html)
- [Social Contagion and Bank Runs: An ABM with LLM Depositors (arXiv 2025)](https://www.arxiv.org/pdf/2602.15066)
- [ABIDES-Economist: Agent-Based Simulation of Economic Systems with Learning Agents (arXiv 2024)](https://arxiv.org/html/2402.09563v1)
- [Agent-Based Modeling and Simulation for Economic Markets: Comprehensive Review (Taylor & Francis 2026)](https://www.tandfonline.com/doi/full/10.1080/17477778.2026.2625187?af=R)
- [Dynamic Bank Runs: An Agent-Based Approach (Banco Central do Brasil)](https://www.bcb.gov.br/pec/wps/ingl/wps465.pdf)
- [Stock-Flow Consistent Dynamic Models: Features, Limitations and Developments (Springer)](https://link.springer.com/chapter/10.1007/978-3-030-23929-9_6)

---

*Feature research for: Ideal World economic engine upgrade (fractional reserve banking, capital markets, fiscal budget, inflation dynamics)*
*Researched: 2026-04-01*
