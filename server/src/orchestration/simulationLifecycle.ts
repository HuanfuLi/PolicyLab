/**
 * simulationLifecycle.ts — unified abort/pause/cleanup/completion controller.
 *
 * Encapsulates all lifecycle transitions for a running simulation session so that
 * simulationRunner.ts can call a single method instead of repeating the same
 * 10-line cleanup block in every error path.
 */
import { asyncLogFlusher } from '../db/asyncLogFlusher.js';
import { clearOrderBook } from '../mechanics/orderBook.js';
import { cleanupSessionCognition } from '../cognition/cognitiveEngine.js';
import { simulationManager } from './simulationManager.js';
import { sessionRepo } from '../db/repos/sessionRepo.js';
import { cleanupSessionState } from './simulationState.js';

// ── Error classes ─────────────────────────────────────────────────────────────

/**
 * Thrown when the simulation loop should stop (abort requested or abort detected
 * mid-iteration). Callers catch this to exit the loop cleanly.
 */
export class SimulationAbortedError extends Error {
  constructor(message = 'Simulation aborted.') {
    super(message);
    this.name = 'SimulationAbortedError';
  }
}

// ── SimulationLifecycle ───────────────────────────────────────────────────────

export class SimulationLifecycle {
  constructor(private readonly sessionId: string) {}

  // ── Startup ───────────────────────────────────────────────────────────────

  /**
   * Call once before the iteration loop begins.
   * Starts the async log flusher and marks the session as running.
   */
  start(): void {
    asyncLogFlusher.start();
    simulationManager.start(this.sessionId);
  }

  // ── Per-iteration gate ────────────────────────────────────────────────────

  /**
   * Called at the TOP of every iteration.
   *
   * - If abort is requested: cleans up and throws SimulationAbortedError.
   * - If pause is requested: enters a 500 ms polling loop, blocking until resumed.
   *   After resuming, checks abort again and throws if needed.
   */
  async checkContinue(iterNum: number): Promise<void> {
    if (simulationManager.isAbortRequested(this.sessionId)) {
      await this._doAbortCleanup();
      throw new SimulationAbortedError();
    }

    if (simulationManager.isPauseRequested(this.sessionId)) {
      simulationManager.setPaused(this.sessionId);
      simulationManager.broadcast(this.sessionId, { type: 'paused', iteration: iterNum - 1 });
      await sessionRepo.updateStage(this.sessionId, 'simulation-paused');

      // Block until resumed or aborted
      await new Promise<void>((resolve) => {
        const check = setInterval(() => {
          const status = simulationManager.getStatus(this.sessionId);
          if (status === 'running' || simulationManager.isAbortRequested(this.sessionId)) {
            clearInterval(check);
            resolve();
          }
        }, 500);
      });

      // Check abort again after waking
      if (simulationManager.isAbortRequested(this.sessionId)) {
        await this._doAbortCleanup();
        throw new SimulationAbortedError();
      }

      await sessionRepo.updateStage(this.sessionId, 'simulating');
    }
  }

  /**
   * Returns true when abort has been requested.
   * Suitable for passing as `shouldAbort` to retryWithHealing / runWithConcurrency.
   */
  shouldAbort(): boolean {
    return (
      simulationManager.isPauseRequested(this.sessionId) ||
      simulationManager.isAbortRequested(this.sessionId)
    );
  }

  // ── Mid-iteration abort race guard ────────────────────────────────────────

  /**
   * Call after the physics/persist phase when an abort may have been signaled
   * while work was in flight. Returns true if abort was detected (and cleanup
   * has been performed); the caller should skip the iteration commit and return.
   */
  async checkMidIterationAbort(iterNum: number): Promise<boolean> {
    if (!simulationManager.isAbortRequested(this.sessionId)) return false;

    asyncLogFlusher.stop();
    clearOrderBook(this.sessionId);
    cleanupSessionCognition(this.sessionId);
    cleanupSessionState(this.sessionId);

    if (simulationManager.isResetRequested(this.sessionId)) {
      simulationManager.broadcast(this.sessionId, { type: 'aborted-reset' });
    } else {
      simulationManager.broadcast(this.sessionId, { type: 'error', message: 'Simulation aborted.' });
      await sessionRepo.updateStage(this.sessionId, 'simulation-complete');
    }
    simulationManager.finish(this.sessionId);
    return true;
  }

  // ── Post-loop termination ─────────────────────────────────────────────────

  /**
   * Called when the iteration loop finishes normally.
   * Flushes pending logs, tears down session state, updates stage, broadcasts completion.
   */
  async complete(finalReport: string): Promise<void> {
    asyncLogFlusher.stop();
    this._doSessionCleanup();
    await sessionRepo.updateStage(this.sessionId, 'simulation-complete');
    simulationManager.broadcast(this.sessionId, { type: 'simulation-complete', finalReport });
    simulationManager.finish(this.sessionId);
  }

  /**
   * Called when the simulation loop is interrupted by a SimulationPausedError
   * (parse failure, context overflow, provider failure, or explicit pause).
   *
   * Stops the flusher but does NOT delete session state Maps — those must survive
   * so that a resume can continue from the last committed iteration.
   */
  async handlePause(_err: unknown): Promise<void> {
    asyncLogFlusher.stop();
    // Do NOT call cleanupSessionState here — state must survive for resume.
    try {
      await sessionRepo.updateStage(this.sessionId, 'simulation-paused');
    } catch {
      // best-effort
    }
    const message = _err instanceof Error ? _err.message : 'Simulation paused.';
    try { simulationManager.broadcast(this.sessionId, { type: 'error', message }); } catch { /* best-effort */ }
    // C1 fix: call setPaused, NOT finish — so resume() can detect status === 'paused'
    simulationManager.setPaused(this.sessionId);
  }

  /**
   * Called from the top-level catch block for any non-pause error.
   * Full cleanup + broadcast + finish.
   */
  async handleError(err: unknown): Promise<void> {
    asyncLogFlusher.stop();
    clearOrderBook(this.sessionId);
    cleanupSessionCognition(this.sessionId);
    cleanupSessionState(this.sessionId);

    const message = err instanceof Error ? err.message : 'Simulation error';
    simulationManager.broadcast(this.sessionId, { type: 'error', message });
    console.error(`[SimulationRunner] Session ${this.sessionId}:`, err);
    simulationManager.finish(this.sessionId);
  }

  /**
   * Abort path: cleanup + broadcast abort/reset + finish + throw.
   * Primarily used by checkContinue; also callable directly if the runner
   * needs to force-abort outside the loop.
   */
  async abort(): Promise<never> {
    await this._doAbortCleanup();
    throw new SimulationAbortedError();
  }

  // ── Internal helpers ──────────────────────────────────────────────────────

  private async _doAbortCleanup(): Promise<void> {
    asyncLogFlusher.stop();
    clearOrderBook(this.sessionId);
    cleanupSessionCognition(this.sessionId);
    cleanupSessionState(this.sessionId);

    if (simulationManager.isResetRequested(this.sessionId)) {
      simulationManager.broadcast(this.sessionId, { type: 'aborted-reset' });
    } else {
      simulationManager.broadcast(this.sessionId, { type: 'error', message: 'Simulation aborted.' });
      await sessionRepo.updateStage(this.sessionId, 'simulation-complete');
    }
    simulationManager.finish(this.sessionId);
  }

  private _doSessionCleanup(): void {
    clearOrderBook(this.sessionId);
    cleanupSessionCognition(this.sessionId);
    cleanupSessionState(this.sessionId);
  }
}
