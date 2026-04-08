import { create } from 'zustand';
import type { EconomyConfig, BudgetAllocation, ScenarioTab } from '@policylab/shared';
import { DEFAULT_ECONOMY_CONFIG } from '@policylab/shared';

interface ScenarioState {
  tabs: ScenarioTab[];
  activeTabId: string;
  baselineConfig: Partial<EconomyConfig> | null;
  baselineBudget: BudgetAllocation | null;
  runningScenarios: boolean;
  scenarioSessionIds: Record<string, string>; // tab.id -> forked session ID

  initFromSession: (config: Partial<EconomyConfig>, budget: BudgetAllocation) => void;
  syncBaseline: (config: Partial<EconomyConfig>, budget: BudgetAllocation) => void;
  addScenario: (name: string) => void;
  removeScenario: (tabId: string) => void;
  renameScenario: (tabId: string, name: string) => void;
  setActiveTab: (tabId: string) => void;
  updateScenarioConfig: (tabId: string, patch: Partial<EconomyConfig>) => void;
  updateScenarioBudget: (tabId: string, budget: BudgetAllocation) => void;
  runAllScenarios: (baseSessionId: string, iterations?: number, navigate?: (url: string) => void) => Promise<string[]>;
  addAndRunNewScenarios: (
    baseSessionId: string,
    existingGroupId: string,
    existingSessionIds: string[],
    iterations: number,
    navigate?: (url: string) => void,
  ) => Promise<string[]>;
  reset: () => void;
}

/** Generate scenario letter name: A, B, C, ... */
function scenarioLetter(index: number): string {
  return String.fromCharCode(65 + index);
}

/** Compute deltas between a tab's config and the baseline config.
 *  Both configs are merged with DEFAULT_ECONOMY_CONFIG first so that
 *  params using defaults are still visible when changed. */
function computeDeltas(
  tabConfig: Partial<EconomyConfig>,
  baselineConfig: Partial<EconomyConfig>,
): Record<string, { from: number | boolean; to: number | boolean }> | undefined {
  const defaults = DEFAULT_ECONOMY_CONFIG as unknown as Record<string, unknown>;
  const fullBaseline = { ...defaults, ...baselineConfig } as Record<string, unknown>;
  const fullTab = { ...defaults, ...tabConfig } as Record<string, unknown>;
  const deltas: Record<string, { from: number | boolean; to: number | boolean }> = {};

  for (const key of new Set([...Object.keys(fullBaseline), ...Object.keys(fullTab)])) {
    const baseVal = fullBaseline[key];
    const tabVal = fullTab[key];
    if (
      baseVal !== tabVal &&
      (typeof baseVal === 'number' || typeof baseVal === 'boolean') &&
      (typeof tabVal === 'number' || typeof tabVal === 'boolean')
    ) {
      deltas[key] = {
        from: baseVal as number | boolean,
        to: tabVal as number | boolean,
      };
    }
  }

  return Object.keys(deltas).length > 0 ? deltas : undefined;
}

