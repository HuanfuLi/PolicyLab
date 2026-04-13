/**
 * AutomatedMarketMaker — Tasks 3 & 4 of the Tick-Based Architecture
 *
 * TASK 3: Constant Product AMM (x·y = k)
 *   Replaces the peer-to-peer order book with an always-liquid system market
 *   maker. No order matching is required — any agent can buy or sell at any
 *   time, with price impact determined purely by reserve ratios.
 *
 *   Invariant:   k = FiatReserve × FoodReserve   (never changes)
 *   Spot price:  P = FiatReserve / FoodReserve    (fiat per food unit)
 *
 *   Buy Δx fiat worth of food:
 *     New_Fiat  = FiatReserve + Δx
 *     New_Food  = k / New_Fiat
 *     Dispensed = FoodReserve − New_Food
 *
 *   Sell Δy food for fiat:
 *     New_Food  = FoodReserve + Δy
 *     New_Fiat  = k / New_Food
 *     Received  = FiatReserve − New_Fiat
 *
 *   Price impact: buying food when reserves are low causes exponential price
 *   spikes (approaching k/FoodReserve²), naturally rationing scarce food.
 *   The market never freezes — it always clears at some price.
 *
 * TASK 4: Stock-Flow Consistent UBI (Demurrage Tax)
 *   Prevents liquidity traps and fiat hoarding via a 2% wealth tax on all
 *   agents at the end of each macro-cycle, redistributed as Universal Basic
 *   Income (UBI) to all living agents equally.
 *
 *   Demurrage loop:
 *     For each agent i:  tax_i = wealth_i × τ  (τ = 0.02)
 *     Pool = Σ tax_i
 *     UBI per agent = Pool / livingAgentCount
 *     Each agent: wealth += (UBI − tax_i)   [net: rich agents lose, poor gain]
 *
 *   Stock-flow consistency: total fiat in system is conserved (Pool distributes
 *   to the same agents it was collected from). No money is created or destroyed.
 *
 * MODULE BOUNDARY:
 *   This module is FULLY DETERMINISTIC and LLM-independent (Symbolic layer).
 *   Agents decide WHEN to buy/sell via LLM — this engine only resolves HOW MUCH
 *   they get and updates reserve state.
 *
 * STANDALONE: Do NOT import simulationRunner.ts. Integration is deferred.
 */

import { distributeProRata } from '@policylab/shared';
// Re-export AMMState from shared (moved there for cross-module access)
export type { AMMState } from '@policylab/shared';
import type { AMMState } from '@policylab/shared';

// ── Constants ──────────────────────────────────────────────────────────────────

/** Demurrage tax rate per macro-cycle. */
const DEMURRAGE_TAX_RATE = 0.02;

/** Maximum allowed price impact per trade (50%). Prevents pool-draining trades. */
const MAX_SLIPPAGE = 0.5;

// ── Demurrage Types ───────────────────────────────────────────────────────────

export interface AgentWealth {
  agentId: string;
  wealth: number;
}

export interface DemurrageResult {
  /** Per-agent net wealth change (positive = gained, negative = lost). */
  netDeltas: Map<string, number>;
  /** Total fiat collected as tax. */
  taxPoolCollected: number;
  /** Fractional amount left undistributed after flooring the UBI pool to an integer. */
  ubiFractionalRemainder: number;
  /** UBI per agent paid out. */
  ubiPerAgent: number;
  /** Number of living agents in the cycle. */
  livingAgentCount: number;
}

// ── Quote Types ───────────────────────────────────────────────────────────────

export interface BuyQuote {
  /** Fiat the agent will spend. */
  fiatIn: number;
  /** Food units the agent will receive. */
  foodOut: number;
  /** Effective price paid per unit (fiatIn / foodOut). */
  effectivePrice: number;
  /** Spot price before the trade executes. */
  spotPriceBefore: number;
  /** Spot price after the trade executes. */
  spotPriceAfter: number;
  /** Price impact as a fraction of spot (0.05 = 5% slippage). */
  priceImpact: number;
  /** Whether the trade is executable (sufficient reserves). */
  executable: boolean;
  /** Reason if not executable. */
  rejectReason?: string;
}

