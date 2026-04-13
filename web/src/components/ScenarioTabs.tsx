import React, { useEffect, useState } from 'react';
import { Plus, X, Loader2, Play } from 'lucide-react';
import { useScenarioStore } from '../stores/scenarioStore';
import EconomyTab from './EconomyTab';
import DiffMarker from './DiffMarker';
import type { EconomyConfig, BudgetAllocation } from '@policylab/shared';

interface ScenarioTabsProps {
  sessionId: string;
  economyConfig: Partial<EconomyConfig>;
  budgetAllocation: BudgetAllocation;
  onConfigChange: (config: Partial<EconomyConfig>) => void;
  onBudgetChange: (budget: BudgetAllocation) => void;
  onRunAll: () => void;
  bootstrapConfidence?: Record<string, string>;
  bootstrapSources?: Record<string, string>;
  /** Phase 11 D-17: forwarded to EconomyTab to gate the governance toggle */
  isPastCheckpoint?: boolean;
}

export default function ScenarioTabs({
  sessionId,
  economyConfig,
  budgetAllocation,
  onConfigChange,
  onBudgetChange,
  onRunAll,
  bootstrapConfidence,
  bootstrapSources,
  isPastCheckpoint = false,
}: ScenarioTabsProps) {
  const {
    tabs,
    activeTabId,
    runningScenarios,
    initFromSession,
    syncBaseline,
    addScenario,
    removeScenario,
    renameScenario,
    setActiveTab,
    updateScenarioConfig,
    updateScenarioBudget,
  } = useScenarioStore();

  const [editingTabId, setEditingTabId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  // Initialize from session config on mount if tabs are empty,
  // and re-sync baseline if session config changes after initialization
  useEffect(() => {
    if (tabs.length === 0) {
      initFromSession(economyConfig, budgetAllocation);
    } else {
      syncBaseline(economyConfig, budgetAllocation);
    }
  }, [economyConfig, budgetAllocation]); // eslint-disable-line react-hooks/exhaustive-deps

  const activeTab = tabs.find(t => t.id === activeTabId);
  const hasNonBaseline = tabs.some(t => !t.isBaseline);

  const handleTabConfigChange = (patch: Partial<EconomyConfig>) => {
    if (!activeTab) return;
    updateScenarioConfig(activeTabId, patch);
    // Also propagate baseline changes to the session store
    if (activeTab.isBaseline) {
      onConfigChange(patch);
    }
  };

  const handleTabBudgetChange = (budget: BudgetAllocation) => {
    if (!activeTab) return;
    updateScenarioBudget(activeTabId, budget);
    if (activeTab.isBaseline) {
      onBudgetChange(budget);
    }
  };

  const handleStartRename = (tabId: string, currentName: string) => {
    setEditingTabId(tabId);
    setEditName(currentName);
  };

  const handleFinishRename = () => {
    if (editingTabId && editName.trim()) {
      renameScenario(editingTabId, editName.trim());
    }
    setEditingTabId(null);
    setEditName('');
  };

  return (
    <div>
      {/* Tab bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.25rem',
          borderBottom: '1px solid var(--glass-border)',
          marginBottom: '1rem',
          overflowX: 'auto',
          flexWrap: 'nowrap',
        }}
      >
        {tabs.map(tab => {
          const isActive = tab.id === activeTabId;
          const isEditing = editingTabId === tab.id;

          return (
            <div
              key={tab.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.25rem',
                padding: '0.5rem 0.75rem',
                cursor: 'pointer',
                borderBottom: isActive
                  ? '2px solid var(--primary)'
                  : '2px solid transparent',
                color: isActive ? 'var(--primary)' : 'var(--text-muted)',
                fontSize: '0.85rem',
                whiteSpace: 'nowrap',
                flexShrink: 0,
                transition: 'border-color 0.15s, color 0.15s',
              }}
              onClick={() => setActiveTab(tab.id)}
            >
              {isEditing ? (
                <input
                  autoFocus
                  value={editName}
                  onChange={e => setEditName(e.target.value)}
                  onBlur={handleFinishRename}
                  onKeyDown={e => {
                    if (e.key === 'Enter') handleFinishRename();
                    if (e.key === 'Escape') {
                      setEditingTabId(null);
                      setEditName('');
                    }
                  }}
                  onClick={e => e.stopPropagation()}
                  style={{
                    background: 'var(--panel-alpha-05)',
                    border: '1px solid var(--primary)',
                    borderRadius: '4px',
                    color: 'var(--color-bright)',
                    padding: '0.1rem 0.4rem',
                    fontSize: '0.85rem',
                    fontFamily: 'inherit',
                    width: '120px',
                    outline: 'none',
                  }}
                />
              ) : (
                <span
                  onDoubleClick={() => {
                    if (!tab.isBaseline) handleStartRename(tab.id, tab.name);
                  }}
                >
                  {tab.name}
                  {tab.deltas && Object.keys(tab.deltas).length > 0 && (
                    <span
                      style={{
                        marginLeft: '0.35rem',
                        fontSize: '0.7rem',
                        background: 'rgba(234, 179, 8, 0.2)',
                        color: 'var(--color-yellow, #eab308)',
                        padding: '0 5px',
                        borderRadius: '999px',
                        fontWeight: 600,
                      }}
                    >
                      {Object.keys(tab.deltas).length}
                    </span>
                  )}
                </span>
              )}

              {!tab.isBaseline && !isEditing && (
                <button
                  onClick={e => {
                    e.stopPropagation();
                    removeScenario(tab.id);
                  }}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--text-dim)',
                    cursor: 'pointer',
                    padding: '0 2px',
                    display: 'flex',
                    alignItems: 'center',
                  }}
                  title="Remove scenario"
                >
                  <X size={14} />
                </button>
              )}
            </div>
          );
        })}

        {/* Add Scenario button */}
        <button
          onClick={() => addScenario('')}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.3rem',
            padding: '0.5rem 0.75rem',
            background: 'none',
            border: 'none',
            color: 'var(--text-dim)',
            cursor: 'pointer',
            fontSize: '0.8rem',
            fontFamily: 'inherit',
            whiteSpace: 'nowrap',
            flexShrink: 0,
          }}
          title="Add a new scenario"
        >
          <Plus size={14} /> Add Scenario
        </button>
      </div>

      {/* Active tab content */}
      {activeTab && (
        <div>
          {/* Show diff summary for non-baseline tabs */}
          {!activeTab.isBaseline && activeTab.deltas && Object.keys(activeTab.deltas).length > 0 && (
            <div
              style={{
                marginBottom: '1rem',
                padding: '0.5rem 0.75rem',
                background: 'rgba(234, 179, 8, 0.08)',
                border: '1px solid rgba(234, 179, 8, 0.25)',
                borderRadius: '6px',
                fontSize: '0.8rem',
                color: 'var(--text-muted)',
              }}
            >
              <strong>{Object.keys(activeTab.deltas).length}</strong> parameter{Object.keys(activeTab.deltas).length !== 1 ? 's' : ''} differ from baseline:
              <div style={{ marginTop: '0.35rem', display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                {Object.entries(activeTab.deltas).map(([key, delta]) => (
                  <span key={key}>
                    <span style={{ fontWeight: 600 }}>{key}</span>
                    <DiffMarker
                      baselineValue={delta.from}
                      currentValue={delta.to}
                    />
                  </span>
                ))}
              </div>
            </div>
          )}

          <EconomyTab
            sessionId={sessionId}
            economyConfig={activeTab.economyConfig}
            budgetAllocation={activeTab.budgetAllocation ?? budgetAllocation}
            onConfigChange={handleTabConfigChange}
            onBudgetChange={handleTabBudgetChange}
            bootstrapConfidence={bootstrapConfidence}
            bootstrapSources={bootstrapSources}
            tabId={activeTabId}
            isPastCheckpoint={isPastCheckpoint}
          />
        </div>
      )}

      {/* Run All Scenarios button */}
      <div style={{ marginTop: '1.5rem', display: 'flex', justifyContent: 'flex-end' }}>
        <button
          className="btn-primary"
          onClick={onRunAll}
          disabled={!hasNonBaseline || runningScenarios}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            opacity: !hasNonBaseline || runningScenarios ? 0.5 : 1,
          }}
        >
          {runningScenarios ? (
            <>
              <Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} />
              Running Scenarios...
            </>
          ) : (
            <>
              <Play size={18} />
              Run All Scenarios
            </>
          )}
        </button>
      </div>
    </div>
  );
}
