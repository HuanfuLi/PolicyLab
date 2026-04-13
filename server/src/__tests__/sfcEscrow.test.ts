import { describe, it } from 'vitest';

// Phase 11 D-10, D-11 — only welfare distributes to citizens; infra/edu/def
// fiat moves into publicGoodsEscrow ledger. Escrow counted in
// computeSystemFiatTotal so M0 stays constant (SFC-neutral).
// Downstream Plan 03 owns escrow ledger; Plan 07 wires escrow into audit call sites.
describe('fiscal escrow accounting (Phase 11 D-10, D-11)', () => {
  it.todo('welfare allocation distributes fiat to agents as direct transfers');
  it.todo('infrastructure allocation accumulates in publicGoodsEscrow.infrastructure');
  it.todo('education allocation accumulates in publicGoodsEscrow.education');
  it.todo('defense allocation accumulates in publicGoodsEscrow.defense');
  it.todo('computeSystemFiatTotal with escrow sum equals pre-spending M0 (SFC-neutral)');
  it.todo('quality-score side effects (productivity, skill, enforcement) still fire');
  it.todo('escrow persists across iterations — no flush');
});
