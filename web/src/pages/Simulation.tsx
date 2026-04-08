import React, { useEffect, useRef, useMemo, useState, useCallback } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Play, Pause, Square, X, Activity, Heart, CircleDollarSign, Users, Loader2, AlertCircle, ArrowRight, GitFork, Zap, ChevronDown, ChevronRight, ShieldAlert, BarChart3 } from 'lucide-react';
import { useSimulationStore, type AgentIntentRecord } from '../stores/simulationStore';
import { useMultiScenarioStore, SCENARIO_COLORS, SCENARIO_DASHES } from '../stores/multiScenarioStore';
import type { MultiScenarioSessionState } from '../stores/multiScenarioStore';
import { ScenarioChart } from '../components/ScenarioChart';
import { CollapsiblePanel } from '../components/CollapsiblePanel';
import { ConfigDiffHeader } from '../components/ConfigDiffHeader';
import { ScenarioProgressBar } from '../components/ScenarioProgressBar';
import { mergeScenarioData, mergeStatsData } from '@policylab/shared/scenarioDataMerge';
import type { ScenarioMeta } from '@policylab/shared/scenarioDataMerge';
import type { EconomyConfig } from '@policylab/shared';
import { useShallow } from 'zustand/react/shallow';
import MarkdownText from '../components/MarkdownText';
import TelemetryPanel from '../components/TelemetryPanel';

// Chart color tokens (kept in sync with --chart-* CSS variables in index.css)
const CHART_ORANGE = 'var(--chart-orange)';
const CHART_VIOLET = 'var(--chart-violet)';

