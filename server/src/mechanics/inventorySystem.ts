/**
 * Component 1B: Physical Asset Inventory
 *
 * Introduces physical, consumable assets that ground survivability in 
 * tangible resources. Food embodies direct survival pressure; Tools
 * embody means of production/productivity.
 *
 * Key mechanics:
 *  - Food spoilage: quality degrades each iteration
 *  - Tool depreciation: durability drops with use
 *  - Starvation pressure: no food → health/cortisol penalties
 *  - Tool productivity: having tools boosts WORK output
 *
 * This module is fully deterministic and LLM-independent.
 */
import type {
    Inventory,
    InventoryItem,
    ItemType,
} from '@policylab/shared';
import {
    DEFAULT_INVENTORY,
    ITEM_PROPERTIES,
    ITEM_TYPES,
} from '@policylab/shared';
import type { ActionCode } from './actionCodes.js';

// ── Configuration Constants ───────────────────────────────────────────────────

/** Minimum food quality before it's considered spoiled (unusable). */
const SPOILAGE_THRESHOLD = 10;

/** Tool durability lost per WORK action. */
const TOOL_WEAR_PER_WORK = 5;

/** Minimum tool quality before the tool breaks (removed from inventory). */
const TOOL_BREAK_THRESHOLD = 5;

/** Food produced per PRODUCE action (base, before skill multiplier). */
const BASE_FOOD_PRODUCTION = 4;

/** Raw materials consumed per PRODUCE action. */
const RAW_MATERIALS_PER_PRODUCE = 1;

/** Health penalty per iteration of starvation (no food). */
const STARVATION_HEALTH_PENALTY = -10;

/** Cortisol increase per iteration of starvation. */
const STARVATION_CORTISOL_PENALTY = 15;

/**
 * Tool productivity bonus multiplier.
 * At 1.0: one tool at full quality gives 1.0 + 1.0×log2(2)×1.0 = 2.0× (the spec 2.0× buff).
 * Diminishing returns via log2 prevent infinite stacking with many tools.
 */
const TOOL_PRODUCTIVITY_BONUS = 1.0;

// ── Core Functions ────────────────────────────────────────────────────────────

/**
 * Creates a fresh inventory, optionally with role-specific bonuses.
 */
export function createInventory(role?: string): Inventory {
    const inv = structuredClone(DEFAULT_INVENTORY);
    if (role) {
        const upper = role.toUpperCase();
        if (/FARMER|PEASANT/.test(upper)) {
            inv.food.quantity = 15;
            inv.raw_materials.quantity = 8;
        } else if (/MERCHANT|TRADER/.test(upper)) {
            inv.luxury_goods.quantity = 3;
        } else if (/ARTISAN|SMITH|CARPENTER|BUILDER/.test(upper)) {
            inv.tools.quantity = 2;
            inv.tools.quality = 90;
        } else if (/MINER/.test(upper)) {
            inv.raw_materials.quantity = 10;
            inv.tools.quantity = 2;
        }
    }
    return inv;
}

/**
 * Result of processing inventory for one iteration.
 */
export interface InventoryProcessResult {
    /** Updated inventory (mutated in-place). */
    inventory: Inventory;
    /** Health delta from food consumption (negative if starving). */
    healthDelta: number;
    /** Cortisol delta from food scarcity. */
    cortisolDelta: number;
    /** Happiness delta from food enjoyment or starvation. */
    happinessDelta: number;
    /** Whether the agent is starving (no usable food). */
    isStarving: boolean;
    /** Tools broke this iteration. */
    toolsBroken: boolean;
    /** Items that spoiled (quantity removed due to low quality). */
    spoiledItems: Array<{ type: ItemType; quantity: number }>;
}

/**
 * Process inventory changes for one agent in one iteration.
 * This handles:
 *  1. Food spoilage (quality decay)
 *  2. Tool depreciation
 *  3. Food consumption (survival)
 *  4. Production from PRODUCE action
 *  5. Starvation penalties
 *
 * @param inventory  The agent's current inventory (mutated in-place).
 * @param action     The action code the agent executed.
 * @param skillMultiplier  Production multiplier from the skill system.
 * @returns  Inventory processing results with stat deltas.
 */
