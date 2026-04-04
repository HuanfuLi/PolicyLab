import { create } from 'zustand';
import type { BootstrapProgressEvent, DataSource } from '@policylab/shared';

interface BootstrapStep {
  step: string;
  status: 'pending' | 'active' | 'done' | 'fallback';
  fallbackSource?: DataSource;
}

interface BootstrapState {
  mode: 'idle' | 'searching' | 'bootstrapping' | 'complete' | 'error';
  selectedLocation: {
    name: string;
    country: string;
    countryCode: string;
    coordinates: { lat: number; lon: number };
  } | null;
  agentCount: number;
  scenario: string;
  steps: BootstrapStep[];
  currentStepIndex: number;
  errorMessage: string | null;
  sessionId: string | null;
  _abortController: AbortController | null;

  setSelectedLocation: (loc: BootstrapState['selectedLocation']) => void;
  setAgentCount: (n: number) => void;
  setScenario: (s: string) => void;
  startBootstrap: (sessionId: string) => Promise<void>;
  reset: () => void;
}

const BOOTSTRAP_STEPS = [
  'geocoding',
  'demographics',
  'economics',
  'governance',
  'infrastructure',
  'generation',
] as const;

const initialSteps = (): BootstrapStep[] =>
  BOOTSTRAP_STEPS.map(step => ({ step, status: 'pending' as const }));

const initialState = {
  mode: 'idle' as const,
  selectedLocation: null,
  agentCount: 50,
  scenario: '',
  steps: initialSteps(),
  currentStepIndex: 0,
  errorMessage: null,
  sessionId: null,
  _abortController: null as AbortController | null,
};

export const useBootstrapStore = create<BootstrapState>((set, get) => ({
  ...initialState,

  setSelectedLocation: (loc) => set({ selectedLocation: loc }),

  setAgentCount: (n) => set({ agentCount: n }),

  setScenario: (s) => set({ scenario: s }),

  startBootstrap: async (sessionId: string) => {
    const { selectedLocation, agentCount, scenario } = get();
    if (!selectedLocation) return;

    // H7 fix: abort any prior SSE stream before starting a new one
    get()._abortController?.abort();
    const abortController = new AbortController();

    set({
      mode: 'bootstrapping',
      steps: initialSteps(),
      currentStepIndex: 0,
      errorMessage: null,
      sessionId,
      _abortController: abortController,
    });

    try {
      const res = await fetch(`/api/sessions/${sessionId}/bootstrap`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          location: selectedLocation.name,
          countryCode: selectedLocation.countryCode,
          coordinates: selectedLocation.coordinates,
          scenario: scenario || undefined,
          agentCount,
        }),
        signal: abortController.signal,
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: 'Bootstrap request failed' }));
        set({
          mode: 'error',
          errorMessage: (errData as { error?: string }).error || `HTTP ${res.status}`,
        });
        return;
      }

      if (!res.body) {
        set({ mode: 'error', errorMessage: 'No response body for SSE stream' });
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        // Keep the last incomplete line in buffer
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const jsonStr = line.slice(6).trim();
          if (!jsonStr) continue;

          try {
            const event = JSON.parse(jsonStr) as BootstrapProgressEvent;
            const state = get();

            switch (event.type) {
              case 'step_start': {
                const stepIdx = event.stepIndex ?? 0;
                const updatedSteps = [...state.steps];
                if (updatedSteps[stepIdx]) {
                  updatedSteps[stepIdx] = { ...updatedSteps[stepIdx], status: 'active' };
                }
                set({ steps: updatedSteps, currentStepIndex: stepIdx });
                break;
              }
              case 'step_done': {
                const stepIdx = event.stepIndex ?? 0;
                const updatedSteps = [...state.steps];
                if (updatedSteps[stepIdx]) {
                  updatedSteps[stepIdx] = { ...updatedSteps[stepIdx], status: 'done' };
                }
                set({ steps: updatedSteps });
                break;
              }
              case 'step_fallback': {
                const stepIdx = event.stepIndex ?? 0;
                const updatedSteps = [...state.steps];
                if (updatedSteps[stepIdx]) {
                  updatedSteps[stepIdx] = {
                    ...updatedSteps[stepIdx],
                    status: 'fallback',
                    fallbackSource: event.fallbackSource,
                  };
                }
                set({ steps: updatedSteps });
                break;
              }
              case 'complete':
                set({ mode: 'complete', sessionId });
                break;
              case 'error':
                set({ mode: 'error', errorMessage: event.message || 'Bootstrap failed' });
                break;
              case 'heartbeat':
                // Ignore
                break;
            }
          } catch {
            // Ignore JSON parse errors
          }
        }
      }

      // If we finished reading without a 'complete' event and still bootstrapping, mark error
      const finalState = get();
      if (finalState.mode === 'bootstrapping') {
        set({ mode: 'error', errorMessage: 'Stream ended unexpectedly' });
      }
    } catch (err) {
      set({
        mode: 'error',
        errorMessage: err instanceof Error ? err.message : 'Bootstrap connection failed',
      });
    }
  },

  reset: () => {
    get()._abortController?.abort();
    set({ ...initialState, steps: initialSteps() });
  },
}));
