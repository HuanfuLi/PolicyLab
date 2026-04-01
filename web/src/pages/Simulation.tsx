import React, { useEffect, useRef, useMemo, useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Play, Pause, Square, X, Activity, Heart, CircleDollarSign, Users, Loader2, AlertCircle, ArrowRight, GitFork, Zap, ChevronDown, ChevronRight, ShieldAlert } from 'lucide-react';
import { useSimulationStore, type AgentIntentRecord } from '../stores/simulationStore';
import { useShallow } from 'zustand/react/shallow';
import MarkdownText from '../components/MarkdownText';

// Chart color tokens (kept in sync with --chart-* CSS variables in index.css)
const CHART_ORANGE = 'var(--chart-orange)';
const CHART_VIOLET = 'var(--chart-violet)';

const Simulation = () => {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const {
    isRunning, isPaused, isComplete,
    currentIteration, totalIterations,
    feed, statsHistory, agents, finalReport, error,
    loadAgents, loadHistory, connectSSE,
    pause, resume, abort, abortAndReset, reset,
    continueSimulation, forkSimulation,
  } = useSimulationStore(useShallow(s => ({
    isRunning: s.isRunning, isPaused: s.isPaused, isComplete: s.isComplete,
    currentIteration: s.currentIteration, totalIterations: s.totalIterations,
    feed: s.feed, statsHistory: s.statsHistory, agents: s.agents,
    finalReport: s.finalReport, error: s.error,
    loadAgents: s.loadAgents, loadHistory: s.loadHistory, connectSSE: s.connectSSE,
    pause: s.pause, resume: s.resume, abort: s.abort, abortAndReset: s.abortAndReset, reset: s.reset,
    continueSimulation: s.continueSimulation, forkSimulation: s.forkSimulation,
  })));

  const { pendingActionCodes, agentIntentHistory, loadIntentHistory } = useSimulationStore(
    useShallow(s => ({
      pendingActionCodes: s.pendingActionCodes,
      agentIntentHistory: s.agentIntentHistory,
      loadIntentHistory: s.loadIntentHistory,
    }))
  );

  // Initialize to '' so auto-proceed never fires before the session fetch resolves.
  // If initialized to 'simulating', a race between the Zustand isComplete update and
  // the local setSessionStage call could trigger auto-proceed with a stale stage value.
  const [sessionStage, setSessionStage] = useState<string>('');
  const [extraIterations, setExtraIterations] = useState(10);
  const [agentStatusTab, setAgentStatusTab] = useState<'lifecycle' | 'intents'>('intents');
  const [confirmDialog, setConfirmDialog] = useState<'end' | 'abort' | null>(null);
  const [autoProceed, setAutoProceed] = useState(() => localStorage.getItem('sim-auto-proceed') === 'true');
  const autoProceedRef = useRef(autoProceed);
  const [earlyStoppingEnabled, setEarlyStoppingEnabled] = useState(
    () => localStorage.getItem('sim-early-stopping') !== 'false'
  );
  const sseCleanupRef = useRef<(() => void) | null>(null);
  const hasAutoProceeded = useRef(false);

  // Keep ref in sync for use in effects without re-running them
  useEffect(() => {
    autoProceedRef.current = autoProceed;
    localStorage.setItem('sim-auto-proceed', autoProceed ? 'true' : 'false');
  }, [autoProceed]);

  // Persist early stopping preference and sync to server mid-run
  useEffect(() => {
    localStorage.setItem('sim-early-stopping', earlyStoppingEnabled ? 'true' : 'false');
    if (!id || (!isRunning && !isPaused)) return;
    fetch(`/api/sessions/${id}/simulate/early-stopping`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: earlyStoppingEnabled }),
    }).catch(() => null);
  }, [earlyStoppingEnabled, id, isRunning, isPaused]);

  useEffect(() => {
    if (!id) return;
    reset();
    // Initialization: load history first, then restore session state
    const init = async () => {
      await loadAgents(id);
      await loadHistory(id);
      await loadIntentHistory(id);

      try {
        const r = await fetch(`/api/sessions/${id}`);
        const s = (await r.json()) as { stage?: string; config?: { totalIterations?: number } | null };
        if (s.stage) setSessionStage(s.stage);

        const targetIters = s.config?.totalIterations ?? 0;

        if (s.stage === 'simulating') {
          // Simulation is actively running; restore the running state immediately.
          // currentIteration is left as-is (set by loadHistory or incoming iteration-start SSE).
          useSimulationStore.setState(prev => ({
            isRunning: true,
            isPaused: false,
            isComplete: false,
            totalIterations: targetIters > 0 ? targetIters : prev.totalIterations,
          }));
        } else if (s.stage === 'simulation-paused') {
          useSimulationStore.setState(prev => ({
            isRunning: false,
            isPaused: true,
            isComplete: false,
            totalIterations: targetIters > 0 ? targetIters : prev.totalIterations,
          }));
        } else if (s.stage === 'simulation-complete' || s.stage === 'reflecting' || s.stage === 'reflection-complete' || s.stage === 'reviewing' || s.stage === 'completed') {
          // Simulation already finished — mark as complete regardless of feed.
          // Mark hasAutoProceeded so the auto-proceed effect does NOT fire on load.
          // Auto-proceed is only valid when a simulation *just finished* via SSE;
          // for pre-completed sessions (e.g. forked sessions, page refresh after
          // completion) the user must choose manually.
          hasAutoProceeded.current = true;
          const state = useSimulationStore.getState();
          useSimulationStore.setState({
            isRunning: false,
            isPaused: false,
            isComplete: true,
            totalIterations: targetIters > 0 ? targetIters : (state.feed.length || state.totalIterations),
          });
        }
      } catch { /* ignore fetch errors */ }
    };

    init();

    // Connect SSE for live updates; will close gracefully if simulation already done
    const disconnect = connectSSE(id);
    sseCleanupRef.current = disconnect;
    return disconnect;
  }, [id]);


  // Auto-proceed: when simulation finishes and toggle is on, navigate to reflection.
  // Only fires when the session is still in a simulation stage — prevents triggering
  // when the user navigates back to this page after reflection/review has started.
  const simulationStages = ['simulating', 'simulation-paused', 'simulation-complete'];

  const handleAutoProceed = useCallback(async () => {
    if (!id || hasAutoProceeded.current) return;
    // Hard guard: never auto-navigate away if we're already past the simulation stage
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
    // Only auto-proceed when in an active simulation stage — skip if user navigated
    // back here from a later stage (reflecting, reviewing, completed, etc.)
    if (isComplete && !isRunning && autoProceedRef.current && !hasAutoProceeded.current
      && simulationStages.includes(sessionStage)) {
      handleAutoProceed();
    }
  }, [isComplete, isRunning, handleAutoProceed, sessionStage]);

  const handlePauseResume = async () => {
    if (!id) return;
    if (isPaused) await resume(id);
    else await pause(id);
  };

  const handleEndAndProceed = async () => {
    if (!id) return;
    sseCleanupRef.current?.();
    await abort(id);
    await fetch(`/api/sessions/${id}/stage`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stage: 'reflecting' }),
    });
    navigate(`/session/${id}/reflection`);
  };

  const handleAbort = async () => {
    if (!id) return;
    sseCleanupRef.current?.();
    reset();
    await abortAndReset(id);
    navigate(`/session/${id}/design`);
  };

  const latestStats = statsHistory[statsHistory.length - 1] ?? null;

  const getAgentColor = (agent: { currentStats: { health: number }; isAlive: boolean }) => {
    if (!agent.isAlive) return 'var(--text-dim)';
    const h = agent.currentStats.health;
    if (h >= 70) return 'var(--success)';
    if (h >= 40) return 'var(--warning)';
    return 'var(--danger)';
  };

  const progress = totalIterations > 0 ? (currentIteration / totalIterations) * 100 : 0;

  // Reversed feed for display (newest first)
  const reversedFeed = useMemo(() => [...feed].reverse(), [feed]);

  // Lifecycle events across all iterations (newest first, capped at 30)
  const allLifecycleEvents = useMemo(() =>
    feed.flatMap(f => f.lifecycleEvents.map(e => ({ ...e, iterNum: f.number }))).reverse().slice(0, 30),
    [feed]
  );


  return (
    <div className="animate-fade-in" style={{ height: 'calc(100vh - 4rem)', display: 'flex', flexDirection: 'column' }}>

      {/* Top Bar: Progress and Controls */}
      <div className="glass-panel" style={{ padding: '1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', flex: 1, marginRight: '2rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem' }}>
            {isComplete ? (
              <span style={{ color: 'var(--success)' }}><strong>Simulation Complete</strong></span>
            ) : isRunning ? (
              <span>
                <strong style={{ color: 'var(--color-bright)' }}>Iteration {currentIteration}</strong>
                {totalIterations > 0 && ` of ${totalIterations}`}
                <Loader2 size={14} style={{ marginLeft: '0.5rem', animation: 'spin 1s linear infinite', display: 'inline' }} />
              </span>
            ) : isPaused ? (
              <span style={{ color: 'var(--warning)' }}>Paused at iteration {currentIteration}</span>
            ) : (
              <span style={{ color: 'var(--text-muted)' }}>Waiting for simulation to start…</span>
            )}
            {totalIterations > 0 && (
              <span style={{ color: 'var(--text-dim)' }}>{Math.round(progress)}%</span>
            )}
          </div>
          <div style={{ height: '8px', background: 'var(--panel-alpha-10)', borderRadius: '4px', overflow: 'hidden' }}>
            <div style={{
              height: '100%',
              width: `${progress}%`,
              background: isComplete
                ? 'var(--success)'
                : 'linear-gradient(90deg, var(--primary), var(--success))',
              transition: 'width 1s linear',
            }} />
          </div>
        </div>

        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          {/* Auto-Proceed Toggle */}
          <div
            onClick={() => setAutoProceed(p => !p)}
            style={{
              display: 'flex', alignItems: 'center', gap: '0.5rem',
              cursor: 'pointer', userSelect: 'none',
              padding: '0.75rem 0.75rem', borderRadius: '8px',
              background: autoProceed ? 'rgba(16, 185, 129, 0.15)' : 'var(--panel-alpha-05)',
              border: `1px solid ${autoProceed ? 'rgba(16, 185, 129, 0.4)' : 'var(--glass-border)'}`,
              transition: 'all 0.2s ease',
            }}
            title="When enabled, automatically proceed to Reflection when simulation completes"
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
              Auto Proceed
            </span>
          </div>

          {/* Early Stopping Toggle */}
          <div
            onClick={() => setEarlyStoppingEnabled(p => !p)}
            style={{
              display: 'flex', alignItems: 'center', gap: '0.5rem',
              cursor: 'pointer', userSelect: 'none',
              padding: '0.75rem 0.75rem', borderRadius: '8px',
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
              Early Stop
            </span>
          </div>

          {(isRunning || isPaused) && !isComplete && (
            <button className="btn-secondary" onClick={handlePauseResume} style={{ width: '120px', justifyContent: 'center' }}>
              {isPaused ? <><Play size={18} /> Resume</> : <><Pause size={18} /> Pause</>}
            </button>
          )}
          {!isComplete && (
            <>
              <button
                className="btn-secondary"
                onClick={() => setConfirmDialog('end')}
                style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}
                title="End simulation now and proceed to Reflection (keeps all completed iterations)"
              >
                <Square size={18} /> End & Proceed
              </button>
              <button
                className="btn-secondary"
                style={{ color: 'var(--danger)', borderColor: 'rgba(239,68,68,0.3)', display: 'flex', alignItems: 'center', gap: '0.4rem' }}
                onClick={() => setConfirmDialog('abort')}
                title="Cancel simulation and discard all data, returning to Design"
              >
                <X size={18} /> Abort
              </button>
            </>
          )}
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '8px', padding: '0.75rem 1rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--danger)' }}>
          <AlertCircle size={16} style={{ flexShrink: 0 }} />
          <span style={{ flex: 1 }}>{error}</span>
          <button
            onClick={() => useSimulationStore.setState({ error: null })}
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--danger)', padding: '0', display: 'flex', alignItems: 'center', flexShrink: 0 }}
            title="Dismiss"
          >
            ✕
          </button>
        </div>
      )}

      {/* Main Dashboard — Three Columns */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(300px, 1.2fr) minmax(250px, 1fr) minmax(300px, 1fr)', gap: '1.5rem', flex: 1, overflow: 'hidden' }}>

        {/* Col 1: Live Feed (virtualized) */}
        <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ padding: '1rem', borderBottom: '1px solid var(--glass-border)', flexShrink: 0 }}>
            <h3 style={{ fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Activity size={18} color="var(--primary)" /> Live Feed
            </h3>
          </div>
          <div style={{ flex: 1, padding: '1rem', overflowY: 'auto' }}>
            {feed.length === 0 && !isRunning && (
              <p style={{ color: 'var(--text-dim)', fontSize: '0.85rem', textAlign: 'center', marginTop: '2rem' }}>
                No iterations yet.
              </p>
            )}
            {/* Pending "next iteration" indicator */}
            {isRunning && feed.length > 0 && (
              <div style={{ paddingLeft: '1rem', borderLeft: '2px solid var(--primary)', opacity: 0.6, marginBottom: '1rem' }}>
                <h4 style={{ fontSize: '0.9rem', color: 'var(--primary)' }}>
                  Iteration {currentIteration} <Loader2 size={12} style={{ display: 'inline', animation: 'spin 1s linear infinite' }} />
                </h4>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-dim)' }}>Collecting agent intentions…</p>
              </div>
            )}
            {/* Feed list (newest first) */}
            {reversedFeed.map(entry => (
              <div key={entry.number} style={{ marginBottom: '1rem' }}>
                <div style={{
                  paddingLeft: '1rem',
                  borderLeft: `2px solid ${entry.number === currentIteration ? 'var(--primary)' : 'var(--glass-border)'}`,
                }}>
                  <h4 style={{
                    fontSize: '0.9rem',
                    color: entry.number === currentIteration ? 'var(--primary)' : 'var(--text-muted)',
                    marginBottom: '0.5rem',
                  }}>
                    Iteration {entry.number}
                    {entry.stats && (
                      <span style={{ fontWeight: 'normal', marginLeft: '0.5rem', fontSize: '0.8rem', color: 'var(--text-dim)' }}>
                        · {entry.stats.aliveCount} alive
                      </span>
                    )}
                  </h4>
                  <p style={{ fontSize: '0.95rem', lineHeight: 1.5, color: 'var(--text-main)' }}>
                    <MarkdownText>{entry.narrativeSummary}</MarkdownText>
                  </p>
                </div>
              </div>
            ))}
            {isComplete && finalReport && (
              <div style={{ paddingLeft: '1rem', borderLeft: '2px solid var(--success)', marginTop: '0.5rem' }}>
                <h4 style={{ fontSize: '0.9rem', color: 'var(--success)', marginBottom: '0.5rem' }}>Final Report</h4>
                <div style={{ fontSize: '0.9rem', lineHeight: 1.6, color: 'var(--text-main)' }}>
                  <MarkdownText>{finalReport}</MarkdownText>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Col 2: Statistics */}
        <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ padding: '1rem', borderBottom: '1px solid var(--glass-border)', flexShrink: 0 }}>
            <h3 style={{ fontSize: '1.1rem' }}>Statistics</h3>
          </div>
          <div style={{ flex: 1, padding: '1rem', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

            {latestStats ? (
              <>
                <StatCard
                  label="Wealth"
                  color="var(--warning)"
                  icon={<CircleDollarSign size={16} />}
                  avg={latestStats.avgWealth}
                  min={latestStats.minWealth}
                  max={latestStats.maxWealth}
                  history={statsHistory.map(s => s.avgWealth)}
                />
                <StatCard
                  label="Health"
                  color="var(--success)"
                  icon={<Heart size={16} />}
                  avg={latestStats.avgHealth}
                  min={latestStats.minHealth}
                  max={latestStats.maxHealth}
                  history={statsHistory.map(s => s.avgHealth)}
                />
                <StatCard
                  label="Happiness"
                  color="var(--primary)"
                  icon={<Users size={16} />}
                  avg={latestStats.avgHappiness}
                  min={latestStats.minHappiness}
                  max={latestStats.maxHappiness}
                  history={statsHistory.map(s => s.avgHappiness)}
                />
                {latestStats.avgCortisol !== undefined && (
                  <StatCard
                    label="Cortisol"
                    color={CHART_ORANGE}
                    icon={<Activity size={16} />}
                    avg={latestStats.avgCortisol}
                    history={statsHistory.map(s => s.avgCortisol ?? 0)}
                  />
                )}
                {latestStats.avgDopamine !== undefined && (
                  <StatCard
                    label="Dopamine"
                    color={CHART_VIOLET}
                    icon={<Zap size={16} />}
                    avg={latestStats.avgDopamine}
                    history={statsHistory.map(s => s.avgDopamine ?? 0)}
                  />
                )}
                <div style={{ background: 'var(--panel-alpha-05)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--glass-border)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}><Users size={16} /> Population</span>
                    <span>{latestStats.aliveCount} / {latestStats.totalCount}</span>
                  </div>
                  {latestStats.giniWealth !== undefined && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
                      <span title="Wealth inequality: 0=equal, 1=totally unequal">Gini (wealth)</span>
                      <span style={{ color: latestStats.giniWealth > 0.5 ? 'var(--danger)' : latestStats.giniWealth > 0.3 ? 'var(--warning)' : 'var(--success)' }}>
                        {latestStats.giniWealth.toFixed(2)}
                      </span>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <p style={{ color: 'var(--text-dim)', fontSize: '0.85rem', textAlign: 'center', marginTop: '2rem' }}>
                Stats will appear after the first iteration.
              </p>
            )}
          </div>
        </div>

        {/* Col 3: Agent Grid + Lifecycle */}
        <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ padding: '1rem', borderBottom: '1px solid var(--glass-border)', flexShrink: 0 }}>
            <h3 style={{ fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Users size={18} /> Agent Status
            </h3>
          </div>
          <div style={{ flex: 1, padding: '1.5rem', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {/* Agent dots — fixed height, no internal scroll needed */}
            <div style={{ flexShrink: 0 }}>
              {agents.length > 0 ? (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1rem' }}>
                  {agents.map(a => (
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
                  Agent data loading…
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

            {/* Tab content — expands to fill remaining space */}
            {agentStatusTab === 'lifecycle' ? (
              allLifecycleEvents.length === 0 ? (
                <div style={{ fontSize: '0.9rem', color: 'var(--text-dim)' }}>No events yet.</div>
              ) : (
                <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
                  {allLifecycleEvents.map((e, idx) => (
                    <div key={idx} style={{ fontSize: '0.9rem', color: 'var(--text-dim)', paddingBottom: '0.5rem' }}>
                      <span style={{ color: 'var(--text-muted)' }}>Iter {e.iterNum}:</span>{' '}
                      <span style={{ color: e.type === 'death' ? 'var(--danger)' : 'var(--primary)' }}>
                        {e.type === 'death' ? '💀' : '🔄'}
                      </span>{' '}
                      {e.detail}
                    </div>
                  ))}
                </div>
              )
            ) : (
              <AgentIntentPanel
                agents={agents}
                agentIntentHistory={agentIntentHistory}
                pendingActionCodes={pendingActionCodes}
                currentIteration={currentIteration}
              />
            )}
          </div>
        </div>

      </div>

      {/* Action Bar — shown when simulation is complete and not running */}
      {isComplete && !isRunning && (
        <div className="glass-panel" style={{ padding: '1rem 1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '1rem', marginTop: '1.5rem', flexShrink: 0 }}>
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
                  if (!id) return;
                  sseCleanupRef.current?.();
                  sseCleanupRef.current = await continueSimulation(id, extraIterations, earlyStoppingEnabled);
                  setSessionStage('simulating');
                }}
                style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
              >
                <Play size={16} /> Add More Iterations
              </button>
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
                const newId = await forkSimulation(id);
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
          onConfirm={() => {
            setConfirmDialog(null);
            if (confirmDialog === 'end') handleEndAndProceed();
            else handleAbort();
          }}
          onCancel={() => setConfirmDialog(null)}
        />
      )}
    </div>
  );
};

// ── ConfirmDialog ─────────────────────────────────────────────────────────────

interface ConfirmDialogProps {
  variant: 'end' | 'abort';
  onConfirm: () => void;
  onCancel: () => void;
}

function ConfirmDialog({ variant, onConfirm, onCancel }: ConfirmDialogProps) {
  const isAbort = variant === 'abort';
  return (
    /* Backdrop */
    <div
      onClick={onCancel}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      {/* Panel */}
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
            ? 'This will cancel the simulation and permanently discard all completed iterations. The session will return to the Design stage.'
            : 'This will stop the simulation at the current iteration and immediately proceed to Reflection. All completed iterations will be preserved.'}
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
  // Phase 3: elite privileged actions
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
        <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>→ {actionTarget}</span>
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
  const citizenAgents = agents.filter(a => !(a as any).isCentralAgent);
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

function AgentIntentCard({ agent, history, pending, currentIteration }: AgentIntentCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [expandedIntents, setExpandedIntents] = useState<Set<number>>(new Set());

  // Current action: live pending if it exists, otherwise last in history
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

  // Show history in reverse chronological order
  const historyDesc = [...history].reverse();

  return (
    <div style={{
      border: '1px solid var(--glass-border)',
      borderRadius: '8px',
      background: agent.isAlive ? 'var(--panel-alpha-05)' : 'rgba(0,0,0,0.1)',
      opacity: agent.isAlive ? 1 : 0.55,
      overflow: 'hidden',
    }}>
      {/* Card header */}
      <div style={{ padding: '0.5rem 0.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.4rem', marginBottom: '0.25rem' }}>
            <span style={{ fontSize: '0.85rem', fontWeight: 600, color: agent.isAlive ? 'var(--color-bright)' : 'var(--text-dim)' }}>
              {agent.name}
            </span>
            {!agent.isAlive && <span style={{ fontSize: '0.68rem', color: 'var(--danger)' }}>†</span>}
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

      {/* Expanded history */}
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

// ── StatCard ──────────────────────────────────────────────────────────────────

interface StatCardProps {
  label: string;
  color: string;
  icon: React.ReactNode;
  avg: number;
  min?: number;
  max?: number;
  history: number[];
}

function StatCard({ label, color, icon, avg, min, max, history }: StatCardProps) {
  const maxHistory = 12;
  const recent = history.slice(-maxHistory);
  const peak = Math.max(...recent, 1);

  return (
    <div style={{ background: 'var(--panel-alpha-05)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--glass-border)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', color, marginBottom: '0.5rem' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>{icon} {label}</span>
        <span>Avg: {avg}</span>
      </div>
      <div style={{ height: '30px', borderBottom: '1px dashed rgba(255,255,255,0.2)', display: 'flex', alignItems: 'flex-end', gap: '2px' }}>
        {recent.map((v, i) => (
          <div key={i} style={{ flex: 1, background: color, height: `${Math.round((v / peak) * 100)}%`, opacity: 0.6, minHeight: '2px' }} />
        ))}
      </div>
      {min !== undefined && max !== undefined && (
        <div style={{ fontSize: '0.8rem', color: 'var(--text-dim)', textAlign: 'right' as const, marginTop: '0.5rem' }}>
          min {min} / max {max}
        </div>
      )}
    </div>
  );
}

export default Simulation;
