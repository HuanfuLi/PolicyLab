import { create } from 'zustand';
import { compareApi } from '../api/compare';
import { sessionsApi } from '../api/sessions';
import type { ComparisonResult, SessionMetadata } from '@policylab/shared';

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
  session1Iterations: any[];
  session2Iterations: any[];

  loadSessions: () => Promise<void>;
  loadHistory: () => Promise<void>;
  selectHistoryItem: (id: string) => Promise<void>;
  toggleSession: (id: string) => void;
  runComparison: () => Promise<void>;
  sendMessage: (text: string) => Promise<void>;
  reset: () => void;
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
  session1Iterations: [] as any[],
  session2Iterations: [] as any[],
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
      const [it1, it2] = await Promise.all([
        sessionsApi.getIterations(item.comparison.session1Id),
        sessionsApi.getIterations(item.comparison.session2Id)
      ]);
      set({ session1Iterations: it1, session2Iterations: it2, loading: false });
    } catch {
      set({ loading: false });
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

    set({ loading: true, error: null, comparison: null, messages: [], session1Iterations: [], session2Iterations: [] });
    try {
      const [comparison, it1, it2] = await Promise.all([
        compareApi.runComparison(selectedIds[0], selectedIds[1]),
        sessionsApi.getIterations(selectedIds[0]),
        sessionsApi.getIterations(selectedIds[1])
      ]);

      set({ comparison, session1Iterations: it1, session2Iterations: it2, loading: false });
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
