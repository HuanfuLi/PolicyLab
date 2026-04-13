/**
 * C5: Simulation control routes (spec §5.2, Stage 2 API).
 *
 * Mounted at: /api/sessions/:id/simulate
 *
 * POST   /        — start simulation
 * POST   /pause   — pause
 * POST   /resume  — resume
 * POST   /abort   — abort
 * GET    /stream  — SSE event stream
 */
import { Router } from 'express';
import { eq, sql } from 'drizzle-orm';
import { db, sqlite } from '../db/index.js';
import {
  iterations, agentIntents, resolvedActions,
  agents, economySnapshots, agentEconomy, marketPrices, roleChanges, ammSnapshots,
  orderBook, depositAccounts, loanContracts, bankBalanceSheets, macroSnapshots,
  equityPositions, bondHoldings, fiscalBudgets, publicGoodsState, enterprises,
} from '../db/schema.js';
import { sessionRepo } from '../db/repos/sessionRepo.js';
import { runSimulation, getSessionTelemetry } from '../orchestration/simulationRunner.js';
import { simulationManager } from '../orchestration/simulationManager.js';
import { asyncLogFlusher } from '../db/asyncLogFlusher.js';
import { rehydrateFiscalBudgetOnAbortReset } from '../orchestration/helpers/fiscalBudgetGuard.js';

/**
 * Wipes all simulation artifacts for a session and resets agents to their
 * initial stats / alive status. Used by the abort-reset flow.
 */
async function eraseSimulationData(sessionId: string): Promise<void> {
  // Drain pending asyncLogFlusher writes BEFORE deleting — if the flusher has
  // queued agent_intents or resolved_actions rows for this session, flushing
  // them AFTER the delete would trigger FOREIGN KEY constraint failures.
  asyncLogFlusher.flush();

  // R4 fix: Wrap all deletes + agent reset in a single transaction for atomicity.
  // Prevents partial cleanup if the server crashes or a query fails mid-way.
  sqlite.transaction(() => {
    db.delete(iterations).where(eq(iterations.sessionId, sessionId)).run();
    db.delete(agentIntents).where(eq(agentIntents.sessionId, sessionId)).run();
    db.delete(resolvedActions).where(eq(resolvedActions.sessionId, sessionId)).run();
    db.delete(economySnapshots).where(eq(economySnapshots.sessionId, sessionId)).run();
    db.delete(agentEconomy).where(eq(agentEconomy.sessionId, sessionId)).run();
    db.delete(marketPrices).where(eq(marketPrices.sessionId, sessionId)).run();
    db.delete(roleChanges).where(eq(roleChanges.sessionId, sessionId)).run();
    db.delete(ammSnapshots).where(eq(ammSnapshots.sessionId, sessionId)).run();
    db.delete(orderBook).where(eq(orderBook.sessionId, sessionId)).run();
    db.delete(depositAccounts).where(eq(depositAccounts.sessionId, sessionId)).run();
    db.delete(loanContracts).where(eq(loanContracts.sessionId, sessionId)).run();
    db.delete(bankBalanceSheets).where(eq(bankBalanceSheets.sessionId, sessionId)).run();
    db.delete(macroSnapshots).where(eq(macroSnapshots.sessionId, sessionId)).run();
    db.delete(equityPositions).where(eq(equityPositions.sessionId, sessionId)).run();
    db.delete(bondHoldings).where(eq(bondHoldings.sessionId, sessionId)).run();
    db.delete(fiscalBudgets).where(eq(fiscalBudgets.sessionId, sessionId)).run();
    db.delete(publicGoodsState).where(eq(publicGoodsState.sessionId, sessionId)).run();
    db.delete(enterprises).where(eq(enterprises.sessionId, sessionId)).run();

    // Reset every agent's current_stats back to initial_stats, revive the dead,
    // and clear persisted allostatic physiology so the next run starts clean.
    sqlite.prepare(
      `UPDATE agents
       SET current_stats = initial_stats,
           status = 'alive',
           died_at_iteration = NULL,
           allostatic_strain = 0,
           allostatic_load = 0
       WHERE session_id = ?`
    ).run(sessionId);
  })();
}

const router = Router({ mergeParams: true });

// POST /simulate — start simulation
router.post('/', async (req, res) => {
  const { id } = req.params as { id: string };
  const totalIterations = Number(req.body?.iterations ?? 20);

  if (!Number.isInteger(totalIterations) || totalIterations < 1 || totalIterations > 200) {
    return res.status(400).json({ error: 'iterations must be an integer between 1 and 200' });
  }

  const session = await sessionRepo.getById(id);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const status = simulationManager.getStatus(id);
  if (status === 'running' || status === 'paused') {
    return res.status(409).json({ error: 'Simulation is currently running or paused. Please abort before starting a new one.' });
  }

  const earlyStoppingEnabled = req.body?.earlyStoppingEnabled !== false;

  // Persist config so resume-after-restart can compute remaining count
  const existingConfig = (session.config as Record<string, unknown> | null) ?? {};
  const updatedConfig = JSON.stringify({ ...existingConfig, totalIterations, earlyStoppingEnabled });
  sqlite.prepare(`UPDATE sessions SET config = ?, updated_at = ? WHERE id = ?`)
    .run(updatedConfig, new Date().toISOString(), id);

  // Set early-stopping flag BEFORE start() so the runner sees it immediately
  simulationManager.setEarlyStopping(id, earlyStoppingEnabled);

  // Mark as running synchronously BEFORE firing the background task so that any
  // concurrent POST /simulate request hitting getStatus() in the same event-loop
  // cycle sees 'running' and returns 409 instead of spawning a second runner.
  simulationManager.start(id);

  // Fire-and-forget: run in background. Broadcast errors to SSE clients
  // so the frontend knows the simulation failed (instead of hanging forever).
  runSimulation(id, totalIterations).catch(err => {
    console.error('[simulate route] unhandled error:', err);
    simulationManager.broadcast(id, {
      type: 'error',
      message: `Simulation failed: ${err instanceof Error ? err.message : String(err)}`,
    });
    // Belt-and-suspenders: if the inner lifecycle handler missed this error
    // path, in-memory status would stay 'running' and block future Start clicks
    // with a 409. Clear state unconditionally so the session is restartable.
    simulationManager.finish(id);
  });

  return res.json({ ok: true });
});