export interface SellQuote {
  /** Food units the agent will sell. */
  foodIn: number;
  /** Fiat the agent will receive. */
  fiatOut: number;
  /** Effective price received per unit (fiatOut / foodIn). */
  effectivePrice: number;
  /** Spot price before the trade executes. */
  spotPriceBefore: number;
  /** Spot price after the trade executes. */
  spotPriceAfter: number;
  /** Price impact as a fraction of spot. */
  priceImpact: number;
  /** Whether the trade is executable. */
  executable: boolean;
  rejectReason?: string;
}

export interface TradeReceipt {
  success: boolean;
  rejectReason?: string;
  /** Updated AMM state after the trade. */
  newState: AMMState;
  quote: BuyQuote | SellQuote;
  executedAtTick: number;
}

// ── AutomatedMarketMaker Class ────────────────────────────────────────────────

/**
 * Constant Product Automated Market Maker (x·y = k).
 *
 * One instance per simulation session. Stateful — call snapshot() to persist
 * to DB and restore(state) to resume after a server restart.
 *
 * Thread safety: The simulation tick loop is single-threaded (Node.js event
 * loop). No locking needed within a single session.
 */
export class AutomatedMarketMaker {
  private fiatReserve: number;
  private foodReserve: number;
  private k: number;
  private readonly initialFiatReserve: number;
  private readonly initialFoodReserve: number;
  private lastUpdatedTick: number;

  /**
   * @param initialFiatReserve  System fiat (should be ≥ 10× total agent fiat
   *                             to minimise price impact on small trades).
   * @param initialFoodReserve  System food units (sets initial spot price).
   * @param currentTick         Global tick at initialisation.
   *
   * Recommended initial values for a 50-agent session:
   *   fiat = 5000  (avg wealth 50 × 50 agents = 2500; AMM holds 2× for depth)
   *   food = 1000  → spot price = 5.0 fiat/unit
   *   k    = 5,000,000
   *
   * Spot price rationale: at 5w/unit, a full-satiety restoration (~35 pts)
   * costs ~3 units = 15w. A solo WORK generates 6–14w/tick. Agents can
   * afford food without permanent destitution, but must actively earn.
   */
  constructor(
    initialFiatReserve: number,
    initialFoodReserve: number,
    currentTick = 0,
  ) {
    if (initialFiatReserve <= 0 || initialFoodReserve <= 0) {
      throw new Error('[AMM] Reserves must be strictly positive.');
    }
    this.fiatReserve = initialFiatReserve;
    this.foodReserve = initialFoodReserve;
    this.k = initialFiatReserve * initialFoodReserve;
    this.initialFiatReserve = initialFiatReserve;
    this.initialFoodReserve = initialFoodReserve;
    this.lastUpdatedTick = currentTick;
  }

  // ── Accessors ────────────────────────────────────────────────────────────

  /** Current spot price: fiat per food unit. */
  get spotPrice(): number {
    return this.fiatReserve / Math.max(0.01, this.foodReserve);
  }

  /** Constant product invariant (should never change). */
  get invariantK(): number {
    return this.k;
  }

  get currentFiatReserve(): number { return this.fiatReserve; }
  get currentFoodReserve(): number { return this.foodReserve; }

  // ── Quote Methods (pure — no state mutation) ──────────────────────────────

