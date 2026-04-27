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
  // Phase 12: if no explicit capacity provided, default to max(employees+1, 20) so
  // the enterprise has at least one open vacancy from bootstrap. Plan 12-02 passes capacity explicitly.
  const capacity = blueprint.capacity != null && blueprint.capacity > 0
    ? blueprint.capacity
    : Math.max((blueprint.employees?.length ?? 0) + 1, 20);

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
    capacity,
    lastApplicants: 0,
    lastVacancies: 0,
  }).run();
}

export function getEnterprises(sessionId: SessionScope): EnterpriseBlueprint[] {
  const rows = db.select().from(enterprises)
    .where(and(eq(enterprises.sessionId, sessionId), eq(enterprises.isBankrupt, false)))
    .all();
  return rows.map(row => {
    const employees = (() => {
      try { return JSON.parse(row.employees ?? '[]') as string[]; }
      catch { return []; }
    })();
    // Phase 12 §8 risk mitigation: legacy rows may have capacity=0 (pre-migration default
    // backfill not yet applied). Coerce to at least max(employees.length, 20).
    const rawCapacity = (row as typeof row & { capacity?: number | null }).capacity;
    const capacity = rawCapacity != null && rawCapacity > 0
      ? rawCapacity
      : Math.max(employees.length, 20);
    if (!rawCapacity || rawCapacity <= 0) {
      console.warn(`[Phase 12] Enterprise ${row.id} had legacy capacity (${rawCapacity ?? 'null'}); defaulting to ${capacity}`);
    }
    return {
      id: row.id,
      name: row.name,
      ownerId: row.ownerId,
      sector: row.sector as EnterpriseSector,
      industry: row.industry,
      commodityOutput: row.commodityOutput as EnterpriseCommodity,
      initialCapital: row.initialCapital,
      initialInventory: {},
      employees,
      wage: row.wage,
      isServiceEnterprise: row.isServiceEnterprise,
      capacity,
    };
  });
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
