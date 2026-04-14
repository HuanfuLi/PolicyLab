/**
 * Component 1C: Global Order Book Matching Engine
 *
 * Replaces 1-on-1 bartering with a realistic market clearing mechanism.
 * All market interactions are abstracted into POST_BUY_ORDER and POST_SELL_ORDER
 * commands. At the end of each iteration, the system matches orders centrally
 * based on price/time priority, dynamically establishing supply-demand equilibrium.
 *
 * This module is fully deterministic and LLM-independent.
 * DB persistence is handled via db/repos/orderBookRepo.ts (injected).
 */
import { v4 as uuidv4 } from 'uuid';
import type {
    ItemType,
    MarketOrder,
    TradeMatch,
    PriceIndex,
    MarketState,
} from '@policylab/shared';
import { ITEM_TYPES } from '@policylab/shared';
import * as orderBookRepo from '../db/repos/orderBookRepo.js';
import { createScope } from '../db/sessionScope.js';

// ── Order Book Data Structure ────────────────────────────────────────────────

/**
 * In-memory order book for one session.
 * Buy orders sorted descending by price (highest first).
 * Sell orders sorted ascending by price (lowest first).
 *
 * The in-memory arrays are the authoritative working set during a simulation
 * iteration.  Persistence (insert / update) is done synchronously using
 * better-sqlite3 so that a crash between iterations cannot leave the DB with
 * stale open orders.
 */
export class OrderBook {
    private buyOrders: MarketOrder[] = [];
    private sellOrders: MarketOrder[] = [];
    private tradeHistory: TradeMatch[] = [];
    private readonly sessionId: string;

    constructor(sessionId: string) {
        this.sessionId = sessionId;
    }

    /**
     * Restore open orders from the DB into in-memory state.
     * Called once during simulation initialisation (after server restart).
     */
    loadFromDB(): void {
        const rows = orderBookRepo.loadOpenOrders(createScope(this.sessionId));

        this.buyOrders = [];
        this.sellOrders = [];

        for (const row of rows) {
            const order: MarketOrder = {
                id: row.id,
                sessionId: row.sessionId,
                agentId: row.agentId,
                side: row.side,
                itemType: row.itemType,
                price: row.price,
                quantity: row.quantity,
                filledQuantity: row.filledQuantity,
                iterationPlaced: row.iterationPlaced,
                filled: false,
            };
            if (order.side === 'buy') {
                this.buyOrders.push(order);
            } else {
                this.sellOrders.push(order);
            }
        }

        // Re-sort after bulk load
        this.buyOrders.sort((a, b) => b.price - a.price || a.iterationPlaced - b.iterationPlaced);
        this.sellOrders.sort((a, b) => a.price - b.price || a.iterationPlaced - b.iterationPlaced);
    }

    /**
     * Reset the order book for a new iteration while preserving unfilled orders.
     */
    reset(): void {
        this.tradeHistory = [];
        // Unfilled orders carry over (good-till-cancelled)
        this.buyOrders = this.buyOrders.filter(o => !o.filled);
        this.sellOrders = this.sellOrders.filter(o => !o.filled);
    }

    /**
     * Submit a new order to the book.
     * The order is inserted into the DB synchronously before being added to
     * the in-memory working set so it will survive a restart.
     *
     * SYSTEM_NPC orders (synthetic liquidity injected each iteration) are
     * sentinels with no agents-table row, so persisting them would violate
     * order_book.agent_id → agents.id. They're re-injected every iteration
     * and consumed in the same matchOrders() call, so skipping persistence
     * is safe.
     */
    submitOrder(order: Omit<MarketOrder, 'id' | 'filled' | 'filledQuantity'>): MarketOrder {
        const fullOrder: MarketOrder = {
            ...order,
            id: uuidv4(),
            filled: false,
            filledQuantity: 0,
        };

        if (order.agentId !== 'SYSTEM_NPC') {
            // Persist immediately (synchronous via better-sqlite3 under the hood)
            orderBookRepo.insertOrder(fullOrder);
        }

        if (order.side === 'buy') {
            this.buyOrders.push(fullOrder);
            // Sort descending by price, then by iteration (FIFO within price)
            this.buyOrders.sort((a, b) => b.price - a.price || a.iterationPlaced - b.iterationPlaced);
        } else {
            this.sellOrders.push(fullOrder);
            // Sort ascending by price, then by iteration (FIFO within price)
            this.sellOrders.sort((a, b) => a.price - b.price || a.iterationPlaced - b.iterationPlaced);
        }

        return fullOrder;
    }