const Simulation = () => {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();

  // ── Multi-scenario store ──────────────────────────────────────────────────
  const {
    scenarios, scenarioOrder, allComplete, anyRunning,
    initScenarios, connectAll, pauseAll, resumeAll, abortAll,
    addMoreIterations, endAndProceed, loadAllAgents, loadAllHistory,
    reset: resetMulti,
  } = useMultiScenarioStore(useShallow(s => ({
    scenarios: s.scenarios,
    scenarioOrder: s.scenarioOrder,
    allComplete: s.allComplete,
    anyRunning: s.anyRunning,
    initScenarios: s.initScenarios,
    connectAll: s.connectAll,
    pauseAll: s.pauseAll,
    resumeAll: s.resumeAll,
    abortAll: s.abortAll,
    addMoreIterations: s.addMoreIterations,
    endAndProceed: s.endAndProceed,
    loadAllAgents: s.loadAllAgents,
    loadAllHistory: s.loadAllHistory,
    reset: s.reset,
  })));

  // ── Legacy single-session store (used for N=1 backward compat internals) ──
  const singleStore = useSimulationStore(useShallow(s => ({
    loadAgents: s.loadAgents, loadHistory: s.loadHistory, connectSSE: s.connectSSE,
    pause: s.pause, resume: s.resume, abort: s.abort, abortAndReset: s.abortAndReset, reset: s.reset,
    continueSimulation: s.continueSimulation, forkSimulation: s.forkSimulation,
    loadIntentHistory: s.loadIntentHistory,
  })));

  const { pendingActionCodes, agentIntentHistory } = useSimulationStore(
    useShallow(s => ({
      pendingActionCodes: s.pendingActionCodes,
      agentIntentHistory: s.agentIntentHistory,
    }))
  );

  // ── Local state ───────────────────────────────────────────────────────────
  // N=1 backward compat: no ?scenarios param = single session group (D-22, D-39)
  const scenarioIds = useMemo(() => {
    const raw = searchParams.get('scenarios');
    return raw ? raw.split(',').filter(Boolean) : [id!];
  }, [searchParams, id]);

  const isMulti = scenarioIds.length > 1;

  const [sessionStage, setSessionStage] = useState<string>('');
  const [extraIterations, setExtraIterations] = useState(10);
  const [showTelemetryPanel, setShowTelemetryPanel] = useState(false);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const bothCollapsed = leftCollapsed && rightCollapsed;
  const [selectedFeedScenario, setSelectedFeedScenario] = useState<string>(scenarioIds[0]);
  const [selectedAgentScenario, setSelectedAgentScenario] = useState<string>(scenarioIds[0]);
  const [agentStatusTab, setAgentStatusTab] = useState<'lifecycle' | 'intents'>('intents');
  const [confirmDialog, setConfirmDialog] = useState<'end' | 'abort' | null>(null);
  const [autoProceed, setAutoProceed] = useState(() => localStorage.getItem('sim-auto-proceed') === 'true');
  const autoProceedRef = useRef(autoProceed);
  const [earlyStoppingEnabled, setEarlyStoppingEnabled] = useState(
    () => localStorage.getItem('sim-early-stopping') !== 'false'
  );
  const sseCleanupRef = useRef<(() => void) | null>(null);
  const hasAutoProceeded = useRef(false);

  // Configs fetched per scenario for ConfigDiffHeader
  const [scenarioConfigs, setScenarioConfigs] = useState<Record<string, Partial<EconomyConfig>>>({});

  // Keep ref in sync for use in effects without re-running them
  useEffect(() => {
    autoProceedRef.current = autoProceed;
    localStorage.setItem('sim-auto-proceed', autoProceed ? 'true' : 'false');
  }, [autoProceed]);

  // Persist early stopping preference and sync to server mid-run
  useEffect(() => {
    localStorage.setItem('sim-early-stopping', earlyStoppingEnabled ? 'true' : 'false');
    if (!id || !anyRunning) return;
    // Sync to all running scenarios
    for (const sid of scenarioIds) {
      fetch(`/api/sessions/${sid}/simulate/early-stopping`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: earlyStoppingEnabled }),
      }).catch(() => null);
    }
  }, [earlyStoppingEnabled, id, anyRunning, scenarioIds]);

  // ── Initialization ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!id) return;
    resetMulti();
    singleStore.reset();
    hasAutoProceeded.current = false;

    const init = async () => {
      // Fetch session metadata for all scenario IDs
      const sessions = await Promise.all(
        scenarioIds.map(sid => fetch(`/api/sessions/${sid}`).then(r => r.json()).catch(() => null))
      );

      const sessionInfos = sessions
        .filter(Boolean)
        .map((s: { id: string; scenarioLabel?: string; config?: { economyConfig?: Partial<EconomyConfig> } }, i: number) => ({
          id: s.id ?? scenarioIds[i],
          label: s.scenarioLabel ?? (i === 0 ? 'Baseline' : `Scenario ${String.fromCharCode(65 + i - 1)}`),
        }));

      // Collect economy configs for diff header
      const configs: Record<string, Partial<EconomyConfig>> = {};
      for (let i = 0; i < sessions.length; i++) {
        const s = sessions[i];
        if (s?.config?.economyConfig) {
          configs[s.id ?? scenarioIds[i]] = s.config.economyConfig;
        }
      }
      setScenarioConfigs(configs);

      // Determine session stage from primary session
      const primary = sessions[0];
      if (primary?.stage) setSessionStage(primary.stage);

      // Init multi-scenario store
      initScenarios(sessionInfos);
      loadAllAgents();
      loadAllHistory();

      // Also load single-store data for intent history (used by N=1 and agent panels)
      await singleStore.loadAgents(scenarioIds[0]);
      await singleStore.loadHistory(scenarioIds[0]);
      await singleStore.loadIntentHistory(scenarioIds[0]);

      // Set initial state based on session stage
      if (primary?.stage === 'simulating') {
        // SSE will update running state
      } else if (primary?.stage === 'simulation-complete' || primary?.stage === 'reflecting' || primary?.stage === 'reflection-complete' || primary?.stage === 'reviewing' || primary?.stage === 'completed') {
        hasAutoProceeded.current = true;
      }

      // Connect all SSE streams
      const disconnect = connectAll();
      sseCleanupRef.current = disconnect;
    };

    init();

    return () => {
      sseCleanupRef.current?.();
    };
  }, [id, searchParams.get('scenarios')]);

  // ── Auto-proceed ──────────────────────────────────────────────────────────
  const simulationStages = ['simulating', 'simulation-paused', 'simulation-complete'];

  const handleAutoProceed = useCallback(async () => {
    if (!id || hasAutoProceeded.current) return;
    if (!simulationStages.includes(sessionStage)) return;
    hasAutoProceeded.current = true;
    await fetch(`/api/sessions/${id}/stage`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stage: 'reflecting' }),
    });
    navigate(`/session/${id}/reflection`);
  }, [id, navigate, sessionStage]);

  useEffect(() => {
    if (allComplete && !anyRunning && autoProceedRef.current && !hasAutoProceeded.current
      && simulationStages.includes(sessionStage)) {
      handleAutoProceed();
    }
  }, [allComplete, anyRunning, handleAutoProceed, sessionStage]);

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handlePauseResume = async () => {
    const anyPaused = Object.values(scenarios).some(s => s.isPaused);
    if (anyPaused) await resumeAll();
    else await pauseAll();
  };

  const handleEndAndProceed = async () => {
    sseCleanupRef.current?.();
    await endAndProceed();
    if (id) {
      await fetch(`/api/sessions/${id}/stage`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage: 'reflecting' }),
      });
      navigate(`/session/${id}/reflection`);
    }
  };

  const handleAbort = async () => {
    sseCleanupRef.current?.();
    await abortAll();
    resetMulti();
    singleStore.reset();
    if (id) {
      await singleStore.abortAndReset(id);
      navigate(`/session/${id}/design`);
    }
  };

  // ── Derived data for charts ───────────────────────────────────────────────
  const scenarioMetas: ScenarioMeta[] = useMemo(() =>
    scenarioOrder.map((sid, i) => ({
      label: scenarios[sid]?.label ?? `Scenario ${i}`,
      index: i,
      sessionId: sid,
    })),
    [scenarioOrder, scenarios]
  );

  const scenariosDataForTelemetry = useMemo(() =>
    scenarioOrder.map(sid => ({
      label: scenarios[sid]?.label ?? sid,
      data: scenarios[sid]?.macroHistory ?? [],
    })),
    [scenarioOrder, scenarios]
  );

  const scenariosDataForStats = useMemo(() =>
    scenarioOrder.map(sid => ({
      label: scenarios[sid]?.label ?? sid,
      data: scenarios[sid]?.statsHistory ?? [],
    })),
    [scenarioOrder, scenarios]
  );

  // Merged data for each chart
  const cpiData = useMemo(() => mergeScenarioData(scenariosDataForTelemetry, 'cpi'), [scenariosDataForTelemetry]);
  const m0Data = useMemo(() => mergeScenarioData(scenariosDataForTelemetry, 'm0'), [scenariosDataForTelemetry]);
  const m1Data = useMemo(() => mergeScenarioData(scenariosDataForTelemetry, 'm1'), [scenariosDataForTelemetry]);
  const totalFiatData = useMemo(() => mergeScenarioData(scenariosDataForTelemetry, 'totalFiatSupply'), [scenariosDataForTelemetry]);

  const wealthData = useMemo(() => mergeStatsData(scenariosDataForStats, 'avgWealth'), [scenariosDataForStats]);
  const healthData = useMemo(() => mergeStatsData(scenariosDataForStats, 'avgHealth'), [scenariosDataForStats]);
  const happinessData = useMemo(() => mergeStatsData(scenariosDataForStats, 'avgHappiness'), [scenariosDataForStats]);
  const cortisolData = useMemo(() => mergeStatsData(scenariosDataForStats, 'avgCortisol'), [scenariosDataForStats]);
  const dopamineData = useMemo(() => mergeStatsData(scenariosDataForStats, 'avgDopamine'), [scenariosDataForStats]);
  const giniData = useMemo(() => mergeScenarioData(scenariosDataForTelemetry, 'giniCoefficient'), [scenariosDataForTelemetry]);
  const trustData = useMemo(() => mergeScenarioData(scenariosDataForTelemetry, 'trustIndex'), [scenariosDataForTelemetry]);
  const crimeData = useMemo(() => mergeScenarioData(scenariosDataForTelemetry, 'crimeRate'), [scenariosDataForTelemetry]);

  // Bond yields need special handling — extract governmentYield from nested object
  // For now, skip if not available as a top-level field

  // Determine global state
  const anyPaused = Object.values(scenarios).some(s => s.isPaused);
  const anyError = Object.values(scenarios).find(s => s.error)?.error ?? null;

  // Selected scenario data for side panels
  const selectedFeedData = scenarios[selectedFeedScenario];
  const selectedAgentData = scenarios[selectedAgentScenario];

  const feedEntries = useMemo(() => {
    const feed = selectedFeedData?.feed ?? [];
    return [...feed].reverse();
  }, [selectedFeedData?.feed]);

  const selectedAgents = selectedAgentData?.agents ?? [];

  // Lifecycle events from selected feed scenario
  const allLifecycleEvents = useMemo(() =>
    (selectedFeedData?.feed ?? []).flatMap(f => f.lifecycleEvents.map(e => ({ ...e, iterNum: f.number }))).reverse().slice(0, 30),
    [selectedFeedData?.feed]
  );

  const getAgentColor = (agent: { currentStats: { health: number }; isAlive: boolean }) => {
    if (!agent.isAlive) return 'var(--text-dim)';
    const h = agent.currentStats.health;
    if (h >= 70) return 'var(--success)';
    if (h >= 40) return 'var(--warning)';
    return 'var(--danger)';
  };

  // ── Scenario tabs component for side panels ───────────────────────────────
  const ScenarioTabBar = ({ selected, onSelect }: { selected: string; onSelect: (id: string) => void }) => (
    <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--glass-border)', paddingBottom: 4, marginBottom: 8 }}>
      {scenarioOrder.map((sid, i) => (
        <button key={sid} onClick={() => onSelect(sid)} style={{
          fontSize: 12, fontWeight: 700,
          color: selected === sid ? SCENARIO_COLORS[i % SCENARIO_COLORS.length] : 'var(--text-dim)',
          borderBottom: selected === sid ? `2px solid ${SCENARIO_COLORS[i % SCENARIO_COLORS.length]}` : '2px solid transparent',
          background: 'none', border: 'none', cursor: 'pointer', padding: '4px 8px',
        }}>
          {scenarios[sid]?.label ?? `Scenario ${i}`}
        </button>
      ))}
    </div>
  );

  return (
    <div className="animate-fade-in" style={{ height: 'calc(100vh - 4rem)', display: 'flex', flexDirection: 'column' }}>

      {/* Top Bar: Progress and Controls */}
      <div className="glass-panel" style={{ padding: '1rem 1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
        {/* Multi-progress bars (D-28) */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, flex: 1, marginRight: '1.5rem' }}>
          {scenarioOrder.map(sid => {
            const s = scenarios[sid];
            if (!s) return null;
            return (
              <ScenarioProgressBar
                key={sid}
                label={s.label}
                current={s.currentIteration}
                total={s.totalIterations}
                color={s.color}
                isComplete={s.isComplete}
                isPaused={s.isPaused}
                error={s.error}
              />
            );
          })}
        </div>

        {/* Controls */}
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexShrink: 0 }}>
          {/* Auto-Proceed Toggle */}
          <div
            onClick={() => setAutoProceed(p => !p)}
            style={{
              display: 'flex', alignItems: 'center', gap: '0.5rem',
              cursor: 'pointer', userSelect: 'none',
              padding: '0.5rem 0.75rem', borderRadius: '8px',
              background: autoProceed ? 'rgba(16, 185, 129, 0.15)' : 'var(--panel-alpha-05)',
              border: `1px solid ${autoProceed ? 'rgba(16, 185, 129, 0.4)' : 'var(--glass-border)'}`,
              transition: 'all 0.2s ease',
            }}
            title="When enabled, automatically proceed to Reflection when all scenarios complete"
          >
            <div style={{
              width: '32px', height: '18px', borderRadius: '9px',
              background: autoProceed ? 'var(--success)' : 'var(--panel-alpha-10)',
              position: 'relative', transition: 'background 0.2s',
              border: `1px solid ${autoProceed ? 'rgba(16, 185, 129, 0.5)' : 'var(--glass-border)'}`,
            }}>
              <div style={{
                width: '14px', height: '14px', borderRadius: '50%',
                background: autoProceed ? 'var(--color-bright)' : 'var(--text-dim)',
                position: 'absolute', top: '1px',
                left: autoProceed ? '16px' : '1px',
                transition: 'left 0.2s ease, background 0.2s',
              }} />
            </div>
            <Zap size={14} color={autoProceed ? 'var(--success)' : 'var(--text-dim)'} />
            <span style={{ fontSize: '0.8rem', color: autoProceed ? 'var(--success)' : 'var(--text-dim)', whiteSpace: 'nowrap' }}>
              Auto
            </span>
          </div>

          {/* Early Stopping Toggle */}
          <div
            onClick={() => setEarlyStoppingEnabled(p => !p)}
            style={{
              display: 'flex', alignItems: 'center', gap: '0.5rem',
              cursor: 'pointer', userSelect: 'none',
              padding: '0.5rem 0.75rem', borderRadius: '8px',
              background: earlyStoppingEnabled ? 'rgba(245, 158, 11, 0.15)' : 'var(--panel-alpha-05)',
              border: `1px solid ${earlyStoppingEnabled ? 'rgba(245, 158, 11, 0.4)' : 'var(--glass-border)'}`,
              transition: 'all 0.2s ease',
            }}
            title={earlyStoppingEnabled
              ? 'Early stopping ON — simulation halts if avg happiness < 5 or avg cortisol > 95'
              : 'Early stopping OFF — simulation runs all planned iterations regardless of collapse'}
          >
            <div style={{
              width: '32px', height: '18px', borderRadius: '9px',
              background: earlyStoppingEnabled ? 'var(--warning)' : 'var(--panel-alpha-10)',
              position: 'relative', transition: 'background 0.2s',
              border: `1px solid ${earlyStoppingEnabled ? 'rgba(245, 158, 11, 0.5)' : 'var(--glass-border)'}`,
            }}>
              <div style={{
                width: '14px', height: '14px', borderRadius: '50%',
                background: earlyStoppingEnabled ? 'var(--color-bright)' : 'var(--text-dim)',
                position: 'absolute', top: '1px',
                left: earlyStoppingEnabled ? '16px' : '1px',
                transition: 'left 0.2s ease, background 0.2s',
              }} />
            </div>
            <ShieldAlert size={14} color={earlyStoppingEnabled ? 'var(--warning)' : 'var(--text-dim)'} />
            <span style={{ fontSize: '0.8rem', color: earlyStoppingEnabled ? 'var(--warning)' : 'var(--text-dim)', whiteSpace: 'nowrap' }}>
              Stop
            </span>
          </div>

          {/* Classic Telemetry button */}
          <button
            className="btn-secondary"
            onClick={() => setShowTelemetryPanel(true)}
            style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.5rem 0.75rem' }}
            title="Show classic economy telemetry charts"
          >
            <BarChart3 size={16} />
          </button>

          {(anyRunning || anyPaused) && !allComplete && (
            <button className="btn-secondary" onClick={handlePauseResume} style={{ width: '100px', justifyContent: 'center' }}>
              {anyPaused ? <><Play size={16} /> Resume</> : <><Pause size={16} /> Pause</>}
            </button>
          )}
          {!allComplete && (
            <>
              <button
                className="btn-secondary"
                onClick={() => setConfirmDialog('end')}
                style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}
                title="End all simulations now and proceed to Reflection"
              >
                <Square size={16} /> End
              </button>
              <button
                className="btn-secondary"
                style={{ color: 'var(--danger)', borderColor: 'rgba(239,68,68,0.3)', display: 'flex', alignItems: 'center', gap: '0.4rem' }}
                onClick={() => setConfirmDialog('abort')}
                title="Cancel all simulations and discard data"
              >
                <X size={16} /> Abort
              </button>
            </>
          )}
        </div>
      </div>

      {/* Error banner */}
      {anyError && (
        <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '8px', padding: '0.75rem 1rem', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--danger)' }}>
          <AlertCircle size={16} style={{ flexShrink: 0 }} />
          <span style={{ flex: 1 }}>{anyError}</span>
        </div>
      )}

      {/* Config Diff Header (D-27) — only for multi-scenario */}
      {isMulti && (
        <div style={{ marginBottom: '0.75rem' }}>
          <ConfigDiffHeader scenarios={scenarioMetas} configs={scenarioConfigs} />
        </div>
      )}

      {/* Main Dashboard — Three Columns with Collapsible Panels */}
      <div style={{ display: 'flex', gap: 8, flex: 1, overflow: 'hidden' }}>

        {/* Left: Live Feed (collapsible) */}
        <CollapsiblePanel side="left" collapsed={leftCollapsed} onToggle={() => setLeftCollapsed(v => !v)} label="Live Feed">
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
            <div style={{ padding: '1rem', borderBottom: '1px solid var(--glass-border)', flexShrink: 0 }}>
              <h3 style={{ fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: '0.5rem', margin: 0 }}>
                <Activity size={18} color="var(--primary)" /> Live Feed
              </h3>
            </div>
            {/* Scenario tabs when N>1 (D-26) */}
            {isMulti && (
              <div style={{ padding: '8px 1rem 0' }}>
                <ScenarioTabBar selected={selectedFeedScenario} onSelect={setSelectedFeedScenario} />
              </div>
            )}
            <div style={{ flex: 1, padding: '1rem', overflowY: 'auto' }}>
              {feedEntries.length === 0 && !anyRunning && (
                <p style={{ color: 'var(--text-dim)', fontSize: '0.85rem', textAlign: 'center', marginTop: '2rem' }}>
                  No iterations yet.
                </p>
              )}
              {/* Pending indicator */}
              {selectedFeedData?.isRunning && feedEntries.length > 0 && (
                <div style={{ paddingLeft: '1rem', borderLeft: '2px solid var(--primary)', opacity: 0.6, marginBottom: '1rem' }}>
                  <h4 style={{ fontSize: '0.9rem', color: 'var(--primary)' }}>
                    Iteration {selectedFeedData.currentIteration} <Loader2 size={12} style={{ display: 'inline', animation: 'spin 1s linear infinite' }} />
                  </h4>
                  <p style={{ fontSize: '0.85rem', color: 'var(--text-dim)' }}>Collecting agent intentions...</p>
                </div>
              )}
              {feedEntries.map(entry => (
                <div key={entry.number} style={{ marginBottom: '1rem' }}>
                  <div style={{
                    paddingLeft: '1rem',
                    borderLeft: `2px solid ${entry.number === (selectedFeedData?.currentIteration ?? 0) ? 'var(--primary)' : 'var(--glass-border)'}`,
                  }}>
                    <h4 style={{
                      fontSize: '0.9rem',
                      color: entry.number === (selectedFeedData?.currentIteration ?? 0) ? 'var(--primary)' : 'var(--text-muted)',
                      marginBottom: '0.5rem',
                    }}>
                      Iteration {entry.number}
                      {entry.stats && (
                        <span style={{ fontWeight: 'normal', marginLeft: '0.5rem', fontSize: '0.8rem', color: 'var(--text-dim)' }}>
                          &middot; {entry.stats.aliveCount} alive
                        </span>
                      )}
                    </h4>
                    <p style={{ fontSize: '0.95rem', lineHeight: 1.5, color: 'var(--text-main)' }}>
                      <MarkdownText>{entry.narrativeSummary}</MarkdownText>
                    </p>
                  </div>
                </div>
              ))}
              {selectedFeedData?.isComplete && selectedFeedData?.finalReport && (
                <div style={{ paddingLeft: '1rem', borderLeft: '2px solid var(--success)', marginTop: '0.5rem' }}>
                  <h4 style={{ fontSize: '0.9rem', color: 'var(--success)', marginBottom: '0.5rem' }}>Final Report</h4>
                  <div style={{ fontSize: '0.9rem', lineHeight: 1.6, color: 'var(--text-main)' }}>
                    <MarkdownText>{selectedFeedData.finalReport}</MarkdownText>
                  </div>
                </div>
              )}
            </div>
          </div>
        </CollapsiblePanel>

        {/* Center: Statistics — chart grid */}
        <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
          <div style={{
            display: bothCollapsed ? 'grid' : 'flex',
            gridTemplateColumns: bothCollapsed ? 'repeat(auto-fill, minmax(420px, 1fr))' : undefined,
            flexDirection: bothCollapsed ? undefined : 'column',
            gap: bothCollapsed ? 24 : 16,
          }}>
            {/* 11 charts in D-25 order */}

            {/* 1. CPI */}
            <ScenarioChart
              data={cpiData}
              scenarios={scenarioMetas}
              field="cpi"
              title="Consumer Price Index"
              yFormatter={(v: number) => v.toFixed(1)}
            />

            {/* 2. Money Supply — M0 as base, show totalFiatSupply and M1 */}
            <ScenarioChart
              data={totalFiatData}
              scenarios={scenarioMetas}
              field="totalFiatSupply"
              title="Money Supply (M0 + Fiat)"
              yFormatter={(v: number) => v.toFixed(0)}
              chartType={!isMulti ? 'area' : 'line'}
            />

            {/* 3. Money Supply M1 */}
            <ScenarioChart
              data={m1Data}
              scenarios={scenarioMetas}
              field="m1"
              title="M1 Money Supply"
              yFormatter={(v: number) => v.toFixed(0)}
            />

            {/* 4. Gini Coefficient */}
            <ScenarioChart
              data={giniData}
              scenarios={scenarioMetas}
              field="giniCoefficient"
              title="Wealth Inequality (Gini)"
              yFormatter={(v: number) => v.toFixed(3)}
            />

            {/* 5. Avg Wealth */}
            <ScenarioChart
              data={wealthData}
              scenarios={scenarioMetas}
              field="avgWealth"
              title="Average Wealth"
              yFormatter={(v: number) => v.toFixed(0)}
            />

            {/* 6. Avg Health */}
            <ScenarioChart
              data={healthData}
              scenarios={scenarioMetas}
              field="avgHealth"
              title="Average Health"
              yFormatter={(v: number) => v.toFixed(1)}
            />

            {/* 7. Avg Happiness */}
            <ScenarioChart
              data={happinessData}
              scenarios={scenarioMetas}
              field="avgHappiness"
              title="Average Happiness"
              yFormatter={(v: number) => v.toFixed(1)}
            />

            {/* 8. Avg Cortisol */}
            <ScenarioChart
              data={cortisolData}
              scenarios={scenarioMetas}
              field="avgCortisol"
              title="Average Cortisol"
              yFormatter={(v: number) => v.toFixed(1)}
            />

            {/* 9. Avg Dopamine */}
            <ScenarioChart
              data={dopamineData}
              scenarios={scenarioMetas}
              field="avgDopamine"
              title="Average Dopamine"
              yFormatter={(v: number) => v.toFixed(1)}
            />

            {/* 10. Trust Index */}
            <ScenarioChart
              data={trustData}
              scenarios={scenarioMetas}
              field="trustIndex"
              title="Trust Index"
              yFormatter={(v: number) => (v * 100).toFixed(0) + '%'}
            />

            {/* 11. Crime Rate */}
            <ScenarioChart
              data={crimeData}
              scenarios={scenarioMetas}
              field="crimeRate"
              title="Crime Rate"
              yFormatter={(v: number) => (v * 100).toFixed(1) + '%'}
            />
          </div>
        </div>

        {/* Right: Agent Status (collapsible) */}
        <CollapsiblePanel side="right" collapsed={rightCollapsed} onToggle={() => setRightCollapsed(v => !v)} label="Agent Status">
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
            <div style={{ padding: '1rem', borderBottom: '1px solid var(--glass-border)', flexShrink: 0 }}>
              <h3 style={{ fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: '0.5rem', margin: 0 }}>
                <Users size={18} /> Agent Status
              </h3>
            </div>
            {/* Scenario tabs when N>1 (D-26) */}
            {isMulti && (
              <div style={{ padding: '8px 1rem 0' }}>
                <ScenarioTabBar selected={selectedAgentScenario} onSelect={setSelectedAgentScenario} />
              </div>
            )}
            <div style={{ flex: 1, padding: '1rem', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              {/* Agent dots */}
              <div style={{ flexShrink: 0 }}>
                {selectedAgents.length > 0 ? (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1rem' }}>
                    {selectedAgents.map(a => (
                      <div
                        key={a.id}
                        style={{
                          width: '14px', height: '14px',
                          borderRadius: '50%',
                          background: getAgentColor(a),
                          boxShadow: a.isAlive ? `0 0 5px ${getAgentColor(a)}` : 'none',
                          cursor: 'pointer',
                          opacity: a.isAlive ? 1 : 0.3,
                        }}
                        title={`${a.name} (${a.role}) — W:${a.currentStats.wealth} H:${a.currentStats.health} Hap:${a.currentStats.happiness}${!a.isAlive ? ' [dead]' : ''}`}
                      />
                    ))}
                  </div>
                ) : (
                  <div style={{ marginBottom: '1rem', color: 'var(--text-dim)', fontSize: '0.85rem' }}>
                    Agent data loading...
                  </div>
                )}
                {/* Tab bar */}
                <div style={{ display: 'flex', borderBottom: '1px solid var(--glass-border)', marginBottom: '0.75rem', gap: 0 }}>
                  {(['intents', 'lifecycle'] as const).map(tab => (
                    <button key={tab} onClick={() => setAgentStatusTab(tab)} style={{
                      flex: 1, padding: '0.4rem 0', fontSize: '0.75rem', fontWeight: 600,
                      textTransform: 'uppercase', letterSpacing: '0.05em', cursor: 'pointer',
                      border: 'none', borderBottom: `2px solid ${agentStatusTab === tab ? 'var(--primary)' : 'transparent'}`,
                      background: 'transparent', color: agentStatusTab === tab ? 'var(--primary)' : 'var(--text-dim)',
                      transition: 'color 0.15s, border-color 0.15s',
                    }}>
                      {tab === 'intents' ? 'Intents' : 'Lifecycle'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Tab content */}
              {agentStatusTab === 'lifecycle' ? (
                allLifecycleEvents.length === 0 ? (
                  <div style={{ fontSize: '0.9rem', color: 'var(--text-dim)' }}>No events yet.</div>
                ) : (
                  <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
                    {allLifecycleEvents.map((e, idx) => (
                      <div key={idx} style={{ fontSize: '0.9rem', color: 'var(--text-dim)', paddingBottom: '0.5rem' }}>
                        <span style={{ color: 'var(--text-muted)' }}>Iter {e.iterNum}:</span>{' '}
                        <span style={{ color: e.type === 'death' ? 'var(--danger)' : 'var(--primary)' }}>
                          {e.type === 'death' ? '\u{1F480}' : '\u{1F504}'}
                        </span>{' '}
                        {e.detail}
                      </div>
                    ))}
                  </div>
                )
              ) : (
                <AgentIntentPanel
                  agents={selectedAgents}
                  agentIntentHistory={agentIntentHistory}
                  pendingActionCodes={pendingActionCodes}
                  currentIteration={selectedAgentData?.currentIteration ?? 0}
                />
              )}
            </div>
          </div>
        </CollapsiblePanel>

      </div>

      {/* Action Bar — shown when all scenarios complete */}
      {allComplete && (
        <div className="glass-panel" style={{ padding: '1rem 1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '1rem', marginTop: '0.75rem', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginRight: 'auto' }}>
            <label style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Extra iterations:</label>
            <input
              type="number"
              min={1}
              max={200}
              value={extraIterations}
              onChange={e => setExtraIterations(Math.max(1, Math.min(200, Number(e.target.value) || 1)))}
              style={{
                width: '70px', padding: '0.35rem 0.5rem', borderRadius: '6px',
                border: '1px solid var(--glass-border)', background: 'var(--panel-alpha-10)',
                color: 'var(--color-bright)', fontSize: '0.9rem', textAlign: 'center',
              }}
            />
          </div>

          {['simulating', 'simulation-paused', 'simulation-complete'].includes(sessionStage) ? (
            <>
              <button
                className="btn-primary"
                onClick={async () => {
                  await addMoreIterations(extraIterations);
                  // Reconnect SSE streams
                  sseCleanupRef.current?.();
                  sseCleanupRef.current = connectAll();
                  setSessionStage('simulating');
                }}
                style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
              >
                <Play size={16} /> Add More Iterations
              </button>
              {/* View Full Comparison (D-14, LSC-10) — only for multi-scenario */}
              {isMulti && (
                <button
                  className="btn-primary"
                  onClick={() => navigate(`/sessions/${scenarioOrder[0]}/compare/${scenarioOrder[1]}`)}
                  style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'var(--primary)', color: 'white', padding: '0.75rem 1.5rem', borderRadius: 8, fontSize: '0.9rem', fontWeight: 700 }}
                >
                  View Full Comparison
                </button>
              )}
              <button
                className="btn-secondary"
                onClick={async () => {
                  if (!id) return;
                  await fetch(`/api/sessions/${id}/stage`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ stage: 'reflecting' }),
                  });
                  navigate(`/session/${id}/reflection`);
                }}
                style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
              >
                <ArrowRight size={16} /> Proceed to Reflection
              </button>
            </>
          ) : (
            <button
              className="btn-primary"
              onClick={async () => {
                if (!id) return;
                const newId = await singleStore.forkSimulation(id);
                navigate(`/session/${newId}/simulation`);
              }}
              style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
            >
              <GitFork size={16} /> Fork & Continue
            </button>
          )}
        </div>
      )}

      {/* Confirmation dialog */}
      {confirmDialog && (
        <ConfirmDialog
          variant={confirmDialog}
          isMulti={isMulti}
          onConfirm={() => {
            setConfirmDialog(null);
            if (confirmDialog === 'end') handleEndAndProceed();
            else handleAbort();
          }}
          onCancel={() => setConfirmDialog(null)}
        />
      )}

      {/* Economy Telemetry Terminal (classic) */}
      {showTelemetryPanel && id && (
        <TelemetryPanel
          sessionId={id}
          onClose={() => setShowTelemetryPanel(false)}
          macroHistory={scenarios[scenarioOrder[0]]?.macroHistory ?? []}
        />
      )}
    </div>
  );
};

