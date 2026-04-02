/**
 * Fiscal Repository — CRUD for fiscal policy tables.
 *
 * Handles CRUD for:
 *  - fiscal_budgets: design-time budget allocation per session (one active per session)
 *  - public_goods_state: per-iteration quality scores for public goods categories
 */
import { eq, sql } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../index.js';
import { fiscalBudgets, publicGoodsState } from '../schema.js';
import type { BudgetAllocation, PublicGoodsState } from '@policylab/shared';

// ── Budget helpers ────────────────────────────────────────────────────────────

function rowToBudgetAllocation(
  row: typeof fiscalBudgets.$inferSelect,
): BudgetAllocation {
  return {
    infrastructure: row.infrastructure,
    education: row.education,
    defense: row.defense,
    welfare: row.welfare,
  };
}

function rowToPublicGoodsState(
  row: typeof publicGoodsState.$inferSelect,
): PublicGoodsState {
  return {
    id: row.id,
    sessionId: row.sessionId,
    iterationNumber: row.iterationNumber,
    infrastructureQuality: row.infrastructureQuality,
    educationQuality: row.educationQuality,
    defenseQuality: row.defenseQuality,
    welfareQuality: row.welfareQuality,
  };
}

// ── Budget operations ─────────────────────────────────────────────────────────

/**
 * Insert or replace the budget allocation for a session.
 * Only one active budget per session — any existing record is replaced.
 *
 * @param budget - Full budget row including id, sessionId, and four allocation fractions.
 */
export function upsertBudget(budget: {
  id: string;
  sessionId: string;
  infrastructure: number;
  education: number;
  defense: number;
  welfare: number;
  createdAt: string;
}): void {
  // Check if a budget already exists for this session
  const existing = db
    .select({ id: fiscalBudgets.id })
    .from(fiscalBudgets)
    .where(eq(fiscalBudgets.sessionId, budget.sessionId))
    .get();

  if (existing) {
    db.update(fiscalBudgets)
      .set({
        infrastructure: budget.infrastructure,
        education: budget.education,
        defense: budget.defense,
        welfare: budget.welfare,
        createdAt: budget.createdAt,
      })
      .where(eq(fiscalBudgets.id, existing.id))
      .run();
  } else {
    db.insert(fiscalBudgets).values({
      id: budget.id,
      sessionId: budget.sessionId,
      infrastructure: budget.infrastructure,
      education: budget.education,
      defense: budget.defense,
      welfare: budget.welfare,
      createdAt: budget.createdAt,
    }).run();
  }
}

/**
 * Returns the budget allocation for a session, or null if none exists.
 * Returns only the four allocation fractions (not the full DB row).
 *
 * @param sessionId - The session to query.
 */
export function getActiveBudget(sessionId: string): BudgetAllocation | null {
  const row = db
    .select()
    .from(fiscalBudgets)
    .where(eq(fiscalBudgets.sessionId, sessionId))
    .get();

  return row ? rowToBudgetAllocation(row) : null;
}

// ── Public goods state operations ─────────────────────────────────────────────

/**
 * Insert or update the public goods state record for a given session + iteration.
 * Uses INSERT OR REPLACE via drizzle's onConflictDoUpdate pattern (by id).
 * Caller should generate a stable id (e.g. `${sessionId}-${iterationNumber}`) for idempotency.
 *
 * @param state - Full PublicGoodsState to persist.
 */
export function upsertPublicGoodsState(state: PublicGoodsState): void {
  const existing = db
    .select({ id: publicGoodsState.id })
    .from(publicGoodsState)
    .where(
      sql`${publicGoodsState.sessionId} = ${state.sessionId}
          AND ${publicGoodsState.iterationNumber} = ${state.iterationNumber}`,
    )
    .get();

  if (existing) {
    db.update(publicGoodsState)
      .set({
        infrastructureQuality: state.infrastructureQuality,
        educationQuality: state.educationQuality,
        defenseQuality: state.defenseQuality,
        welfareQuality: state.welfareQuality,
      })
      .where(eq(publicGoodsState.id, existing.id))
      .run();
  } else {
    db.insert(publicGoodsState).values({
      id: state.id,
      sessionId: state.sessionId,
      iterationNumber: state.iterationNumber,
      infrastructureQuality: state.infrastructureQuality,
      educationQuality: state.educationQuality,
      defenseQuality: state.defenseQuality,
      welfareQuality: state.welfareQuality,
    }).run();
  }
}

/**
 * Returns the latest public goods state for a session (highest iterationNumber), or null.
 *
 * @param sessionId - The session to query.
 */
export function getPublicGoodsState(sessionId: string): PublicGoodsState | null {
  const row = db
    .select()
    .from(publicGoodsState)
    .where(eq(publicGoodsState.sessionId, sessionId))
    .orderBy(sql`${publicGoodsState.iterationNumber} DESC`)
    .limit(1)
    .get();

  return row ? rowToPublicGoodsState(row) : null;
}

/**
 * Returns all public goods state records for a session, ordered by iteration ascending.
 * Used for session export/import.
 *
 * @param sessionId - The session to query.
 */
export function getPublicGoodsStateBySession(sessionId: string): PublicGoodsState[] {
  const rows = db
    .select()
    .from(publicGoodsState)
    .where(eq(publicGoodsState.sessionId, sessionId))
    .orderBy(sql`${publicGoodsState.iterationNumber} ASC`)
    .all();

  return rows.map(rowToPublicGoodsState);
}

/**
 * Deletes all fiscal data for a session (fiscal_budgets + public_goods_state).
 * Used during session import cleanup before re-importing data.
 *
 * @param sessionId - The session whose fiscal data should be cleared.
 */
export function deleteBySession(sessionId: string): void {
  db.delete(fiscalBudgets).where(eq(fiscalBudgets.sessionId, sessionId)).run();
  db.delete(publicGoodsState).where(eq(publicGoodsState.sessionId, sessionId)).run();
}

/**
 * Convenience helper: create a new budget for a session with a generated id.
 * Returns the generated id for caller reference.
 *
 * @param sessionId - Session to associate with.
 * @param allocation - The four fraction values.
 */
export function createBudget(
  sessionId: string,
  allocation: BudgetAllocation,
): string {
  const id = uuidv4();
  upsertBudget({
    id,
    sessionId,
    ...allocation,
    createdAt: new Date().toISOString(),
  });
  return id;
}