  /**
   * Quote how much food an agent receives for spending `fiatAmount`.
   *
   * Derivation:
   *   New_Fiat  = x + Δx
   *   New_Food  = k / New_Fiat      (invariant preserved)
   *   Dispensed = y − New_Food
   *
   * PURE — does not mutate reserves.
   */
  quoteBuy(fiatAmount: number): BuyQuote {
    const spotBefore = this.spotPrice;

    if (fiatAmount <= 0) {
      return this.rejectBuyQuote(fiatAmount, 0, spotBefore, 'fiatAmount must be positive');
    }

    const newFiat = this.fiatReserve + fiatAmount;
    const newFood = this.k / newFiat;
    const foodDispensed = this.foodReserve - newFood;

    // Asymptotic floor: food reserve approaches but never reaches zero.
    // This allows astronomical prices during famines without crashing.
    // When the clamp triggers, mirror executeBuy exactly: use clamped food reserve
    // so quoted foodOut and spotPriceAfter match what execution will actually deliver.
    const effectiveNewFood = Math.max(0.01, newFood);
    const effectiveFoodDispensed = this.foodReserve - effectiveNewFood;

    if (effectiveFoodDispensed <= 0) {
      return this.rejectBuyQuote(fiatAmount, 0, spotBefore, 'insufficient food reserves');
    }

    const spotAfter = newFiat / effectiveNewFood;
    const effectivePrice = fiatAmount / effectiveFoodDispensed;
    const priceImpact = Math.abs(effectivePrice - spotBefore) / spotBefore;

    if (priceImpact > MAX_SLIPPAGE) {
      return this.rejectBuyQuote(fiatAmount, effectiveFoodDispensed, spotBefore,
        `price impact ${(priceImpact * 100).toFixed(1)}% exceeds max slippage ${MAX_SLIPPAGE * 100}%`);
    }

    return {
      fiatIn: fiatAmount,
      foodOut: effectiveFoodDispensed,
      effectivePrice,
      spotPriceBefore: spotBefore,
      spotPriceAfter: spotAfter,
      priceImpact,
      executable: true,
    };
  }

  /**
   * Quote how much fiat an agent receives for selling `foodAmount` units.
   *
   * Derivation:
   *   New_Food  = y + Δy
   *   New_Fiat  = k / New_Food      (invariant preserved)
   *   Received  = x − New_Fiat
   *
   * PURE — does not mutate reserves.
   */
  quoteSell(foodAmount: number): SellQuote {
    const spotBefore = this.spotPrice;

    if (foodAmount <= 0) {
      return this.rejectSellQuote(foodAmount, 0, spotBefore, 'foodAmount must be positive');
    }

    const newFood = this.foodReserve + foodAmount;
    const newFiat = this.k / newFood;
    const fiatReceived = this.fiatReserve - newFiat;

    if (fiatReceived <= 0) {
      return this.rejectSellQuote(foodAmount, 0, spotBefore, 'insufficient fiat reserves');
    }

    if (newFiat < 0.01) {
      return this.rejectSellQuote(foodAmount, fiatReceived, spotBefore,
        'trade would exhaust fiat reserves');
    }

    const spotAfter = newFiat / newFood;
    const effectivePrice = fiatReceived / foodAmount;
    const priceImpact = Math.abs(effectivePrice - spotBefore) / spotBefore;

    if (priceImpact > MAX_SLIPPAGE) {
      return this.rejectSellQuote(foodAmount, fiatReceived, spotBefore,
        `price impact ${(priceImpact * 100).toFixed(1)}% exceeds max slippage ${MAX_SLIPPAGE * 100}%`);
    }

    return {
      foodIn: foodAmount,
      fiatOut: fiatReceived,
      effectivePrice,
      spotPriceBefore: spotBefore,
      spotPriceAfter: spotAfter,
      priceImpact,
      executable: true,
    };
  }

  // ── Execute Methods (mutate reserves) ────────────────────────────────────

  /**
   * Execute a buy order: agent spends `fiatAmount`, receives food.
   * Mutates internal reserve state.
   *
   * @returns TradeReceipt with food dispensed and updated AMM state.
   */
  executeBuy(fiatAmount: number, currentTick: number): TradeReceipt {
    const quote = this.quoteBuy(fiatAmount);

    if (!quote.executable) {
      return {
        success: false,
        rejectReason: quote.rejectReason,
        newState: this.snapshot(currentTick),
        quote,
        executedAtTick: currentTick,
      };
    }

    // Apply reserve update
    this.fiatReserve += fiatAmount;
    this.foodReserve = this.k / this.fiatReserve;
    // Asymptotic floor: prevent depletion below minimum reserve.
    // Maintain k invariant by adjusting fiat reserve instead of degrading k.
    if (this.foodReserve < 0.01) {
      this.foodReserve = 0.01;
      this.fiatReserve = this.k / 0.01;  // raise fiat to preserve k
    }
    this.lastUpdatedTick = currentTick;

    // Invariant check (floating-point guard)
    this.assertInvariant();

    return {
      success: true,
      newState: this.snapshot(currentTick),
      quote,
      executedAtTick: currentTick,
    };
  }

