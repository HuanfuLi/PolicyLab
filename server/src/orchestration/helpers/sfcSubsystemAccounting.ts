/**
 * Per-subsystem SFC balance accumulator.
 * Phase 11 D-20, D-21, D-22, D-23.
 *
 * Each subsystem tick in simulationRunner is wrapped: snapshot total before,
 * run the tick, snapshot total after, accumulate (after - before) into the
 * subsystem bucket. A healthy subsystem produces 0 drift; a non-zero value
 * localizes a fiat leak to that subsystem.
 *
 * Per D-23: drift detection logs but does NOT pause the simulation.
 */

export type SubsystemKey =
  | 'physicsActions'
  | 'trade'
  | 'enforcement'
  | 'banking'
  | 'capmkt'
  | 'fiscal';

export type SfcBySubsystem = Record<SubsystemKey, number>;

/**
 * Initialize the subsystem accumulator at the start of each iteration.
 * Phase 11 D-21: every subsystem starts at 0 each iteration (no carry-over).
 */
export function initializeSfcBySubsystem(): SfcBySubsystem {
  return {
    physicsActions: 0,
    trade: 0,
    enforcement: 0,
    banking: 0,
    capmkt: 0,
    fiscal: 0,
  };
}

/**
 * Run a block with snapshot-before / snapshot-after bookkeeping.
 * Returns the block's return value unchanged.
 *
 * If the block throws, accumulator is NOT updated and exception propagates.
 * Multiple calls on the same subsystem accumulate (+=).
 *
 * @param subsystem Which subsystem bucket to update.
 * @param snapshot Closure that returns the current system fiat total.
 * @param block The subsystem tick to run.
 * @param sfcBySubsystem The accumulator (mutated in place).
 */
export function accountSubsystem<T>(
  subsystem: SubsystemKey,
  snapshot: () => number,
  block: () => T,
  sfcBySubsystem: SfcBySubsystem,
): T {
  const before = snapshot();
  const result = block();
  const after = snapshot();
  sfcBySubsystem[subsystem] += (after - before);
  return result;
}

/**
 * Log a structured drift line when |total drift| exceeds threshold.
 * Does NOT pause the simulation per D-23.
 *
 * Emits one line for the total drift, plus per-subsystem lines for any
 * subsystem whose individual drift exceeds the same threshold. Output
 * format is grep-friendly (`[SFC] iter=N`) for forensic audit.
 */
export function reportDriftIfOverThreshold(
  iterNum: number,
  sfcDrift: number,
  sfcBySubsystem: SfcBySubsystem,
  thresholdAbs: number = 0.1,
): void {
  if (Math.abs(sfcDrift) <= thresholdAbs) return;
  console.error(`[SFC] iter=${iterNum} total drift=${sfcDrift.toFixed(4)}`);
  for (const [subsys, delta] of Object.entries(sfcBySubsystem)) {
    if (Math.abs(delta) > thresholdAbs) {
      const sign = delta > 0 ? '+' : '';
      console.error(`[SFC]   ${subsys}: ${sign}${delta.toFixed(4)}`);
    }
  }
}
