/**
 * Phase 11 D-15 — fiscalEnabled=true implies a fiscal_budgets row must exist
 * before runSimulation proceeds. No silent fallback to DEFAULT_BUDGET_ALLOCATION.
 *
 * Folded from bootstrap bug where session 3b25f15c had fiscalEnabled=true but
 * bootstrap.ts:524 createBudget never wrote a row, and runSimulation silently
 * defaulted via `fiscalRepo.getActiveBudget(scope) ?? DEFAULT_BUDGET_ALLOCATION`.
 *
 * Strategy: the production assertion is encapsulated in the standalone helper
 * `assertFiscalBudgetExists(scope, economyConfig, sessionId, getActiveBudget)`
 * which the runner calls during startup. Testing the helper directly avoids
 * mounting the entire 3000-line simulationRunner while still exercising the
 * exact contract the runner depends on.
 *
 * Additionally we use vi.mock + dynamic import to test the route-level guards
 * (PUT /config flip + abort-reset rehydration) without touching the real DB.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { BudgetAllocation, EconomyConfig } from '@policylab/shared';
import {
  assertFiscalBudgetExists,
  ASSERTION_PHRASE,
} from '../orchestration/helpers/fiscalBudgetGuard.js';

const SESSION_ID = 'sess-fiscal-test';
const SCOPE = SESSION_ID as unknown as Parameters<typeof assertFiscalBudgetExists>[0];

function makeBudget(): BudgetAllocation {
  return { infrastructure: 0.25, education: 0.25, defense: 0.25, welfare: 0.25 };
}

function makeConfig(overrides: Partial<EconomyConfig> = {}): EconomyConfig {
  return {
    bankingEnabled: false,
    reserveRequirement: 0.1,
    baseLoanInterestRate: 0.005,
    defaultLoanTermIterations: 20,
    defaultThresholdIterations: 3,
    depositInterestRate: 0.002,
    capitalMarketsEnabled: false,
    fiscalEnabled: true,
    ...overrides,
  };
}

// ── Helper-level contract (Task 1 core) ──────────────────────────────────────

describe('assertFiscalBudgetExists (Phase 11 D-15)', () => {
  it('throws when fiscalEnabled=true and getActiveBudget returns null', () => {
    const lookup = vi.fn(() => null);
    expect(() => assertFiscalBudgetExists(SCOPE, makeConfig({ fiscalEnabled: true }), SESSION_ID, lookup))
      .toThrowError(/fiscalEnabled=true but no fiscal_budgets row/);
    expect(lookup).toHaveBeenCalledWith(SCOPE);
  });

  it('error message references the sessionId and the three known root causes', () => {
    const lookup = vi.fn(() => null);
    let caught: Error | undefined;
    try {
      assertFiscalBudgetExists(SCOPE, makeConfig({ fiscalEnabled: true }), SESSION_ID, lookup);
    } catch (err) {
      caught = err as Error;
    }
    expect(caught).toBeDefined();
    const msg = caught!.message;
    expect(msg).toContain(SESSION_ID);
    expect(msg).toContain(ASSERTION_PHRASE);
    expect(msg).toMatch(/abort-reset/i);
    expect(msg).toMatch(/PUT \/config/);
    expect(msg).toMatch(/bootstrap/i);
    expect(msg).toMatch(/re-bootstrap|budgetAllocation/);
  });

  it('does NOT throw when fiscalEnabled=true and a row exists', () => {
    const lookup = vi.fn(() => makeBudget());
    expect(() => assertFiscalBudgetExists(SCOPE, makeConfig({ fiscalEnabled: true }), SESSION_ID, lookup))
      .not.toThrow();
  });

  it('does NOT throw when fiscalEnabled=false (no lookup performed)', () => {
    const lookup = vi.fn(() => null);
    expect(() => assertFiscalBudgetExists(SCOPE, makeConfig({ fiscalEnabled: false }), SESSION_ID, lookup))
      .not.toThrow();
    expect(lookup).not.toHaveBeenCalled();
  });

  it('does NOT throw when fiscalEnabled is undefined (legacy session)', () => {
    const lookup = vi.fn(() => null);
    const cfg = makeConfig();
    delete (cfg as Partial<EconomyConfig>).fiscalEnabled;
    expect(() => assertFiscalBudgetExists(SCOPE, cfg, SESSION_ID, lookup)).not.toThrow();
    expect(lookup).not.toHaveBeenCalled();
  });
});

// ── Source-grep contracts (no silent fallbacks left at known sites) ──────────

describe('Silent-fallback removal (D-15)', () => {
  it('simulationRunner.ts no longer contains `?? DEFAULT_BUDGET_ALLOCATION`', async () => {
    const fs = await import('node:fs/promises');
    const src = await fs.readFile(
      new URL('../orchestration/simulationRunner.ts', import.meta.url),
      'utf8',
    );
    const matches = src.match(/\?\?\s*DEFAULT_BUDGET_ALLOCATION/g) ?? [];
    expect(matches.length).toBe(0);
  });

  it('simulationRunner.ts contains the assertion phrase (root-cause guidance)', async () => {
    const fs = await import('node:fs/promises');
    const src = await fs.readFile(
      new URL('../orchestration/simulationRunner.ts', import.meta.url),
      'utf8',
    );
    expect(src).toContain(ASSERTION_PHRASE);
  });
});

// ── Route-level guards (Task 2: PUT /config flip + abort-reset rehydration) ──

const sessionRecord: { config: Record<string, unknown> | null } = { config: null };
const sessionGetByIdMock = vi.fn(async (_id: string) => ({
  id: SESSION_ID,
  config: sessionRecord.config,
}));
const sessionUpdateConfigMock = vi.fn(async (_id: string, _cfg: Record<string, unknown>) => {});
const sessionUpdateStageMock = vi.fn(async (_id: string, _stage: string) => {});

const fiscalStore: { row: BudgetAllocation | null } = { row: null };
const getActiveBudgetMock = vi.fn((_scope: unknown) => fiscalStore.row);
const createBudgetMock = vi.fn((_scope: unknown, alloc: BudgetAllocation) => {
  fiscalStore.row = { ...alloc };
  return 'budget-id';
});

beforeEach(() => {
  sessionRecord.config = null;
  fiscalStore.row = null;
  sessionGetByIdMock.mockClear();
  sessionUpdateConfigMock.mockClear();
  sessionUpdateStageMock.mockClear();
  getActiveBudgetMock.mockClear();
  createBudgetMock.mockClear();
});

vi.mock('../db/repos/sessionRepo.js', () => ({
  sessionRepo: {
    getById: (id: string) => sessionGetByIdMock(id),
    updateConfig: (id: string, cfg: Record<string, unknown>) => sessionUpdateConfigMock(id, cfg),
    updateStage: (id: string, stage: string) => sessionUpdateStageMock(id, stage),
  },
}));

vi.mock('../db/repos/fiscalRepo.js', () => ({
  getActiveBudget: (scope: unknown) => getActiveBudgetMock(scope),
  createBudget: (scope: unknown, alloc: BudgetAllocation) => createBudgetMock(scope, alloc),
}));

const { assertPutConfigFiscalFlip, rehydrateFiscalBudgetOnAbortReset } = await import(
  '../orchestration/helpers/fiscalBudgetGuard.js'
);

describe('PUT /config fiscalEnabled flip guard (Phase 11 D-15)', () => {
  it('returns a 400-shaped error when flipping false→true with no row and no allocation', () => {
    const result = assertPutConfigFiscalFlip({
      sessionId: SESSION_ID,
      currentEconomyConfig: { fiscalEnabled: false },
      incomingEconomyConfig: { fiscalEnabled: true },
      incomingBudgetAllocation: undefined,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return; // type narrowing
    expect(result.status).toBe(400);
    expect(result.error).toMatch(/requires budgetAllocation/);
  });

  it('creates a budget when flipping false→true with allocation in body and no existing row', () => {
    const result = assertPutConfigFiscalFlip({
      sessionId: SESSION_ID,
      currentEconomyConfig: { fiscalEnabled: false },
      incomingEconomyConfig: { fiscalEnabled: true },
      incomingBudgetAllocation: makeBudget(),
    });
    expect(result.ok).toBe(true);
    expect(createBudgetMock).toHaveBeenCalledTimes(1);
    expect(createBudgetMock.mock.calls[0][1]).toEqual(makeBudget());
  });

  it('succeeds (no createBudget call) when flipping false→true and row already exists', () => {
    fiscalStore.row = makeBudget();
    const result = assertPutConfigFiscalFlip({
      sessionId: SESSION_ID,
      currentEconomyConfig: { fiscalEnabled: false },
      incomingEconomyConfig: { fiscalEnabled: true },
      incomingBudgetAllocation: undefined,
    });
    expect(result.ok).toBe(true);
    expect(createBudgetMock).not.toHaveBeenCalled();
  });

  it('does nothing when fiscalEnabled is not flipping true', () => {
    const result = assertPutConfigFiscalFlip({
      sessionId: SESSION_ID,
      currentEconomyConfig: { fiscalEnabled: true },
      incomingEconomyConfig: { fiscalEnabled: true },
      incomingBudgetAllocation: undefined,
    });
    expect(result.ok).toBe(true);
    expect(createBudgetMock).not.toHaveBeenCalled();
  });

  it('does nothing when incoming config does not touch fiscalEnabled', () => {
    const result = assertPutConfigFiscalFlip({
      sessionId: SESSION_ID,
      currentEconomyConfig: { fiscalEnabled: false },
      incomingEconomyConfig: { reserveRequirement: 0.1 },
      incomingBudgetAllocation: undefined,
    });
    expect(result.ok).toBe(true);
    expect(createBudgetMock).not.toHaveBeenCalled();
  });
});

describe('abort-reset fiscal budget rehydration (Phase 11 D-15)', () => {
  it('re-creates a budget when fiscalEnabled=true and budgetAllocation is in session.config', async () => {
    sessionRecord.config = {
      economyConfig: { fiscalEnabled: true },
      budgetAllocation: makeBudget(),
    };
    await rehydrateFiscalBudgetOnAbortReset(SESSION_ID);
    expect(createBudgetMock).toHaveBeenCalledTimes(1);
    expect(createBudgetMock.mock.calls[0][1]).toEqual(makeBudget());
  });

  it('re-creates a budget when allocation is nested under economyConfig.budgetAllocation', async () => {
    sessionRecord.config = {
      economyConfig: { fiscalEnabled: true, budgetAllocation: makeBudget() },
    };
    await rehydrateFiscalBudgetOnAbortReset(SESSION_ID);
    expect(createBudgetMock).toHaveBeenCalledTimes(1);
    expect(createBudgetMock.mock.calls[0][1]).toEqual(makeBudget());
  });

  it('skips when fiscalEnabled is false', async () => {
    sessionRecord.config = {
      economyConfig: { fiscalEnabled: false },
      budgetAllocation: makeBudget(),
    };
    await rehydrateFiscalBudgetOnAbortReset(SESSION_ID);
    expect(createBudgetMock).not.toHaveBeenCalled();
  });

  it('skips when fiscalEnabled=true but no budgetAllocation present (row recreation impossible)', async () => {
    sessionRecord.config = { economyConfig: { fiscalEnabled: true } };
    await rehydrateFiscalBudgetOnAbortReset(SESSION_ID);
    expect(createBudgetMock).not.toHaveBeenCalled();
  });

  it('skips when session is missing entirely', async () => {
    sessionGetByIdMock.mockResolvedValueOnce(null as never);
    await rehydrateFiscalBudgetOnAbortReset(SESSION_ID);
    expect(createBudgetMock).not.toHaveBeenCalled();
  });
});

describe('simulate.ts grep-verifiable contracts', () => {
  it('contains rehydration log marker', async () => {
    const fs = await import('node:fs/promises');
    const src = await fs.readFile(
      new URL('../routes/simulate.ts', import.meta.url),
      'utf8',
    );
    expect(src).toMatch(/re-created fiscal_budgets/);
  });
});

describe('sessions.ts grep-verifiable contracts', () => {
  it('contains the flip guard symbol and 400 message', async () => {
    const fs = await import('node:fs/promises');
    const src = await fs.readFile(
      new URL('../routes/sessions.ts', import.meta.url),
      'utf8',
    );
    expect(src).toMatch(/assertPutConfigFiscalFlip|flipsTrueFromFalse/);
    expect(src).toMatch(/requires budgetAllocation/);
  });
});
