import { create } from 'zustand';
import type { Agent, Iteration, IterationStats, TelemetryLog } from '@policylab/shared';

// SSE event shapes mirroring server's SimulationEvent union
type SSEEvent =
  | { type: 'iteration-start'; iteration: number; total: number }
  | {
      type: 'agent-intent';
      agentId: string;
      agentName: string;
      intent: string;
      reasoning: string;
      actionCode: string;
      actionTarget: string | null;
      actions?: ActionQueueRecord[];
    }
  | { type: 'resolution'; iteration: number; narrativeSummary: string; lifecycleEvents: LifecycleEvent[] }
  | { type: 'iteration-complete'; iteration: number; stats: IterationStats }
  | { type: 'simulation-complete'; finalReport: string }
  | { type: 'paused'; iteration: number }
  | { type: 'error'; message: string }
  | { type: 'aborted-reset' };

export interface LifecycleEvent {
  type: 'death' | 'role_change';
  agentId: string;
  detail: string;
}

export interface ActionQueueRecord {
  actionCode: string;
  parameters: Record<string, unknown>;
}

export interface AgentIntentRecord {
  agentId: string;
  agentName: string;
  iterationNumber: number;
  actionCode: string;
  actionTarget: string | null;
  actions: ActionQueueRecord[];
  narrative: string;
  reasoning: string;
}

export interface IterationFeed {
  number: number;
  narrativeSummary: string;
  lifecycleEvents: LifecycleEvent[];
  stats: IterationStats | null;
}

interface SimulationStore {
  // Status
  isRunning: boolean;
  isPaused: boolean;
  isComplete: boolean;
  currentIteration: number;
  totalIterations: number;

  // SSE synchronization
  /** The SSE `id` of the last processed event. Used to filter duplicates on reconnect. */
  lastSeenId: number | null;

  // Live feed
  feed: IterationFeed[];
  pendingIntents: Record<string, string>; // agentId → narrative
  pendingActionCodes: Record<string, { actionCode: string; actionTarget: string | null; actions: ActionQueueRecord[] }>;
  agentIntentHistory: Record<string, AgentIntentRecord[]>; // agentId → sorted history

  // Stats history
  statsHistory: IterationStats[];

  /** Per-iteration macro telemetry snapshots — populated from loadHistory and SSE */
  macroHistory: TelemetryLog[];

  // Agents (loaded from API)
  agents: Agent[];

  // Final report
  finalReport: string | null;

  // Error
  error: string | null;

  // Actions
  loadAgents: (sessionId: string) => Promise<void>;
  loadHistory: (sessionId: string) => Promise<void>;
  loadMacroHistory: (sessionId: string) => Promise<void>;
  loadIntentHistory: (sessionId: string) => Promise<void>;
  connectSSE: (sessionId: string) => () => void;
  pause: (sessionId: string) => Promise<void>;
  resume: (sessionId: string) => Promise<void>;
  abort: (sessionId: string) => Promise<void>;
  abortAndReset: (sessionId: string) => Promise<void>;
  continueSimulation: (sessionId: string, iterations: number, earlyStoppingEnabled?: boolean) => Promise<() => void>;
  forkSimulation: (sessionId: string) => Promise<string>;
  reset: () => void;
}

const initialState = {
  isRunning: false,
  isPaused: false,
  isComplete: false,
  currentIteration: 0,
  totalIterations: 0,
  lastSeenId: null as number | null,
  feed: [] as IterationFeed[],
  pendingIntents: {} as Record<string, string>,
  pendingActionCodes: {} as Record<string, { actionCode: string; actionTarget: string | null; actions: ActionQueueRecord[] }>,
  agentIntentHistory: {} as Record<string, AgentIntentRecord[]>,
  statsHistory: [] as IterationStats[],
  macroHistory: [] as TelemetryLog[],
  agents: [] as Agent[],
  finalReport: null as string | null,
  error: null as string | null,
};

/** Monotonic counter to prevent stale loadMacroHistory responses from overwriting fresh data */
let macroHistoryGeneration = 0;

