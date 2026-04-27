import { desc, eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import type { MacroSnapshot } from '@policylab/shared';
import { macroSnapshots } from '../schema.js';
import type { SessionScope } from '../sessionScope.js';

type MacroSnapshotRow = typeof macroSnapshots.$inferSelect;
type MacroSnapshotInsert = typeof macroSnapshots.$inferInsert;

type DbLike = any;

function rowToMacroSnapshot(row: MacroSnapshotRow): MacroSnapshot {
  return {
    id: row.id,
    sessionId: row.sessionId,
    iterationNumber: row.iterationNumber,
    m0: row.m0,
    m1: row.m1,
    cpi: row.cpi,
    inflationRate: row.inflationRate,
    inflationExpectations: row.inflationExpectations,
    totalLoansOutstanding: row.totalLoansOutstanding,
    treasuryBalance: row.treasuryBalance,
    timestamp: row.timestamp,
    // Phase 12 D-20: labor-market telemetry (nullable)
    avgPostedWage: (row as any).avgPostedWage ?? null,
    unemploymentRate: (row as any).unemploymentRate ?? null,
    reservationWageP25: (row as any).reservationWageP25 ?? null,
    reservationWageP50: (row as any).reservationWageP50 ?? null,
    reservationWageP75: (row as any).reservationWageP75 ?? null,
    vacanciesTotal: (row as any).vacanciesTotal ?? null,
    applicantsTotal: (row as any).applicantsTotal ?? null,
    displacedThisIteration: (row as any).displacedThisIteration ?? null,
  };
}

export function insertMacroSnapshot(
  db: DbLike,
  snapshot: Omit<MacroSnapshot, 'id' | 'timestamp'>,
): void {
  db.insert(macroSnapshots).values({
    id: uuidv4(),
    sessionId: snapshot.sessionId,
    iterationNumber: snapshot.iterationNumber,
    m0: snapshot.m0,
    m1: snapshot.m1,
    cpi: snapshot.cpi,
    inflationRate: snapshot.inflationRate,
    inflationExpectations: snapshot.inflationExpectations,
    totalLoansOutstanding: snapshot.totalLoansOutstanding,
    treasuryBalance: snapshot.treasuryBalance,
    timestamp: new Date().toISOString(),
    // Phase 12 D-20: labor-market telemetry (nullable — optional on caller)
    ...(snapshot.avgPostedWage !== undefined ? { avgPostedWage: snapshot.avgPostedWage } : {}),
    ...(snapshot.unemploymentRate !== undefined ? { unemploymentRate: snapshot.unemploymentRate } : {}),
    ...(snapshot.reservationWageP25 !== undefined ? { reservationWageP25: snapshot.reservationWageP25 } : {}),
    ...(snapshot.reservationWageP50 !== undefined ? { reservationWageP50: snapshot.reservationWageP50 } : {}),
    ...(snapshot.reservationWageP75 !== undefined ? { reservationWageP75: snapshot.reservationWageP75 } : {}),
    ...(snapshot.vacanciesTotal !== undefined ? { vacanciesTotal: snapshot.vacanciesTotal } : {}),
    ...(snapshot.applicantsTotal !== undefined ? { applicantsTotal: snapshot.applicantsTotal } : {}),
    ...(snapshot.displacedThisIteration !== undefined ? { displacedThisIteration: snapshot.displacedThisIteration } : {}),
  } as MacroSnapshotInsert).run();
}

export function getLatestSnapshot(db: DbLike, sessionId: SessionScope): MacroSnapshot | null {
  const row = db.select()
    .from(macroSnapshots)
    .where(eq(macroSnapshots.sessionId, sessionId))
    .orderBy(desc(macroSnapshots.iterationNumber))
    .limit(1)
    .get();

  return row ? rowToMacroSnapshot(row) : null;
}

export function getRecentSnapshots(db: DbLike, sessionId: SessionScope, count: number): MacroSnapshot[] {
  const rows = db.select()
    .from(macroSnapshots)
    .where(eq(macroSnapshots.sessionId, sessionId))
    .orderBy(desc(macroSnapshots.iterationNumber))
    .limit(count)
    .all();

  return rows.map(rowToMacroSnapshot);
}

export function getSnapshotsBySession(db: DbLike, sessionId: SessionScope): MacroSnapshot[] {
  const rows = db.select()
    .from(macroSnapshots)
    .where(eq(macroSnapshots.sessionId, sessionId))
    .orderBy(desc(macroSnapshots.iterationNumber))
    .all();

  return rows.map(rowToMacroSnapshot);
}
