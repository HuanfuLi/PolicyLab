import { create } from 'zustand';
import { settingsApi } from '../api/settings';
import type { AppSettings, SettingsResponse } from '@policylab/shared';

interface SettingsStore {
  settings: SettingsResponse | null;
  testStatus: 'idle' | 'testing' | 'success' | 'error';
  testMessage: string;
  loadSettings: () => Promise<void>;
  updateSettings: (s: Partial<AppSettings>) => Promise<void>;
  testConnection: (overrides?: Partial<AppSettings>) => Promise<void>;
}

export const useSettingsStore = create<SettingsStore>((set) => ({
  settings: null,
  testStatus: 'idle',
  testMessage: '',

  loadSettings: async () => {
    try {
      const settings = await settingsApi.get();
      set({ settings });
    } catch (err) {
      console.error('Failed to load settings:', err);
    }
  },

  updateSettings: async (updates: Partial<AppSettings>) => {
    const updated = await settingsApi.update(updates);
    set({ settings: updated });
  },

  testConnection: async (overrides?: Partial<AppSettings>) => {
    set({ testStatus: 'testing', testMessage: '' });
    try {
      const result = await settingsApi.test(overrides);
      if (result.ok) {
        set({
          testStatus: 'success',
          testMessage: `Connected to ${result.model} (${result.latencyMs}ms)`,
        });
      } else {
        set({
          testStatus: 'error',
          testMessage: result.error ?? 'Connection failed',
        });
      }
    } catch (err) {
      set({
        testStatus: 'error',
        testMessage: err instanceof Error ? err.message : 'Connection failed',
      });
    }
  },
}));
