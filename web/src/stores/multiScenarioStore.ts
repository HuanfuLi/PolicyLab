import { create } from 'zustand';
import type { Agent, IterationStats, TelemetryLog } from '@policylab/shared';
import type {
  ActionQueueRecord,
  IterationFeed,
  LifecycleEvent,
} from './simulationStore';

type SSEEvent =
  | { type: 'iteration-start'; iteration: number; total: number }
  | {
      type: 'agent-intent';
      agentId: string;
      agentName: string;
      intent: string;
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

export const SCENARIO_COLORS = [
  'var(--chart-blue)',
  'var(--chart-orange)',
  'var(--chart-green)',
  'var(--chart-violet)',
] as const;

export const SCENARIO_DASHES = ['', '8 4', '4 4', '2 4'] as const;

const MACRO_HISTORY_CAP = 1000;

export interface MultiScenarioSessionState {
  label: string;
  color: string;
  dashPattern: string;
  sessionId: string;
  isRunning: boolean;
  isPaused: boolean;
  isComplete: boolean;
  currentIteration: number;
  totalIterations: number;
  macroHistory: TelemetryLog[];
  statsHistory: IterationStats[];
  feed: IterationFeed[];
  agents: Agent[];
  finalReport: string | null;
  error: string | null;
}

interface MultiScenarioStore {
  scenarios: Record<string, MultiScenarioSessionState>;
  scenarioOrder: string[];
  allComplete: boolean;
  anyRunning: boolean;
  initScenarios: (sessions: Array<{ id: string; label: string }>) => void;
  connectAll: () => () => void;
  pauseAll: () => Promise<void>;
  resumeAll: () => Promise<void>;
  abortAll: () => Promise<void>;
  addMoreIterations: (count: number) => Promise<void>;
  endAndProceed: () => Promise<void>;
  loadAllAgents: () => Promise<void>;
  loadAllHistory: () => Promise<void>;
  reset: () => void;
}

const emptyState = (): Pick<MultiScenarioStore, 'scenarios' | 'scenarioOrder' | 'allComplete' | 'anyRunning'> => ({
  scenarios: {},
  scenarioOrder: [],
  allComplete: false,
  anyRunning: false,
});

function deriveFlags(scenarios: Record<string, MultiScenarioSessionState>) {
  const values = Object.values(scenarios);
  return {
    allComplete: values.length > 0 && values.every((scenario) => scenario.isComplete),
    anyRunning: values.some((scenario) => scenario.isRunning),
  };
}

function createScenarioState(sessionId: string, label: string, index: number): MultiScenarioSessionState {
  return {
    label,
    color: SCENARIO_COLORS[index % SCENARIO_COLORS.length],
    dashPattern: SCENARIO_DASHES[index % SCENARIO_DASHES.length],
    sessionId,
    isRunning: false,
    isPaused: false,
    isComplete: false,
    currentIteration: 0,
    totalIterations: 0,
    macroHistory: [],
    statsHistory: [],
    feed: [],
    agents: [],
    finalReport: null,
    error: null,
  };
}

async function postJson(url: string, body?: Record<string, unknown>) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    throw new Error(`Request failed: ${res.status}`);
  }
}