// ── ConfirmDialog ─────────────────────────────────────────────────────────────

interface ConfirmDialogProps {
  variant: 'end' | 'abort';
  isMulti: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

function ConfirmDialog({ variant, isMulti, onConfirm, onCancel }: ConfirmDialogProps) {
  const isAbort = variant === 'abort';
  return (
    <div
      onClick={onCancel}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="glass-panel"
        style={{ width: '420px', padding: '2rem', display: 'flex', flexDirection: 'column', gap: '1.25rem', background: 'var(--bg-color)' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          {isAbort
            ? <X size={22} color="var(--danger)" />
            : <Square size={22} color="var(--color-bright)" />}
          <h3 style={{ fontSize: '1.1rem', margin: 0 }}>
            {isAbort ? 'Abort Simulation?' : 'End & Proceed to Reflection?'}
          </h3>
        </div>
        <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', lineHeight: 1.6, margin: 0 }}>
          {isAbort
            ? `This will stop all running simulations. Results so far will be preserved. Continue?`
            : `This will end all running simulations at their current iteration and proceed to reflection. Continue?`}
        </p>
        <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '0.25rem' }}>
          <button className="btn-secondary" onClick={onCancel}>
            Keep Running
          </button>
          <button
            className={isAbort ? 'btn-secondary' : 'btn-primary'}
            style={isAbort ? { color: 'var(--danger)', borderColor: 'rgba(239,68,68,0.4)' } : undefined}
            onClick={onConfirm}
          >
            {isAbort ? <><X size={15} /> Abort</> : <><Square size={15} /> End & Proceed</>}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Action Code Styling ───────────────────────────────────────────────────────

const ACTION_COLORS: Record<string, string> = {
  WORK: '#10b981', WORK_AT_ENTERPRISE: '#059669', PRODUCE_AND_SELL: '#84cc16',
  POST_BUY_ORDER: '#d97706', POST_SELL_ORDER: '#b45309', POST_JOB_OFFER: '#92400e',
  FOUND_ENTERPRISE: '#7c3aed', APPLY_FOR_JOB: '#2563eb', HIRE_EMPLOYEE: '#0f766e', FIRE_EMPLOYEE: '#b91c1c', QUIT_JOB: '#9f1239',
  REST: '#60a5fa', INVEST: '#818cf8',
  STRIKE: '#f97316',
  STEAL: '#ef4444', SABOTAGE: '#dc2626',
  HELP: '#ec4899',
  EMBEZZLE: '#c084fc', ADJUST_TAX: '#e879f9', SUPPRESS: '#fb7185',
  NONE: '#6b7280',
};

function actionBadge(actionCode: string, actionTarget: string | null) {
  const color = ACTION_COLORS[actionCode] ?? ACTION_COLORS.NONE;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', flexWrap: 'wrap' }}>
      <span style={{
        background: `${color}22`, border: `1px solid ${color}66`, color,
        borderRadius: '4px', padding: '1px 6px', fontSize: '0.72rem', fontWeight: 700,
        letterSpacing: '0.04em', fontFamily: 'monospace',
      }}>{actionCode}</span>
      {actionTarget && (
        <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>&rarr; {actionTarget}</span>
      )}
    </span>
  );
}

function actionQueueBadges(actions: Array<{ actionCode: string; parameters: Record<string, unknown> }>, fallbackActionCode: string | null, fallbackActionTarget: string | null) {
  const queue = actions.length > 0
    ? actions
    : (fallbackActionCode ? [{ actionCode: fallbackActionCode, parameters: fallbackActionTarget ? { target: fallbackActionTarget } : {} }] : []);

  if (queue.length === 0) {
    return <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)', fontStyle: 'italic' }}>No action yet</span>;
  }

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
      {queue.map((action, index) => {
        const target = action.parameters.target ?? action.parameters.agent_id ?? action.parameters.enterprise_id ?? null;
        return (
          <span key={`${action.actionCode}-${index}`} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
            {actionBadge(action.actionCode, typeof target === 'string' ? target : null)}
          </span>
        );
      })}
    </div>
  );
}

