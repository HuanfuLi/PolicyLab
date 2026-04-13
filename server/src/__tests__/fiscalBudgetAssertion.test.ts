import { describe, it } from 'vitest';

// Phase 11 D-15 — fiscalEnabled=true implies a fiscal_budgets row must exist
// before runSimulation proceeds. No silent fallback to DEFAULT_BUDGET_ALLOCATION.
// Folded from bootstrap bug where session 3b25f15c had fiscalEnabled=true but
// bootstrap.ts:524 createBudget never wrote a row.
describe('fiscal budget startup assertion (Phase 11 D-15)', () => {
  it.todo('runSimulation throws when fiscalEnabled=true and fiscal_budgets row missing');
  it.todo('runSimulation proceeds when fiscal_budgets row exists');
  it.todo('runSimulation proceeds (no assertion) when fiscalEnabled=false');
  it.todo('bootstrap.ts writes a fiscal_budgets row when fiscalEnabled=true');
  it.todo('assertion error message references sessionId and fiscalEnabled config');
});
