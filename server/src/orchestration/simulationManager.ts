/**
 * C4: SimulationManager — in-memory state and SSE broadcasting per session (spec §9).
 *
 * Manages:
 * - Running/paused/abort flags per session
 * - Connected SSE client list
 * - Event broadcasting
 */
import type { Response } from 'express';

export type SimulationStatus = 'idle' | 'running' | 'paused';

interface SimulationState {
  status: SimulationStatus;
  abortRequested: boolean;
  pauseRequested: boolean;
  /** When true, abort also resets all simulation data and returns to design stage. */
  resetRequested: boolean;
  /** When false, regime-collapse early stopping is suppressed for this session. */
  earlyStoppingEnabled: boolean;
  clients: Set<Response>;
  /** Monotonic counter for SSE event sequencing. Session-scoped; used as the SSE `id:` field. */
  sequenceId: number;
}

export type SimulationEvent =
  | { type: 'iteration-start'; iteration: number; total: number }
  | {
      type: 'agent-intent';
      agentId: string;
      agentName: string;
      intent: string;
      actionCode: string;
      actionTarget: string | null;
      actions?: Array<{ actionCode: string; parameters: Record<string, unknown> }>;
    }
  | { type: 'resolution'; iteration: number; narrativeSummary: string; lifecycleEvents: unknown[] }
  | { type: 'iteration-complete'; iteration: number; stats: Record<string, unknown> }
  | { type: 'simulation-complete'; finalReport: string }
  | { type: 'paused'; iteration: number }
  | { type: 'error'; message: string }
  | { type: 'aborted-reset' };

class SimulationManager {
  private sessions = new Map<string, SimulationState>();

  private getOrCreate(sessionId: string): SimulationState {
    if (!this.sessions.has(sessionId)) {
      this.sessions.set(sessionId, {
        status: 'idle',
        abortRequested: false,
        pauseRequested: false,
        resetRequested: false,
        earlyStoppingEnabled: true,
        clients: new Set(),
        sequenceId: 0,
      });
    }
    return this.sessions.get(sessionId)!;
  }

  getStatus(sessionId: string): SimulationStatus {
    return this.sessions.get(sessionId)?.status ?? 'idle';
  }

  start(sessionId: string): void {
    const state = this.getOrCreate(sessionId);
    state.status = 'running';
    state.abortRequested = false;
    state.pauseRequested = false;
    // earlyStoppingEnabled is intentionally NOT reset here — it may be
    // pre-set by the route handler from request body before start() is called.
  }

  setEarlyStopping(sessionId: string, enabled: boolean): void {
    this.getOrCreate(sessionId).earlyStoppingEnabled = enabled;
  }

  isEarlyStoppingEnabled(sessionId: string): boolean {
    return this.sessions.get(sessionId)?.earlyStoppingEnabled ?? true;
  }

  pause(sessionId: string): void {
    const state = this.sessions.get(sessionId);
    if (state && state.status === 'running') {
      state.pauseRequested = true;
    }
  }

  resume(sessionId: string): void {
    const state = this.sessions.get(sessionId);
    if (state && state.status === 'paused') {
      state.status = 'running';
      state.pauseRequested = false;
    }
  }

  abort(sessionId: string): void {
    const state = this.sessions.get(sessionId);
    if (state) {
      state.abortRequested = true;
    }
  }

  /** Signal abort AND mark that the caller wants a full reset to design stage. */
  abortAndReset(sessionId: string): void {
    const state = this.getOrCreate(sessionId);
    state.abortRequested = true;
    state.resetRequested = true;
  }

  isResetRequested(sessionId: string): boolean {
    return this.sessions.get(sessionId)?.resetRequested ?? false;
  }

  isPauseRequested(sessionId: string): boolean {
    return this.sessions.get(sessionId)?.pauseRequested ?? false;
  }

  isAbortRequested(sessionId: string): boolean {
    return this.sessions.get(sessionId)?.abortRequested ?? false;
  }

  setPaused(sessionId: string): void {
    const state = this.sessions.get(sessionId);
    if (state) {
      state.status = 'paused';
      state.pauseRequested = false;
    }
  }

  /** Called when simulation ends (complete or abort). */
  finish(sessionId: string): void {
    const state = this.sessions.get(sessionId);
    if (state) {
      state.status = 'idle';
      state.abortRequested = false;
      state.pauseRequested = false;
      state.resetRequested = false;
    }
  }

  addClient(sessionId: string, res: Response): void {
    const state = this.getOrCreate(sessionId);
    state.clients.add(res);
    res.on('close', () => {
      state.clients.delete(res);
    });
  }

  /** Returns the next sequence ID for this session (used by keep-alive pings). */
  nextSequenceId(sessionId: string): number {
    const state = this.getOrCreate(sessionId);
    return ++state.sequenceId;
  }

  broadcast(sessionId: string, event: SimulationEvent): void {
    const state = this.sessions.get(sessionId);
    if (!state || state.clients.size === 0) return;
    const seq = ++state.sequenceId;
    const data = `id: ${seq}\ndata: ${JSON.stringify(event)}\n\n`;
    for (const client of state.clients) {
      try {
        client.write(data);
      } catch {
        state.clients.delete(client);
      }
    }
  }
}

export const simulationManager = new SimulationManager();