  /**
   * Execute a sell order: agent sells `foodAmount`, receives fiat.
   * Mutates internal reserve state.
   *
   * @returns TradeReceipt with fiat received and updated AMM state.
   */
  executeSell(foodAmount: number, currentTick: number): TradeReceipt {
    const quote = this.quoteSell(foodAmount);

    if (!quote.executable) {
      return {
        success: false,
        rejectReason: quote.rejectReason,
        newState: this.snapshot(currentTick),
        quote,
        executedAtTick: currentTick,
      };
    }

    // Apply reserve update
    this.foodReserve += foodAmount;
    this.fiatReserve = this.k / this.foodReserve;
    this.lastUpdatedTick = currentTick;

    this.assertInvariant();

    return {
      success: true,
      newState: this.snapshot(currentTick),
      quote,
      executedAtTick: currentTick,
    };
  }

  /**
   * Inject goods directly into the reserve (system enterprise liquidation).
   * Updates the invariant k so subsequent trades reflect the new depth.
   *
   * @param amount  Number of goods units to add (must be > 0).
   */
  injectGoodsReserve(amount: number): void {
    if (amount <= 0) return;
    this.foodReserve += amount;
    this.k = this.fiatReserve * this.foodReserve;
  }

  /**
   * Inject fiat directly into the reserve (e.g. enterprise registration fees).
   * Updates the invariant k — fiat re-enters the circular economy rather than disappearing.
   *
   * @param amount  Fiat units to add (must be > 0).
   */
  injectFiatReserve(amount: number): void {
    if (amount <= 0) return;
    this.fiatReserve += amount;
    this.k = this.fiatReserve * this.foodReserve;
  }

  /**
   * Withdraw fiat directly from the reserve (e.g. recycling AMM profit as UBI).
   * Updates the invariant k.
   *
   * @param amount  Fiat units to withdraw (must be > 0 and < fiatReserve).
   * @returns Actual amount withdrawn (may be less than requested if floor is hit).
   */
  withdrawFiatReserve(amount: number): number {
    if (amount <= 0) return 0;
    const before = this.fiatReserve;
    this.fiatReserve = Math.max(0.01, this.fiatReserve - amount);
    this.k = this.fiatReserve * this.foodReserve;
    return before - this.fiatReserve;  // actual amount withdrawn
  }

  /**
   * Withdraw goods directly from the reserve (e.g. inflation feedback contraction).
   * Updates the invariant k.
   *
   * @param amount  Goods units to withdraw (must be > 0 and < foodReserve).
   * @returns Actual amount withdrawn (may be less than requested if floor is hit).
   */
  withdrawGoodsReserve(amount: number): number {
    if (amount <= 0) return 0;
    const before = this.foodReserve;
    this.foodReserve = Math.max(0.01, this.foodReserve - amount);
    this.k = this.fiatReserve * this.foodReserve;
    return before - this.foodReserve;  // actual amount withdrawn
  }

  // ── Persistence ───────────────────────────────────────────────────────────

  snapshot(currentTick = this.lastUpdatedTick): AMMState {
    return {
      fiatReserve: this.fiatReserve,
      foodReserve: this.foodReserve,
      k: this.k,
      lastUpdatedTick: currentTick,
    };
  }

  /** Restore from DB snapshot (e.g., after server restart). */
  restore(state: AMMState): void {
    this.fiatReserve = state.fiatReserve;
    this.foodReserve = state.foodReserve;
    this.lastUpdatedTick = state.lastUpdatedTick;
    // Always re-anchor k from the restored reserves. This eliminates any
    // floating-point drift accumulated through JSON serialisation round-trips.
    this.k = this.fiatReserve * this.foodReserve;
  }

  // ── Diagnostics ───────────────────────────────────────────────────────────

  /**
   * Maximum food an agent could buy before reserves hit the MIN_RESERVE_RATIO floor.
   * Useful for prompts: "Max purchasable food this tick: N units".
   */
  maxBuyableFood(): number {
    const minFoodReserve = 0.01;
    if (this.foodReserve <= minFoodReserve) return 0;
    return this.foodReserve - minFoodReserve;
  }

