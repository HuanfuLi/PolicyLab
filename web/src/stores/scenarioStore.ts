import { create } from 'zustand';
import type { EconomyConfig, BudgetAllocation, ScenarioTab } from '@policylab/shared';

interface ScenarioState {
  tabs: ScenarioTab[];
  activeTabId: string;
  baselineConfig: Partial<EconomyConfig> | null;
  baselineBudget: BudgetAllocation | null;
  runningScenarios: boolean;
  scenarioSessionIds: Record<string, string>; // tab.id -> forked session ID

  initFromSession: (config: Partial<EconomyConfig>, budget: BudgetAllocation) => void;
  addScenario: (name: string) => void;
  removeScenario: (tabId: string) => void;
  renameScenario: (tabId: string, name: string) => void;
  setActiveTab: (tabId: string) => void;
  updateScenarioConfig: (tabId: string, patch: Partial<EconomyConfig>) => void;
  updateScenarioBudget: (tabId: string, budget: BudgetAllocation) => void;
  runAllScenarios: (baseSessionId: string) => Promise<string[]>;
  reset: () => void;
}

/** Generate scenario letter name: A, B, C, ... */
function scenarioLetter(index: number): string {
  return String.fromCharCode(65 + index);
}

/** Compute deltas between a tab's config and the baseline config */
function computeDeltas(
  tabConfig: Partial<EconomyConfig>,
  baselineConfig: Partial<EconomyConfig>,
): Record<string, { from: number | boolean; to: number | boolean }> | undefined {
  const deltas: Record<string, { from: number | boolean; to: number | boolean }> = {};
  const allKeys = new Set([...Object.keys(tabConfig), ...Object.keys(baselineConfig)]);

  for (const key of allKeys) {
    const baseVal = (baselineConfig as Record<string, unknown>)[key];
    const tabVal = (tabConfig as Record<string, unknown>)[key];
    if (
      baseVal !== tabVal &&
      baseVal !== undefined &&
      tabVal !== undefined &&
      (typeof baseVal === 'number' || typeof baseVal === 'boolean')
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

    const baselineId = crypto.randomUUID();
    const baselineTab: ScenarioTab = {
      id: baselineId,
      name: 'Baseline',
      isBaseline: true,
      economyConfig: { ...config },
      budgetAllocation: { ...budget },
    };

    set({
      tabs: [baselineTab],
      activeTabId: baselineId,
      baselineConfig: { ...config },
      baselineBudget: { ...budget },
    });
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

  runAllScenarios: async (baseSessionId: string): Promise<string[]> => {
    const { tabs } = get();
    const nonBaseline = tabs.filter(t => !t.isBaseline);
    if (nonBaseline.length === 0) return [];

    set({ runningScenarios: true });
    const sessionIds: Record<string, string> = {};
    const allForkIds: string[] = [];

    try {
      // Step 1: Fork and configure each scenario sequentially
      for (const tab of nonBaseline) {
        // Fork the session
        const forkRes = await fetch(`/api/sessions/${baseSessionId}/fork`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        if (!forkRes.ok) throw new Error(`Fork failed for scenario "${tab.name}"`);
        const { id: forkId } = await forkRes.json();

        // Patch the fork's config with the scenario overrides
        const configRes = await fetch(`/api/sessions/${forkId}/config`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            economyConfig: tab.economyConfig,
            ...(tab.budgetAllocation ? { budgetAllocation: tab.budgetAllocation } : {}),
          }),
        });
        if (!configRes.ok) throw new Error(`Config patch failed for scenario "${tab.name}"`);

        sessionIds[tab.id] = forkId;
        allForkIds.push(forkId);
      }

      set({ scenarioSessionIds: sessionIds });

      // Step 2: Start simulations sequentially (per Research open question 3)
      // Start baseline first
      await fetch(`/api/sessions/${baseSessionId}/simulate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      // Then each fork
      for (const forkId of allForkIds) {
        await fetch(`/api/sessions/${forkId}/simulate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
      }

      set({ runningScenarios: false });
      return allForkIds;
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
