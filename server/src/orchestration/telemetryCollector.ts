/**
 * TelemetryCollector — per-iteration physics/economy telemetry snapshots.
 *
 * Extracted from simulationRunner.ts (Phase B3) to isolate telemetry logic.
 * Reads committed telemetry from DB and merges with in-memory uncommitted entries.
 */
import { sqlite } from '../db/index.js';
import { sessionTelemetryLogs } from './simulationState.js';
import type { TelemetryLog } from '@policylab/shared';

/**
 * Get combined telemetry for a session: DB-committed + in-memory uncommitted.
 *
 * Called by the /simulate/telemetry route and internally during simulation.
 * After a server restart the in-memory map is empty, but DB still has all
 * previously committed iterations.
 */
export function getSessionTelemetry(sessionId: string): TelemetryLog[] {
  // Always load committed history from DB
  const dbLogs: TelemetryLog[] = [];
  try {
    const rows = sqlite.prepare(
      `SELECT statistics FROM iterations WHERE session_id = ? ORDER BY iteration_number ASC`
    ).all(sessionId) as Array<{ statistics: string }>;

    for (const row of rows) {
      try {
        const parsed = JSON.parse(row.statistics) as Record<string, unknown>;
        if (parsed._telemetry) dbLogs.push(parsed._telemetry as TelemetryLog);
      } catch (err) {
        console.warn('[getSessionTelemetry] Malformed statistics row, skipping:', err);
      }
    }
  } catch (err) {
    console.warn('[getSessionTelemetry] DB query failed:', err);
  }

  // Merge in-memory entries not yet committed (e.g. current in-flight iteration)
  const inMemory = sessionTelemetryLogs.get(sessionId) ?? [];
  if (inMemory.length === 0) return dbLogs;

  const dbIterNums = new Set(dbLogs.map(l => l.iterationNumber));
  const uncommitted = inMemory.filter(l => !dbIterNums.has(l.iterationNumber));
  return uncommitted.length > 0 ? [...dbLogs, ...uncommitted] : dbLogs;
}
