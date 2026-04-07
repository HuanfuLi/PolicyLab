import { create } from 'zustand';
import type { Agent } from '@policylab/shared';

// SSE event shapes from the reflection runner
interface PassStartEvent { type: 'pass-start'; pass: 1 | 2; total: number }
interface AgentReflectionEvent { type: 'agent-reflection'; pass: 1 | 2; agentId: string; agentName: string; content: string }
interface EvaluationStartEvent { type: 'evaluation-start' }
interface EvaluationEvent { type: 'evaluation'; verdict: string; strengths: string[]; weaknesses: string[]; analysis: string }
interface ReflectionCompleteEvent { type: 'reflection-complete' }
interface ErrorEvent { type: 'error'; message: string }

export interface AgentReflectionData {
  pass1: string;
  pass2: string | null;
}

export interface Evaluation {
  verdict: string;
  strengths: string[];
  weaknesses: string[];
  analysis: string;
}

interface ReflectionStore {
  // Status
  isRunning: boolean;
  isComplete: boolean;
  currentPass: 1 | 2 | null;
  completedCount: number;
  totalAgents: number;
  isEvaluating: boolean;

  // Data
  agentReflections: Record<string, AgentReflectionData>;  // agentId → reflections
  evaluation: Evaluation | null;
  error: string | null;

  // Agents (loaded separately)
  agents: Agent[];

  // Actions
  loadAgents: (sessionId: string) => Promise<void>;
  loadReflections: (sessionId: string) => Promise<void>;
  startReflection: (sessionId: string) => Promise<void>;
  connectSSE: (sessionId: string) => () => void;
  reset: () => void;
}

const initialState = {
  isRunning: false,
  isComplete: false,
  currentPass: null as 1 | 2 | null,
  completedCount: 0,
  totalAgents: 0,
  isEvaluating: false,
  agentReflections: {} as Record<string, AgentReflectionData>,
  evaluation: null as Evaluation | null,
  error: null as string | null,
  agents: [] as Agent[],
};

export const useReflectionStore = create<ReflectionStore>((set) => ({
  ...initialState,

  reset: () => set(initialState),

  loadAgents: async (sessionId: string) => {
    try {
      const res = await fetch(`/api/sessions/${sessionId}/agents`);
      if (!res.ok) return;
      const data = await res.json() as { agents: Agent[] };
      set({ agents: data.agents });
    } catch { /* ignore */ }
  },

  loadReflections: async (sessionId: string) => {
    try {
      const res = await fetch(`/api/sessions/${sessionId}/reflect`);
      if (!res.ok) return;
      const data = await res.json() as {
        reflections: Record<string, { pass1: string; pass2: string | null }>;
        evaluation: Evaluation | null;
      };
      set({
        agentReflections: data.reflections ?? {},
        evaluation: data.evaluation ?? null,
        isComplete: !!data.evaluation,
      });
    } catch { /* ignore */ }
  },

  startReflection: async (sessionId: string) => {
    try {
      const res = await fetch(`/api/sessions/${sessionId}/reflect`, { method: 'POST' });
      if (!res.ok) {
        const err = await res.json() as { error: string };
        set({ error: err.error });
      }
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to start reflection' });
    }
  },

  connectSSE: (sessionId: string) => {
    const es = new EventSource(`/api/sessions/${sessionId}/reflect/stream`);

    es.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data) as
          | PassStartEvent | AgentReflectionEvent | EvaluationStartEvent
          | EvaluationEvent | ReflectionCompleteEvent | ErrorEvent;

        switch (event.type) {
          case 'pass-start':
            set({
              isRunning: true,
              currentPass: event.pass,
              totalAgents: event.total,
              completedCount: 0,
              isEvaluating: false,
            });
            break;

          case 'agent-reflection':
            set(state => {
              const existing = state.agentReflections[event.agentId] ?? { pass1: '', pass2: null };
              const updated = event.pass === 1
                ? { ...existing, pass1: event.content }
                : { ...existing, pass2: event.content };
              return {
                agentReflections: { ...state.agentReflections, [event.agentId]: updated },
                completedCount: state.completedCount + 1,
              };
            });
            break;

          case 'evaluation-start':
            set({ isEvaluating: true });
            break;

          case 'evaluation':
            set({
              evaluation: {
                verdict: event.verdict,
                strengths: event.strengths,
                weaknesses: event.weaknesses,
                analysis: event.analysis,
              },
              isEvaluating: false,
            });
            break;

          case 'reflection-complete':
            set({ isRunning: false, isComplete: true });
            es.close();
            break;

          case 'error':
            set({ isRunning: false, error: event.message });
            es.close();
            break;
        }
      } catch { /* ignore parse errors */ }
    };

    es.onerror = () => es.close();

    return () => es.close();
  },
}));