// ── AgentIntentPanel ──────────────────────────────────────────────────────────

interface AgentIntentPanelProps {
  agents: Array<{ id: string; name: string; role: string; isAlive: boolean }>;
  agentIntentHistory: Record<string, AgentIntentRecord[]>;
  pendingActionCodes: Record<string, { actionCode: string; actionTarget: string | null; actions: Array<{ actionCode: string; parameters: Record<string, unknown> }> }>;
  currentIteration: number;
}

function AgentIntentPanel({ agents, agentIntentHistory, pendingActionCodes, currentIteration }: AgentIntentPanelProps) {
  const citizenAgents = agents.filter(a => !('isCentralAgent' in a && (a as Record<string, unknown>).isCentralAgent));
  const sorted = [...citizenAgents].sort((a, b) => {
    if (a.isAlive !== b.isAlive) return a.isAlive ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  if (sorted.length === 0) {
    return <div style={{ fontSize: '0.9rem', color: 'var(--text-dim)' }}>No agents yet.</div>;
  }

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
      {sorted.map(agent => (
        <div key={agent.id} style={{ marginBottom: '0.5rem' }}>
          <AgentIntentCard
            agent={agent}
            history={agentIntentHistory[agent.id] ?? []}
            pending={pendingActionCodes[agent.id] ?? null}
            currentIteration={currentIteration}
          />
        </div>
      ))}
    </div>
  );
}

// ── AgentIntentCard ───────────────────────────────────────────────────────────

interface AgentIntentCardProps {
  agent: { id: string; name: string; role: string; isAlive: boolean };
  history: AgentIntentRecord[];
  pending: { actionCode: string; actionTarget: string | null; actions: Array<{ actionCode: string; parameters: Record<string, unknown> }> } | null;
  currentIteration: number;
}

function AgentIntentCard({ agent, history, pending }: AgentIntentCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [expandedIntents, setExpandedIntents] = useState<Set<number>>(new Set());

  const latestRecord = history[history.length - 1] ?? null;
  const currentActionCode = pending?.actionCode ?? latestRecord?.actionCode ?? null;
  const currentActionTarget = pending !== null ? pending.actionTarget : latestRecord?.actionTarget ?? null;
  const currentActions = pending?.actions ?? latestRecord?.actions ?? [];

  const toggleIntent = (iterNum: number) => {
    setExpandedIntents(prev => {
      const next = new Set(prev);
      if (next.has(iterNum)) next.delete(iterNum);
      else next.add(iterNum);
      return next;
    });
  };

  const historyDesc = [...history].reverse();

  return (
    <div style={{
      border: '1px solid var(--glass-border)',
      borderRadius: '8px',
      background: agent.isAlive ? 'var(--panel-alpha-05)' : 'rgba(0,0,0,0.1)',
      opacity: agent.isAlive ? 1 : 0.55,
      overflow: 'hidden',
    }}>
      <div style={{ padding: '0.5rem 0.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.4rem', marginBottom: '0.25rem' }}>
            <span style={{ fontSize: '0.85rem', fontWeight: 600, color: agent.isAlive ? 'var(--color-bright)' : 'var(--text-dim)' }}>
              {agent.name}
            </span>
            {!agent.isAlive && <span style={{ fontSize: '0.68rem', color: 'var(--danger)' }}>&dagger;</span>}
          </div>
          {actionQueueBadges(currentActions, currentActionCode, currentActionTarget)}
        </div>
        {history.length > 0 && (
          <button
            onClick={() => setExpanded(e => !e)}
            style={{
              background: 'transparent', border: '1px solid var(--glass-border)',
              borderRadius: '6px', padding: '0.2rem 0.5rem', cursor: 'pointer',
              color: 'var(--text-muted)', fontSize: '0.72rem', display: 'flex', alignItems: 'center', gap: '0.2rem',
              whiteSpace: 'nowrap', flexShrink: 0,
            }}
          >
            {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            {history.length}
          </button>
        )}
      </div>

      {expanded && history.length > 0 && (
        <div style={{ borderTop: '1px solid var(--glass-border)', padding: '0.5rem 0.75rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          {historyDesc.map(record => {
            const isOpen = expandedIntents.has(record.iterationNumber);
            return (
              <div key={record.iterationNumber}
                style={{ borderRadius: '6px', overflow: 'hidden', border: '1px solid var(--glass-border)' }}
              >
                <div
                  onClick={() => toggleIntent(record.iterationNumber)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '0.5rem',
                    padding: '0.3rem 0.5rem', cursor: 'pointer',
                    background: isOpen ? 'var(--panel-alpha-10)' : 'transparent',
                    userSelect: 'none',
                  }}
                >
                  {isOpen ? <ChevronDown size={11} color="var(--text-dim)" /> : <ChevronRight size={11} color="var(--text-dim)" />}
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-dim)', minWidth: '3.5rem' }}>
                    Iter {record.iterationNumber}
                  </span>
                  {actionQueueBadges(record.actions, record.actionCode, record.actionTarget)}
                </div>
                {isOpen && record.narrative && (
                  <div style={{
                    padding: '0.4rem 0.75rem 0.4rem 1.5rem',
                    fontSize: '0.8rem', color: 'var(--text-muted)', lineHeight: 1.5,
                    borderTop: '1px solid var(--glass-border)',
                    background: 'var(--panel-alpha-05)',
                  }}>
                    {record.narrative}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default Simulation;
