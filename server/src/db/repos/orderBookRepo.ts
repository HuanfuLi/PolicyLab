/**
 * Order Book Repository — persistence for market order book.
 *
 * Extracted from mechanics/orderBook.ts to maintain mechanics layer purity.
 * All DB operations for order book data go through this repo.
 */
import { eq, and } from 'drizzle-orm';
import { db, sqlite } from '../index.js';
import { orderBook as orderBookTable } from '../schema.js';
import type { ItemType, MarketOrder } from '@policylab/shared';

/** Row shape returned from DB queries */
export interface OrderBookRow {
  id: string;
  sessionId: string;
  agentId: string;
  side: 'buy' | 'sell';
  itemType: ItemType;
  price: number;
  quantity: number;
  filledQuantity: number;
  iterationPlaced: number;
}

/** Load all open orders for a session from the DB. */
export function loadOpenOrders(sessionId: string): OrderBookRow[] {
  const rows = db
    .select()
    .from(orderBookTable)
    .where(
      and(
        eq(orderBookTable.sessionId, sessionId),
        eq(orderBookTable.status, 'open'),
      ),
    )
    .all();

  return rows.map(row => ({
    id: row.id,
    sessionId: row.sessionId,
    agentId: row.agentId,
    side: row.side as 'buy' | 'sell',
    itemType: row.itemType as ItemType,
    price: row.price,
    quantity: row.quantity,
    filledQuantity: row.filledQuantity,
    iterationPlaced: row.iterationPlaced,
  }));
}

/** Persist a new order to the DB. */
export function insertOrder(order: MarketOrder): void {
  sqlite.transaction(() => {
    db.insert(orderBookTable).values({
      id: order.id,
      sessionId: order.sessionId,
      agentId: order.agentId,
      side: order.side,
      itemType: order.itemType,
      price: order.price,
      quantity: order.quantity,
      filledQuantity: 0,
      iterationPlaced: order.iterationPlaced,
      status: 'open',
      createdAt: new Date().toISOString(),
    }).run();
  })();
}

/** Atomically update fill state for matched orders. */
export function updateMatchedOrders(orders: Array<{ id: string; filledQuantity: number; filled: boolean }>): void {
  if (orders.length === 0) return;
  sqlite.transaction(() => {
    for (const order of orders) {
      db.update(orderBookTable)
        .set({
          filledQuantity: order.filledQuantity,
          status: order.filled ? 'filled' : 'open',
        })
        .where(eq(orderBookTable.id, order.id))
        .run();
    }
  })();
}

/** Cancel all orders belonging to an agent. */
export function cancelAgentOrders(orderIds: string[]): void {
  if (orderIds.length === 0) return;
  sqlite.transaction(() => {
    for (const id of orderIds) {
      db.update(orderBookTable)
        .set({ status: 'cancelled' })
        .where(eq(orderBookTable.id, id))
        .run();
    }
  })();
}
