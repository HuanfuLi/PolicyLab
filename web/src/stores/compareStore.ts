import { create } from 'zustand';
import { compareApi } from '../api/compare';
import { sessionsApi } from '../api/sessions';
import type { ComparisonResult, SessionMetadata, TelemetryLog } from '@policylab/shared';

interface CompareMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface CompareStore {
  allSessions: SessionMetadata[];
  selectedIds: string[];
  comparison: ComparisonResult | null;
  messages: CompareMessage[];
  loading: boolean;
  chatPending: boolean;
  error: string | null;

  history: { id: string, timestamp: string, comparison: ComparisonResult }[];
  session1Iterations: Record<string, unknown>[];
  session2Iterations: Record<string, unknown>[];
  session1Telemetry: TelemetryLog[];
  session2Telemetry: TelemetryLog[];

  loadSessions: () => Promise<void>;
  loadHistory: () => Promise<void>;
  selectHistoryItem: (id: string) => Promise<void>;
  deleteComparison: (id: string) => Promise<void>;
  toggleSession: (id: string) => void;
  runComparison: () => Promise<void>;
  sendMessage: (text: string) => Promise<void>;
  reset: () => void;
}

async function fetchTelemetry(sessionId: string): Promise<TelemetryLog[]> {
  try {
    const res = await fetch(`/api/sessions/${sessionId}/simulate/telemetry`);
    if (!res.ok) return [];
    return (await res.json()) as TelemetryLog[] ?? [];
  } catch { return []; }
}

const initialState = {
  allSessions: [] as SessionMetadata[],
  selectedIds: [] as string[],
  comparison: null as ComparisonResult | null,
  messages: [] as CompareMessage[],
  loading: false,
  chatPending: false,
  error: null as string | null,
  history: [] as { id: string, timestamp: string, comparison: ComparisonResult }[],
  session1Iterations: [] as Record<string, unknown>[],
  session2Iterations: [] as Record<string, unknown>[],
  session1Telemetry: [] as TelemetryLog[],
  session2Telemetry: [] as TelemetryLog[],
};

export const useCompareStore = create<CompareStore>((set, get) => ({
  ...initialState,

  reset: () => set(initialState),

  loadSessions: async () => {
    try {
      const sessions = await sessionsApi.list();
      set({ allSessions: sessions });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to load sessions' });
    }
  },

  loadHistory: async () => {
    try {
      const history = await compareApi.getHistory();
      set({ history });
    } catch (err) {
      console.error(err);
    }
  },

  selectHistoryItem: async (id: string) => {
    const { history } = get();
    const item = history.find(h => h.id === id);
    if (!item) return;

    set({
      selectedIds: [item.comparison.session1Id, item.comparison.session2Id],
      comparison: item.comparison,
      messages: [],
      error: null,
      loading: true,
    });

    try {
      const [it1, it2, t1, t2] = await Promise.all([
        sessionsApi.getIterations(item.comparison.session1Id),
        sessionsApi.getIterations(item.comparison.session2Id),
        fetchTelemetry(item.comparison.session1Id),
        fetchTelemetry(item.comparison.session2Id),
      ]);
      set({ session1Iterations: it1, session2Iterations: it2, session1Telemetry: t1, session2Telemetry: t2, loading: false });
    } catch (err) {
      set({ loading: false, error: err instanceof Error ? err.message : 'Failed to load iteration data' });
    }
  },

  deleteComparison: async (id: string) => {
    try {
      await compareApi.deleteComparison(id);
      const { history, comparison } = get();
      const deleted = history.find(h => h.id === id);
      set({ history: history.filter(h => h.id !== id) });
      // If the deleted item was currently displayed, clear it
      if (deleted && comparison &&
          comparison.session1Id === deleted.comparison.session1Id &&
          comparison.session2Id === deleted.comparison.session2Id) {
        set({ comparison: null, messages: [], session1Iterations: [], session2Iterations: [], session1Telemetry: [], session2Telemetry: [] });
      }
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to delete comparison' });
    }
  },

  toggleSession: (id: string) => {
    const { selectedIds, comparison } = get();
    // Reset comparison if selection changes
    if (comparison) {
      set({ comparison: null, messages: [], error: null });
    }
    if (selectedIds.includes(id)) {
      set({ selectedIds: selectedIds.filter(s => s !== id) });
    } else if (selectedIds.length < 2) {
      set({ selectedIds: [...selectedIds, id] });
    }
  },

  runComparison: async () => {
    const { selectedIds, loadHistory } = get();
    if (selectedIds.length !== 2) return;

    set({ loading: true, error: null, comparison: null, messages: [], session1Iterations: [], session2Iterations: [], session1Telemetry: [], session2Telemetry: [] });
    try {
      const [comparison, it1, it2, t1, t2] = await Promise.all([
        compareApi.runComparison(selectedIds[0], selectedIds[1]),
        sessionsApi.getIterations(selectedIds[0]),
        sessionsApi.getIterations(selectedIds[1]),
        fetchTelemetry(selectedIds[0]),
        fetchTelemetry(selectedIds[1]),
      ]);

      set({ comparison, session1Iterations: it1, session2Iterations: it2, session1Telemetry: t1, session2Telemetry: t2, loading: false });
      void loadHistory(); // refresh history list
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : 'Comparison failed',
      });
    }
  },

  sendMessage: async (text: string) => {
    const { selectedIds, comparison } = get();
    if (!comparison || selectedIds.length !== 2) return;

    const userMsg: CompareMessage = { role: 'user', content: text };
    set(state => ({ messages: [...state.messages, userMsg], chatPending: true, error: null }));

    try {
      const reply = await compareApi.sendMessage(selectedIds[0], selectedIds[1], text);
      const assistantMsg: CompareMessage = { role: 'assistant', content: reply };
      set(state => ({ messages: [...state.messages, assistantMsg], chatPending: false }));
    } catch (err) {
      set({
        chatPending: false,
        error: err instanceof Error ? err.message : 'Chat failed',
      });
    }
  },
}));
