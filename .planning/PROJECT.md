# PolicyLab

## What This Is

A local-first, LLM-powered multi-agent economic simulation platform for policy experimentation. It models micro-societies of 20–150+ "Citizen Agents" using a Neuro-Symbolic Engine: LLMs drive intentions and narratives while a deterministic physics/economic engine enforces resource constraints, financial systems, and psychological realism. Designed as a sandbox for policymakers to preview the effects of economic policies before real-world implementation.

Forked from the Ideal World project with a sharper focus on economic realism and policy evaluation.

## Core Value

The deterministic economic engine must be realistic enough that simulation outcomes are meaningful for understanding real-world policy trade-offs — not just entertaining narratives, but grounded macro-economic dynamics that policymakers can use to preview policy effects.

## Current Milestone: v1.0 Real Economy Engine — FEATURE COMPLETE

**Goal:** Transform the simulation from a cash/barter economy into a modern economic system with banking, capital markets, fiscal policy, and inflation dynamics — enabling realistic macro-economic behavior and policy experimentation.

**Status:** All 7 phases complete (Phases 1-7). Post-implementation audit done (65 issues fixed across 5 rounds). Modularity refactoring complete (Phase A+B). See `MODULE_MAP.md` for current architecture.

**Delivered features:**
- Fractional reserve banking (bank agents, central bank, money creation through lending)
- Full capital markets (enterprise equity, government & corporate bonds)
- Fiscal spending with multipliers and persistent public goods quality
- Inflation feedback loop (CPI tracking, money supply effects, agent cognition integration)
- Real-time economic dashboard (CPI, money supply, fiscal, bond yields)
- Scenario builder with tab-based A/B comparison
- Real-world location bootstrap from World Bank data (23 indicators)

## Requirements

### Validated

<!-- Shipped and confirmed valuable. Inherited from Ideal World codebase. -->

- ✓ Constant-product AMM for food + commodities — v0
- ✓ Order book matching engine for peer-to-peer trade — v0
- ✓ Role-based wage tiers via WORK action — v0
- ✓ Private enterprise system (FOUND, hire, produce, sell) — v0
- ✓ MET-based metabolism and satiety consumption — v0
- ✓ Allostatic load (cortisol → strain → load) — v0
- ✓ Demurrage tax + UBI redistribution (SFC-compliant) — v0
- ✓ Skill system with learning-by-doing and decay — v0
- ✓ Inventory system (food, tools, luxury, raw materials) with quality/spoilage — v0
- ✓ 20+ action codes with role-tier permission gates — v0
- ✓ Democratic governance cycle (franchise selection, proposals, voting, ratification) — v0
- ✓ Multi-provider LLM gateway (Anthropic, OpenAI, Gemini, Vertex, Ollama) — v0
- ✓ Full session lifecycle (idea → brainstorm → design → simulate → reflect → review) — v0
- ✓ Economy tab with policymaker parameter controls (slider+numeric, soft limits, tooltips) — Phase 6
- ✓ Fork-based A/B scenario comparison with config diff and 8-dimension scoring — Phase 6
- ✓ SSE real-time simulation streaming — v0
- ✓ Session comparison with LLM analysis — v0
- ✓ Import/export, reflection, and review flows — v0
- ✓ SFC conservation law enforcement (total fiat audit) — v0
- ✓ Fractional reserve banking with bank agent role and central bank — Phase 1
- ✓ Loan contracts with interest rates, terms, and repayment schedules — Phase 1
- ✓ Default and bankruptcy mechanics for unpaid loans — Phase 1
- ✓ Deposit accounts with interest returns — Phase 1
- ✓ M1/M2 money supply tracking (updated SFC invariant) — Phase 1
- ✓ Enterprise equity — buy/sell shares, dividend distribution — Phase 2
- ✓ Government bonds — treasury issues debt, pays coupon interest — Phase 2
- ✓ Corporate bonds — enterprises issue debt for capital — Phase 2
- ✓ Budget categories configurable at session design time — Phase 3
- ✓ Spending multipliers — each category affects simulation stats — Phase 3
- ✓ Public goods quality scores — Phase 3
- ✓ CPI calculation from market price data — Phase 4
- ✓ Money supply → price level feedback — Phase 4
- ✓ Inflation expectations injected into agent cognition — Phase 4
- ✓ Real-time economic dashboard (CPI, M1/M2, fiscal, bond yields) — Phase 5
- ✓ Scenario builder with A/B comparison — Phase 6
- ✓ Real-world location bootstrap from World Bank data — Phase 7
- ✓ EconomyConfig type holding all tunable parameters as session-level config — Phase 1

