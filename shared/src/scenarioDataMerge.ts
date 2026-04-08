import type { IterationStats, TelemetryLog } from './types.js';

export interface ScenarioMeta {
  label: string;
  index: number;
  sessionId: string;
}

export interface MergedDataPoint {
  iterationNumber: number;
  [key: string]: number | null | undefined;
}

function mergeRows<T extends { iterationNumber: number }>(
  scenarios: Array<{ label: string; data: T[] }>,
  field: keyof T,
): MergedDataPoint[] {
  const byIteration = new Map<number, MergedDataPoint>();

  for (const { label, data } of scenarios) {
    for (const row of data) {
      const key = `${String(field)}_${label}`;
      const existing = byIteration.get(row.iterationNumber) ?? {
        iterationNumber: row.iterationNumber,
      };
      const value = row[field];

      existing[key] = typeof value === 'number' ? value : null;
      byIteration.set(row.iterationNumber, existing);
    }
  }

  return Array.from(byIteration.values()).sort((a, b) => a.iterationNumber - b.iterationNumber);
}

export function mergeScenarioData(
  scenarios: Array<{ label: string; data: TelemetryLog[] }>,
  field: keyof TelemetryLog,
): MergedDataPoint[] {
  return mergeRows(scenarios, field);
}

export function mergeStatsData(
  scenarios: Array<{ label: string; data: IterationStats[] }>,
  field: keyof IterationStats,
): MergedDataPoint[] {
  return mergeRows(scenarios, field);
}