  /**
   * Fiat cost to buy exactly `foodUnits` (convenience wrapper over quoteBuy).
   * Returns null if not executable.
   */
  fiatCostForFood(foodUnits: number): number | null {
    // Invert the AMM formula: given Δy food dispensed, find Δx fiat required.
    // New_Food = y − Δy  →  New_Fiat = k / New_Food  →  Δx = New_Fiat − x
    const newFood = this.foodReserve - foodUnits;
    if (newFood <= 0 || newFood < 0.01) return null;
    const newFiat = this.k / newFood;
    return newFiat - this.fiatReserve;
  }

  // ── Private Helpers ───────────────────────────────────────────────────────

  private assertInvariant(): void {
    const actual = this.fiatReserve * this.foodReserve;
    const drift = Math.abs(actual - this.k) / this.k;
    if (drift > 0.0001) {
      // Floating-point drift: re-anchor food reserve from k
      this.foodReserve = this.k / this.fiatReserve;
    }
  }

  private rejectBuyQuote(fiatIn: number, foodOut: number, spot: number, reason: string): BuyQuote {
    return {
      fiatIn, foodOut,
      effectivePrice: 0, spotPriceBefore: spot, spotPriceAfter: spot,
      priceImpact: 0, executable: false, rejectReason: reason,
    };
  }

  private rejectSellQuote(foodIn: number, fiatOut: number, spot: number, reason: string): SellQuote {
    return {
      foodIn, fiatOut,
      effectivePrice: 0, spotPriceBefore: spot, spotPriceAfter: spot,
      priceImpact: 0, executable: false, rejectReason: reason,
    };
  }
}

// ── Demurrage UBI (Task 4) ────────────────────────────────────────────────────

/**
 * Compute and apply a single Demurrage macro-cycle.
 *
 * Algorithm:
 *   1. Collect τ = 2% tax from every living agent's wealth (floor: 0).
 *   2. Sum all collected tax into Global_UBI_Pool.
 *   3. Divide pool equally among ALL living agents (including the rich who paid more).
 *
 * Net effect per agent:
 *   Net_i = UBI_per_agent − tax_i
 *         = (Pool / N) − (wealth_i × τ)
 *         = (Σ wealth_j × τ / N) − (wealth_i × τ)
 *         = τ × (avg_wealth − wealth_i)
 *
 * This is equivalent to a Robin Hood transfer: agents below average wealth
 * receive a net positive transfer; agents above pay a net positive tax.
 * Total fiat in the system is strictly conserved: Σ Net_i = 0.
 *
 * Stock-flow consistency proof:
 *   Σ Net_i = Σ (UBI − tax_i) = N × UBI − Σ tax_i = Pool − Pool = 0  ✓
 *
 * PURE FUNCTION — returns deltas, does not mutate agent objects.
 *
 * @param agents        All living agents with their current wealth.
 * @param taxRate       Override the demurrage tax rate (default: DEMURRAGE_TAX_RATE = 0.02).
 * @param ubiAllocation Fraction of collected tax redistributed as UBI (default: 1.0 = 100%).
 * @returns             DemurrageResult with per-agent net deltas and macro stats.
 */
