# Pitfalls Research

**Domain:** Fractional reserve banking, capital markets, fiscal policy, and inflation modeling — layered onto an existing SFC-compliant multi-agent LLM simulation
**Researched:** 2026-04-01
**Confidence:** HIGH (core SFC/banking accounting), MEDIUM (LLM integration, SQLite performance specifics)

---

## Critical Pitfalls

### Pitfall 1: Breaking M0 Conservation by Treating Loan Issuance as a Simple Wealth Transfer

**What goes wrong:**
The simplest implementation of a bank loan is `bank.wealth -= amount; borrower.wealth += amount`. This transfers existing fiat and looks SFC-compliant — the total in `computeSystemFiatTotal` stays constant. But it is economically wrong. Fractional reserve banking creates new M1 money at the moment of loan issuance: the borrower gets a deposit (new money) while the bank records a loan asset and deposit liability. M0 (base money) stays constant; M1 expands. If you model this as wealth transfer, you get no money expansion, the multiplier effect never emerges, and the whole purpose of adding banking is defeated.

**Why it happens:**
The existing `computeSystemFiatTotal` sums `agent.wealth + AMM reserves + treasury + escrow`. Developers extend this pattern to banks, treating bank reserves as just another wallet. The SFC audit still passes because fiat is "conserved" — but it is conserving the wrong thing. M0 and M1 are different layers and must be tracked separately from the start.

**How to avoid:**
Define two invariants before writing a line of banking code:
1. **M0 invariant (unchanged):** `Σ(all base money positions) = constant`. Bank reserves, treasury, and agent cash balances at the base money layer sum to a constant.
2. **M1 = M0 + loans invariant:** Agent deposit balances = bank reserve holdings + outstanding loan book. Track `loans_outstanding` as a separate system-level counter. Extend `computeSystemFiatTotal` to accept a `loansOutstanding` parameter and assert `totalFiatSupply = M0_constant + loansOutstanding`.

The new SFC assertion is: `Σ agent_deposits + AMM_reserves + treasury + escrow = M0 + Σ outstanding_loan_principals`.

**Warning signs:**
- The SFC audit passes after a loan is issued but `Σ agent.wealth` did not increase — money creation failed silently.
- Simulation shows bank agents getting poor from lending (wealth drained rather than loan asset recorded).
- No boom/bust dynamics emerge even with high loan volumes.

**Phase to address:** Banking foundation phase (first banking phase). The M1/M0 split must be designed before any banking code is written.

---

### Pitfall 2: Loan Repayment That Destroys the Wrong Money

**What goes wrong:**
When a borrower repays principal, M1 contracts — the deposit used to repay is destroyed, not transferred. Implementing repayment as `bank.wealth += principal; borrower.wealth -= principal` is wrong because it transfers fiat rather than destroying the deposit. The bank's loan asset disappears but its reserves increase — double-counting net bank wealth. After enough cycles the bank accumulates ever-growing reserves that were never in M0, causing `computeSystemFiatTotal` to drift upward and the SFC audit to fire.

**Why it happens:**
Repayment feels symmetric with issuance. If issuance moved money one way, repayment should move it back. But under fractional reserve accounting the directions of money creation and destruction are not symmetric wealth transfers — they are balance sheet events. The loan asset shrinks and the deposit liability shrinks simultaneously. Neither the bank nor the borrower gains base money net.

**How to avoid:**
Model loans as balance sheet entries, not cash flows:
- **Issuance:** `bank.loanAssets += principal; bank.depositLiabilities += principal; borrower.depositBalance += principal`. Base money (reserves) unchanged.
- **Repayment:** `bank.loanAssets -= principal; bank.depositLiabilities -= principal; borrower.depositBalance -= principal`. Base money unchanged.
- **Interest payment only** moves base money: `bank.reserves += interest; borrower.depositBalance -= interest`. This is actual income to the bank.

Track `loanAssets` and `depositLiabilities` as columns in a `bankBalanceSheet` table. The SFC assertion checks that `bank.depositLiabilities = Σ borrower.depositBalances` (no leakage between the two sides).

**Warning signs:**
- Bank wealth grows monotonically even without interest income.
- `computeSystemFiatTotal` drifts upward by exactly the sum of repaid principals.
- Gini coefficient collapses (banks become artificially dominant) with no economic explanation.

**Phase to address:** Banking foundation phase. Must be implemented correctly before the first loan is issued.

---

### Pitfall 3: Interest Payments That Violate SFC Conservation