    /**
     * Run the matching engine: match buy and sell orders by price/time priority.
     * Returns all trades executed.
     *
     * All fill-state DB updates happen atomically inside a single sqlite transaction
     * so a mid-match crash cannot produce partially-updated rows.
     */
    matchOrders(): TradeMatch[] {
        const matches: TradeMatch[] = [];

        // Process each item type independently
        for (const itemType of ITEM_TYPES) {
            const buys = this.buyOrders.filter(o => o.itemType === itemType && !o.filled);
            const sells = this.sellOrders.filter(o => o.itemType === itemType && !o.filled);

            let buyIdx = 0;
            let sellIdx = 0;

            while (buyIdx < buys.length && sellIdx < sells.length) {
                const buy = buys[buyIdx];
                const sell = sells[sellIdx];

                // Match condition: buy price >= sell price
                if (buy.price < sell.price) break; // No more matches possible

                // Don't match self-trades
                if (buy.agentId === sell.agentId) {
                    sellIdx++;
                    continue;
                }

                // Calculate match quantity
                const buyRemaining = buy.quantity - buy.filledQuantity;
                const sellRemaining = sell.quantity - sell.filledQuantity;
                const matchQty = Math.min(buyRemaining, sellRemaining);

                if (matchQty <= 0) {
                    if (buyRemaining <= 0) buyIdx++;
                    else sellIdx++;
                    continue;
                }

                // Execution price: midpoint of buy and sell prices
                const executionPrice = Math.round((buy.price + sell.price) / 2);

                const match: TradeMatch = {
                    buyOrderId: buy.id,
                    sellOrderId: sell.id,
                    buyerId: buy.agentId,
                    sellerId: sell.agentId,
                    itemType,
                    quantity: matchQty,
                    executionPrice,
                };

                matches.push(match);

                // Update fill quantities
                buy.filledQuantity += matchQty;
                sell.filledQuantity += matchQty;

                if (buy.filledQuantity >= buy.quantity) {
                    buy.filled = true;
                    buyIdx++;
                }
                if (sell.filledQuantity >= sell.quantity) {
                    sell.filled = true;
                    sellIdx++;
                }
            }
        }

        // Atomically persist fill state for all matched orders
        if (matches.length > 0) {
            const filledOrderIds = new Set<string>();
            for (const match of matches) {
                filledOrderIds.add(match.buyOrderId);
                filledOrderIds.add(match.sellOrderId);
            }

            const touchedOrders = [...this.buyOrders, ...this.sellOrders]
                .filter(o => filledOrderIds.has(o.id))
                .map(o => ({ id: o.id, filledQuantity: o.filledQuantity, filled: o.filled }));

            orderBookRepo.updateMatchedOrders(touchedOrders);
        }

        this.tradeHistory.push(...matches);
        return matches;
    }

    /**
     * Compute price indices for all item types based on current iteration's trades.
     */
    computePriceIndices(): PriceIndex[] {
        const indices: PriceIndex[] = [];

        for (const itemType of ITEM_TYPES) {
            const trades = this.tradeHistory.filter(t => t.itemType === itemType);
            const buys = this.buyOrders.filter(o => o.itemType === itemType);
            const sells = this.sellOrders.filter(o => o.itemType === itemType);

            if (trades.length === 0) {
                // No trades: use mid-market estimate from unfilled orders
                const bestBid = buys.length > 0 ? Math.max(...buys.map(o => o.price)) : 0;
                const bestAsk = sells.length > 0 ? Math.min(...sells.map(o => o.price)) : 0;

                indices.push({
                    itemType,
                    lastPrice: bestBid > 0 && bestAsk > 0 ? Math.round((bestBid + bestAsk) / 2) : 0,
                    vwap: 0,
                    volume: 0,
                    totalDemand: buys.reduce((s, o) => s + (o.quantity - o.filledQuantity), 0),
                    totalSupply: sells.reduce((s, o) => s + (o.quantity - o.filledQuantity), 0),
                });
                continue;
            }

            // VWAP: volume-weighted average price
            const totalVolume = trades.reduce((s, t) => s + t.quantity, 0);
            const vwap = totalVolume > 0
                ? Math.round(trades.reduce((s, t) => s + t.executionPrice * t.quantity, 0) / totalVolume)
                : 0;

            indices.push({
                itemType,
                lastPrice: trades[trades.length - 1].executionPrice,
                vwap,
                volume: totalVolume,
                totalDemand: buys.reduce((s, o) => s + Math.max(0, o.quantity - o.filledQuantity), 0),
                totalSupply: sells.reduce((s, o) => s + Math.max(0, o.quantity - o.filledQuantity), 0),
            });
        }

        return indices;
    }

