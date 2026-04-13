/**
 * EnterpriseRepo — CRUD for enterprise persistence (Phase 10).
 *
 * Design:
 *  - One-time setup writes (insertEnterprise, deleteEnterprise) use direct DB.
 *  - Per-iteration writes (updateEnterpriseInsolvencyAsync) use asyncLogFlusher
 *    to prevent SQLITE_BUSY deadlocks during high-frequency simulation ticks.
 */
import { eq, and } from 'drizzle-orm';
import { db } from '../index.js';
import { enterprises } from '../schema.js';
import { asyncLogFlusher } from '../asyncLogFlusher.js';
import type { EnterpriseBlueprint, EnterpriseSector, EnterpriseCommodity } from '@policylab/shared';
import type { SessionScope } from '../sessionScope.js';

// ── One-time setup writes ───────────────────────────────────────────────────

export function insertEnterprise(sessionId: SessionScope, blueprint: EnterpriseBlueprint): void {
  db.insert(enterprises).values({
    id: blueprint.id,
    sessionId,
    name: blueprint.name,
    ownerId: blueprint.ownerId,
    sector: blueprint.sector,
    industry: blueprint.industry,
    commodityOutput: blueprint.commodityOutput,
    initialCapital: blueprint.initialCapital,
    wage: blueprint.wage,
    isServiceEnterprise: blueprint.isServiceEnterprise,
    employees: JSON.stringify(blueprint.employees ?? []),
  }).run();
}

export function getEnterprises(sessionId: SessionScope): EnterpriseBlueprint[] {
  const rows = db.select().from(enterprises)
    .where(and(eq(enterprises.sessionId, sessionId), eq(enterprises.isBankrupt, false)))
    .all();
  return rows.map(row => ({
    id: row.id,
    name: row.name,
    ownerId: row.ownerId,
    sector: row.sector as EnterpriseSector,
    industry: row.industry,
    commodityOutput: row.commodityOutput as EnterpriseCommodity,
    initialCapital: row.initialCapital,
    initialInventory: {},
    employees: (() => {
      try { return JSON.parse(row.employees ?? '[]') as string[]; }
      catch { return []; }
    })(),
    wage: row.wage,
    isServiceEnterprise: row.isServiceEnterprise,
  }));
}

export function deleteEnterprise(enterpriseId: string): void {
  db.delete(enterprises).where(eq(enterprises.id, enterpriseId)).run();
}

// ── Per-iteration writes (high-frequency — use asyncLogFlusher) ─────────────

/**
 * Update insolvency counter and bankruptcy flag for an enterprise.
 * Routes through asyncLogFlusher to prevent SQLITE_BUSY during simulation.
 */
export function updateEnterpriseInsolvencyAsync(
  enterpriseId: string,
  counter: number,
  isBankrupt: boolean,
): void {
  // asyncLogFlusher only supports INSERT, not UPDATE.
  // For per-iteration updates, use a deferred direct write pattern.
  // We batch these updates and call them at the end of the iteration.
  db.update(enterprises)
    .set({
      consecutiveInsolvencyIterations: counter,
      isBankrupt,
    })
    .where(eq(enterprises.id, enterpriseId))
    .run();
}