**What goes wrong:**
Interest income is real base-money income to the bank. If interest is paid from borrower wealth to bank reserves, M0 should be conserved (fiat moves, not created). But two implementation bugs commonly break this:
1. Interest is accrued (added to loan balance) without being simultaneously deducted from borrower deposit — interest income "appears" without a source, minting fiat.
2. Interest is deducted from borrower wealth but the bank's reserves are not credited — fiat vanishes.

Either bug will cause per-iteration SFC drift equal to `total_interest_accrued_per_tick`.

**Why it happens:**
Interest accrual often happens in a separate accounting step from interest payment. If the accrual step runs and the payment step fails (e.g., borrower lacks funds and the code silently skips the bank credit), the system is left with a phantom debit and no corresponding credit.

**How to avoid:**
Treat interest as an atomic double-entry transaction: `borrower.wealth -= interest; bank.reserves += interest`. Never allow partial execution. If the borrower cannot pay, either: (a) accrue it to the loan balance (capitalization — both borrower liability and bank asset grow equally, no SFC drift), or (b) trigger a default event that writes down the loan asset and simultaneously writes down the deposit liability (destroying both sides cleanly). Run the SFC assertion after every interest processing step in the physics loop, not just once per iteration.

**Warning signs:**
- SFC drift is small but accumulates proportionally to the number of loans outstanding.
- Drift rate matches the average interest rate × loan volume.
- SFC warning fires on iterations with high repayment activity.

**Phase to address:** Banking foundation phase. Implement and test interest accounting in isolation before integrating into the simulation loop.

---

### Pitfall 4: Bank Agent Reserves Not Included in the SFC Perimeter

**What goes wrong:**
The existing `computeSystemFiatTotal` does not know about bank agents or their reserve accounts. When banks are added as agent-type entities with a standard `wealth` field, their reserves are counted once in `agent.wealth` totals. But if a separate `bank.reserveAccount` structure is also added (distinct from `agent.wealth`), and both are populated on loan issuance, the total is double-counted. The SFC audit will show M0 has grown.

**Why it happens:**
`computeSystemFiatTotal` is written to sum `agent.wealth` for all alive agents. Bank agents appear in that list. If the banking subsystem also maintains in-memory reserve maps (analogous to `sessionStateTreasury` or `sessionAMMRegistry`), they are outside the SFC perimeter and the total will be wrong. This mirrors the existing pattern with `sessionStateTreasury` — treasury was a separate tracker that had to be explicitly added to `computeSystemFiatTotal`. Banks will need the same treatment.

**How to avoid:**
Before any banking code, extend `computeSystemFiatTotal` to accept a `bankReserves` parameter (equivalent to how `treasury` is already a separate line item). Decide definitively: does bank base-money live in `agent.wealth` or in a dedicated reserve map? Enforce one representation and add an assertion that the bank's `agent.wealth` equals its reserve map value at all times. The SFC perimeter must explicitly enumerate every place M0 can reside.

**Warning signs:**
- SFC total jumps on the iteration a bank agent is registered, proportional to its initial capitalization.
- Bank agent's `agent.wealth` and a separate reserve counter are both non-zero and not equal.
- `computeSystemFiatTotal` returns different values depending on which maps are passed in.

**Phase to address:** Banking foundation phase, specifically the `computeSystemFiatTotal` extension step before bank agent onboarding.

---

### Pitfall 5: Bond Issuance Treated as Money Creation Instead of Debt Placement

**What goes wrong:**
When the government issues a bond, it receives fiat from the buyer and issues a bond liability. This is a pure asset swap: the buyer's fiat decreases, the buyer's bond asset increases, the treasury's fiat increases, the treasury's bond liability increases. M0 is conserved. The mistake is implementing this as `treasury += faceValue` without deducting `buyer.wealth -= faceValue` — or worse, having the central bank "buy" bonds by crediting reserves without any corresponding debit, which is unsterilized monetary financing and inflates M0.

**Why it happens:**
The existing `sessionStateTreasury` is a number. Adding bond issuance revenue to it without corresponding buyer deductions is a one-line change that compiles and runs but silently mints fiat. This is especially likely if bonds are initially implemented as a "government income stream" rather than as debt instruments requiring buyer-side accounting.

**How to avoid:**
Model bonds with explicit buyer accounting from the first commit:
- **Primary issuance:** `buyer.wealth -= price; treasury += price; buyer.bondHoldings[bondId] += faceValue; government.bondLiabilities += faceValue`.
- **Central bank open market purchase:** `centralBank.reserveCredit += price; government.bondLiabilities -= price`. This is the only path where M0 expands (QE-equivalent). Make it an explicit, named operation, never an implicit path.

