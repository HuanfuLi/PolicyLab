import { create } from 'zustand';
import { sessionsApi } from '../api/sessions';
import type { SessionMetadata } from '@policylab/shared';

interface SessionsStore {
  sessions: SessionMetadata[];
  loading: boolean;
  error: string | null;
  loadSessions: () => Promise<void>;
  createSession: (idea: string) => Promise<string>;
  deleteSession: (id: string) => Promise<void>;
  importSession: (file: File) => Promise<string>;
}

export const useSessionsStore = create<SessionsStore>((set, get) => ({
  sessions: [],
  loading: false,
  error: null,

  loadSessions: async () => {
    set({ loading: true, error: null });
    try {
      const sessions = await sessionsApi.list();
      set({ sessions, loading: false });
    } catch (err) {
      set({ loading: false, error: err instanceof Error ? err.message : 'Failed to load sessions' });
    }
  },

  createSession: async (idea: string) => {
    const { id } = await sessionsApi.create(idea);
    // Refresh the list
    await get().loadSessions();
    return id;
  },

  deleteSession: async (id: string) => {
    await sessionsApi.delete(id);
    set(state => ({ sessions: state.sessions.filter(s => s.id !== id) }));
  },

  importSession: async (file: File) => {
    const text = await file.text();
    const data = JSON.parse(text);
    const res = await fetch('/api/sessions/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const err = await res.json() as { error: string };
      throw new Error(err.error || 'Import failed');
    }
    const { id } = await res.json() as { id: string };
    await get().loadSessions();
    return id;
  },
}));
