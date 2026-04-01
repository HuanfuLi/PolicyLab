/**
 * Economy types for the Neuro-Symbolic Architecture Phase 1.
 * Shared between frontend and backend.
 *
 * These types support:
 *  - 1A: Dynamic Skills & Dual-Track Production
 *  - 1B: Physical Asset Inventory
 *  - 1C: Global Order Book Matching Engine
 */

// ── 1A: Dynamic Skills ────────────────────────────────────────────────────────

/**
 * Skill categories that agents can develop through "learning by doing".
 * Each skill has a multiplier (0–100) that affects production output.
 */
export type SkillCategory =
    | 'farming'
    | 'crafting'
    | 'trading'
    | 'mining'
    | 'healing'
    | 'leadership'
    | 'combat'
    | 'scholarship'
    | 'management';

/**
 * A single skill entry with current level and metadata.
 */
export interface SkillEntry {
    /** Skill level 0–100. Higher = more effective at related actions. */
    level: number;
    /** Cumulative XP earned in this skill (drives level growth). */
    experience: number;
}

/**
 * Full skill matrix for an agent: a record mapping each category to its entry.
 */
export type SkillMatrix = Record<SkillCategory, SkillEntry>;

/**
 * Default starting skill matrix — all agents start egalitarian.
 */
export const DEFAULT_SKILL_MATRIX: SkillMatrix = {
    farming: { level: 10, experience: 0 },
    crafting: { level: 10, experience: 0 },
    trading: { level: 10, experience: 0 },
    mining: { level: 10, experience: 0 },
    healing: { level: 10, experience: 0 },
    leadership: { level: 10, experience: 0 },
    combat: { level: 10, experience: 0 },
    scholarship: { level: 10, experience: 0 },
    management: { level: 10, experience: 0 },
};

export const SKILL_CATEGORIES: readonly SkillCategory[] = [
    'farming', 'crafting', 'trading', 'mining',
    'healing', 'leadership', 'combat', 'scholarship', 'management',
] as const;

// ── 1B: Physical Asset Inventory ──────────────────────────────────────────────

/**
 * Item types in the physical asset inventory.
 */
export type ItemType = 'food' | 'tools' | 'luxury_goods' | 'raw_materials';

/**
 * A single inventory item with quantity and degradation properties.
 */
export interface InventoryItem {
    /** Item type identifier. */
    type: ItemType;
    /** Current quantity. */
    quantity: number;
    /**
     * Quality/durability level (0–100).
     * For food: freshness (spoilage reduces this each iteration).
     * For tools: durability (usage reduces this each iteration).
     */
    quality: number;
}

/**
 * Full inventory for an agent.
 */
export type Inventory = Record<ItemType, InventoryItem>;

/**
 * Default starting inventory — basic survival kit.
 */
export const DEFAULT_INVENTORY: Inventory = {
    food: { type: 'food', quantity: 10, quality: 100 },
    tools: { type: 'tools', quantity: 1, quality: 80 },
    luxury_goods: { type: 'luxury_goods', quantity: 0, quality: 100 },
    raw_materials: { type: 'raw_materials', quantity: 5, quality: 100 },
};

export const ITEM_TYPES: readonly ItemType[] = [
    'food', 'tools', 'luxury_goods', 'raw_materials',
] as const;

/**
 * Physical properties for each item type.
 */
export interface ItemProperties {
    /** Rate at which quality decays per iteration (0–1). */
    decayRate: number;
    /** Base weight per unit (affects carrying/storage in future phases). */
    baseWeight: number;
    /** Whether the item is consumable (destroyed on use). */
    consumable: boolean;
}

export const ITEM_PROPERTIES: Record<ItemType, ItemProperties> = {
    food: { decayRate: 0.15, baseWeight: 1, consumable: true },
    tools: { decayRate: 0.05, baseWeight: 3, consumable: false },
    luxury_goods: { decayRate: 0.02, baseWeight: 1, consumable: false },
    raw_materials: { decayRate: 0.01, baseWeight: 5, consumable: true },
};

// ── 1C: Order Book ────────────────────────────────────────────────────────────

/**
 * A single order in the global order book.
 */
export interface MarketOrder {
    /** Unique order ID. */
    id: string;
    /** Session this order belongs to. */
    sessionId: string;
    /** Agent who placed the order. */
    agentId: string;
    /** 'buy' or 'sell'. */
    side: 'buy' | 'sell';
    /** Item being traded. */
    itemType: ItemType;
    /** Price per unit (in wealth units). */
    price: number;
    /** Quantity to trade. */
    quantity: number;
    /** Iteration the order was placed. */
    iterationPlaced: number;
    /** Whether the order has been filled. */
    filled: boolean;
    /** Quantity already filled (for partial fills). */
    filledQuantity: number;
}

/**
 * Result of a single trade match.
 */
export interface TradeMatch {
    /** Buy order ID. */
    buyOrderId: string;
    /** Sell order ID. */
    sellOrderId: string;
    /** Buyer agent ID. */
    buyerId: string;
    /** Seller agent ID. */
    sellerId: string;
    /** Item traded. */
    itemType: ItemType;
    /** Quantity traded in this match. */
    quantity: number;
    /** Price per unit at which the trade executed. */
    executionPrice: number;
}

/**
 * Market price index snapshot for a single item.
 */
export interface PriceIndex {
    /** Item type. */
    itemType: ItemType;
    /** Last traded price. */
    lastPrice: number;
    /** Volume-weighted average price this iteration. */
    vwap: number;
    /** Total volume traded this iteration. */
    volume: number;
    /** Total buy demand (unfilled quantity). */
    totalDemand: number;
    /** Total sell supply (unfilled quantity). */
    totalSupply: number;
}

/**
 * Full market state after order book clearing for one iteration.
 */
export interface MarketState {
    /** Price indices for each traded item. */
    priceIndices: PriceIndex[];
    /** All trades that executed this iteration. */
    trades: TradeMatch[];
    /** Remaining unfilled orders. */
    openOrders: MarketOrder[];
}

// ── Employment / Dual-Track ────────────────────────────────────────────────────

/**
 * Represents an employment relationship.
 */
export interface EmploymentContract {
    /** Employer agent ID. */
    employerId: string;
    /** Employee agent ID. */
    employeeId: string;
    /** Wage per iteration (wealth units). */
    wage: number;
    /** Iteration the contract was established. */
    startedAt: number;
}

// ── Economy State (aggregate per iteration) ──────────────────────────────────

/**
 * Snapshot of the full economy state after one iteration.
 */
export interface EconomySnapshot {
    /** Iteration number. */
    iteration: number;
    /** Market state after order book clearing. */
    market: MarketState;
    /** Active employment contracts. */
    contracts: EmploymentContract[];
    /** Summary statistics. */
    summary: {
        /** Total wealth in the economy. */
        totalWealth: number;
        /** Total food available. */
        totalFood: number;
        /** Total tools available. */
        totalTools: number;
        /** Average skill level across all agents. */
        avgSkillLevel: number;
        /** Number of active employment contracts. */
        activeContracts: number;
    };
}