### Active

<!-- Current scope — post-milestone quality and architecture work. -->

- [ ] Test coverage expansion (26% → target 60%+) — see MODULE_MAP.md Wave 1-6
- [ ] SimulationRunner subsystem tick extraction (Phase B1 deferred)
- [ ] Frontend API layer standardization (Phase C)
- [ ] Full centralAgent DB write extraction (Phase A2 deferred)

### Out of Scope

<!-- Explicit boundaries. Includes reasoning to prevent re-adding. -->

- Governance overhaul (separation of powers, constitutional enforcement, courts) — future milestone
- Policymaker comparison tools (distributional analysis, policy briefs, A/B scenarios) — future milestone
- Scenario builder UI for policymaker-friendly parameter entry — future milestone (v1.0 establishes config surface)
- Real-time multiplayer / networked simulations — fundamentally different architecture
- Derivatives market (options, futures, swaps) — incompatible with discrete-iteration ABM ticks
- Interbank lending market — meaningless with 1–2 bank agents
- Per-agent credit scores — wealth history is a sufficient proxy at this scale
- Hyperinflation caps — clamping destroys experiment value

## Context

Forked from Ideal World at commit 79499b2. The existing economy is stock-flow consistent with a constant-product AMM, order book, enterprise system, and demurrage/UBI redistribution. The SFC invariant currently enforces `Σ agent_wealth + AMM_reserves + treasury + escrow = constant`. Fractional reserve banking will evolve this to track M0 (base money, constant) vs M1/M2 (expanded through lending).

The governance system currently has 3 policy levers (tax_rate, ubi_allocation, enforcement_level) and runs a democratic cycle every 5 iterations. Fiscal spending will add budget allocation as a design-time config that flows through the economic engine.

## Constraints

- **SFC Integrity**: Every new financial instrument must maintain stock-flow consistency. M0 must remain constant; M1/M2 expansion must be fully traceable through the banking system.
- **Big Bang Delivery**: All systems designed together as one coherent update. Each phase should be internally complete but the full feature set ships as a unit.
- **Backward Compatibility**: Existing sessions must still work. New economic features activate for new sessions; old sessions run with legacy mechanics.
- **Performance**: Banking/capital market operations must not degrade the simulation tick rate. Batch operations where possible.
- **LLM Budget**: Agent cognition changes (inflation awareness) must work within existing prompt token budgets. Inject economic context efficiently.
- **Config Surface**: All economic parameters must be session-level config (EconomyConfig type) to enable future scenario builder UI.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Fork from Ideal World | Project scope shifted from philosophy sandbox to policy evaluation platform | ✓ Good |
| Fractional reserve over strict conservation | Modern economies create money through lending; core mechanism for boom/bust cycles | — Pending |
| Bank agent role + central bank | Dedicated roles create realistic institutional structure; monetary policy lever | — Pending |
| Full capital markets (equity + bonds) | Enables productive capital accumulation beyond cash hoarding | — Pending |
| Design-time budget config over voting | Simpler for v1.0; voting can be added later as governance enhancement | — Pending |
| Full inflation feedback loop | Agents reacting to inflation creates realistic behavioral dynamics | — Pending |
| Big bang delivery | Systems are deeply interconnected — banking feeds capital markets, fiscal policy affects money supply | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd:transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-04-05 after v1.0 milestone feature completion + post-implementation audit + modularity refactoring*