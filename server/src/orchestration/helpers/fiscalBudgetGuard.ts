/**
 * Phase 11 D-15 — Fiscal budget guards.
 *
 * Three coupled responsibilities:
 *
 *   1. `assertFiscalBudgetExists` — startup gate for `runSimulation`. When
 *      `economyConfig.fiscalEnabled === true`, a `fiscal_budgets` row MUST
 *      exist for the session. Throws a descriptive error pointing at the
 *      three known root causes (abort-reset, PUT /config flip, bootstrap
 *      regression) so the caller / SSE pipeline can surface a useful message
 *      to the operator. No silent fallback to `DEFAULT_BUDGET_ALLOCATION`.
 *
 *   2. `assertPutConfigFiscalFlip` — guard for the PUT /api/sessions/:id/config
 *      handler. When the request flips `fiscalEnabled` from false→true and
 *      no row exists, require an explicit `budgetAllocation` in the body
 *      (or fail with a 400-shaped result). Auto-creates the row when
 *      allocation is supplied so the downstream startup assertion passes.
 *
 *   3. `rehydrateFiscalBudgetOnAbortReset` — invoked from the abort-reset
 *      path immediately after `eraseSimulationData` wipes every session
 *      table (fiscal_budgets included). Recreates the row from
 *      `session.config.budgetAllocation` (or
 *      `session.config.economyConfig.budgetAllocation`) when fiscalEnabled
 *      is true, so the next simulation start does not trip the assertion.
 *
 * The functions are extracted into a standalone helper so they can be unit
 * tested without mounting the entire 3000-line `simulationRunner.ts` or
 * spinning up a real Express server.
 */
import type { BudgetAllocation, EconomyConfig } from '@policylab/shared';
import * as fiscalRepo from '../../db/repos/fiscalRepo.js';
import { sessionRepo } from '../../db/repos/sessionRepo.js';
import { createScope, type SessionScope } from '../../db/sessionScope.js';

/**
 * Marker phrase grep-asserted by tests. Kept as an exported constant so the
 * test file can verify it without duplicating the literal across two places.
 */
export const ASSERTION_PHRASE = 'fiscalEnabled=true but no fiscal_budgets row';

type GetActiveBudgetFn = (scope: SessionScope) => BudgetAllocation | null;

/**
 * Throw with descriptive root-cause guidance when fiscalEnabled is true and
 * no fiscal_budgets row exists. Pure / DI-friendly: the caller injects the
 * lookup so tests can mock without touching the DB.
 */
export function assertFiscalBudgetExists(
  scope: SessionScope,
  economyConfig: EconomyConfig,
  sessionId: string,
  getActiveBudget: GetActiveBudgetFn = fiscalRepo.getActiveBudget,
): void {
  if (economyConfig.fiscalEnabled !== true) return;

  const budget = getActiveBudget(scope);
  if (budget) return;

  throw new Error(
    `[FISCAL] Session ${sessionId} has ${ASSERTION_PHRASE}. ` +
    `This indicates either (a) an abort-reset wiped the budget and bootstrap was not re-run, ` +
    `(b) fiscalEnabled was flipped via PUT /config without providing budgetAllocation, or ` +
    `(c) a bootstrap regression. Re-bootstrap the session or POST budgetAllocation via ` +
    `PUT /api/sessions/${sessionId}/config.`,
  );
}

// ── PUT /config flip guard ────────────────────────────────────────────────────

export type PutConfigFlipResult =
  | { ok: true }
  | { ok: false; status: 400; error: string };

interface PutConfigFlipInput {
  sessionId: string;
  /** Current persisted economyConfig (may be undefined for legacy sessions). */
  currentEconomyConfig: Partial<EconomyConfig> | undefined;
  /** Incoming patch from the request body — may be a partial. */
  incomingEconomyConfig: Record<string, unknown> | undefined;
  /** Top-level budgetAllocation in the request body (preferred location). */
  incomingBudgetAllocation: BudgetAllocation | undefined;
}

/**
 * If the PUT body flips fiscalEnabled from false→true, require a budget row
 * to exist OR a budgetAllocation in the body. Auto-creates the row when an
 * allocation is supplied. Returns a structured result so the route can
 * forward the 400 directly without re-shaping the error.
 */
export function assertPutConfigFiscalFlip(input: PutConfigFlipInput): PutConfigFlipResult {
  const incomingFiscalEnabled = input.incomingEconomyConfig?.fiscalEnabled;
  const currentEnabled = input.currentEconomyConfig?.fiscalEnabled === true;
  const flipsTrueFromFalse = incomingFiscalEnabled === true && !currentEnabled;

  if (!flipsTrueFromFalse) return { ok: true };

  const scope = createScope(input.sessionId);
  const existing = fiscalRepo.getActiveBudget(scope);
  if (existing) return { ok: true };

  // Look in both the top-level body and the nested economyConfig patch —
  // older clients may send it either place.
  const allocation =
    input.incomingBudgetAllocation ??
    (input.incomingEconomyConfig?.budgetAllocation as BudgetAllocation | undefined);

  if (!allocation) {
    return {
      ok: false,
      status: 400,
      error:
        'Flipping fiscalEnabled to true requires budgetAllocation in the request body ' +
        'or a pre-existing fiscal_budgets row. Provide allocation or re-bootstrap the session.',
    };
  }

  fiscalRepo.createBudget(scope, allocation);
  return { ok: true };
}

// ── Abort-reset rehydration ──────────────────────────────────────────────────

/**
 * Called from the abort-reset route AFTER eraseSimulationData() wipes all
 * session tables (including fiscal_budgets). Recreates the row from
 * session.config so the next runSimulation start does not trip
 * assertFiscalBudgetExists.
 *
 * Skips silently when:
 *   - session is missing (caller will handle)
 *   - fiscalEnabled is not true
 *   - no budgetAllocation can be located in session.config
 *
 * The third skip path is honest: if we can't find an allocation we can't
 * recreate the row, and the next simulation start will throw the assertion
 * with its descriptive root-cause message — which is the desired behavior.
 */
export async function rehydrateFiscalBudgetOnAbortReset(sessionId: string): Promise<void> {
  const session = await sessionRepo.getById(sessionId);
  if (!session) return;

  const config = (session.config as Record<string, unknown> | null) ?? {};
  const econConfig = (config.economyConfig as Record<string, unknown> | undefined) ?? {};
  const fiscalEnabled = econConfig.fiscalEnabled === true;
  if (!fiscalEnabled) return;

  // Allocation is conventionally stored at session.config.budgetAllocation,
  // but some legacy paths nested it under economyConfig.budgetAllocation.
  // Check both before giving up.
  const allocation =
    (config.budgetAllocation as BudgetAllocation | undefined) ??
    (econConfig.budgetAllocation as BudgetAllocation | undefined);
  if (!allocation) return;

  fiscalRepo.createBudget(createScope(sessionId), allocation);
  console.log(`[SIMULATE] Abort-reset re-created fiscal_budgets for fiscalEnabled session ${sessionId}`);
}
