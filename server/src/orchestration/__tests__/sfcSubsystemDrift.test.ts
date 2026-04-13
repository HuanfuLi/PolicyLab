import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  initializeSfcBySubsystem,
  accountSubsystem,
  accountSubsystemAsync,
  reportDriftIfOverThreshold,
  type SfcBySubsystem,
  type SubsystemKey,
} from '../helpers/sfcSubsystemAccounting.js';

// Phase 11 D-20, D-21, D-22, D-23 — per-subsystem SFC drift telemetry.
// Diagnostic only: no auto-correction, no pause. Threshold 0.1 abs fiat/iter.

describe('sfcSubsystemAccounting helper (Phase 11 D-20, D-21, D-22, D-23)', () => {
  describe('initializeSfcBySubsystem', () => {
    it('returns all six subsystem buckets initialized to 0', () => {
      const acc = initializeSfcBySubsystem();
      expect(acc).toEqual({
        physicsActions: 0,
        trade: 0,
        enforcement: 0,
        banking: 0,
        capmkt: 0,
        fiscal: 0,
      });
    });

    it('returns a fresh object each call (no shared reference)', () => {
      const a = initializeSfcBySubsystem();
      const b = initializeSfcBySubsystem();
      a.banking += 5;
      expect(b.banking).toBe(0);
    });
  });

  describe('accountSubsystem', () => {
    it('updates the subsystem bucket by (after - before)', () => {
      const acc = initializeSfcBySubsystem();
      let total = 100;
      const snapshot = () => total;
      accountSubsystem('banking', snapshot, () => { total = 103; }, acc);
      expect(acc.banking).toBeCloseTo(3, 6);
      expect(acc.fiscal).toBe(0);
    });

    it('accumulates across multiple calls on the same subsystem (+= not =)', () => {
      const acc = initializeSfcBySubsystem();
      let total = 100;
      const snapshot = () => total;
      accountSubsystem('fiscal', snapshot, () => { total = 105; }, acc);
      accountSubsystem('fiscal', snapshot, () => { total = 102; }, acc);
      // First call: +5; second call: -3; sum = +2
      expect(acc.fiscal).toBeCloseTo(2, 6);
    });

    it('passes through the block return value', () => {
      const acc = initializeSfcBySubsystem();
      const result = accountSubsystem('capmkt', () => 0, () => 'hello', acc);
      expect(result).toBe('hello');
    });

    it('does NOT update accumulator when block throws', () => {
      const acc = initializeSfcBySubsystem();
      let total = 100;
      const snapshot = () => total;
      expect(() =>
        accountSubsystem('banking', snapshot, () => {
          total = 999; // would imply +899 if accumulator updated
          throw new Error('boom');
        }, acc),
      ).toThrow('boom');
      expect(acc.banking).toBe(0);
    });

    it('handles 0 delta without polluting the bucket', () => {
      const acc = initializeSfcBySubsystem();
      let total = 100;
      const snapshot = () => total;
      accountSubsystem('physicsActions', snapshot, () => { /* no fiat change */ }, acc);
      expect(acc.physicsActions).toBe(0);
    });
  });

  describe('accountSubsystemAsync', () => {
    it('awaits the block before snapshotting after', async () => {
      const acc = initializeSfcBySubsystem();
      let total = 100;
      const snapshot = () => total;
      await accountSubsystemAsync('fiscal', snapshot, async () => {
        await new Promise<void>(resolve => setTimeout(resolve, 1));
        total = 110;
      }, acc);
      expect(acc.fiscal).toBeCloseTo(10, 6);
    });

    it('does NOT update accumulator when async block rejects', async () => {
      const acc = initializeSfcBySubsystem();
      let total = 100;
      const snapshot = () => total;
      await expect(
        accountSubsystemAsync('fiscal', snapshot, async () => {
          total = 999;
          throw new Error('async boom');
        }, acc),
      ).rejects.toThrow('async boom');
      expect(acc.fiscal).toBe(0);
    });

    it('passes through async block return value', async () => {
      const acc = initializeSfcBySubsystem();
      const result = await accountSubsystemAsync('banking', () => 0, async () => 42, acc);
      expect(result).toBe(42);
    });
  });

  describe('reportDriftIfOverThreshold', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let errorSpy: any;

    beforeEach(() => {
      errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
      errorSpy.mockRestore();
    });

    it('stays silent when |drift| <= threshold (0.1 default)', () => {
      const acc = initializeSfcBySubsystem();
      acc.fiscal = 0.05;
      reportDriftIfOverThreshold(1, 0.05, acc);
      expect(errorSpy).not.toHaveBeenCalled();
    });

    it('logs total drift line when |drift| exceeds threshold', () => {
      const acc = initializeSfcBySubsystem();
      acc.fiscal = 0.5;
      reportDriftIfOverThreshold(7, 0.5, acc);
      expect(errorSpy).toHaveBeenCalled();
      const firstCall = errorSpy.mock.calls[0]?.[0];
      expect(String(firstCall)).toMatch(/\[SFC\] iter=7/);
      expect(String(firstCall)).toMatch(/total drift=0\.5/);
    });

    it('logs per-subsystem lines for buckets exceeding threshold', () => {
      const acc: SfcBySubsystem = {
        physicsActions: 0,
        trade: 0,
        enforcement: 0,
        banking: -0.4,
        capmkt: 0.05,
        fiscal: 0.6,
      };
      reportDriftIfOverThreshold(3, 0.25, acc);
      // Expect 1 total line + 2 subsystem lines (banking and fiscal — capmkt below threshold).
      // Note: total of 0.25 is at the threshold; helper logs only when STRICTLY exceeds.
      // Use 0.249 as the report-threshold to ensure trigger.
      reportDriftIfOverThreshold(4, 0.5, acc, 0.1);
      const calls: string[] = errorSpy.mock.calls.map((c: unknown[]) => String(c[0]));
      expect(calls.some((line: string) => line.includes('iter=4'))).toBe(true);
      expect(calls.some((line: string) => line.includes('banking') && line.includes('-0.4000'))).toBe(true);
      expect(calls.some((line: string) => line.includes('fiscal') && line.includes('+0.6000'))).toBe(true);
      expect(calls.some((line: string) => line.includes('capmkt'))).toBe(false);
    });

    it('respects custom threshold', () => {
      const acc = initializeSfcBySubsystem();
      acc.fiscal = 0.3;
      reportDriftIfOverThreshold(2, 0.3, acc, 1.0);
      expect(errorSpy).not.toHaveBeenCalled();

      reportDriftIfOverThreshold(2, 1.5, acc, 1.0);
      expect(errorSpy).toHaveBeenCalled();
    });
  });

  describe('SubsystemKey type contract', () => {
    it('exposes the six expected subsystem identifiers', () => {
      // Compile-time: any missing key would fail TypeScript check.
      const expected: SubsystemKey[] = [
        'physicsActions',
        'trade',
        'enforcement',
        'banking',
        'capmkt',
        'fiscal',
      ];
      const acc = initializeSfcBySubsystem();
      for (const k of expected) {
        expect(acc[k]).toBe(0);
      }
    });
  });
});
