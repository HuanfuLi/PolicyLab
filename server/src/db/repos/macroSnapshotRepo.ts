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
  }).run();
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
