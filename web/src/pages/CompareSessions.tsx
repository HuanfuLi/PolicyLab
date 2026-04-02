import React, { useEffect, useRef, useState } from 'react';
import { ArrowRight, CheckSquare, Square, MessageSquare, Send, Users, Clock } from 'lucide-react';
import { useCompareStore } from '../stores/compareStore';
import MarkdownText from '../components/MarkdownText';
import type { SessionMetadata, ComparisonDimension, EconomyParamDiff } from '@policylab/shared';

const stageBadge: Record<string, { label: string; cls: string }> = {
  'completed': { label: '✓ Completed', cls: 'badge-success' },
  'reviewing': { label: 'Reviewing', cls: 'badge-info' },
  'reflection-complete': { label: 'Reflected', cls: 'badge-info' },
};

function ScoreBar({ score, color }: { score: number; color: string }) {
  return (
    <div style={{ flex: 1, background: 'var(--panel-alpha-05)', borderRadius: '4px', overflow: 'hidden', height: '8px' }}>
      <div style={{ width: `${score}%`, height: '100%', background: color, borderRadius: '4px', transition: 'width 0.5s ease' }} />
    </div>
  );
}

function DimensionRow({ dim, idx }: { dim: ComparisonDimension; idx: number }) {
  const [open, setOpen] = useState(false);
  const colors = ['var(--primary)', 'var(--warning)'];

  return (
    <div style={{ borderBottom: '1px solid var(--glass-border)', paddingBottom: '0.75rem', marginBottom: '0.75rem' }}>
      <div
        style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', cursor: 'pointer', marginBottom: '0.5rem' }}
        onClick={() => setOpen(o => !o)}
      >
        <span style={{ width: '180px', color: 'var(--color-bright)', fontSize: '0.9rem', flexShrink: 0 }}>{dim.name}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flex: 1 }}>
          <span style={{ color: colors[0], fontWeight: 'bold', fontSize: '0.85rem', width: '32px', textAlign: 'right' }}>{dim.score1}</span>
          <ScoreBar score={dim.score1} color={colors[0]} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flex: 1 }}>
          <span style={{ color: colors[1], fontWeight: 'bold', fontSize: '0.85rem', width: '32px', textAlign: 'right' }}>{dim.score2}</span>
          <ScoreBar score={dim.score2} color={colors[1]} />
        </div>
      </div>
      {open && (
        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', lineHeight: 1.6, margin: 0, paddingLeft: '180px' }}>
          <MarkdownText>{dim.analysis}</MarkdownText>
        </p>
      )}
    </div>
  );
}