// POST /simulate/pause
router.post('/pause', (req, res) => {
  const { id } = req.params as { id: string };
  const status = simulationManager.getStatus(id);
  if (status === 'running') {
    simulationManager.pause(id);
    return res.json({ ok: true });
  }
  // Already paused — treat as success so the frontend can reconcile its state.
  if (status === 'paused') {
    return res.json({ ok: true, alreadyPaused: true });
  }
  // Simulation has already stopped (error, completion, abort) but the frontend
  // still thinks it's running (missed SSE event).  Return the actual status so
  // the frontend can sync instead of showing an opaque 409 to the user.
  return res.json({ ok: false, stale: true, actualStatus: 'idle' });
});

// POST /simulate/resume
router.post('/resume', async (req, res) => {
  const { id } = req.params as { id: string };
  const memStatus = simulationManager.getStatus(id);

  if (memStatus === 'running') {
    return res.status(409).json({ error: 'Simulation is already running' });
  }

  if (memStatus === 'paused') {
    // Normal case: in-memory runner is paused, just signal it to continue
    simulationManager.resume(id);
    return res.json({ ok: true });
  }

  // memStatus === 'idle': runner is gone (server restart). Check DB for paused stage.
  const session = await sessionRepo.getById(id);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  if (session.stage !== 'simulation-paused') {
    return res.status(409).json({ error: 'No paused simulation to resume' });
  }

  // Compute how many iterations remain
  const [maxRow] = await db
    .select({ max: sql<number>`max(${iterations.iterationNumber})` })
    .from(iterations)
    .where(eq(iterations.sessionId, id));
  const completedCount = maxRow?.max ?? 0;
  const config = (session.config as Record<string, unknown> | null) ?? {};
  const plannedTotal = typeof config.totalIterations === 'number' ? config.totalIterations : 20;
  const remaining = Math.max(1, plannedTotal - completedCount);

  // Mark as running synchronously before firing background task (same race-condition
  // guard as the start route) so concurrent resume requests see 'running' immediately.
  simulationManager.start(id);

  // Restart runner fire-and-forget
  runSimulation(id, remaining).catch(err => {
    console.error('[resume route] unhandled error:', err);
    simulationManager.broadcast(id, {
      type: 'error',
      message: `Simulation failed on resume: ${err instanceof Error ? err.message : String(err)}`,
    });
  });

  return res.json({ ok: true });
});

// PATCH /simulate/early-stopping — toggle regime-collapse early stopping mid-run
router.patch('/early-stopping', (req, res) => {
  const { id } = req.params as { id: string };
  const enabled = req.body?.enabled !== false;
  simulationManager.setEarlyStopping(id, enabled);
  return res.json({ ok: true, earlyStoppingEnabled: enabled });
});

// POST /simulate/abort
router.post('/abort', (req, res) => {
  const { id } = req.params as { id: string };
  simulationManager.abort(id);
  return res.json({ ok: true });
});

// POST /simulate/abort-reset — stop simulation and wipe all artifacts, return to design
router.post('/abort-reset', async (req, res) => {
  const { id } = req.params as { id: string };
  // Signal runner to stop without advancing to simulation-complete stage
  simulationManager.abortAndReset(id);
  // Erase all simulation artifacts and reset agents
  await eraseSimulationData(id);
  // Phase 11 D-15: eraseSimulationData wipes fiscal_budgets. If the session
  // was fiscalEnabled, recreate the row from session.config.budgetAllocation
  // so the next simulation start does not trip assertFiscalBudgetExists.
  // The helper logs "[SIMULATE] Abort-reset re-created fiscal_budgets ..."
  // when it actually creates a row; silently no-ops otherwise (fiscalEnabled
  // false, or no allocation in config — in which case the next start will
  // throw the descriptive assertion, which is the intended behavior).
  await rehydrateFiscalBudgetOnAbortReset(id);
  // Return session to design stage
  await sessionRepo.updateStage(id, 'design-review');
  return res.json({ ok: true });
});

// GET /simulate/telemetry — deterministic physics telemetry log
router.get('/telemetry', (req, res) => {
  const { id } = req.params as { id: string };
  return res.json(getSessionTelemetry(id));
});

// GET /simulate/stream — SSE long-lived connection
router.get('/stream', (req, res) => {
  const { id } = req.params as { id: string };

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  // Establish connection
  res.write(': connected\n\n');

  simulationManager.addClient(id, res);

  // Keep-alive ping every 15s — carries a sequence ID so the client's lastEventId
  // stays current and reconnects use the correct Last-Event-ID header.
  const ping = setInterval(() => {
    try {
      const seq = simulationManager.nextSequenceId(id);
      res.write(`id: ${seq}\n: ping\n\n`);
    } catch { clearInterval(ping); }
  }, 15000);

  req.on('close', () => clearInterval(ping));
});

export default router;