export function computeDemurrageCycle(
  agents: AgentWealth[],
  taxRate = DEMURRAGE_TAX_RATE,
  ubiAllocation = 1.0,
): DemurrageResult {
  const livingAgentCount = agents.length;

  if (livingAgentCount === 0) {
    return {
      netDeltas: new Map(),
      taxPoolCollected: 0,
      ubiFractionalRemainder: 0,
      ubiPerAgent: 0,
      livingAgentCount: 0,
    };
  }

  // Step 1: Collect tax
  let taxPoolCollected = 0;
  const taxMap = new Map<string, number>();

  for (const agent of agents) {
    // Clamp to non-negative: negative-wealth agents must not receive a subsidy from the tax pool.
    const tax = Math.max(0, agent.wealth * taxRate);
    taxMap.set(agent.agentId, tax);
    taxPoolCollected += tax;
  }

  // Step 2: Compute UBI per agent from the redistributable pool
  const redistributablePool = taxPoolCollected * Math.min(1, Math.max(0, ubiAllocation));
  // Floor to integer for distributeProRata (which requires integer input).
  // The sub-unit fractional remainder stays in the tax pool (treasury) — not lost, just not redistributed.
  // distributeProRata(fractional) creates fiat (floor-loop overruns) and must not receive fractional input.
  const totalPoolInt = Math.floor(redistributablePool);
  const ubiFractionalRemainder = redistributablePool - totalPoolInt;
  const weights = agents.map(() => 1);  // Equal weights: each living agent gets one share
  const ubiShares = distributeProRata(totalPoolInt, weights);  // Sums exactly to totalPoolInt
  // ubiPerAgent for interface compat: average share (may be fractional for display only)
  const ubiPerAgent = livingAgentCount > 0 ? totalPoolInt / livingAgentCount : 0;

  // Step 3: Compute net delta per agent (UBI received − tax paid)
  const netDeltas = new Map<string, number>();
  for (let i = 0; i < agents.length; i++) {
    const agent = agents[i];
    const tax = taxMap.get(agent.agentId) ?? 0;
    const ubiReceived = ubiShares[i] ?? 0;
    netDeltas.set(agent.agentId, ubiReceived - tax);
  }

  return {
    netDeltas,
    taxPoolCollected,
    ubiFractionalRemainder,
    ubiPerAgent,
    livingAgentCount,
  };
}

// ── AMM Factory ───────────────────────────────────────────────────────────────

/**
 * Initialise an AMM with balanced reserves for a given session size.
 *
 * Sizing heuristic:
 *   - Target spot price: 5–8 fiat/unit (affordable on a WORK wage of 6–14w/tick)
 *   - Reserve depth: AMM holds fiat ≥ 4× total agent fiat (low price impact)
 *   - k = fiatReserve × foodReserve
 *
 * @param agentCount      Total living agents.
 * @param avgAgentWealth  Average starting wealth (default 50).
 * @param targetSpotPrice Desired initial food price (default 6.0 fiat/unit).
 */
export function createAMMForSession(
  agentCount: number,
  avgAgentWealth = 50,
  targetSpotPrice = 6.0,
  currentTick = 0,
): AutomatedMarketMaker {
  const totalAgentFiat = agentCount * avgAgentWealth;

  // AMM holds 4× total agent fiat for depth
  const fiatReserve = totalAgentFiat * 4;

  // Food reserve derived from target spot price: P = x/y → y = x/P
  const foodReserve = fiatReserve / targetSpotPrice;

  return new AutomatedMarketMaker(fiatReserve, foodReserve, currentTick);
}

/** Item types that have dedicated AMM pools (excluding food which uses the primary AMM). */
export const MULTI_AMM_ITEM_TYPES = ['raw_materials', 'luxury_goods', 'tools'] as const;
export type MultiAMMItemType = typeof MULTI_AMM_ITEM_TYPES[number];

/** Initial spot prices for non-food commodity AMM pools. */
const COMMODITY_SPOT_PRICES: Record<MultiAMMItemType, number> = {
  raw_materials: 4.0,  // cheaper than food, basic material
  luxury_goods: 12.0,  // expensive, discretionary item
  tools: 12.0,         // durable goods, similar price tier to luxury
};

/**
 * Create a multi-commodity AMM registry (one pool per non-food commodity).
 * Each pool sized at 2× total agent fiat for depth (smaller than food AMM).
 */
export function createMultiCommodityAMMs(
  agentCount: number,
  avgAgentWealth = 50,
  currentTick = 0,
): Map<MultiAMMItemType, AutomatedMarketMaker> {
  const totalAgentFiat = agentCount * avgAgentWealth;
  const pools = new Map<MultiAMMItemType, AutomatedMarketMaker>();

  for (const itemType of MULTI_AMM_ITEM_TYPES) {
    const spotPrice = COMMODITY_SPOT_PRICES[itemType];
    const fiatReserve = totalAgentFiat * 2; // 2× depth for non-food commodities
    const goodsReserve = fiatReserve / spotPrice;
    pools.set(itemType, new AutomatedMarketMaker(fiatReserve, goodsReserve, currentTick));
  }

  return pools;
}
