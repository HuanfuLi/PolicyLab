/**
 * Phase 11 SFC umbrella integration scaffold.
 *
 * Plan 11-07 (subsystem drift telemetry) converts the relevant todos into real
 * assertions exercising the sfcSubsystemAccounting helper + the simulationRunner
 * wiring contract. Other todos remain `it.todo` until their owning waves land.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { TaxPolicy, PublicGoodsEscrow, TelemetryLog } from '@policylab/shared';
import {
  initializeSfcBySubsystem,
  accountSubsystem,
  accountSubsystemAsync,
  reportDriftIfOverThreshold,
  type SfcBySubsystem,
} from '../orchestration/helpers/sfcSubsystemAccounting.js';

describe('Phase 11 SFC integration', () => {
  // ── Real assertions for Plan 11-07 (D-20, D-21, D-22, D-23) ──────────────────

  describe('TelemetryLog.sfcDrift contract (D-21)', () => {
    it('TelemetryLog type accepts sfcDrift + sfcDriftBySubsystem', () => {
      // Compile-time + runtime smoke: any breaking change to the shared type would
      // surface here.
      const tel: TelemetryLog = {
        iterationNumber: 1,
        totalFiatSupply: 1000,
        totalFiatSupplyRounded: 1000,
        ammFoodReserve_Y: 50,
        ammFiatReserve_X: 500,
        ammSpotPrice_Food: 10,
        totalCaloriesBurned: 0,
        totalCaloriesProduced: 0,
        actionFailureRate: 0,
        giniCoefficient: 0,
        socialMobilityIndex: 0,
        crimeRate: 0,
        averageCortisol: 20,
        m0: 1000,
        m1: 1000,
        loansOutstanding: 0,
        sfcDrift: 0,
        sfcDriftBySubsystem: {
          physicsActions: 0,
          trade: 0,
          enforcement: 0,
          banking: 0,
          capmkt: 0,
          fiscal: 0,
        },
      };
      expect(tel.sfcDrift).toBe(0);
      expect(tel.sfcDriftBySubsystem?.banking).toBe(0);
    });
  });

  describe('subsystem-drift sum invariant (D-21)', () => {
    it('sum of all subsystem deltas equals total observed drift in a clean simulation step', () => {
      // Simulate a 4-subsystem mini-iteration: each subsystem moves fiat between
      // the same closed perimeter so total drift is 0 and each bucket is 0.
      const sfc: SfcBySubsystem = initializeSfcBySubsystem();
      let total = 1000;
      const snapshot = () => total;

      // Banking tick: deposit interest +50, withdraw -50 (net 0 inside SFC perimeter)
      accountSubsystem('banking', snapshot, () => { /* SFC-neutral */ }, sfc);
      // Capmkt tick: bond payout +20 to citizen, treasury -20 (net 0)
      accountSubsystem('capmkt', snapshot, () => { /* SFC-neutral */ }, sfc);
      // Fiscal: welfare +30 to citizens, treasury -30 (net 0)
      accountSubsystem('fiscal', snapshot, () => { /* SFC-neutral */ }, sfc);

      const totalDrift = total - 1000;
      const bucketSum = sfc.physicsActions + sfc.trade + sfc.enforcement + sfc.banking + sfc.capmkt + sfc.fiscal;
      expect(Math.abs(bucketSum - totalDrift)).toBeLessThan(0.001);
      expect(totalDrift).toBe(0);
    });

    it('sum of subsystem deltas equals total drift when one subsystem leaks', () => {
      const sfc: SfcBySubsystem = initializeSfcBySubsystem();
      let total = 1000;
      const snapshot = () => total;

      // Inject a synthetic +5 leak in fiscal
      accountSubsystem('banking', snapshot, () => { /* clean */ }, sfc);
      accountSubsystem('fiscal', snapshot, () => { total += 5; /* LEAK */ }, sfc);
      accountSubsystem('capmkt', snapshot, () => { /* clean */ }, sfc);

      const totalDrift = total - 1000;
      const bucketSum = sfc.physicsActions + sfc.trade + sfc.enforcement + sfc.banking + sfc.capmkt + sfc.fiscal;
      expect(Math.abs(bucketSum - totalDrift)).toBeLessThan(0.001);
      expect(sfc.fiscal).toBeCloseTo(5, 6);
      expect(sfc.banking).toBe(0);
      expect(sfc.capmkt).toBe(0);
    });
  });

  describe('drift reporting threshold (D-22, D-23)', () => {
    let errorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      errorSpy = vi.spyOn(console, 'error').mockImplementation((() => {}) as never);
    });

    afterEach(() => {
      errorSpy.mockRestore();
    });

    it('drift > 0.1 emits console.error with subsystem breakdown (no auto-correction)', () => {
      const sfc: SfcBySubsystem = initializeSfcBySubsystem();
      sfc.fiscal = 0.5;
      reportDriftIfOverThreshold(7, 0.5, sfc, 0.1);
      expect(errorSpy).toHaveBeenCalled();
      // Verify simulation can continue afterwards (no exception thrown).
      // Helper returns void; threshold call does not throw.
      expect(() => reportDriftIfOverThreshold(8, 0.6, sfc, 0.1)).not.toThrow();
    });

    it('drift <= 0.1 stays silent', () => {
      const sfc: SfcBySubsystem = initializeSfcBySubsystem();
      sfc.fiscal = 0.05;
      reportDriftIfOverThreshold(2, 0.05, sfc, 0.1);
      expect(errorSpy).not.toHaveBeenCalled();
    });
  });

  describe('async subsystem accumulator (fiscal tick contract)', () => {
    it('accountSubsystemAsync awaits the block and accumulates drift', async () => {
      const sfc: SfcBySubsystem = initializeSfcBySubsystem();
      let total = 1000;
      const snapshot = () => total;
      // Fiscal tick is async (awaits sessionRepo.updateConfig in the runner).
      // Simulate 0-drift fiscal tick: treasury → escrow → SFC perimeter unchanged.
      await accountSubsystemAsync('fiscal', snapshot, async () => {
        await new Promise<void>(r => setTimeout(r, 0));
        // No fiat movement → 0 drift
      }, sfc);
      expect(sfc.fiscal).toBe(0);
    });

    it('accountSubsystemAsync detects a synthetic fiscal leak after await', async () => {
      const sfc: SfcBySubsystem = initializeSfcBySubsystem();
      let total = 1000;
      const snapshot = () => total;
      await accountSubsystemAsync('fiscal', snapshot, async () => {
        await new Promise<void>(r => setTimeout(r, 0));
        total += 2; // synthetic leak inside the awaited region
      }, sfc);
      expect(sfc.fiscal).toBeCloseTo(2, 6);
    });
  });

  describe('per-iteration accumulator reset (D-21)', () => {
    it('initializeSfcBySubsystem zeroes all 6 buckets each iteration', () => {
      const sfc1 = initializeSfcBySubsystem();
      sfc1.fiscal = 99;
      sfc1.banking = -50;
      // Next iteration: the runner re-calls initialize so a fresh accumulator is used.
      const sfc2 = initializeSfcBySubsystem();
      expect(sfc2.fiscal).toBe(0);
      expect(sfc2.banking).toBe(0);
      expect(sfc2.physicsActions).toBe(0);
      expect(sfc2.trade).toBe(0);
      expect(sfc2.enforcement).toBe(0);
      expect(sfc2.capmkt).toBe(0);
    });
  });

  // ── Remaining downstream-owned umbrella todos (other waves) ─────────────────
  it.todo('full 5-iteration runSimulation: M0 constant within ±0.1');
  it.todo('escrow + tax withholdings + deposits + AMM reserves + agent wealth = initial M0');
  it.todo('welfare distribution remains direct per-agent transfer (no escrow)');
  it.todo('infra/edu/def spending accumulates in publicGoodsEscrow ledger');
  it.todo('tax withholdings: WORK + AMM sell + VAT + cap gains + bond maturity all routed to treasury');
  it.todo('governanceEnabled=false run shows no governance cycle artifacts');
  it.todo('cortisol trajectory non-monotonic across 5-iter run (not just decaying to floor)');
  it.todo('wealth trajectory non-monotonic — bad policy produces decline, good policy produces growth');
});

// Type-import smoke: prove the shared exports resolve at compile time.
// (Run time: no assertion — just a reference so the import is not pruned.)
const _typeSmoke = (): { p: TaxPolicy; e: PublicGoodsEscrow; t: TelemetryLog } | null => null;
void _typeSmoke;