    /**
     * Get the full market state after matching.
     */
    getMarketState(): MarketState {
        return {
            priceIndices: this.computePriceIndices(),
            trades: [...this.tradeHistory],
            openOrders: [
                ...this.buyOrders.filter(o => !o.filled),
                ...this.sellOrders.filter(o => !o.filled),
            ],
        };
    }

    /**
     * Remove all orders for a specific agent (e.g., when they die).
     * Also marks the orders as 'cancelled' in the DB.
     */
    removeAgentOrders(agentId: string): void {
        const agentBuyIds = this.buyOrders.filter(o => o.agentId === agentId).map(o => o.id);
        const agentSellIds = this.sellOrders.filter(o => o.agentId === agentId).map(o => o.id);

        orderBookRepo.cancelAgentOrders([...agentBuyIds, ...agentSellIds]);

        this.buyOrders = this.buyOrders.filter(o => o.agentId !== agentId);
        this.sellOrders = this.sellOrders.filter(o => o.agentId !== agentId);
    }

    /**
     * Get the best current price for an item type (for agent decision-making).
     * Returns the midpoint of best bid and best ask, or 0 if no orders.
     */
    getBestPrice(itemType: ItemType): number {
        const buys = this.buyOrders.filter(o => o.itemType === itemType && !o.filled);
        const sells = this.sellOrders.filter(o => o.itemType === itemType && !o.filled);

        const bestBid = buys.length > 0 ? buys[0].price : 0;
        const bestAsk = sells.length > 0 ? sells[0].price : 0;

        if (bestBid > 0 && bestAsk > 0) return Math.round((bestBid + bestAsk) / 2);
        if (bestBid > 0) return bestBid;
        if (bestAsk > 0) return bestAsk;
        return 0;
    }

    /**
     * Get the total number of open (unfilled) orders.
     */
    get openOrderCount(): number {
        return this.buyOrders.filter(o => !o.filled).length
            + this.sellOrders.filter(o => !o.filled).length;
    }
}

// ── Session Order Book Registry ──────────────────────────────────────────────

/**
 * Global registry of order books, one per active session.
 */
const sessionOrderBooks = new Map<string, OrderBook>();

/**
 * Get or create the order book for a session.
 * The sessionId is passed through to the OrderBook so it can persist orders.
 */
export function getOrderBook(sessionId: string): OrderBook {
    let book = sessionOrderBooks.get(sessionId);
    if (!book) {
        book = new OrderBook(sessionId);
        sessionOrderBooks.set(sessionId, book);
    }
    return book;
}

/**
 * Restore an order book from the DB for a session that was previously running.
 * Should be called during simulation initialisation to reload open orders.
 */
export function restoreOrderBook(sessionId: string): OrderBook {
    let book = sessionOrderBooks.get(sessionId);
    if (!book) {
        book = new OrderBook(sessionId);
        sessionOrderBooks.set(sessionId, book);
    }
    book.loadFromDB();
    return book;
}

/**
 * Returns true if an in-memory order book already exists for this session.
 * Used by the simulation runner to decide whether a DB restore is needed.
 */
export function isOrderBookWarm(sessionId: string): boolean {
    return sessionOrderBooks.has(sessionId);
}

/**
 * Clean up the order book for a session (e.g., when simulation ends).
 */
export function clearOrderBook(sessionId: string): void {
    sessionOrderBooks.delete(sessionId);
}
