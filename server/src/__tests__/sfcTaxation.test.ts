import { describe, it } from 'vitest';

// Phase 11 D-12, D-14 — tax base extended beyond WORK. Withholding is inline
// at each taxable event so SFC traceability holds per-action.
describe('extended tax withholding (Phase 11 D-12, D-14)', () => {
  it.todo('WORK wage income: income-rate tax withheld inline, credited to treasury');
  it.todo('PRODUCE_AND_SELL AMM sell proceeds: income-rate tax withheld at trade execution');
  it.todo('AMM buy trade: VAT added on top, routed to treasury');
  it.todo('SELL_SHARES profit: capital-gains rate applied, routed to treasury');
  it.todo('matured bond payout: capital-gains rate applied, routed to treasury');
  it.todo('enterprise wage settlement: income-rate withheld from employee credit');
  it.todo('progressive taxPolicy: rate selected from brackets by income level');
  it.todo('sum of all tax withholdings == treasury increase this iteration (SFC invariant)');
});
