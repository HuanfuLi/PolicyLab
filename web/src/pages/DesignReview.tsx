import React, { useState, useRef, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Send, FileText, Users, Scale, Play, Loader2, AlertCircle, Bot, GitFork, RefreshCw, SlidersHorizontal } from 'lucide-react';
import { useSessionDetailStore } from '../stores/sessionDetailStore';
import MarkdownText from '../components/MarkdownText';

const LOCKABLE_VARIABLES = [
  { key: 'wealth', label: 'Wealth' },
  { key: 'health', label: 'Health' },
  { key: 'happiness', label: 'Happiness' },
  { key: 'cortisol', label: 'Cortisol' },
  { key: 'dopamine', label: 'Dopamine' },
  { key: 'role', label: 'Role' },
  { key: 'skills', label: 'Skills' },
  { key: 'inventory', label: 'Inventory' },
];

const DesignReview = () => {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const chatEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [activeTab, setActiveTab] = useState<'overview' | 'agents' | 'law'>('overview');
  const [iterations, setIterations] = useState(20);
  const [reviewed, setReviewed] = useState(false);
  const [input, setInput] = useState('');
  const [agentSearch, setAgentSearch] = useState('');
  const [forking, setForking] = useState(false);
  const [showAdvancedControl, setShowAdvancedControl] = useState(false);
  const [lockedVariables, setLockedVariables] = useState<string[]>([]);
  // agentStatEdits: keyed by agentId, stores overridden stat values while the row is being edited
  const [agentStatEdits, setAgentStatEdits] = useState<Record<string, Record<string, number>>>({});

  const {
    session,
    refinementMessages,
    agents,
    loading,
    chatPending,
    error,
    failedMessage,
    loadSession,
    loadAgents,
    sendRefinementMessage,
    retryRefinement,
    startSimulation,
    forkSession,
    updateLockedVariables,
    reset,
  } = useSessionDetailStore();

  useEffect(() => {
    if (!id) return;
    reset();
    loadSession(id);
  }, [id]);

  // Redirect if not in design-review stage
  useEffect(() => {
    if (!session || loading) return;
    if (session.stage === 'brainstorming' || session.stage === 'idea-input' || session.stage === 'designing') {
      navigate(`/session/${id}/brainstorm`, { replace: true });
    }
    // Sync iterations from config
    if (session.config?.totalIterations) {
      setIterations(session.config.totalIterations);
    }
    // Sync locked variables from config
    setLockedVariables(session.config?.lockedVariables ?? []);
  }, [session?.stage, session?.config?.lockedVariables, loading]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [refinementMessages, chatPending]);

  // Handle textarea auto-resize
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    if (!input) {
      el.style.height = 'auto'; // Reset when empty
    } else {
      el.style.height = 'auto';
      // 1.5rem padding + up to 4 lines of 1.25 line height
      el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
    }
  }, [input]);

  // Pre-fill input with failed message so user can edit and resend
  useEffect(() => {
    if (failedMessage && !input) {
      setInput(failedMessage);
    }
  }, [failedMessage]);

  const handleSend = async () => {
    if (!input.trim() || chatPending || !id) return;
    const text = input.trim();
    setInput('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    await sendRefinementMessage(id, text);
  };

  const handleStartSimulation = async () => {
    if (!id) return;
    await startSimulation(id, iterations);
    navigate(`/session/${id}/simulation`);
  };

  const isPastDesign = session && !['design-review', 'refining'].includes(session.stage);

  const handleFork = async () => {
    if (!id || forking) return;
    setForking(true);
    try {
      const newId = await forkSession(id, iterations);
      navigate(`/session/${newId}/design`);
    } catch (err) {
      console.error('Fork failed:', err);
    } finally {
      setForking(false);
    }
  };

  const handleStatSave = async (agentId: string, field: string, value: number) => {
    if (!id) return;
    try {
      await fetch(`/api/sessions/${id}/agents/${agentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: value }),
      });
      await loadAgents(id);
    } catch (err) {
      console.error('Failed to save agent stat:', err);
    }
    // Clear the edit state for this cell
    setAgentStatEdits(prev => {
      const next = { ...prev };
      if (next[agentId]) {
        const fields = { ...next[agentId] };
        delete fields[field];
        if (Object.keys(fields).length === 0) delete next[agentId];
        else next[agentId] = fields;
      }
      return next;
    });
  };

  const handleToggleLock = async (key: string, checked: boolean) => {
    if (!id) return;
    const updated = checked ? [...lockedVariables, key] : lockedVariables.filter(v => v !== key);
    setLockedVariables(updated);
    await updateLockedVariables(id, updated);
  };

  const filteredAgents = agents.filter(a =>
    !agentSearch || a.name.toLowerCase().includes(agentSearch.toLowerCase()) || a.role.toLowerCase().includes(agentSearch.toLowerCase())
  );

  if (loading && !session) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh' }}>
        <Loader2 size={32} style={{ color: 'var(--primary)', animation: 'spin 1s linear infinite' }} />
      </div>
    );
  }

  const tabBtnStyle = (tab: string) => ({
    flex: 1,
    padding: '1rem',
    background: activeTab === tab ? 'var(--panel-alpha-05)' : 'transparent',
    border: 'none',
    color: activeTab === tab ? 'var(--primary)' : 'var(--text-muted)',
    cursor: 'pointer',
    borderBottom: activeTab === tab ? '2px solid var(--primary)' : '2px solid transparent',
    display: 'flex' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: '0.5rem',
  });

  return (
    <div className="animate-fade-in" style={{ height: 'calc(100vh - 4rem)', display: 'flex', flexDirection: 'column' }}>
      <div className="page-header" style={{ marginBottom: '1rem' }}>
        <h1 className="page-title" style={{ fontSize: '1.5rem' }}>
          {session?.title ?? 'Design Review'}
        </h1>
        {session?.timeScale && (
          <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>⏱ {session.timeScale}</span>
        )}
      </div>

      <div style={{ display: 'flex', gap: '1.5rem', flex: 1, overflow: 'hidden' }}>

        {/* Left Side: Documents Panel (~60%) */}
        <div className="glass-panel" style={{ flex: 6, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

          <div style={{ display: 'flex', borderBottom: '1px solid var(--glass-border)', flexShrink: 0 }}>
            <button style={tabBtnStyle('overview')} onClick={() => setActiveTab('overview')}>
              <FileText size={18} /> Overview
            </button>
            <button style={tabBtnStyle('agents')} onClick={() => setActiveTab('agents')}>
              <Users size={18} /> Agents ({agents.length})
            </button>
            <button style={tabBtnStyle('law')} onClick={() => setActiveTab('law')}>
              <Scale size={18} /> Law
            </button>
          </div>

          <div style={{ flex: 1, overflow: 'auto', padding: '1.5rem' }}>
            {activeTab === 'overview' && (
              <div>
                <h2 style={{ color: 'var(--color-bright)', marginBottom: '1rem' }}>{session?.title}</h2>
                {session?.societyOverview ? (
                  <MarkdownText style={{ color: 'var(--text-muted)' }}>
                    {session.societyOverview}
                  </MarkdownText>
                ) : (
                  <p style={{ color: 'var(--text-dim)' }}>No overview available.</p>
                )}
                {session?.timeScale && (
                  <div style={{ marginTop: '1.5rem', padding: '0.75rem 1rem', background: 'var(--panel-alpha-05)', borderRadius: '8px', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                    <strong>Time Scale:</strong> {session.timeScale}
                  </div>
                )}
              </div>
            )}

            {activeTab === 'agents' && (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem', alignItems: 'center' }}>
                  <h3 style={{ fontSize: '1.1rem' }}>Agent Roster ({agents.length} agents)</h3>
                  <input
                    type="text"
                    placeholder="Search by name or role..."
                    className="input-glass"
                    style={{ padding: '0.5rem 1rem', width: '220px' }}
                    value={agentSearch}
                    onChange={e => setAgentSearch(e.target.value)}
                  />
                </div>

                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--glass-border)', color: 'var(--text-muted)' }}>
                      <th style={{ padding: '0.75rem' }}>Name</th>
                      <th style={{ padding: '0.75rem' }}>Role</th>
                      <th style={{ padding: '0.75rem' }}>Wealth</th>
                      <th style={{ padding: '0.75rem' }}>Health</th>
                      <th style={{ padding: '0.75rem' }}>Happy</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredAgents.map(a => {
                      const edits = agentStatEdits[a.id] ?? {};
                      const mkStatCell = (field: 'wealth' | 'health' | 'happiness', baseColor: string, max = 100) => {
                        const persisted = a.initialStats[field] ?? 0;
                        const editVal = edits[field] ?? persisted;
                        return (
                          <td style={{ padding: '0.4rem 0.75rem' }}>
                            <input
                              type="number"
                              value={editVal}
                              min={0}
                              max={max}
                              onChange={e => {
                                const v = Number(e.target.value);
                                setAgentStatEdits(prev => ({
                                  ...prev,
                                  [a.id]: { ...(prev[a.id] ?? {}), [field]: v },
                                }));
                              }}
                              onBlur={e => {
                                const v = Math.min(max, Math.max(0, Number(e.target.value)));
                                if (v !== persisted) handleStatSave(a.id, field, v);
                                else setAgentStatEdits(prev => {
                                  const next = { ...prev };
                                  if (next[a.id]) {
                                    const f = { ...next[a.id] };
                                    delete f[field];
                                    if (Object.keys(f).length === 0) delete next[a.id];
                                    else next[a.id] = f;
                                  }
                                  return next;
                                });
                              }}
                              onKeyDown={e => {
                                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                              }}
                              style={{
                                width: '70px',
                                padding: '0.25rem 0.4rem',
                                background: 'transparent',
                                border: '1px solid transparent',
                                borderRadius: '4px',
                                color: baseColor,
                                fontSize: 'inherit',
                                fontFamily: 'inherit',
                                cursor: 'text',
                                outline: 'none',
                                transition: 'border-color 0.15s',
                              }}
                              onFocus={e => { e.currentTarget.style.borderColor = baseColor; e.currentTarget.style.background = 'var(--panel-alpha-05)'; }}
                              onBlurCapture={e => { e.currentTarget.style.borderColor = 'transparent'; e.currentTarget.style.background = 'transparent'; }}
                            />
                          </td>
                        );
                      };
                      return (
                        <tr key={a.id} style={{ borderBottom: '1px solid var(--glass-border)' }}>
                          <td style={{ padding: '0.75rem' }}>{a.name}</td>
                          <td style={{ padding: '0.75rem', color: 'var(--text-muted)' }}>{a.role}</td>
                          {mkStatCell('wealth', 'var(--warning)', 9999)}
                          {mkStatCell('health', 'var(--success)')}
                          {mkStatCell('happiness', 'var(--primary)')}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>

                {filteredAgents.length === 0 && (
                  <p style={{ color: 'var(--text-dim)', textAlign: 'center', marginTop: '2rem' }}>No agents match your search.</p>
                )}
              </div>
            )}

            {activeTab === 'law' && (
              <div>
                <h2 style={{ color: 'var(--color-bright)', marginBottom: '1rem' }}>Virtual Law</h2>
                {session?.law ? (
                  <MarkdownText style={{ color: 'var(--text-muted)' }}>
                    {session.law}
                  </MarkdownText>
                ) : (
                  <p style={{ color: 'var(--text-dim)' }}>No law available.</p>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Right Side: Refinement Chat (~40%) */}
        <div className="glass-panel" style={{ flex: 4, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ padding: '1rem', borderBottom: '1px solid var(--glass-border)', background: 'var(--panel-dark-10)', flexShrink: 0 }}>
            <h3 style={{ fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Bot size={18} /> Refinement Chat
            </h3>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {refinementMessages.length === 0 && (
              <p style={{ color: 'var(--text-dim)', fontSize: '0.85rem', textAlign: 'center', marginTop: '2rem' }}>
                Ask the Central Agent to make changes to the design.
              </p>
            )}
            {refinementMessages.map((msg, idx) => (
              <div key={msg.id ?? idx} style={{
                background: msg.role === 'user' ? 'rgba(79, 70, 229, 0.2)' : 'var(--panel-alpha-05)',
                border: '1px solid',
                borderColor: msg.role === 'user' ? 'rgba(79, 70, 229, 0.4)' : 'var(--glass-border)',
                padding: '0.75rem 1rem',
                borderRadius: '8px',
                alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
                maxWidth: '85%',
              }}>
                <span style={{ fontSize: '0.8rem', color: msg.role === 'user' ? 'var(--primary)' : 'var(--text-muted)', marginBottom: '0.25rem', display: 'block' }}>
                  {msg.role === 'user' ? 'You' : 'Central Agent'}
                </span>
                <span style={{ whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
                  {msg.role === 'assistant' ? (
                    <MarkdownText>{msg.content}</MarkdownText>
                  ) : (
                    msg.content
                  )}
                </span>
              </div>
            ))}

            {chatPending && (
              <div style={{ background: 'var(--panel-alpha-05)', border: '1px solid var(--glass-border)', padding: '0.75rem 1rem', borderRadius: '8px', alignSelf: 'flex-start', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
                Central Agent is thinking…
              </div>
            )}

            {error && (
              <div style={{ color: 'var(--danger)', display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem' }}>
                <AlertCircle size={14} /> {error}
                {failedMessage && (
                  <button
                    onClick={() => id && retryRefinement(id)}
                    disabled={chatPending}
                    style={{ background: 'none', border: '1px solid var(--danger)', color: 'var(--danger)', padding: '0.25rem 0.5rem', borderRadius: '4px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.8rem' }}
                  >
                    <RefreshCw size={12} /> Retry
                  </button>
                )}
              </div>
            )}

            <div ref={chatEndRef} />
          </div>

          <div style={{ padding: '1rem', borderTop: '1px solid var(--glass-border)', flexShrink: 0 }}>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <textarea
                ref={textareaRef}
                className="input-glass"
                placeholder="Request a change... (Shift+Enter for new line)"
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    if (!chatPending) handleSend();
                  }
                }}
                disabled={chatPending}
                rows={1}
                style={{
                  resize: 'none',
                  overflowY: 'auto',
                  minHeight: '52px',
                  maxHeight: '120px',
                  fontFamily: 'inherit',
                  lineHeight: '1.25',
                }}
              />
              <button
                className="btn-secondary"
                onClick={handleSend}
                disabled={chatPending || !input.trim()}
                style={{ width: '48px', padding: 0, justifyContent: 'center' }}
              >
                <Send size={18} />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Action Bar */}
      <div className="glass-card" style={{ marginTop: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1.5rem' }}>
        {!isPastDesign && (
          <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'center' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', color: reviewed ? 'var(--success)' : 'var(--text-muted)' }}>
              <input
                type="checkbox"
                checked={reviewed}
                onChange={e => setReviewed(e.target.checked)}
                style={{ accentColor: 'var(--success)', width: '18px', height: '18px' }}
              />
              I have reviewed the society design
            </label>
          </div>
        )}
        {isPastDesign && <div />}

        <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ color: 'var(--text-muted)' }}>Iterations:</span>
            <input
              type="number"
              className="input-glass"
              value={iterations}
              onChange={e => setIterations(Math.min(100, Math.max(1, Number(e.target.value))))}
              style={{ width: '80px', padding: '0.5rem' }}
              min={1}
              max={100}
            />
          </div>
          <div style={{ position: 'relative' }}>
            <button
              className="btn-secondary"
              onClick={() => setShowAdvancedControl(v => !v)}
              style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', position: 'relative' }}
            >
              <SlidersHorizontal size={16} />
              Advanced Control
              {lockedVariables.length > 0 && (
                <span style={{ background: 'var(--primary)', color: '#fff', borderRadius: '999px', fontSize: '0.7rem', padding: '0 6px', lineHeight: '18px', minWidth: '18px', textAlign: 'center' }}>
                  {lockedVariables.length}
                </span>
              )}
            </button>
            {showAdvancedControl && (
              <div style={{
                position: 'absolute',
                bottom: 'calc(100% + 8px)',
                right: 0,
                background: 'var(--panel-bg, #1a1a2e)',
                border: '1px solid var(--glass-border)',
                borderRadius: '10px',
                padding: '1rem',
                minWidth: '220px',
                zIndex: 100,
                boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
              }}>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.75rem', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                  Lock Variables
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {LOCKABLE_VARIABLES.map(({ key, label }) => (
                    <label key={key} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', cursor: 'pointer', color: lockedVariables.includes(key) ? 'var(--primary)' : 'var(--text-muted)', fontSize: '0.9rem' }}>
                      <input
                        type="checkbox"
                        checked={lockedVariables.includes(key)}
                        onChange={e => handleToggleLock(key, e.target.checked)}
                        style={{ accentColor: 'var(--primary)', width: '15px', height: '15px' }}
                      />
                      {label}
                    </label>
                  ))}
                </div>
                <div style={{ marginTop: '0.75rem', fontSize: '0.75rem', color: 'var(--text-dim)', lineHeight: 1.4 }}>
                  Locked variables stay fixed at initial values throughout the simulation.
                </div>
              </div>
            )}
          </div>

          {isPastDesign ? (
            <button
              className="btn-primary"
              onClick={handleFork}
              disabled={forking}
              style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
            >
              {forking ? <Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} /> : <GitFork size={18} />}
              Fork & Simulate
            </button>
          ) : (
            <button
              className="btn-primary"
              onClick={handleStartSimulation}
              disabled={!reviewed}
              style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', opacity: reviewed ? 1 : 0.5 }}
            >
              <Play size={18} /> Start Simulation
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default DesignReview;
