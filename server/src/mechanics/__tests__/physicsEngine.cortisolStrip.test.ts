import { describe, it } from 'vitest';

// Phase 11 D-01 — strip all per-action cortisol relief from physicsEngine.ts.
// See .planning/phases/11-*/11-RESEARCH.md §1 for the full table of stripped actions.
// Downstream wave will replace these .todo entries with real assertions once the
// per-action deltas are removed and trace.push lines updated.
describe('physicsEngine cortisol-strip (Phase 11 D-01)', () => {
  it.todo('WORK cortisolDelta === 0 (per-action relief removed)');
  it.todo('WORK_AT_ENTERPRISE cortisolDelta === 0');
  it.todo('REST cortisolDelta === 0');
  it.todo('PRODUCE_AND_SELL cortisolDelta === 0');
  it.todo('POST_BUY_ORDER cortisolDelta === 0');
  it.todo('POST_SELL_ORDER cortisolDelta === 0');
  it.todo('HELP cortisolDelta === 0');
  it.todo('DEPOSIT cortisolDelta === 0');
  it.todo('REPAY_LOAN cortisolDelta === 0');
  it.todo('BUY_BOND cortisolDelta === 0');
  it.todo('ISSUE_GOV_BOND cortisolDelta === 0');
  it.todo('STEAL retains outcome-driven +10 cortisol (not stripped)');
  it.todo('STRIKE retains outcome-driven +5 cortisol (not stripped)');
  it.todo('trace.push lines still fire with structural-pressure descriptions');
});