export function processInventory(
    inventory: Inventory,
    action: ActionCode,
    skillMultiplier: number = 1.0,
): InventoryProcessResult {
    let healthDelta = 0;
    let cortisolDelta = 0;
    let happinessDelta = 0;
    let isStarving = false;
    let toolsBroken = false;
    const spoiledItems: Array<{ type: ItemType; quantity: number }> = [];

    // ── 1. Quality decay (spoilage / depreciation) ──────────────────────────
    for (const itemType of ITEM_TYPES) {
        const item = inventory[itemType];
        if (item.quantity <= 0) continue;

        const props = ITEM_PROPERTIES[itemType];
        item.quality = Math.max(0, item.quality - props.decayRate * 100);

        // Remove spoiled items
        if (item.quality < SPOILAGE_THRESHOLD && props.consumable) {
            spoiledItems.push({ type: itemType, quantity: item.quantity });
            item.quantity = 0;
            item.quality = 100; // Reset quality for new stock
        }
    }

    // ── 2. Tool depreciation from use ──────────────────────────────────────
    if (action === 'WORK' || action === 'WORK_AT_ENTERPRISE' || action === 'PRODUCE_AND_SELL') {
        const tools = inventory.tools;
        if (tools.quantity > 0) {
            tools.quality = Math.max(0, tools.quality - TOOL_WEAR_PER_WORK);
            if (tools.quality < TOOL_BREAK_THRESHOLD) {
                tools.quantity = Math.max(0, tools.quantity - 1);
                tools.quality = tools.quantity > 0 ? 80 : 100; // Next tool or reset
                toolsBroken = true;
            }
        }
    }

    // ── 3. Luxury services cortisol reduction ─────────────────────────────
    // Consuming luxury_goods drastically reduces Cortisol, preventing mental
    // breakdown spirals. One unit consumed per iteration if available.
    if (inventory.luxury_goods.quantity > 0) {
        inventory.luxury_goods.quantity -= 1;
        cortisolDelta -= 20;
        happinessDelta += 5;
    }

    // ── 4. Weekly metabolism is now handled after all actions resolve. ─────
    const food = inventory.food;
    const usableFood = food.quality >= SPOILAGE_THRESHOLD ? food.quantity : 0;
    if (usableFood <= 0) {
        isStarving = true;
        healthDelta += STARVATION_HEALTH_PENALTY;
        cortisolDelta += STARVATION_CORTISOL_PENALTY;
        happinessDelta -= 5;
    }

    // ── 5. Production (PRODUCE_AND_SELL action) ────────────────────────────
    if (action === 'PRODUCE_AND_SELL') {
        const rawMat = inventory.raw_materials;
        if (rawMat.quantity >= RAW_MATERIALS_PER_PRODUCE) {
            rawMat.quantity -= RAW_MATERIALS_PER_PRODUCE;
            const produced = Math.round(BASE_FOOD_PRODUCTION * skillMultiplier);
            food.quantity += produced;
            // Fresh produce has high quality
            food.quality = Math.min(100, food.quality + 10);
        } else {
            // Can still produce without raw materials, just less
            const produced = Math.round(BASE_FOOD_PRODUCTION * skillMultiplier * 0.3);
            food.quantity += produced;
        }
    }

    return {
        inventory,
        healthDelta,
        cortisolDelta,
        happinessDelta,
        isStarving,
        toolsBroken,
        spoiledItems,
    };
}

/**
 * Get the tool productivity multiplier for an agent.
 * Having functional tools boosts WORK output.
 *
 * @returns A multiplier: 1.0 (no tools) to 1.0 + TOOL_PRODUCTIVITY_BONUS * quantity
 */
export function getToolMultiplier(inventory: Inventory): number {
    const tools = inventory.tools;
    if (tools.quantity <= 0 || tools.quality < TOOL_BREAK_THRESHOLD) return 1.0;
    // Each tool adds a bonus, with diminishing returns
    const effectiveTools = Math.log2(tools.quantity + 1);
    const qualityFactor = tools.quality / 100;
    return 1.0 + TOOL_PRODUCTIVITY_BONUS * effectiveTools * qualityFactor;
}

/**
 * Calculate total item count across all inventory slots.
 */
export function totalItems(inventory: Inventory): number {
    let total = 0;
    for (const itemType of ITEM_TYPES) {
        total += inventory[itemType].quantity;
    }
    return total;
}

/**
 * Check if the agent can afford a trade (has enough items or wealth).
 */
export function canTrade(
    inventory: Inventory,
    itemType: ItemType,
    quantity: number,
    side: 'buy' | 'sell',
): boolean {
    if (side === 'sell') {
        return inventory[itemType].quantity >= quantity;
    }
    // For buy, we just need to verify the agent has wealth (checked elsewhere)
    return true;
}

/**
 * Transfer items between two inventories (e.g., after a trade match).
 *
 * @param from  Seller's inventory.
 * @param to    Buyer's inventory.
 * @param itemType  Item type being transferred.
 * @param quantity  Amount to transfer.
 * @returns  True if transfer succeeded, false if insufficient stock.
 */
export function transferItems(
    from: Inventory,
    to: Inventory,
    itemType: ItemType,
    quantity: number,
): boolean {
    if (from[itemType].quantity < quantity) return false;
    from[itemType].quantity -= quantity;
    to[itemType].quantity += quantity;
    // Transfer quality: blend towards seller's quality
    const fromQ = from[itemType].quality;
    const toQ = to[itemType].quality;
    const totalQty = to[itemType].quantity;
    if (totalQty > 0) {
        to[itemType].quality = Math.round(
            (toQ * (totalQty - quantity) + fromQ * quantity) / totalQty
        );
    }
    return true;
}
