import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { FileText, ArrowRight, TrendingDown, TrendingUp, Minus, Loader2, AlertCircle, CheckCircle, ChevronDown, ChevronUp, BarChart2, SkipForward, RotateCcw } from 'lucide-react';
import { useReflectionStore } from '../stores/reflectionStore';
import { useSimulationStore } from '../stores/simulationStore';
import { useSessionDetailStore } from '../stores/sessionDetailStore';
import { LineChart } from '../components/LineChart';
import MarkdownText from '../components/MarkdownText';
import type { IterationStats } from '@policylab/shared';

interface AgentStatsHistory {
  name: string;
  role: string;
  history: Array<{ iter: number; wealth: number; health: number; happiness: number }>;
}

function StatDelta({ initial, final }: { initial: number; final: number }) {
  const delta = final - initial;
  const Icon = delta > 0 ? TrendingUp : delta < 0 ? TrendingDown : Minus;
  const color = delta > 0 ? 'var(--success)' : delta < 0 ? 'var(--danger)' : 'var(--text-dim)';
  return (
    <span style={{ color, display: 'inline-flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.85rem' }}>
      <Icon size={14} /> {delta > 0 ? '+' : ''}{delta}
    </span>
  );
}

const Reflection = () => {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const sseCleanupRef = useRef<(() => void) | null>(null);

  const {
    isRunning, isComplete, currentPass, completedCount, totalAgents, isEvaluating,
    agentReflections, evaluation, error,
    agents, loadAgents, loadReflections, startReflection, connectSSE, reset,
  } = useReflectionStore();

  const { session, loadSession } = useSessionDetailStore();
  const { agents: simAgents, statsHistory: simStatsHistory } = useSimulationStore();

  // Society-wide stats for trend graph
  const [societyStats, setSocietyStats] = useState<IterationStats[]>([]);
  // Per-agent stats history
  const [agentStatsMap, setAgentStatsMap] = useState<Record<string, AgentStatsHistory>>({});
  const [agentStatsLoaded, setAgentStatsLoaded] = useState(false);
  // Which agent cards have expanded stats
  const [expandedAgents, setExpandedAgents] = useState<Set<string>>(new Set());

  // Track whether the user has skipped reflection (set true on Skip, false on Redo)
  const [isSkipped, setIsSkipped] = useState(false);

  // Use agents from simulation store if reflection store hasn't loaded yet
  const displayAgents = agents.length > 0 ? agents : simAgents;

  const loadSocietyStats = async (sessionId: string) => {
    try {
      const res = await fetch(`/api/sessions/${sessionId}/iterations?full=true`);
      if (!res.ok) {
        console.warn(`Failed to load society stats: HTTP ${res.status}`);
        return;
      }
      const iters = await res.json() as Array<{ statistics?: IterationStats }>;
      const stats = iters.filter(it => it.statistics).map(it => it.statistics!);
      setSocietyStats(stats);
    } catch (err) {
      console.warn('Failed to load society stats:', err);
    }
  };

  useEffect(() => {
    if (!id) return;
    reset();
    loadAgents(id);
    loadSession(id);
    loadReflections(id);
    loadSocietyStats(id);
  }, [id]);

  const loadAgentStats = async (sessionId: string) => {
    if (agentStatsLoaded) return;
    try {
      const res = await fetch(`/api/sessions/${sessionId}/iterations/agent-stats`);
      if (!res.ok) {
        console.warn(`Failed to load agent stats: HTTP ${res.status}`);
        return;
      }
      const data = await res.json() as { agents: Record<string, AgentStatsHistory> };
      setAgentStatsMap(data.agents);
      setAgentStatsLoaded(true);
    } catch (err) {
      console.warn('Failed to load agent stats:', err);
    }
  };

  // Auto-start reflection if stage is 'reflecting' (just came from simulation)
  useEffect(() => {
    if (!session || !id) return;
    if (session.stage === 'reflecting' && !isRunning && !isComplete) {
      startReflection(id).then(() => {
        const cleanup = connectSSE(id);
        sseCleanupRef.current = cleanup;
      });
    } else if (session.stage === 'reflection-complete' || session.stage === 'reviewing' || session.stage === 'completed') {
      loadReflections(id);
    }
  }, [session?.stage, id]);

  useEffect(() => {
    return () => {
      sseCleanupRef.current?.();
    };
  }, []);

  // Detect skipped state on page revisit: stage advanced past 'reflecting' but no evaluation loaded
  useEffect(() => {
    if (
      (session?.stage === 'reflection-complete' || session?.stage === 'reviewing' || session?.stage === 'completed')
      && !isComplete
    ) {
      setIsSkipped(true);
    }
  }, [session?.stage, isComplete]);

  const handleSkip = async () => {
    sseCleanupRef.current?.();
    if (id) {
      await fetch(`/api/sessions/${id}/stage`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage: 'reflection-complete' }),
      }).catch(() => null);
    }
    setIsSkipped(true);
  };

  const handleRedo = async () => {
    if (!id) return;
    sseCleanupRef.current?.();
    setIsSkipped(false);
    reset();
    await fetch(`/api/sessions/${id}/stage`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stage: 'reflecting' }),
    }).catch(() => null);
    await startReflection(id);
    const cleanup = connectSSE(id);
    sseCleanupRef.current = cleanup;
  };

  // Use simStatsHistory as fallback for society stats
  const displayStats = societyStats.length > 0 ? societyStats : simStatsHistory;

  const citizenAgents = displayAgents.filter(a => !a.isCentralAgent);
  const aliveCount = citizenAgents.filter(a => a.isAlive).length;

  const avgInitial = (key: 'wealth' | 'health' | 'happiness') =>
    citizenAgents.length === 0 ? 0
      : Math.round(citizenAgents.reduce((s, a) => s + a.initialStats[key], 0) / citizenAgents.length);

  const avgFinal = (key: 'wealth' | 'health' | 'happiness') =>
    citizenAgents.length === 0 ? 0
      : Math.round(citizenAgents.reduce((s, a) => s + a.currentStats[key], 0) / citizenAgents.length);

  const reflectionEntries = Object.entries(agentReflections);

  const toggleAgentExpand = (agentId: string) => {
    if (!agentStatsLoaded && id) loadAgentStats(id);
    setExpandedAgents(prev => {
      const next = new Set(prev);
      if (next.has(agentId)) next.delete(agentId);
      else next.add(agentId);
      return next;
    });
  };

  return (
    <div className="animate-fade-in" style={{ height: 'calc(100vh - 4rem)', display: 'flex', flexDirection: 'column' }}>
      <div className="page-header" style={{ marginBottom: '1rem' }}>
        <h1 className="page-title" style={{ fontSize: '1.5rem' }}>Reflection</h1>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          {/* Skip / Redo button */}
          {isSkipped || isComplete ? (
            <button
              className="btn-secondary"
              onClick={handleRedo}
              disabled={isRunning}
              style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', opacity: isRunning ? 0.5 : 1 }}
              title="Re-run reflection from scratch"
            >
              <RotateCcw size={16} /> Redo
            </button>
          ) : (
            <button
              className="btn-secondary"
              onClick={handleSkip}
              style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}
              title="Skip reflection to save tokens (can redo later)"
            >
              <SkipForward size={16} /> Skip
            </button>
          )}
          <button
            className="btn-primary"
            onClick={async () => {
              if (id) {
                await fetch(`/api/sessions/${id}/stage`, {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ stage: 'reviewing' }),
                }).catch(() => null);
              }
              navigate(`/session/${id}/agents`);
            }}
            disabled={!isComplete && !isSkipped}
            style={{ opacity: isComplete || isSkipped ? 1 : 0.5 }}
          >
            Review Agents <ArrowRight size={18} />
          </button>
        </div>
      </div>

      {/* Running indicator */}
      {isRunning && (
        <div style={{ marginBottom: '1rem', padding: '0.75rem 1rem', background: 'rgba(79, 70, 229, 0.1)', border: '1px solid rgba(79, 70, 229, 0.3)', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '0.75rem', color: 'var(--primary)' }}>
          <Loader2 size={16} style={{ animation: 'spin 1s linear infinite', flexShrink: 0 }} />
          <span>
            {isEvaluating
              ? 'Central Agent evaluating society…'
              : currentPass
                ? `Pass ${currentPass}: collecting agent reflections (${completedCount}/${totalAgents})`
                : 'Starting reflection…'}
          </span>
        </div>
      )}

      {error && (
        <div style={{ marginBottom: '1rem', padding: '0.75rem 1rem', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--danger)' }}>
          <AlertCircle size={16} /> {error}
        </div>
      )}

      <div style={{ display: 'flex', gap: '1.5rem', flex: 1, overflow: 'hidden' }}>

        {/* Left Panel: Society Evaluation Report */}
        <div className="glass-panel" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ padding: '1.5rem', borderBottom: '1px solid var(--glass-border)' }}>
            <h2 style={{ fontSize: '1.25rem', color: 'var(--color-bright)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <FileText size={20} style={{ color: 'var(--primary)' }} /> Society Evaluation
            </h2>
          </div>

          <div style={{ padding: '2rem', overflowY: 'auto', flex: 1, color: 'var(--text-muted)', lineHeight: 1.6 }}>
            {!evaluation && !isRunning && (
              <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-dim)' }}>
                <Loader2 size={32} style={{ marginBottom: '1rem', opacity: 0.4, animation: 'spin 1s linear infinite' }} />
                <p>Waiting for evaluation…</p>
              </div>
            )}

            {isEvaluating && !evaluation && (
              <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-dim)' }}>
                <Loader2 size={32} style={{ marginBottom: '1rem', color: 'var(--primary)', animation: 'spin 1s linear infinite' }} />
                <p>Central Agent is evaluating the simulation…</p>
              </div>
            )}

            {evaluation && (
              <>
                <h3 style={{ color: 'var(--color-bright)', marginBottom: '0.75rem' }}>Overall Verdict</h3>
                <MarkdownText>{evaluation.verdict}</MarkdownText>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', marginBottom: '2rem' }}>
                  <div style={{ background: 'rgba(16, 185, 129, 0.05)', border: '1px solid rgba(16, 185, 129, 0.2)', padding: '1.25rem', borderRadius: '12px' }}>
                    <h4 style={{ color: 'var(--success)', marginBottom: '0.75rem' }}>Strengths</h4>
                    <ul style={{ listStyleType: 'disc', listStylePosition: 'inside', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                      {evaluation.strengths.map((s, i) => <li key={i}>{s}</li>)}
                    </ul>
                  </div>
                  <div style={{ background: 'rgba(239, 68, 68, 0.05)', border: '1px solid rgba(239, 68, 68, 0.2)', padding: '1.25rem', borderRadius: '12px' }}>
                    <h4 style={{ color: 'var(--danger)', marginBottom: '0.75rem' }}>Weaknesses</h4>
                    <ul style={{ listStyleType: 'disc', listStylePosition: 'inside', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                      {evaluation.weaknesses.map((w, i) => <li key={i}>{w}</li>)}
                    </ul>
                  </div>
                </div>

                <h3 style={{ color: 'var(--color-bright)', marginBottom: '0.75rem' }}>Final Statistics</h3>
                <div style={{ display: 'flex', gap: '1rem', marginBottom: '2rem' }}>
                  {(['wealth', 'health', 'happiness'] as const).map(stat => (
                    <div key={stat} style={{ flex: 1, background: 'var(--panel-alpha-05)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--glass-border)', textAlign: 'center' }}>
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-dim)', textTransform: 'uppercase', marginBottom: '0.5rem', letterSpacing: '0.05em' }}>{stat}</div>
                      <div style={{ fontSize: '1.1rem', fontWeight: 'bold', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
                        {avgInitial(stat)} → {avgFinal(stat)}
                        <StatDelta initial={avgInitial(stat)} final={avgFinal(stat)} />
                      </div>
                    </div>
                  ))}
                </div>

                <div style={{ display: 'flex', gap: '1rem', marginBottom: '2rem' }}>
                  <div style={{ flex: 1, background: 'var(--panel-alpha-05)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--glass-border)', textAlign: 'center' }}>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-dim)', textTransform: 'uppercase', marginBottom: '0.5rem', letterSpacing: '0.05em' }}>Survivors</div>
                    <div style={{ fontSize: '1.1rem', fontWeight: 'bold' }}>
                      {aliveCount} / {citizenAgents.length}
                      {aliveCount < citizenAgents.length && (
                        <span style={{ color: 'var(--danger)', fontSize: '0.85rem', marginLeft: '0.5rem' }}>({citizenAgents.length - aliveCount} died)</span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Society Trend Graph */}
                <h3 style={{ color: 'var(--color-bright)', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <BarChart2 size={18} style={{ color: 'var(--primary)' }} /> Society Trend
                </h3>
                <div style={{ background: 'var(--panel-alpha-05)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--glass-border)', marginBottom: '2rem' }}>
                  {displayStats.length > 1 ? (
                    <LineChart
                      series={[
                        { label: 'Wealth', color: 'var(--warning)', data: displayStats.map(s => s.avgWealth ?? 0) },
                        { label: 'Health', color: 'var(--success)', data: displayStats.map(s => s.avgHealth ?? 0), yRange: [0, 100] },
                        { label: 'Happiness', color: 'var(--chart-indigo)', data: displayStats.map(s => s.avgHappiness ?? 0), yRange: [0, 100] },
                      ]}
                      xLabels={displayStats.map(s => String(s.iterationNumber))}
                      height={240}
                      splitAxes
                    />
                  ) : (
                    <div style={{ color: 'var(--text-dim)', fontSize: '0.9rem', textAlign: 'center', padding: '2rem 1rem' }}>
                      <AlertCircle size={20} style={{ opacity: 0.5, marginBottom: '0.5rem' }} />
                      <div>No iteration data available.</div>
                      <div style={{ fontSize: '0.8rem', marginTop: '0.5rem', opacity: 0.7 }}>
                        {displayStats.length === 0
                          ? 'The simulation produced no iterations — likely an early failure (e.g., LLM provider was unreachable).'
                          : 'Need at least 2 iterations to render a trend.'}
                      </div>
                    </div>
                  )}
                </div>

                <h3 style={{ color: 'var(--color-bright)', marginBottom: '0.75rem' }}>Analysis</h3>
                <MarkdownText>{evaluation.analysis}</MarkdownText>
              </>
            )}
          </div>
        </div>

        {/* Right Panel: Agent Reflections */}
        <div className="glass-panel" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ padding: '1.5rem', borderBottom: '1px solid var(--glass-border)', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <h2 style={{ fontSize: '1.1rem', color: 'var(--color-bright)' }}>Agent Reflections</h2>
            {isComplete && (
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.85rem', color: 'var(--success)' }}>
                <CheckCircle size={14} /> Complete
              </span>
            )}
            {isRunning && (
              <span style={{ fontSize: '0.85rem', color: 'var(--text-dim)' }}>
                {completedCount}/{totalAgents}
              </span>
            )}
          </div>

          <div style={{ padding: '1.5rem', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {reflectionEntries.length === 0 && !isRunning && (
              <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-dim)' }}>
                <p>Reflections will appear here…</p>
              </div>
            )}

            {reflectionEntries.map(([agentId, data]) => {
              const agent = displayAgents.find(a => a.id === agentId);
              const agentName = agent?.name ?? agentId;
              const agentRole = agent?.role ?? '';
              const isExpanded = expandedAgents.has(agentId);
              const agentHistory = agentStatsMap[agentId]?.history;

              return (
                <div key={agentId} style={{ padding: '1rem', background: 'var(--panel-alpha-02)', border: '1px solid var(--glass-border)', borderRadius: '12px' }}>
                  {/* Header with name and expand button */}
                  <div style={{ color: 'var(--color-bright)', fontWeight: 'bold', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    {agentName}
                    {agentRole && <span className="badge badge-neutral" style={{ fontWeight: 'normal' }}>{agentRole}</span>}
                    {agent && !agent.isAlive && <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>†</span>}
                    <button
                      onClick={() => toggleAgentExpand(agentId)}
                      style={{
                        marginLeft: 'auto',
                        background: 'none',
                        border: '1px solid var(--glass-border)',
                        borderRadius: '6px',
                        padding: '0.2rem 0.5rem',
                        color: 'var(--text-dim)',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.25rem',
                        fontSize: '0.75rem',
                      }}
                      title="Toggle agent statistics"
                    >
                      <BarChart2 size={12} />
                      {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                    </button>
                  </div>

                  {/* Expandable stats graph */}
                  <div style={{
                    overflow: 'hidden',
                    transition: 'max-height 0.3s ease-in-out, opacity 0.3s ease-in-out',
                    maxHeight: isExpanded ? '280px' : '0',
                    opacity: isExpanded ? 1 : 0,
                  }}>
                    {isExpanded && agentHistory && agentHistory.length > 1 ? (
                      <div style={{ background: 'var(--panel-alpha-05)', padding: '0.75rem', borderRadius: '8px', border: '1px solid var(--glass-border)', marginBottom: '0.75rem' }}>
                        <LineChart
                          series={[
                            { label: 'Wealth', color: 'var(--warning)', data: agentHistory.map(h => h.wealth) },
                            { label: 'Health', color: 'var(--success)', data: agentHistory.map(h => h.health), yRange: [0, 100] },
                            { label: 'Happiness', color: 'var(--chart-indigo)', data: agentHistory.map(h => h.happiness), yRange: [0, 100] },
                          ]}
                          xLabels={agentHistory.map(h => String(h.iter))}
                          height={200}
                          splitAxes
                        />
                      </div>
                    ) : isExpanded ? (
                      <div style={{ padding: '0.75rem', color: 'var(--text-dim)', fontSize: '0.8rem', marginBottom: '0.75rem' }}>
                        <Loader2 size={14} style={{ animation: 'spin 1s linear infinite', display: 'inline', marginRight: '0.5rem' }} />
                        Loading stats…
                      </div>
                    ) : null}
                  </div>

                  {data.pass1 && (
                    <div style={{ marginBottom: data.pass2 ? '0.75rem' : 0 }}>
                      <span style={{ fontSize: '0.75rem', color: 'var(--primary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Personal perspective</span>
                      {/* whiteSpace: pre-wrap preserves the \n\n separator the
                          backend uses to append the "What went well: …" suffix
                          from the pass1_best schema slot. Without it, the
                          paragraph break collapses to a single space. */}
                      <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginTop: '0.4rem', fontStyle: 'italic', whiteSpace: 'pre-wrap' }}>
                        "{data.pass1}"
                      </p>
                    </div>
                  )}

                  {data.pass2 && (
                    <div>
                      <span style={{ fontSize: '0.75rem', color: 'var(--success)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>After seeing the full picture</span>
                      <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginTop: '0.4rem', fontStyle: 'italic', whiteSpace: 'pre-wrap' }}>
                        "{data.pass2}"
                      </p>
                    </div>
                  )}
                </div>
              );
            })}

            {/* Skeleton cards while loading */}
            {isRunning && currentPass === 1 && Array.from({ length: Math.max(0, (totalAgents || 3) - completedCount) }).map((_, i) => (
              <div key={`skeleton-${i}`} style={{ padding: '1rem', background: 'var(--panel-alpha-02)', border: '1px solid var(--glass-border)', borderRadius: '12px', opacity: 0.4 }}>
                <div style={{ height: '1rem', background: 'var(--glass-border)', borderRadius: '4px', width: '40%', marginBottom: '0.75rem' }} />
                <div style={{ height: '0.75rem', background: 'var(--glass-border)', borderRadius: '4px', width: '90%', marginBottom: '0.4rem' }} />
                <div style={{ height: '0.75rem', background: 'var(--glass-border)', borderRadius: '4px', width: '70%' }} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Reflection;