function ConfigDiffSection({ diffs, session1Title, session2Title }: {
  diffs: EconomyParamDiff[];
  session1Title: string;
  session2Title: string;
}) {
  return (
    <div style={{
      background: 'var(--panel-alpha-05)',
      borderRadius: 12,
      padding: '20px 24px',
      marginBottom: 24,
      border: '1px solid var(--glass-border)',
    }}>
      <h3 style={{ margin: '0 0 16px', color: 'var(--primary)', fontSize: 16 }}>
        Configuration Differences
      </h3>
      <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 16 }}>
        These economic parameters were changed between the two sessions.
      </p>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--glass-border)' }}>
            <th style={{ textAlign: 'left', padding: '8px 12px', color: 'var(--text-muted)' }}>Parameter</th>
            <th style={{ textAlign: 'right', padding: '8px 12px', color: 'var(--text-muted)' }}>{session1Title}</th>
            <th style={{ textAlign: 'right', padding: '8px 12px', color: 'var(--text-muted)' }}>{session2Title}</th>
          </tr>
        </thead>
        <tbody>
          {diffs.map(d => (
            <tr key={d.param} style={{ borderBottom: '1px solid var(--glass-border)' }}>
              <td style={{ padding: '8px 12px' }}>{d.label}</td>
              <td style={{ textAlign: 'right', padding: '8px 12px', fontFamily: 'monospace' }}>
                {typeof d.session1Value === 'boolean' ? (d.session1Value ? 'Yes' : 'No') : d.session1Value}
              </td>
              <td style={{ textAlign: 'right', padding: '8px 12px', fontFamily: 'monospace' }}>
                {typeof d.session2Value === 'boolean' ? (d.session2Value ? 'Yes' : 'No') : d.session2Value}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SVGLineChart({ title, iterations }: { title: string, iterations: any[] }) {
  if (!iterations || iterations.length === 0) return (
    <div style={{ flex: 1, background: 'var(--panel-alpha-05)', borderRadius: '8px', padding: '1rem', textAlign: 'center', color: 'var(--text-dim)', fontSize: '0.85rem' }}>
      No metric history available for {title}
    </div>
  );

  const width = 400;
  const height = 150;
  const padUrl = 20;

  const x = (i: number) => padUrl + (i / Math.max(1, iterations.length - 1)) * (width - 2 * padUrl);
  const y = (val: number) => height - padUrl - (val / 100) * (height - 2 * padUrl);

  const pointsWealth = iterations.map((it, i) => `${x(i)},${y(it.statistics?.avgWealth || 50)}`).join(' ');
  const pointsHealth = iterations.map((it, i) => `${x(i)},${y(it.statistics?.avgHealth || 50)}`).join(' ');
  const pointsHappiness = iterations.map((it, i) => `${x(i)},${y(it.statistics?.avgHappiness || 50)}`).join(' ');

  return (
    <div style={{ flex: 1, background: 'var(--panel-alpha-05)', borderRadius: '8px', padding: '1rem' }}>
      <h4 style={{ margin: '0 0 1rem 0', fontSize: '0.9rem', color: 'var(--color-bright)', textAlign: 'center' }}>
        {title} Metrics Over Time
      </h4>
      <svg width="100%" viewBox={`0 0 ${width} ${height}`} style={{ overflow: 'visible' }}>
        <g stroke="var(--glass-border)" strokeWidth="1">
          <line x1={padUrl} y1={y(0)} x2={width - padUrl} y2={y(0)} />
          <line x1={padUrl} y1={y(50)} x2={width - padUrl} y2={y(50)} strokeDasharray="4,4" />
          <line x1={padUrl} y1={y(100)} x2={width - padUrl} y2={y(100)} />
        </g>
        <polyline points={pointsWealth} fill="none" style={{ stroke: 'var(--success)' }} strokeWidth="2" />
        <polyline points={pointsHealth} fill="none" style={{ stroke: 'var(--danger)' }} strokeWidth="2" />
        <polyline points={pointsHappiness} fill="none" style={{ stroke: 'var(--chart-sapphire)' }} strokeWidth="2" />
      </svg>
      <div style={{ display: 'flex', justifyContent: 'center', gap: '1rem', marginTop: '0.5rem', fontSize: '0.75rem' }}>
        <span style={{ color: 'var(--success)', display: 'flex', alignItems: 'center', gap: '0.2rem' }}>● Wealth</span>
        <span style={{ color: 'var(--danger)', display: 'flex', alignItems: 'center', gap: '0.2rem' }}>● Health</span>
        <span style={{ color: 'var(--chart-sapphire)', display: 'flex', alignItems: 'center', gap: '0.2rem' }}>● Happiness</span>
      </div>
    </div>
  );
}

function SessionCard({ session, selected, eligible, onToggle }: {
  session: SessionMetadata;
  selected: boolean;
  eligible: boolean;
  onToggle: () => void;
}) {
  const badge = stageBadge[session.stage];
  return (
    <div
      onClick={eligible ? onToggle : undefined}
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: '1rem',
        padding: '0.75rem 1rem',
        background: selected ? 'var(--panel-alpha-05)' : 'transparent',
        borderRadius: '8px',
        cursor: eligible ? 'pointer' : 'not-allowed',
        border: selected ? '1px solid var(--primary)' : '1px solid transparent',
        opacity: eligible ? 1 : 0.45,
        transition: 'all 0.15s',
      }}
    >
      <div style={{ marginTop: '2px', color: selected ? 'var(--primary)' : 'var(--text-muted)', flexShrink: 0 }}>
        {selected ? <CheckSquare size={18} /> : <Square size={18} />}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.25rem' }}>
          <strong style={{ color: 'var(--color-bright)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {session.title}
          </strong>
          {badge && <span className={`badge ${badge.cls}`} style={{ fontSize: '0.75rem' }}>{badge.label}</span>}
          {!eligible && <span style={{ color: 'var(--text-dim)', fontSize: '0.8rem' }}>(not completed)</span>}
        </div>
        <div style={{ display: 'flex', gap: '1rem', fontSize: '0.8rem', color: 'var(--text-dim)' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}><Users size={13} /> {session.agentCount}</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}><Clock size={13} /> {session.completedIterations} iter</span>
        </div>
      </div>
    </div>
  );
}

const CompareSessions = () => {
  const {
    allSessions, selectedIds, comparison, messages, history, session1Iterations, session2Iterations,
    loading, chatPending, error,
    loadSessions, loadHistory, selectHistoryItem, toggleSession, runComparison, sendMessage,
  } = useCompareStore();

  const [chatInput, setChatInput] = useState('');
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => { loadSessions(); loadHistory(); }, []);
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const completedSessions = allSessions.filter(
    s => s.stage === 'completed' || s.stage === 'reviewing' || s.stage === 'reflection-complete'
  );

  const handleChat = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = chatInput.trim();
    if (!text || chatPending) return;
    setChatInput('');
    await sendMessage(text);
  };

  const selected1 = selectedIds[0] ? allSessions.find(s => s.id === selectedIds[0]) : null;
  const selected2 = selectedIds[1] ? allSessions.find(s => s.id === selectedIds[1]) : null;

  return (
    <div className="animate-fade-in" style={{ maxWidth: '1000px', margin: '0 auto', paddingBottom: '3rem' }}>
      <div className="page-header" style={{ marginBottom: '2rem' }}>
        <h1 className="page-title">Compare Sessions</h1>
      </div>

      {/* Session selection */}
      <div className="glass-card" style={{ marginBottom: '2rem' }}>
        <h3 style={{ fontSize: '1rem', marginBottom: '1rem', color: 'var(--text-muted)' }}>
          Select exactly 2 completed sessions to compare
          {selectedIds.length > 0 && (
            <span style={{ color: 'var(--primary)', marginLeft: '0.75rem' }}>
              ({selectedIds.length}/2 selected)
            </span>
          )}
        </h3>

        {allSessions.length === 0 && (
          <p style={{ color: 'var(--text-dim)', textAlign: 'center', padding: '2rem' }}>
            No sessions found. Create and complete a session first.
          </p>
        )}

        {completedSessions.length < 2 && allSessions.length > 0 && (
          <p style={{ color: 'var(--text-dim)', marginBottom: '1rem', fontSize: '0.9rem' }}>
            You need at least 2 completed sessions to compare. Only completed, reviewing, or reflected sessions are eligible.
          </p>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', marginBottom: '1.5rem' }}>
          {allSessions.filter(s => s.stage !== 'idea-input').map(session => {
            const eligible = session.stage === 'completed' || session.stage === 'reviewing' || session.stage === 'reflection-complete';
            const selected = selectedIds.includes(session.id);
            const disabled = !selected && selectedIds.length === 2;
            return (
              <SessionCard
                key={session.id}
                session={session}
                selected={selected}
                eligible={eligible && !disabled}
                onToggle={() => toggleSession(session.id)}
              />
            );
          })}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button
            className="btn-primary"
            disabled={selectedIds.length !== 2 || loading}
            onClick={runComparison}
          >
            {loading ? 'Analysing...' : 'Generate Comparison'} <ArrowRight size={18} />
          </button>
        </div>
      </div>

      {/* Historical comparisons */}
      <div className="glass-card" style={{ marginBottom: '2rem' }}>
        <h3 style={{ fontSize: '1rem', marginBottom: '1rem', color: 'var(--text-muted)' }}>Historical Comparisons</h3>
        {history.length === 0 ? (
          <p style={{ color: 'var(--text-dim)', textAlign: 'center', padding: '1rem', fontSize: '0.9rem' }}>No past reports found.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            {history.map(item => {
              const s1 = allSessions.find(s => s.id === item.comparison.session1Id)?.title || 'Society A';
              const s2 = allSessions.find(s => s.id === item.comparison.session2Id)?.title || 'Society B';
              const isSelected = !!comparison && comparison.session1Id === item.comparison.session1Id && comparison.session2Id === item.comparison.session2Id;
              return (
                <div
                  key={item.id}
                  onClick={() => selectHistoryItem(item.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.75rem 1rem',
                    background: isSelected ? 'var(--panel-alpha-05)' : 'transparent',
                    border: isSelected ? '1px solid var(--primary)' : '1px solid transparent',
                    borderRadius: '8px', cursor: 'pointer', transition: 'all 0.15s'
                  }}
                >
                  <Clock size={16} color={isSelected ? "var(--primary)" : "var(--text-dim)"} />
                  <div style={{ flex: 1 }}>
                    <div style={{ color: isSelected ? 'var(--primary)' : 'var(--color-bright)', fontSize: '0.9rem' }}>{s1} vs {s2}</div>
                    <div style={{ color: 'var(--text-dim)', fontSize: '0.75rem' }}>{new Date(item.timestamp).toLocaleString()}</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Error */}
      {error && !loading && (
        <div style={{ color: 'var(--danger)', padding: '1rem', background: 'rgba(239,68,68,0.1)', borderRadius: '8px', marginBottom: '2rem' }}>
          {error}
        </div>
      )}

      {/* Loading spinner */}
      {loading && (
        <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
          <p>The Central Agent is analysing both societies…</p>
        </div>
      )}

      {/* Results */}
      {comparison && !loading && (
        <>
          <h2 style={{ fontSize: '1.25rem', marginBottom: '1.5rem', color: 'var(--color-bright)' }}>
            Comparison Report
          </h2>

          {/* Side-by-side stat cards */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', marginBottom: '2rem' }}>
            {[selected1, selected2].map((s, idx) => s && (
              <div key={s.id} className="glass-card" style={{ borderTop: `4px solid ${idx === 0 ? 'var(--primary)' : 'var(--warning)'}` }}>
                <h3 style={{ fontSize: '1.1rem', color: 'var(--color-bright)', marginBottom: '1rem', textAlign: 'center' }}>
                  {idx === 0 ? 'Society A' : 'Society B'}: {s.title}
                </h3>
                <div style={{ display: 'flex', gap: '1.5rem', justifyContent: 'center', fontSize: '0.85rem', color: 'var(--text-dim)' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}><Users size={14} /> {s.agentCount} agents</span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}><Clock size={14} /> {s.completedIterations} iter</span>
                </div>
              </div>
            ))}
          </div>

          {/* Configuration Differences */}
          {comparison.economyParamDiffs && comparison.economyParamDiffs.length > 0 && (
            <ConfigDiffSection
              diffs={comparison.economyParamDiffs}
              session1Title={selected1?.title ?? 'Session A'}
              session2Title={selected2?.title ?? 'Session B'}
            />
          )}

          {/* Dimensions */}
          <div className="glass-card" style={{ marginBottom: '2rem' }}>
            <h3 style={{ fontSize: '1rem', color: 'var(--color-bright)', marginBottom: '1.25rem' }}>
              Dimensions
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginLeft: '1rem', fontWeight: 'normal' }}>
                (click to expand analysis)
              </span>
            </h3>
            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', paddingLeft: '180px' }}>
              <div style={{ flex: 1, textAlign: 'center', fontSize: '0.8rem', color: 'var(--primary)' }}>Society A</div>
              <div style={{ flex: 1, textAlign: 'center', fontSize: '0.8rem', color: 'var(--warning)' }}>Society B</div>
            </div>
            {comparison.dimensions.map((dim, idx) => (
              <DimensionRow key={dim.name} dim={dim} idx={idx} />
            ))}

            <div style={{ display: 'flex', gap: '1.5rem', marginTop: '2rem', flexWrap: 'wrap' }}>
              <SVGLineChart title={selected1?.title || 'Society A'} iterations={session1Iterations} />
              <SVGLineChart title={selected2?.title || 'Society B'} iterations={session2Iterations} />
            </div>
          </div>

          {/* Narrative */}
          <div className="glass-panel" style={{ padding: '1.5rem', marginBottom: '2rem' }}>
            <h3 style={{ fontSize: '1rem', color: 'var(--color-bright)', marginBottom: '1rem' }}>Central Analysis</h3>
            <MarkdownText>{comparison.narrative}</MarkdownText>
          </div>

          {/* Verdict callout */}
          <div style={{
            padding: '1.25rem 1.5rem',
            background: 'var(--panel-alpha-05)',
            borderLeft: '4px solid var(--primary)',
            borderRadius: '8px',
            marginBottom: '2rem',
          }}>
            <p style={{ color: 'var(--color-bright)', fontWeight: 'bold', marginBottom: '0.25rem' }}>Verdict</p>
            <MarkdownText>{comparison.verdict}</MarkdownText>
          </div>

          {/* Follow-up chat */}
          <div className="glass-card">
            <h3 style={{ fontSize: '1rem', color: 'var(--color-bright)', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <MessageSquare size={18} /> Follow-up Questions
            </h3>

            {messages.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1rem', maxHeight: '320px', overflowY: 'auto' }}>
                {messages.map((msg, idx) => (
                  <div
                    key={idx}
                    style={{
                      padding: '0.75rem 1rem',
                      borderRadius: '8px',
                      background: msg.role === 'user' ? 'var(--panel-alpha-05)' : 'rgba(99,102,241,0.1)',
                      alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
                      maxWidth: '85%',
                    }}
                  >
                    <p style={{ color: msg.role === 'user' ? 'var(--text-main)' : 'var(--color-bright)', fontSize: '0.9rem', lineHeight: 1.6 }}>
                      {msg.role === 'assistant' ? (
                        <MarkdownText>{msg.content}</MarkdownText>
                      ) : (
                        msg.content
                      )}
                    </p>
                  </div>
                ))}
                {chatPending && (
                  <div style={{ padding: '0.75rem 1rem', borderRadius: '8px', background: 'rgba(99,102,241,0.1)', alignSelf: 'flex-start' }}>
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Thinking…</span>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>
            )}

            <form onSubmit={handleChat} style={{ display: 'flex', gap: '0.75rem' }}>
              <input
                type="text"
                className="input-glass"
                placeholder="Ask a follow-up question about these societies…"
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                disabled={chatPending}
                style={{ flex: 1 }}
              />
              <button
                type="submit"
                className="btn-secondary"
                style={{ padding: '0.5rem 1rem' }}
                disabled={!chatInput.trim() || chatPending}
              >
                <Send size={16} />
              </button>
            </form>
          </div>
        </>
      )}
    </div>
  );
};

export default CompareSessions;