/** Max telemetry entries to keep in memory (sliding window) */
const MACRO_HISTORY_CAP = 1000;

export const useSimulationStore = create<SimulationStore>((set, get) => ({
  ...initialState,

  reset: () => set({ ...initialState, macroHistory: [] as TelemetryLog[] }),

  loadAgents: async (sessionId: string) => {
    try {
      const res = await fetch(`/api/sessions/${sessionId}/agents`);
      if (!res.ok) return;
      const data = await res.json() as { agents: Agent[] };
      set({ agents: data.agents });
    } catch { /* ignore */ }
  },

  loadHistory: async (sessionId: string) => {
    try {
      const res = await fetch(`/api/sessions/${sessionId}/iterations?full=true`);
      if (!res.ok) return;
      const iters = await res.json() as Array<Iteration & { statistics?: IterationStats; lifecycleEvents?: LifecycleEvent[] }>;
      if (iters.length === 0) return;

      const feed: IterationFeed[] = iters.map(it => ({
        number: it.number,
        narrativeSummary: it.narrativeSummary,
        lifecycleEvents: (it.lifecycleEvents ?? []) as LifecycleEvent[],
        stats: it.statistics ?? null,
      }));

      const statsHistory: IterationStats[] = iters
        .filter(it => it.statistics)
        .map(it => it.statistics!);

      set({
        feed,
        statsHistory,
        currentIteration: iters[iters.length - 1].number,
      });
      get().loadMacroHistory(sessionId);
    } catch { /* ignore */ }
  },

  loadMacroHistory: async (sessionId: string) => {
    const gen = ++macroHistoryGeneration;
    try {
      const res = await fetch(`/api/sessions/${sessionId}/simulate/telemetry`);
      if (!res.ok) return;
      // Discard stale response if a newer request was issued while this one was in flight
      if (gen !== macroHistoryGeneration) return;
      const data = await res.json() as TelemetryLog[];
      const capped = (data ?? []).length > MACRO_HISTORY_CAP
        ? (data ?? []).slice(-MACRO_HISTORY_CAP)
        : (data ?? []);
      set({ macroHistory: capped });
    } catch { /* ignore */ }
  },

  loadIntentHistory: async (sessionId: string) => {
    try {
      const res = await fetch(`/api/sessions/${sessionId}/agent-intents`);
      if (!res.ok) return;
      const data = await res.json() as {
        agents: Array<{
          agentId: string; agentName: string; role: string;
          intents: Array<{
            iterationNumber: number;
            actionCode: string;
            actionTarget: string | null;
            actions: ActionQueueRecord[];
            narrative: string;
          }>;
        }>;
      };
      const history: Record<string, AgentIntentRecord[]> = {};
      for (const a of data.agents) {
        history[a.agentId] = a.intents.map(i => ({
          agentId: a.agentId,
          agentName: a.agentName,
          iterationNumber: i.iterationNumber,
          actionCode: i.actionCode,
          actionTarget: i.actionTarget,
          actions: i.actions ?? [],
          narrative: i.narrative,
          reasoning: i.reasoning ?? '',
        }));
      }
      set({ agentIntentHistory: history });
    } catch { /* ignore */ }
  },

  connectSSE: (sessionId: string) => {
    const es = new EventSource(`/api/sessions/${sessionId}/simulate/stream`);

    // ── Double-buffering: push events into a mutable buffer and flush
    // via requestAnimationFrame to avoid per-event React re-renders. ────
    type BufferedEvent = { seqId: number | null; event: SSEEvent };
    const buffer: BufferedEvent[] = [];
    let rafId: number | null = null;

    const flushBuffer = () => {
      rafId = null;
      if (buffer.length === 0) return;

      const batch = buffer.splice(0);
      let needAgentReload = false;
      let needMacroReload = false;

      set(state => {
        // Clone mutable state we'll update across the batch
        let { isRunning, isPaused, isComplete, currentIteration, totalIterations,
          lastSeenId,
          pendingIntents, pendingActionCodes, agentIntentHistory,
          feed, statsHistory, finalReport, error } = state;
        const { macroHistory } = state;

        // Process as mutable copies to avoid intermediate object allocations
        feed = [...feed];
        pendingIntents = { ...pendingIntents };
        pendingActionCodes = { ...pendingActionCodes };
        agentIntentHistory = { ...agentIntentHistory };

        for (const { seqId, event } of batch) {
          // Advance lastSeenId; track the highest id seen this batch
          if (seqId !== null) {
            lastSeenId = Math.max(lastSeenId ?? 0, seqId);
          }

          switch (event.type) {
            case 'iteration-start':
              isRunning = true;
              isPaused = false;
              currentIteration = event.iteration;
              totalIterations = event.total;
              pendingIntents = {};
              pendingActionCodes = {};
              // Reset lastSeenId on new simulation start to prevent stale
              // sequence IDs from a previous run rejecting new events
              if (event.iteration <= 1) {
                lastSeenId = seqId;
              }
              break;

            case 'agent-intent': {
              pendingIntents[event.agentId] = event.intent;
              pendingActionCodes[event.agentId] = {
                actionCode: event.actionCode,
                actionTarget: event.actionTarget,
                actions: event.actions ?? [],
              };
              // Accumulate in history (deduplicate by agentId + iterationNumber)
              // Ring-buffer cap: keep at most 500 entries per agent to prevent
              // unbounded memory growth during long-running simulations (BUG-10).
              const INTENT_HISTORY_CAP = 500;
              const agentHistory = agentIntentHistory[event.agentId] ?? [];
              const alreadyRecorded = agentHistory.some(r => r.iterationNumber === currentIteration);
              if (!alreadyRecorded && currentIteration > 0) {
                const newRecord: AgentIntentRecord = {
                  agentId: event.agentId,
                  agentName: event.agentName,
                  iterationNumber: currentIteration,
                  actionCode: event.actionCode,
                  actionTarget: event.actionTarget,
                  actions: event.actions ?? [],
                  narrative: event.intent,
                  reasoning: event.reasoning ?? '',
                };
                // Append new record; if over cap, drop the oldest entry (shift)
                const updated = [...agentHistory, newRecord];
                if (updated.length > INTENT_HISTORY_CAP) {
                  updated.shift();
                }
                agentIntentHistory[event.agentId] = updated;
              }
              break;
            }

            case 'resolution': {
              const entry: IterationFeed = {
                number: event.iteration,
                narrativeSummary: event.narrativeSummary,
                lifecycleEvents: event.lifecycleEvents as LifecycleEvent[],
                stats: null,
              };
              const idx = feed.findIndex(f => f.number === event.iteration);
              if (idx >= 0) {
                feed[idx] = { ...feed[idx], ...entry };
              } else {
                feed.push(entry);
              }
              break;
            }

            case 'iteration-complete': {
              feed = feed.map(f =>
                f.number === event.iteration ? { ...f, stats: event.stats } : f
              );
              statsHistory = [...statsHistory, event.stats];
              pendingIntents = {};
              needAgentReload = true;
              needMacroReload = true;
              break;
            }

            case 'simulation-complete':
              isRunning = false;
              isComplete = true;
              finalReport = event.finalReport;
              needAgentReload = true;
              break;

            case 'paused':
              isRunning = false;
              isPaused = true;
              break;

            case 'error':
              isRunning = false;
              error = event.message;
              // "Simulation paused:" prefix means a parse/context-overflow failure — treat as
              // a recoverable pause so the Resume button appears and the user can retry.
              if (event.message.startsWith('Simulation paused:')) {
                isPaused = true;
              } else {
                isPaused = false;
                // If aborted, mark as complete so progress bar and action bar render correctly
                if (event.message.includes('abort')) {
                  isComplete = true;
                }
              }
              break;

            case 'aborted-reset':
              // Server confirmed the abort-reset; component handles navigation
              isRunning = false;
              isPaused = false;
              break;
          }
        }

        return {
          isRunning, isPaused, isComplete, currentIteration, totalIterations,
          lastSeenId,
          pendingIntents, pendingActionCodes, agentIntentHistory,
          feed, statsHistory, macroHistory, finalReport, error,
        };
      });

      if (needAgentReload) {
        get().loadAgents(sessionId);
      }
      if (needMacroReload) {
        get().loadMacroHistory(sessionId);
      }
    };

    const scheduleFlush = () => {
      if (rafId === null) {
        rafId = requestAnimationFrame(flushBuffer);
      }
    };

    es.onmessage = (e) => {
      try {
        // Parse the SSE sequence id (the `id:` line) provided by the browser's EventSource API.
        // e.lastEventId is a string; parse to int. Empty string means no id was set.
        const rawId = e.lastEventId !== '' ? parseInt(e.lastEventId, 10) : null;
        const seqId = rawId !== null && !isNaN(rawId) ? rawId : null;

        // Duplicate filtering: skip events we've already processed (can arrive on reconnect).
        const currentLastSeen = get().lastSeenId;
        if (seqId !== null && currentLastSeen !== null && seqId <= currentLastSeen) {
          // This event was already processed before the reconnect; skip it.
          return;
        }

        // Gap detection: warn if events may have been missed.
        if (seqId !== null && currentLastSeen !== null && seqId > currentLastSeen + 1) {
          console.warn(
            `[SSE] Sequence gap detected: expected ${currentLastSeen + 1}, got ${seqId}. ` +
            `${seqId - currentLastSeen - 1} event(s) may have been missed.`
          );
        }

        const event = JSON.parse(e.data) as SSEEvent;
        buffer.push({ seqId, event });
        scheduleFlush();
      } catch { /* ignore parse errors */ }
    };

    es.onerror = () => {
      es.close();
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
    };

    return () => {
      es.close();
      if (rafId !== null) cancelAnimationFrame(rafId);
      // Flush any remaining events synchronously
      flushBuffer();
    };
  },

  pause: async (sessionId: string) => {
    const res = await fetch(`/api/sessions/${sessionId}/simulate/pause`, { method: 'POST' });
    if (!res.ok) {
      set({ error: `Pause failed: ${res.status}` });
      return;
    }
    const body = await res.json().catch(() => ({ ok: true }));
    if (body.stale) {
      // Simulation already stopped (error/completion) but we missed the SSE event.
      // Reconcile frontend state so the user isn't stuck on a phantom "running" screen.
      set({ isRunning: false, isPaused: false, error: 'Simulation has already stopped.' });
    } else {
      set({ isPaused: true, isRunning: false });
    }
  },

  resume: async (sessionId: string) => {
    const res = await fetch(`/api/sessions/${sessionId}/simulate/resume`, { method: 'POST' });
    if (res.ok) {
      set({ isPaused: false, isRunning: true });
    }
  },

  abort: async (sessionId: string) => {
    const res = await fetch(`/api/sessions/${sessionId}/simulate/abort`, { method: 'POST' });
    if (res.ok) {
      set({ isRunning: false, isPaused: false, isComplete: true });
    } else {
      set({ error: `Abort failed: ${res.status}` });
    }
  },

  abortAndReset: async (sessionId: string) => {
    await fetch(`/api/sessions/${sessionId}/simulate/abort-reset`, { method: 'POST' });
  },

  continueSimulation: async (sessionId: string, iterations: number, earlyStoppingEnabled = true) => {
    set({ isComplete: false, finalReport: null, error: null });
    const res = await fetch(`/api/sessions/${sessionId}/simulate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ iterations, earlyStoppingEnabled }),
    });
    if (!res.ok) {
      set({ error: `Continue failed: ${res.status}`, isComplete: true });
      return () => {};
    }
    return get().connectSSE(sessionId);
  },

  forkSimulation: async (sessionId: string) => {
    const res = await fetch(`/api/sessions/${sessionId}/fork-simulation`, { method: 'POST' });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error((err as { error?: string }).error ?? `Fork failed: HTTP ${res.status}`);
    }
    const data = await res.json() as { id: string };
    return data.id;
  },
}));
