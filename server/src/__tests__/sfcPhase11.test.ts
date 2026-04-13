import { describe, it } from 'vitest';
import type { TaxPolicy, PublicGoodsEscrow, TelemetryLog } from '@policylab/shared';

// Phase 11 umbrella SFC integration scaffold. Downstream waves 1-6 convert
// these todos into real integration tests once escrow, tax withholding, and
// subsystem drift telemetry land.
// See .planning/phases/11-*/11-CONTEXT.md for the full decision set.
describe('Phase 11 SFC integration', () => {
  it.todo('full 5-iteration run: M0 constant within ±0.1');
  it.todo('escrow + tax withholdings + deposits + AMM reserves + agent wealth = initial M0');
  it.todo('welfare distribution remains direct per-agent transfer (no escrow)');
  it.todo('infra/edu/def spending accumulates in publicGoodsEscrow ledger');
  it.todo('tax withholdings: WORK + AMM sell + VAT + cap gains + bond maturity all routed to treasury');
  it.todo('TelemetryLog.sfcDrift per iteration ≤ 0.1 absolute');
  it.todo('governanceEnabled=false run shows no governance cycle artifacts');
  it.todo('cortisol trajectory non-monotonic across 5-iter run (not just decaying to floor)');
  it.todo('wealth trajectory non-monotonic — bad policy produces decline, good policy produces growth');
});

// Type-import smoke: prove the shared exports resolve at compile time.
// (Run time: no assertion — just a reference so the import is not pruned.)
const _typeSmoke = (): { p: TaxPolicy; e: PublicGoodsEscrow; t: TelemetryLog } | null => null;
void _typeSmoke;
