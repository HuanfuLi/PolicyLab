/**
 * Capital Market Repository — CRUD for capital markets tables.
 *
 * Handles CRUD for:
 *  - equity_positions (per-agent share holdings in an enterprise)
 *  - bond_holdings (gov and corp bond holdings per agent)
 *
 * Pattern mirrors bankingRepo.ts: synchronous better-sqlite3 calls via drizzle.
 */
import { eq, and, sql } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../index.js';
import { equityPositions, bondHoldings } from '../schema.js';
import type { EquityPosition, BondHolding } from '@policylab/shared';
import type { SessionScope } from '../sessionScope.js';

// ── Row converters ────────────────────────────────────────────────────────────

function rowToEquityPosition(row: typeof equityPositions.$inferSelect): EquityPosition {
  return {
    id: row.id,
    sessionId: row.sessionId,
    ownerAgentId: row.ownerAgentId,
    enterpriseOwnerId: row.enterpriseOwnerId,
    sharesHeld: row.sharesHeld,
    averageCostBasis: row.averageCostBasis,
    lastUpdated: row.lastUpdated,
  };
}

function rowToBondHolding(row: typeof bondHoldings.$inferSelect): BondHolding {
  return {
    id: row.id,
    sessionId: row.sessionId,
    ownerAgentId: row.ownerAgentId,
    issuerId: row.issuerId,
    bondType: row.bondType as 'government' | 'corporate',
    faceValue: row.faceValue,
    couponRate: row.couponRate,
    maturityIteration: row.maturityIteration,
    purchaseIteration: row.purchaseIteration,
    status: row.status as 'active' | 'matured' | 'defaulted',
  };
}

// ── Equity Position operations ─────────────────────────────────────────────────

/**
 * Get all equity positions for a session.
 */
export function getEquityPositionsBySession(sessionId: SessionScope): EquityPosition[] {
  const rows = db
    .select()
    .from(equityPositions)
    .where(eq(equityPositions.sessionId, sessionId))
    .all();

  return rows.map(rowToEquityPosition);
}

/**
 * Get a specific equity position by ownerAgentId, enterpriseOwnerId, and sessionId.
 */
export function getEquityPosition(
  ownerAgentId: string,
  enterpriseOwnerId: string,
  sessionId: SessionScope,
): EquityPosition | undefined {
  const rows = db
    .select()
    .from(equityPositions)
    .where(
      and(
        eq(equityPositions.ownerAgentId, ownerAgentId),
        eq(equityPositions.enterpriseOwnerId, enterpriseOwnerId),
        eq(equityPositions.sessionId, sessionId),
      ),
    )
    .all();

  return rows.length > 0 ? rowToEquityPosition(rows[0]) : undefined;
}

/**
 * Insert or update an equity position by id.
 * If the position id already exists, updates sharesHeld, averageCostBasis, lastUpdated.
 * If not, inserts a new row with a generated id if none is provided.
 */
export function upsertEquityPosition(pos: EquityPosition): void {
  const id = pos.id ?? uuidv4();

  db.insert(equityPositions)
    .values({
      id,
      sessionId: pos.sessionId,
      ownerAgentId: pos.ownerAgentId,
      enterpriseOwnerId: pos.enterpriseOwnerId,
      sharesHeld: pos.sharesHeld,
      averageCostBasis: pos.averageCostBasis,
      lastUpdated: pos.lastUpdated,
    })
    .onConflictDoUpdate({
      target: equityPositions.id,
      set: {
        sharesHeld: pos.sharesHeld,
        averageCostBasis: pos.averageCostBasis,
        lastUpdated: pos.lastUpdated,
      },
    })
    .run();
}

/**
 * Delete all equity positions for a session (used during session cleanup).
 */
export function deleteEquityPositionsBySession(sessionId: SessionScope): void {
  db.delete(equityPositions)
    .where(eq(equityPositions.sessionId, sessionId))
    .run();
}

// ── Bond Holding operations ────────────────────────────────────────────────────

/**
 * Get all bond holdings for a session.
 */
export function getBondHoldingsBySession(sessionId: SessionScope): BondHolding[] {
  const rows = db
    .select()
    .from(bondHoldings)
    .where(eq(bondHoldings.sessionId, sessionId))
    .all();

  return rows.map(rowToBondHolding);
}

/**
 * Get all active bond holdings for a session (status = 'active' only).
 * These are the holdings eligible for coupon payments and maturity processing.
 */
export function getActiveBondHoldingsBySession(sessionId: SessionScope): BondHolding[] {
  const rows = db
    .select()
    .from(bondHoldings)
    .where(
      and(
        eq(bondHoldings.sessionId, sessionId),
        eq(bondHoldings.status, 'active'),
      ),
    )
    .all();

  return rows.map(rowToBondHolding);
}

/**
 * Insert or update a bond holding by id.
 * If the holding id already exists, updates status (e.g., active → matured).
 * If not, inserts a new row.
 */
export function upsertBondHolding(holding: BondHolding): void {
  const id = holding.id ?? uuidv4();

  db.insert(bondHoldings)
    .values({
      id,
      sessionId: holding.sessionId,
      ownerAgentId: holding.ownerAgentId,
      issuerId: holding.issuerId,
      bondType: holding.bondType,
      faceValue: holding.faceValue,
      couponRate: holding.couponRate,
      maturityIteration: holding.maturityIteration,
      purchaseIteration: holding.purchaseIteration,
      status: holding.status,
    })
    .onConflictDoUpdate({
      target: bondHoldings.id,
      set: {
        status: holding.status,
      },
    })
    .run();
}

/**
 * Delete a single bond holding by id.
 * Called after a bond matures or defaults and is removed from active holdings.
 */
export function deleteBondHolding(id: string): void {
  db.delete(bondHoldings)
    .where(eq(bondHoldings.id, id))
    .run();
}

/**
 * Delete all bond holdings for a session (used during session cleanup).
 */
export function deleteBondHoldingsBySession(sessionId: SessionScope): void {
  db.delete(bondHoldings)
    .where(eq(bondHoldings.sessionId, sessionId))
    .run();
}

/**
 * Get the total face value of all active bond holdings for a session.
 * Used for SFC audit purposes if needed.
 *
 * SELECT COALESCE(SUM(face_value), 0) FROM bond_holdings WHERE session_id = ? AND status = 'active'
 */
export function getTotalActiveBondFaceValue(sessionId: SessionScope): number {
  const result = db
    .select({ total: sql<number>`COALESCE(SUM(${bondHoldings.faceValue}), 0)` })
    .from(bondHoldings)
    .where(
      and(
        eq(bondHoldings.sessionId, sessionId),
        eq(bondHoldings.status, 'active'),
      ),
    )
    .get();

  return result?.total ?? 0;
}