export const useMultiScenarioStore = create<MultiScenarioStore>((set, get) => ({
  ...emptyState(),

  initScenarios: (sessions) => {
    const nextScenarios: Record<string, MultiScenarioSessionState> = {};
    const scenarioOrder = sessions.slice(0, 4).map(({ id, label }, index) => {
      nextScenarios[id] = createScenarioState(id, label, index);
      return id;
    });

    set({
      scenarios: nextScenarios,
      scenarioOrder,
      ...deriveFlags(nextScenarios),
    });
  },

  connectAll: () => {
    const { scenarioOrder } = get();
    const cleanups = scenarioOrder.map((sessionId) => {
      const es = new EventSource(`/api/sessions/${sessionId}/simulate/stream`);
      const buffer: SSEEvent[] = [];
      let rafId: number | null = null;
      let lastTelemetryIteration = 0;

      const scheduleTelemetryLoad = async (fromIteration: number) => {
        try {
          const res = await fetch(`/api/sessions/${sessionId}/simulate/telemetry?from=${fromIteration}`);
          if (!res.ok) return;
          const data = await res.json() as TelemetryLog[];
          set((state) => {
            const scenario = state.scenarios[sessionId];
            if (!scenario) return state;
            const merged = [...scenario.macroHistory, ...(data ?? [])];
            const capped = merged.length > MACRO_HISTORY_CAP ? merged.slice(-MACRO_HISTORY_CAP) : merged;
            const nextScenarios = {
              ...state.scenarios,
              [sessionId]: {
                ...scenario,
                macroHistory: capped,
              },
            };
            return {
              scenarios: nextScenarios,
              ...deriveFlags(nextScenarios),
            };
          });
        } catch {
          // Ignore telemetry fetch failures during live updates.
        }
      };

      const flushBuffer = () => {
        rafId = null;
        if (buffer.length === 0) return;

        const batch = buffer.splice(0);
        const telemetryFetches: number[] = [];

        set((state) => {
          const scenario = state.scenarios[sessionId];
          if (!scenario) return state;

          let nextScenario = {
            ...scenario,
            feed: [...scenario.feed],
            statsHistory: [...scenario.statsHistory],
          };

          for (const event of batch) {
            switch (event.type) {
              case 'iteration-start':
                nextScenario = {
                  ...nextScenario,
                  isRunning: true,
                  isPaused: false,
                  currentIteration: event.iteration,
                  totalIterations: event.total,
                  error: null,
                };
                break;
              case 'agent-intent':
                break;
              case 'resolution': {
                const entry: IterationFeed = {
                  number: event.iteration,
                  narrativeSummary: event.narrativeSummary,
                  lifecycleEvents: event.lifecycleEvents,
                  stats: null,
                };
                const existingIndex = nextScenario.feed.findIndex((item) => item.number === event.iteration);
                if (existingIndex >= 0) {
                  nextScenario.feed[existingIndex] = {
                    ...nextScenario.feed[existingIndex],
                    ...entry,
                  };
                } else {
                  nextScenario.feed.push(entry);
                }
                break;
              }
              case 'iteration-complete':
                nextScenario.feed = nextScenario.feed.map((item) =>
                  item.number === event.iteration ? { ...item, stats: event.stats } : item,
                );
                nextScenario.statsHistory.push(event.stats);
                telemetryFetches.push(lastTelemetryIteration);
                lastTelemetryIteration = event.iteration;
                break;
              case 'simulation-complete':
                nextScenario = {
                  ...nextScenario,
                  isRunning: false,
                  isPaused: false,
                  isComplete: true,
                  finalReport: event.finalReport,
                };
                break;
              case 'paused':
                nextScenario = {
                  ...nextScenario,
                  isRunning: false,
                  isPaused: true,
                  currentIteration: event.iteration,
                };
                break;
              case 'error':
                nextScenario = {
                  ...nextScenario,
                  isRunning: false,
                  isPaused: event.message.startsWith('Simulation paused:'),
                  isComplete: event.message.includes('abort') ? true : nextScenario.isComplete,
                  error: event.message,
                };
                break;
              case 'aborted-reset':
                nextScenario = {
                  ...nextScenario,
                  isRunning: false,
                  isPaused: false,
                };
                break;
            }
          }

          const nextScenarios = {
            ...state.scenarios,
            [sessionId]: nextScenario,
          };
          return {
            scenarios: nextScenarios,
            ...deriveFlags(nextScenarios),
          };
        });

        for (const fromIteration of telemetryFetches) {
          void scheduleTelemetryLoad(fromIteration);
        }
      };

      const scheduleFlush = () => {
        if (rafId === null) {
          rafId = requestAnimationFrame(flushBuffer);
        }
      };

      es.onmessage = (e) => {
        try {
          buffer.push(JSON.parse(e.data) as SSEEvent);
          scheduleFlush();
        } catch {
          // Ignore malformed SSE payloads.
        }
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
        if (rafId !== null) {
          cancelAnimationFrame(rafId);
        }
        flushBuffer();
      };
    });

    return () => {
      cleanups.forEach((cleanup) => cleanup());
    };
  },

  pauseAll: async () => {
    const running = Object.values(get().scenarios).filter((scenario) => scenario.isRunning && !scenario.isPaused);
    await Promise.all(
      running.map((scenario) => postJson(`/api/sessions/${scenario.sessionId}/simulate/pause`)),
    );
  },

  resumeAll: async () => {
    const paused = Object.values(get().scenarios).filter((scenario) => scenario.isPaused && !scenario.isComplete);
    await Promise.all(
      paused.map((scenario) => postJson(`/api/sessions/${scenario.sessionId}/simulate/resume`)),
    );
  },

  abortAll: async () => {
    const active = Object.values(get().scenarios).filter((scenario) => scenario.isRunning || scenario.isPaused);
    await Promise.all(
      active.map((scenario) => postJson(`/api/sessions/${scenario.sessionId}/simulate/abort`)),
    );
  },

  addMoreIterations: async (count) => {
    const eligible = Object.values(get().scenarios).filter((scenario) => scenario.isComplete);
    await Promise.all(
      eligible.map((scenario) =>
        postJson(`/api/sessions/${scenario.sessionId}/simulate`, { iterations: count }),
      ),
    );
  },

  endAndProceed: async () => {
    const active = Object.values(get().scenarios).filter((scenario) => !scenario.isComplete);
    await Promise.all(
      active.map((scenario) => postJson(`/api/sessions/${scenario.sessionId}/simulate/abort`)),
    );
  },

  loadAllAgents: async () => {
    const { scenarioOrder } = get();
    await Promise.all(
      scenarioOrder.map(async (sessionId) => {
        try {
          const res = await fetch(`/api/sessions/${sessionId}/agents`);
          if (!res.ok) return;
          const data = await res.json() as { agents: Agent[] };
          set((state) => {
            const scenario = state.scenarios[sessionId];
            if (!scenario) return state;
            const nextScenarios = {
              ...state.scenarios,
              [sessionId]: {
                ...scenario,
                agents: data.agents,
              },
            };
            return {
              scenarios: nextScenarios,
              ...deriveFlags(nextScenarios),
            };
          });
        } catch {
          // Ignore agent load failures.
        }
      }),
    );
  },

  loadAllHistory: async () => {
    const { scenarioOrder } = get();
    await Promise.all(
      scenarioOrder.map(async (sessionId) => {
        try {
          const [telemetryRes, itersRes] = await Promise.all([
            fetch(`/api/sessions/${sessionId}/simulate/telemetry`),
            fetch(`/api/sessions/${sessionId}/iterations?full=true`),
          ]);
          if (!telemetryRes.ok || !itersRes.ok) return;
          const [macroHistory, iters] = await Promise.all([
            telemetryRes.json() as Promise<TelemetryLog[]>,
            itersRes.json() as Promise<Array<{ statistics?: IterationStats }>>,
          ]);
          const statsHistory = iters
            .filter((it) => it.statistics)
            .map((it) => it.statistics!) as IterationStats[];

          set((state) => {
            const scenario = state.scenarios[sessionId];
            if (!scenario) return state;
            const nextScenarios = {
              ...state.scenarios,
              [sessionId]: {
                ...scenario,
                macroHistory: (macroHistory ?? []).slice(-MACRO_HISTORY_CAP),
                statsHistory: statsHistory ?? [],
              },
            };
            return {
              scenarios: nextScenarios,
              ...deriveFlags(nextScenarios),
            };
          });
        } catch {
          // Ignore history load failures.
        }
      }),
    );
  },

  reset: () => set(emptyState()),
}));