Add a separate `governmentDebtOutstanding` counter to the SFC assertion: `totalFiatSupply = M0 + loansOutstanding` (bond purchases are not money creation unless the central bank is the buyer — track whether the buyer is the central bank explicitly).

**Warning signs:**
- Treasury balance increases without any corresponding decrease in agent or AMM balances.
- `computeSystemFiatTotal` increases by exactly the bond face value on issuance iterations.
- No agent in the system has reduced wealth after a bond auction.

**Phase to address:** Capital markets phase. Must be reviewed before the first bond auction runs.

---

### Pitfall 6: Dividend and Coupon Payments Sourced from the Wrong Pool

**What goes wrong:**
Dividends and coupon payments move fiat from issuer to holder. An enterprise pays dividends from its operating revenue (which is already in the SFC perimeter as enterprise treasury / wage pool). A government pays coupon from the treasury. Both are SFC-neutral transfers. The mistake is paying dividends or coupons by incrementing shareholder/bondholder wealth without decrementing the source — creating fiat from nothing. This often surfaces first in testing when enterprise earnings look artificially high because revenue was credited but dividend was not debited.

**Why it happens:**
Dividend logic is often written in two places: the enterprise profit-distribution step and the agent wealth-update step. If either step is skipped or gated by a different condition (e.g., "pay dividends only if enterprise has profit" but the debit runs even if the credit doesn't), fiat appears.

**How to avoid:**
Use the existing `distributeProRata` function for every dividend and coupon distribution — it already handles integer remainder correctly and is SFC-tested. Route all distributions through a single function: `enterprise.treasury -= totalDividend; distributeProRata(shareholders, totalDividend)`. Never allow the credit side to run without the debit side in the same synchronous code path. Write a post-distribution assertion: `enterprise.treasury_before - enterprise.treasury_after === Σ shareholder_wealth_increases`.

**Warning signs:**
- Enterprise treasury stays flat while shareholder wealth grows on dividend iterations.
- `computeSystemFiatTotal` grows by exactly the coupon payment amount on coupon dates.
- The SFC audit fires specifically on iterations where the governance cycle distributes UBI or dividends simultaneously (masking the source of the drift).

**Phase to address:** Capital markets phase (equity) and banking phase (bond coupons). Add to SFC sandbox tests before integration.

---

### Pitfall 7: The Inflation Feedback Loop Operates on Nominal Wealth Instead of Real Purchasing Power

**What goes wrong:**
CPI is calculated and agents are told "inflation is 8%." But agents' wealth values in the simulation are nominal fiat units. When the simulation gives agents an inflation signal, their LLM cognition may rationally decide to demand higher wages — but the physics engine still applies nominal wage deltas unchanged. The result is a coherent narrative about inflation with no actual wage-price spiral: real wages silently compress iteration over iteration while the LLM reports "agents are concerned about inflation." The simulation looks like it is modeling inflation but is only narrating it.

**Why it happens:**
The Neuro-Symbolic architecture separates narrative (LLM) from mechanics (physics engine). Inflation as a concept lives naturally in the LLM layer. But for inflation to affect real outcomes, it must change the physics layer's wage parameters, price dynamics, or AMM input amounts. If the CPI calculation and the agent cognition injection are implemented without any physics-layer hook, inflation becomes pure narrative.

**How to avoid:**
Define the physics-layer effects of inflation before implementing any LLM integration:
1. CPI should directly adjust the AMM `k` calibration or commodity price floor (prices rise in fiat terms as M1 expands).
2. WORK action wage deltas should be modifiable by a `wageInflationAdjustment` parameter that agents or governance can update.
3. Allostatic load thresholds (satiety cost) should be denominated in real units, not nominal fiat.

Only after the physics-layer inflation hooks exist should LLM inflation awareness be added. The LLM then drives agent decisions to use those hooks, not just narrate about them.

**Warning signs:**
- CPI is computed and injected into prompts but no physics parameter changes when CPI rises.
- Agent narratives describe "wage demands" and "hoarding" but `avgWealth` time series show smooth, unexplained compression.
- Inflation runs continuously in the LLM context but AMM spot prices remain stable.

**Phase to address:** Inflation phase. Verify physics-layer hooks before any prompt injection.

---

### Pitfall 8: The `computeSystemFiatTotal` Function Is Not Updated Atomically with New Financial Instruments

**What goes wrong:**
Each new financial instrument (bank reserves, deposit accounts, bond escrow, enterprise equity pools) introduces a new place where fiat can reside. If `computeSystemFiatTotal` is updated after the instrument is coded — rather than as the first step of implementing the instrument — there will be a window where the SFC audit silently passes while fiat is leaking into an uncounted pocket. By the time the audit is updated, the bug may have persisted through multiple phases and be masked by compensating errors elsewhere.

**Why it happens:**
The natural development order is: implement the instrument, wire up the logic, then update the SFC check. The SFC check is treated as bookkeeping that follows implementation rather than as a contract that defines the implementation boundary.

**How to avoid:**
Make updating `computeSystemFiatTotal` the first task in every feature ticket that introduces a new fiat location. Use a pattern analogous to the existing `treasury` parameter: each new fiat location is a named parameter with a default of zero. Add a compile-time check (TypeScript strict-mode) that forces callers to acknowledge new parameters. Write a test that verifies `computeSystemFiatTotal` returns the same value before and after each new instrument is initialized at zero.

**Warning signs:**
- The SFC assertion passes but aggregate agent wealth clearly changed without a corresponding change in treasury/AMM totals.
- The drift warning in the simulation runner fires intermittently — not every iteration, but on iterations where the new instrument first activates.
- Debugging reveals a map (`sessionBankReserves`, `sessionLoanBook`) that exists in the runner but is not passed to `computeSystemFiatTotal`.

**Phase to address:** Every phase that introduces new financial instruments. Add as a checklist item in the phase acceptance criteria.

---

### Pitfall 9: The Fiscal Multiplier Applies Before Revenue Is Collected

**What goes wrong:**
Fiscal spending with a multiplier effect (infrastructure → productivity bonus) is implemented as: `agent.productivity *= multiplier` on the iteration the budget is approved. But the government has not yet collected the tax revenue to fund the spending. The spending is applied immediately and the revenue arrives later (next iteration's tax cycle). This creates a one-iteration window where both the multiplier benefit and the government's un-funded spending amount are in the system simultaneously — a temporary M0 expansion that may not fully reverse if tax collection is approximate or subject to rounding.

**Why it happens:**
Multiplier effects are intuitive to implement as immediate stat buffs on a trigger event (governance approval). Tax collection happens in a separate phase of the simulation loop. The two are not linked by a strict pre-condition.

**How to avoid:**
Fiscal spending must debit the treasury before the multiplier is applied. The order in the simulation loop must be: (1) collect taxes into treasury, (2) approve budget allocation from treasury balance, (3) apply multiplier effects. If the treasury does not have sufficient balance, the spending is either deferred or pro-rated. This is identical to how wages are currently funded — `sessionStateTreasury` is debited before wage credits — and the same discipline applies.

**Warning signs:**
- Treasury goes negative on budget-approval iterations.
- `computeSystemFiatTotal` spikes on governance cycle iterations (multiplier applies but treasury has not been debited yet).
- Productivity averages jump on iteration 5 (governance cycle) then immediately correct on iteration 6 when revenue arrives — an artificial sawtooth pattern.

**Phase to address:** Fiscal policy phase. Enforce treasury-before-multiplier order in the governance cycle sequence.

---

### Pitfall 10: Bank Run Cascade Locks the Simulation

**What goes wrong:**
A bank run is triggered when agents simultaneously attempt to withdraw deposits the bank cannot cover (reserve ratio violation). If the simulation resolves withdrawal requests sequentially in agent order, the first N agents succeed and the remaining M agents receive zero — triggering death from poverty or allostatic overload for all M agents in a single iteration. This is realistic in isolation but catastrophic for simulation stability: a 50-agent society loses 20 agents in one tick, the LLM narrative becomes incoherent, and the SFC audit fires because dead agents' deposits are not properly written down.

**Why it happens:**
Sequential processing of concurrent withdrawal intents with no partial-fill mechanism. The order book already has this problem for buy orders (handled by escrow), but banking lacks an equivalent clearing mechanism.

**How to avoid:**
Implement bank runs as a multi-iteration process rather than a single-tick event:
1. When reserve ratio breaches threshold, enter a "bank stress" state.
2. In stress state, withdrawal requests are pro-rated across claimants using `distributeProRata`.
3. Central bank emergency liquidity provision (reserve injection from central bank balance) can prevent full failure.
4. If the bank fully fails, record it as a bankruptcy event and distribute remaining reserves pro-rata to depositors across multiple iterations.

This mirrors how real banking crises unfold and prevents single-iteration population collapse. The SFC implication: the central bank's emergency injection is an M0 expansion event — it must be tracked explicitly.

**Warning signs:**
- Population drops by >20% in a single iteration with no epidemic or food shortage explanation.
- Dead agents still have non-zero `depositBalance` in the bank's ledger.
- The SFC audit fires immediately after a mass-withdrawal event.

**Phase to address:** Banking phase. Design the bank failure resolution mechanism before opening deposits to agents.

---

## Technical Debt Patterns

Shortcuts that seem reasonable but create long-term problems.

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Store all bank state in `agent.wealth` only (no separate balance sheet tables) | No schema migration, works immediately | Cannot distinguish reserves from loans from deposits; M1 tracking impossible; SFC evolution is a rewrite | Never — the whole point of banking is the balance sheet distinction |
| Implement bonds as simple timed deposits (no secondary market, no yield curve) | Dramatically simpler | Prevents yield dynamics and monetary policy effects; unrealistic capital markets | Acceptable as Phase 1 if secondary market is planned in a follow-up |
| Calculate CPI from a single good (food price only) | Trivially easy, always available | CPI is misleading if food supply shock dominates; inflation narrative desynchronizes from capital goods reality | Acceptable for MVP if documented explicitly as "food CPI" not general CPI |
| Use a fixed reserve ratio (e.g., always 10%) | No central bank policy lever needed | Eliminates monetary policy as a simulation variable; central bank is decorative | Only acceptable if the milestone explicitly defers monetary policy |
| Accrue interest to loan balance instead of requiring cash payment | Prevents borrower death from interest | Bank never receives real fiat income; interest compounding is a fiat minting loop if not carefully bounded | Never for principal; acceptable for interest with explicit accrual-capitalization tracking |
| Run the inflation feedback loop every iteration rather than every N iterations | Simpler loop logic | CPI noise from small samples creates wild inflation swings; LLM agents get incoherent inflation signals | Never — always smooth CPI over a rolling window of at least 3–5 iterations |
| Reuse the existing `sessionStateTreasury` number to track central bank reserves | No new data structure needed | Treasury (fiscal) and central bank reserves (monetary) have different accounting rules; conflating them makes monetary policy impossible to implement correctly | Never — separate them from day one |

---

## Integration Gotchas

Common mistakes when connecting the new financial systems to the existing simulation.

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Banking + SFC audit | Adding bank reserves to `computeSystemFiatTotal` after the fact, discovering drift that predates the fix | Extend `computeSystemFiatTotal` as the first code change of the banking phase; zero-initialize bank reserves and verify the audit passes before any loans are created |
| Banking + agent cognition | Injecting the full loan book and interest rates into every agent prompt | Only inject the individual agent's own debt obligations and a system-level credit availability signal; full loan book context blows the token budget |
| Banking + order book | Bank agents participating in the order book using `depositLiabilities` as if they were cash reserves | Bank agents should have a separate `operatingAccount` (real base money) for market participation; deposit liabilities are never spendable by the bank |
| Capital markets + physicsEngine | Equity price changes applied as wealth deltas through `resolveAction` | Mark-to-market equity value must be tracked separately from `agent.wealth`; only realized sales change `agent.wealth`; unrealized gains are not spendable fiat |
| Fiscal multipliers + physicsEngine | Implementing multipliers as permanent stat modifications | Multipliers should decay over time or be re-applied each iteration they are funded; permanent modifications accumulate across budget cycles and eventually cap productivity at the stat ceiling |
| Inflation + AMM | Directly modifying AMM `k` to simulate price level changes | AMM k is a conservation invariant; changing k changes fiat reserves without agent consent — this is monetary policy by AMM manipulation, not inflation. Instead, adjust agent decision thresholds or willingness-to-pay parameters |
| Governance + fiscal budget | Budget approved by vote but not yet reflected in treasury debit | Separate "budget proposal," "budget approval," and "budget execution" as distinct state transitions; treasury debit happens at execution, not approval |
| Import/export + bank state | Bank balance sheets not included in session export | Any new financial state that must survive pause/resume must be added to the `SessionExport` schema and `remapSnapshotAgentIds`; bank loan books contain agent IDs |
| Inflation prompts + `sessionIterationMetrics` | Appending inflation data to the already-unbounded metrics string | Use the existing rolling window fix (last 3 iterations) and include only a single inflation signal number, not the full CPI history |

---

## Performance Traps

Patterns that work at small scale but fail as usage grows.

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Computing loan interest for every loan every iteration (O(loans × agents)) | Tick rate degrades as loan book grows | Batch interest accrual; compute in a single SQL aggregate query per bank per iteration | ~50 agents with average 3 loans each = 150 loan checks per tick |
| Loading full bond orderbook for every agent's INVEST decision | Memory spike when querying all available bonds | Pre-compute a "market summary" (top 5 bonds by yield) once per iteration and inject into all agent prompts | Bond market with >20 distinct instruments and 50+ agents |
| Resolving equity mark-to-market prices by scanning all trade history | Latency grows with session age | Maintain a running `lastTradedPrice` per enterprise in memory; persist on trade execution, not on read | Any simulation past iteration 20 with active equity trading |
| Running CPI calculation inside the tight iteration loop for every price data point | CPI computation adds measurable tick latency | Compute CPI once per iteration from the iteration's price snapshot (already being captured for telemetry); use batch SQL aggregate | CPI calculation involving >100 price samples |
| Bank run pro-ration using a loop over all depositors to compute shares | O(depositors) per iteration during stress | Use `distributeProRata` (already O(n) and handles remainders correctly) via a single precomputed pass | Any bank with >30 depositors |
| Writing each loan repayment as an individual DB row in `asyncLogFlusher` | `SQLITE_BUSY` during high-repayment iterations | Batch all repayment updates for a single iteration into one `asyncLogFlusher` call | >10 simultaneous loan repayments in one iteration |

---

## Security Mistakes

Domain-specific security issues beyond general web security.

| Mistake | Risk | Prevention |
|---------|------|------------|
| Allowing an LLM-driven bank agent to issue loans beyond the reserve ratio without a physics-layer enforcement gate | Bank agent narrative can "decide" to make unlimited loans; SFC integrity violated by LLM output | Reserve ratio enforcement must live in `physicsEngine.ts` (deterministic layer), never be LLM-gated; the LLM requests a loan amount, the physics engine approves only what reserve math allows |
| Allowing negative treasury balances as a simulation convenience | Treasury can drift to −∞ if governance repeatedly approves unfunded spending; SFC audit becomes unreliable | Treasury floor at zero (or an explicit overdraft limit backed by central bank reserve creation that is tracked as M0 expansion) |
| Letting the central bank issue unlimited reserves to prevent all bank failures | Central bank becomes a magic money printer; M0 is no longer constant; inflation model has no grounding | Central bank reserves must start at a fixed initial endowment; emergency liquidity provision depletes that endowment; when exhausted, bank failures proceed |
| Storing loan terms (interest rate, maturity) as LLM-generated JSON without schema validation | Malformed loan terms (e.g., `interestRate: "high"` or negative maturity) enter the loan book undetected | Validate all loan term fields with Zod schema at the physicsEngine boundary before any loan is recorded |

---

## UX Pitfalls

Common user experience mistakes in this domain.

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Displaying M1 money supply without distinguishing it from M0 in the telemetry UI | Users cannot tell if inflation is caused by money creation vs. price discovery; the simulation looks "broken" | Show M0 (base money, constant line), M1 (M0 + deposits), and loan-to-deposit ratio as three separate telemetry channels |
| Showing nominal wealth on the dashboard without a CPI deflator | A society with 200% inflation looks "prosperous" because nominal wealth is high; user draws wrong policy conclusions | Display real wealth (nominal / CPI index) alongside nominal; make the deflator basis year visible |
| Triggering a bank run cascade off-screen with no event signal | The simulation jumps from 50 to 30 agents in one iteration; users cannot explain what happened | Fire a `bank_stress` lifecycle event and a `bank_failure` event with cause metadata; surface both in the SSE stream and the reflection |
| Showing CPI as a raw per-iteration percentage change | 10 iterations of small prices changes produce a noisy CPI graph; users cannot see trends | Smooth CPI with a 3–5 iteration rolling average; show both the raw signal and the smoothed trend |
| Displaying bond yields without explaining the price-yield relationship | Users try to understand why bond "value" moves inversely to interest rates; the UI provides no explanation | Include a brief contextual note in the bond market panel; avoid showing raw yield change without direction indicator |

---

## "Looks Done But Isn't" Checklist

Things that appear complete but are missing critical pieces.

- [ ] **Fractional reserve banking:** Loan issuance logic is written — verify that `computeSystemFiatTotal` was extended to include `loansOutstanding` and the SFC assertion still passes after 5 iterations of lending.
- [ ] **Fractional reserve banking:** Loan repayment logic is written — verify that repaying a loan decreases both `bank.loanAssets` AND `borrower.depositBalance` by the same amount (not just transfers fiat to the bank).
- [ ] **Interest income:** Interest payment logic exists — verify that bank `reserves` increase by exactly the interest amount and that the SFC audit does not drift on an iteration where only interest (no principal) is paid.
- [ ] **Bank agent SFC perimeter:** Bank agents exist in the simulation — verify that removing a bank agent's fiat from `agent.wealth` and adding `bankReserves` as a separate line item in `computeSystemFiatTotal` produces the same total (no double-count or gap).
- [ ] **Bond issuance:** Government bonds are being issued — verify that the treasury balance increases AND the buyer's `agent.wealth` decreases by the same amount in the same tick.
- [ ] **Equity dividends:** Enterprise dividends are distributing — verify that `enterprise.treasury` decreased by exactly `Σ shareholder_dividend_credits` using the post-distribution assertion.
- [ ] **CPI calculation:** CPI is being computed — verify that it is calculated from actual market transaction prices (not AMM spot price alone) and that the base period is pinned to iteration 1 of each session.
- [ ] **Inflation → physics hooks:** Inflation context is injected into agent prompts — verify that at least one physics parameter (wage delta, commodity price floor, or AMM reserve adjustment) actually changes when CPI exceeds a threshold; otherwise inflation is pure narrative.
- [ ] **Fiscal multipliers:** Public goods multipliers are implemented — verify that the treasury is debited before the multiplier is applied, and that the multiplier decays or requires re-funding next cycle (no permanent stat accumulation).
- [ ] **Central bank reserves:** A central bank entity exists — verify that its initial reserve endowment is included in M0 and that any emergency reserve injection is tracked as M0 expansion (i.e., the SFC invariant acknowledges M0 is no longer constant when QE occurs).
- [ ] **Session import/export:** New financial tables exist (loans, bonds, equity, bank balance sheets) — verify that all new tables with agent ID references are included in the export schema and that `remapSnapshotAgentIds` covers the new ID fields.
- [ ] **`sessionIterationMetrics` growth:** Inflation and banking signals are being appended to metrics — verify the string is still bounded (rolling window, not unbounded append) after adding new financial context fields.
- [ ] **Bank failure:** A bank failure path exists — verify that all depositor balances sum to zero (or to remaining reserves, distributed pro-rata) after failure, and that dead depositors' outstanding balances are written off against the bank's loan book.

---

## Recovery Strategies

When pitfalls occur despite prevention, how to recover.

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| M0 contaminated (loans treated as wealth transfer) | HIGH | Audit all loan issuance paths, reconstruct correct loan asset / deposit liability balance sheets from DB history, recompute M0 baseline from pre-banking sessions, add migration script to split affected `agent.wealth` into reserves + deposits |
| SFC drift discovered at late phase | MEDIUM–HIGH | Isolate which iteration first showed drift via `_telemetry.totalFiatSupply` history; binary-search the commit history to find the introducing change; add the missed fiat location to `computeSystemFiatTotal`; verify drift is eliminated in a fresh test session |
| Inflation narrative without physics coupling (discovered after UI is shipped) | MEDIUM | Add physics-layer hooks (wage multiplier, AMM price floor) as a targeted patch; re-run existing test sessions to verify CPI changes now produce observable agent wealth changes; no DB migration required |
| Bank run cascade kills too many agents in one tick | MEDIUM | Add pro-ration to the withdrawal settlement function; introduce the "bank stress" state machine with multi-iteration resolution; existing sessions that already ran are not recoverable but new sessions will behave correctly |
| `sessionIterationMetrics` string bloat includes banking/inflation data (exceeds context window) | LOW–MEDIUM | Apply rolling window truncation to the string (last 3 iterations only); existing running sessions are paused by `SimulationPausedError` — resume will auto-truncate on next iteration |
| Bond issuance double-minting treasury (missing buyer debit) | MEDIUM | Find all bond issuance events in `resolvedActions` table; compute total double-minted amount; write a session-specific migration that reduces treasury by that amount and records a synthetic corrective transfer |
| Fiscal multiplier applied without treasury debit (treasury went negative) | LOW | The treasury floor prevents cascading SFC drift; add the debit-before-multiplier ordering fix; sessions with negative treasury can be corrected by zeroing the treasury and adjusting the M0 baseline accordingly |

---

## Pitfall-to-Phase Mapping

How roadmap phases should address these pitfalls.

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| M0/M1 invariant violation (Pitfalls 1–2) | Banking foundation phase — extend `computeSystemFiatTotal` first | SFC audit passes after 10 iterations of lending and repayment with no drift |
| Interest accounting errors (Pitfall 3) | Banking foundation phase — atomic interest transactions | Isolated unit test: interest payment moves exactly `amount` from borrower to bank reserves; total unchanged |
| Bank agent SFC perimeter gap (Pitfall 4) | Banking foundation phase — SFC perimeter extension | `computeSystemFiatTotal` before and after bank initialization returns identical totals |
| Bond issuance money creation (Pitfall 5) | Capital markets phase — primary bond auction | After bond auction, `Σ buyer.wealth` decreased by exactly `Σ proceeds`; treasury increased by same amount |
| Dividend/coupon fiat creation (Pitfall 6) | Capital markets phase — distribution functions | Post-distribution assertion in unit test: source account debit = Σ recipient credits |
| Inflation-narrative decoupling (Pitfall 7) | Inflation phase — physics hooks before prompts | CPI > threshold triggers measurable change in at least one physics parameter; verify in sandbox before prompt injection |
| `computeSystemFiatTotal` lagging (Pitfall 8) | Every new financial instrument phase | PR checklist item: "Does `computeSystemFiatTotal` include all new fiat locations added in this PR?" |
| Fiscal multiplier pre-funding violation (Pitfall 9) | Fiscal policy phase — budget execution sequence | Treasury balance never negative after budget execution; verified by SFC audit |
| Bank run cascade death (Pitfall 10) | Banking phase — failure resolution design | Simulate a forced bank run in sandbox; verify agent death count ≤ 3 agents per iteration during resolution |

---

## Sources

- [Agent Based-Stock Flow Consistent Macroeconomics: Towards a Benchmark Model](https://www.researchgate.net/publication/304491966_Agent_Based-Stock_Flow_Consistent_Macroeconomics_Towards_a_Benchmark_Model) — MEDIUM confidence (gated paper, abstract only)
- [Simulating the Fractional Reserve Banking using Agent-Based Models (CCL Northwestern)](https://ccl.northwestern.edu/2016/monett.pdf) — MEDIUM confidence (direct inspection)
- [DIY Macroeconomic Model Simulation: SFC Model of the Monetary Circuit](https://macrosimulation.org/an_sfc_model) — HIGH confidence (directly inspected; explicit balance sheet accounting rules)
- [Stock-flow consistent model — Wikipedia](https://en.wikipedia.org/wiki/Stock_flow_consistent_model) — MEDIUM confidence (overview, points to Godley-Lavoie)
- [Money Creation under Full-reserve Banking: A Stock-flow Consistent Analysis (Levy Institute WP-851)](https://www.levyinstitute.org/pubs/wp_851.pdf) — HIGH confidence (academic working paper, directly addresses M0/M1 accounting)
- [Fiscal Policy in a Stock-Flow Consistent (SFC) Model — Levy Institute](https://www.levyinstitute.org/publications/fiscal-policy-in-a-stock-flow-consistent-sfc-model/) — HIGH confidence
- [EconAgent: LLM-Empowered Agents for Simulating Macroeconomic Activities (ACL 2024)](https://aclanthology.org/2024.acl-long.829.pdf) — MEDIUM confidence (LLM macro-simulation pitfalls, inflation expectations section)
- [Agent-Based Modeling in Economics and Finance: Past, Present, and Future (INET)](https://oms-inet.files.svdcdn.com/staging/files/JEL-v2.0.pdf) — MEDIUM confidence (bank run cascade mechanics)
- [On the Instability of Fractional Reserve Banking (ScienceDirect 2025)](https://www.sciencedirect.com/science/article/abs/pii/S0014292125001618) — MEDIUM confidence (reserve ratio instability thresholds)
- [Interbank Decisions and Margins of Stability: Agent-Based SFC Approach (JEDC 2024)](https://ideas.repec.org/a/eee/dyncon/v160y2024ics0165188924000149.html) — MEDIUM confidence (contagion cascade ordering)
- Direct codebase inspection: `server/src/orchestration/simulationRunner.ts`, `server/src/mechanics/automatedMarketMaker.ts`, `server/src/db/schema.ts`, `.planning/codebase/CONCERNS.md` — HIGH confidence

---

*Pitfalls research for: Fractional reserve banking + capital markets + fiscal policy + inflation — layered onto Ideal World SFC simulation*
*Researched: 2026-04-01*