export const useScenarioStore = create<ScenarioState>((set, get) => ({
  tabs: [],
  activeTabId: '',
  baselineConfig: null,
  baselineBudget: null,
  runningScenarios: false,
  scenarioSessionIds: {},

  initFromSession: (config: Partial<EconomyConfig>, budget: BudgetAllocation) => {
    const { tabs } = get();
    // Only initialize if tabs are empty
    if (tabs.length > 0) return;

    // Merge with defaults so ALL params are in the baseline (not just bootstrap-provided ones).
    // This ensures computeDeltas can detect changes to any param, not just the ~13 from bootstrap.
    const fullConfig: Partial<EconomyConfig> = { ...DEFAULT_ECONOMY_CONFIG, ...config };

    const baselineId = crypto.randomUUID();
    const baselineTab: ScenarioTab = {
      id: baselineId,
      name: 'Baseline',
      isBaseline: true,
      economyConfig: { ...fullConfig },
      budgetAllocation: { ...budget },
    };

    set({
      tabs: [baselineTab],
      activeTabId: baselineId,
      baselineConfig: { ...fullConfig },
      baselineBudget: { ...budget },
    });
  },

  // M23 fix: re-sync baseline if session config changes after init (e.g., refinement chat)
  syncBaseline: (config: Partial<EconomyConfig>, budget: BudgetAllocation) => {
    const { tabs } = get();
    if (tabs.length === 0) return; // not initialized yet
    const fullConfig: Partial<EconomyConfig> = { ...DEFAULT_ECONOMY_CONFIG, ...config };
    set(state => ({
      baselineConfig: { ...fullConfig },
      baselineBudget: { ...budget },
      tabs: state.tabs.map(t =>
        t.isBaseline
          ? { ...t, economyConfig: { ...fullConfig }, budgetAllocation: { ...budget } }
          : t,
      ),
    }));
  },

  addScenario: (name: string) => {
    const { tabs, baselineConfig, baselineBudget } = get();
    if (!baselineConfig) return;

    const nonBaselineCount = tabs.filter(t => !t.isBaseline).length;
    const scenarioName = name || `Scenario ${scenarioLetter(nonBaselineCount)}`;
    const newId = crypto.randomUUID();

    const newTab: ScenarioTab = {
      id: newId,
      name: scenarioName,
      isBaseline: false,
      economyConfig: { ...baselineConfig },
      budgetAllocation: baselineBudget ? { ...baselineBudget } : undefined,
    };

    set(state => ({
      tabs: [...state.tabs, newTab],
      activeTabId: newId,
    }));
  },

  removeScenario: (tabId: string) => {
    set(state => {
      const tab = state.tabs.find(t => t.id === tabId);
      if (!tab || tab.isBaseline) return state;

      const newTabs = state.tabs.filter(t => t.id !== tabId);
      const newActiveId = state.activeTabId === tabId
        ? newTabs[0]?.id ?? ''
        : state.activeTabId;

      return { tabs: newTabs, activeTabId: newActiveId };
    });
  },

  renameScenario: (tabId: string, name: string) => {
    set(state => ({
      tabs: state.tabs.map(t =>
        t.id === tabId && !t.isBaseline ? { ...t, name } : t,
      ),
    }));
  },

  setActiveTab: (tabId: string) => {
    set({ activeTabId: tabId });
  },

  updateScenarioConfig: (tabId: string, patch: Partial<EconomyConfig>) => {
    const { baselineConfig } = get();
    if (!baselineConfig) return;

    set(state => ({
      tabs: state.tabs.map(t => {
        if (t.id !== tabId) return t;
        const updatedConfig = { ...t.economyConfig, ...patch };
        const deltas = t.isBaseline ? undefined : computeDeltas(updatedConfig, baselineConfig);
        return { ...t, economyConfig: updatedConfig, deltas };
      }),
    }));
  },

  updateScenarioBudget: (tabId: string, budget: BudgetAllocation) => {
    set(state => ({
      tabs: state.tabs.map(t =>
        t.id === tabId ? { ...t, budgetAllocation: { ...budget } } : t,
      ),
    }));
  },

  runAllScenarios: async (baseSessionId: string, iterations?: number, navigate?: (url: string) => void): Promise<string[]> => {
    const { tabs, runningScenarios } = get();
    if (runningScenarios) return []; // Prevent concurrent calls
    const baselineTab = tabs.find(t => t.isBaseline);
    const nonBaseline = tabs.filter(t => !t.isBaseline);
    if (!baselineTab) return [];

    set({ runningScenarios: true });
    const groupId = crypto.randomUUID();
    const iterationCounts = new Set([iterations ?? 20]);
    if (iterationCounts.size !== 1) {
      set({ runningScenarios: false });
      throw new Error('All scenarios must use the same iteration count (D-12)');
    }

    try {
      const groupRes = await fetch(`/api/sessions/${baseSessionId}/group`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupId, scenarioLabel: baselineTab.name }),
      });
      if (!groupRes.ok) throw new Error('Failed to assign scenario group to base session');

      const forkPairs = await Promise.all(nonBaseline.map(async (tab) => {
        const forkRes = await fetch(`/api/sessions/${baseSessionId}/fork`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ iterations, groupId, scenarioLabel: tab.name }),
        });
        if (!forkRes.ok) throw new Error(`Fork failed for scenario "${tab.name}"`);
        const { id: forkId } = await forkRes.json() as { id: string };

        const configRes = await fetch(`/api/sessions/${forkId}/config`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            economyConfig: tab.economyConfig,
            ...(tab.budgetAllocation ? { budgetAllocation: tab.budgetAllocation } : {}),
          }),
        });
        if (!configRes.ok) throw new Error(`Config patch failed for scenario "${tab.name}"`);

        return [tab.id, forkId] as const;
      }));

      const scenarioSessionIds = Object.fromEntries([
        [baselineTab.id, baseSessionId],
        ...forkPairs,
      ]);
      const allSessionIds = [baseSessionId, ...forkPairs.map(([, forkId]) => forkId)];

      await Promise.all(allSessionIds.map(async (sessionId) => {
        const simRes = await fetch(`/api/sessions/${sessionId}/simulate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(iterations ? { iterations } : {}),
        });
        if (!simRes.ok) throw new Error(`Failed to start simulation for session ${sessionId}`);
      }));

      set({
        scenarioSessionIds,
        runningScenarios: false,
      });

      navigate?.(`/sessions/${baseSessionId}/simulate?scenarios=${allSessionIds.join(',')}`);
      return allSessionIds;
    } catch (err) {
      set({ runningScenarios: false });
      throw err;
    }
  },

  addAndRunNewScenarios: async (
    baseSessionId: string,
    existingGroupId: string,
    existingSessionIds: string[],
    iterations: number,
    navigate?: (url: string) => void,
  ): Promise<string[]> => {
    const { tabs, runningScenarios, scenarioSessionIds } = get();
    if (runningScenarios) return [];

    const baselineTab = tabs.find(t => t.isBaseline);
    if (!baselineTab) return [];

    const existingMappings = { ...scenarioSessionIds, [baselineTab.id]: baseSessionId };
    const newTabs = tabs.filter((tab) => !existingMappings[tab.id]);
    if (newTabs.length === 0) {
      const allIds = Array.from(new Set(existingSessionIds));
      navigate?.(`/sessions/${baseSessionId}/simulate?scenarios=${allIds.join(',')}`);
      return allIds;
    }

    const iterationCounts = new Set([iterations]);
    if (iterationCounts.size !== 1) {
      throw new Error('All scenarios must use the same iteration count (D-12)');
    }

    set({ runningScenarios: true });

    try {
      const forkPairs = await Promise.all(newTabs.map(async (tab) => {
        const forkRes = await fetch(`/api/sessions/${baseSessionId}/fork`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ iterations, groupId: existingGroupId, scenarioLabel: tab.name }),
        });
        if (!forkRes.ok) throw new Error(`Fork failed for scenario "${tab.name}"`);
        const { id: forkId } = await forkRes.json() as { id: string };

        const configRes = await fetch(`/api/sessions/${forkId}/config`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            economyConfig: tab.economyConfig,
            ...(tab.budgetAllocation ? { budgetAllocation: tab.budgetAllocation } : {}),
          }),
        });
        if (!configRes.ok) throw new Error(`Config patch failed for scenario "${tab.name}"`);

        return [tab.id, forkId] as const;
      }));

      const newIds = forkPairs.map(([, forkId]) => forkId);
      await Promise.all(newIds.map(async (sessionId) => {
        const simRes = await fetch(`/api/sessions/${sessionId}/simulate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ iterations }),
        });
        if (!simRes.ok) throw new Error(`Failed to start simulation for session ${sessionId}`);
      }));

      const mergedMappings = {
        ...existingMappings,
        ...Object.fromEntries(forkPairs),
      };
      const allIds = [...existingSessionIds, ...newIds];

      set({
        scenarioSessionIds: mergedMappings,
        runningScenarios: false,
      });

      navigate?.(`/sessions/${baseSessionId}/simulate?scenarios=${allIds.join(',')}`);
      return allIds;
    } catch (err) {
      set({ runningScenarios: false });
      throw err;
    }
  },

  reset: () => {
    set({
      tabs: [],
      activeTabId: '',
      baselineConfig: null,
      baselineBudget: null,
      runningScenarios: false,
      scenarioSessionIds: {},
    });
  },
}));
