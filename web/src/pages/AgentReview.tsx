import React, { useState, useRef, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Send, CheckCircle, Loader2, ChevronDown, ChevronUp } from 'lucide-react';
import { useReflectionStore } from '../stores/reflectionStore';
import { useSessionDetailStore } from '../stores/sessionDetailStore';
import MarkdownText from '../components/MarkdownText';
import type { Agent } from '@policylab/shared';

interface ChatMsg {
  role: 'user' | 'agent';
  content: string;
}

function getAgentHealthColor(agent: Agent): string {
  if (!agent.isAlive) return 'var(--text-dim)';
  if (agent.currentStats.health < 30) return 'var(--danger)';
  if (agent.currentStats.health < 60) return 'var(--warning)';
  return 'var(--success)';
}

const AgentReview = () => {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const chatEndRef = useRef<HTMLDivElement>(null);
  const [activeAgentId, setActiveAgentId] = useState<string | null>(null);
  const [chatsByAgent, setChatsByAgent] = useState<Record<string, ChatMsg[]>>({});
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [search, setSearch] = useState('');

  const { agents, agentReflections, loadAgents, loadReflections } = useReflectionStore();
  const { loadSession } = useSessionDetailStore();

  const loadChatHistory = async (agentId: string) => {
    if (!id) return;
    try {
      const res = await fetch(`/api/sessions/${id}/review/${agentId}/messages`);
      if (!res.ok) return;
      const data = await res.json() as { messages: Array<{ role: string; content: string }> };
      setChatsByAgent(prev => ({
        ...prev,
        [agentId]: data.messages
          .filter(m => m.role === 'user' || m.role === 'assistant')
          .map(m => ({ role: m.role === 'assistant' ? 'agent' : 'user', content: m.content })),
      }));
    } catch { /* ignore */ }
  };

  useEffect(() => {
    if (!id) return;
    loadAgents(id);
    loadReflections(id);
    loadSession(id);

    // Auto-mark session as completed when visiting the review stage
    fetch(`/api/sessions/${id}`).then(r => r.json()).then((s: { stage?: string }) => {
      if (s.stage && s.stage !== 'completed' && s.stage !== 'reviewing') {
        fetch(`/api/sessions/${id}/stage`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ stage: 'completed' }),
        }).catch(() => null);
      }
    }).catch(() => null);
  }, [id]);

  // Pre-select first alive agent
  useEffect(() => {
    if (!activeAgentId && agents.length > 0) {
      const citizens = agents.filter(a => !a.isCentralAgent);
      const first = citizens.find(a => a.isAlive) ?? citizens[0];
      if (first) {
        setActiveAgentId(first.id);
        loadChatHistory(first.id);
      }
    }
  }, [agents]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatsByAgent, activeAgentId]);

  const handleSelectAgent = (agentId: string) => {
    setActiveAgentId(agentId);
    setInput('');
    if (!chatsByAgent[agentId]) {
      loadChatHistory(agentId);
    }
  };

  const handleSend = async () => {
    if (!input.trim() || sending || !activeAgentId || !id) return;
    const text = input.trim();
    setInput('');
    setSending(true);

    // Optimistically add user message
    setChatsByAgent(prev => ({
      ...prev,
      [activeAgentId]: [...(prev[activeAgentId] ?? []), { role: 'user', content: text }],
    }));

    try {
      const res = await fetch(`/api/sessions/${id}/review/${activeAgentId}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
      });
      if (res.ok) {
        const data = await res.json() as { reply: string };
        setChatsByAgent(prev => ({
          ...prev,
          [activeAgentId]: [...(prev[activeAgentId] ?? []), { role: 'agent', content: data.reply }],
        }));
      }
    } catch { /* ignore */ }

    setSending(false);
  };

  const citizenAgents = agents.filter(a => !a.isCentralAgent);
  const aliveAgents = citizenAgents.filter(a => a.isAlive);
  const deceasedAgents = citizenAgents.filter(a => !a.isAlive);

  const filterAgents = (list: Agent[]) =>
    search.trim() === ''
      ? list
      : list.filter(a =>
        a.name.toLowerCase().includes(search.toLowerCase()) ||
        a.role.toLowerCase().includes(search.toLowerCase())
      );

  const activeAgent = agents.find(a => a.id === activeAgentId);
  const currentMessages = activeAgentId ? (chatsByAgent[activeAgentId] ?? []) : [];
  const activeReflection = activeAgentId ? agentReflections[activeAgentId] : null;

  const handleEndSession = async () => {
    if (!id) return;
    // Session is already auto-completed on page load; just navigate home
    await fetch(`/api/sessions/${id}/stage`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stage: 'completed' }),
    }).catch(() => null);
    navigate('/');
  };

  return (
    <div className="animate-fade-in" style={{ height: 'calc(100vh - 4rem)', display: 'flex', flexDirection: 'column' }}>
      <div className="page-header" style={{ marginBottom: '1rem' }}>
        <h1 className="page-title" style={{ fontSize: '1.5rem' }}>Agent Review</h1>
        <button className="btn-secondary" style={{ color: 'var(--success)' }} onClick={handleEndSession}>
          <CheckCircle size={18} /> Finish & Go Home
        </button>
      </div>

      <div className="glass-panel" style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

        {/* Left Sidebar: Agent List */}
        <div style={{ width: '280px', borderRight: '1px solid var(--glass-border)', display: 'flex', flexDirection: 'column', background: 'var(--panel-dark-20)', flexShrink: 0 }}>
          <div style={{ padding: '1rem', borderBottom: '1px solid var(--glass-border)' }}>
            <input
              type="text"
              placeholder="Search agents…"
              className="input-glass"
              style={{ padding: '0.5rem 1rem' }}
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>

          <div style={{ flex: 1, overflowY: 'auto' }}>
            {filterAgents(aliveAgents).length > 0 && (
              <>
                <div style={{ padding: '0.6rem 1rem', fontSize: '0.75rem', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.05em', background: 'var(--panel-alpha-02)' }}>
                  Alive ({aliveAgents.length})
                </div>
                {filterAgents(aliveAgents).map(agent => (
                  <div
                    key={agent.id}
                    onClick={() => handleSelectAgent(agent.id)}
                    style={{
                      padding: '0.75rem 1rem', display: 'flex', alignItems: 'center', gap: '0.75rem',
                      cursor: 'pointer',
                      background: activeAgentId === agent.id ? 'var(--panel-alpha-05)' : 'transparent',
                      borderLeft: activeAgentId === agent.id ? '3px solid var(--primary)' : '3px solid transparent',
                    }}
                  >
                    <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: getAgentHealthColor(agent), flexShrink: 0 }} />
                    <div>
                      <div style={{ color: activeAgentId === agent.id ? 'var(--color-bright)' : 'var(--text-muted)', fontSize: '0.9rem' }}>{agent.name}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>{agent.role}</div>
                    </div>
                  </div>
                ))}
              </>
            )}

            {filterAgents(deceasedAgents).length > 0 && (
              <>
                <div style={{ padding: '0.6rem 1rem', fontSize: '0.75rem', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.05em', background: 'var(--panel-alpha-02)' }}>
                  Deceased ({deceasedAgents.length})
                </div>
                {filterAgents(deceasedAgents).map(agent => (
                  <div
                    key={agent.id}
                    onClick={() => handleSelectAgent(agent.id)}
                    style={{
                      padding: '0.75rem 1rem', display: 'flex', alignItems: 'center', gap: '0.75rem',
                      cursor: 'pointer', opacity: 0.6,
                      background: activeAgentId === agent.id ? 'var(--panel-alpha-05)' : 'transparent',
                      borderLeft: activeAgentId === agent.id ? '3px solid var(--text-dim)' : '3px solid transparent',
                    }}
                  >
                    <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: 'var(--text-dim)', flexShrink: 0 }} />
                    <div>
                      <div style={{ color: activeAgentId === agent.id ? 'var(--color-bright)' : 'var(--text-muted)', fontSize: '0.9rem' }}>{agent.name}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>{agent.role}</div>
                    </div>
                  </div>
                ))}
              </>
            )}

            {agents.length === 0 && (
              <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-dim)', fontSize: '0.9rem' }}>
                Loading agents…
              </div>
            )}
          </div>
        </div>

        {/* Right Area */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {activeAgent ? (
            <>
              {/* Header */}
              <div style={{ padding: '1.25rem 2rem', borderBottom: '1px solid var(--glass-border)', display: 'flex', alignItems: 'center', gap: '1rem', flexShrink: 0 }}>
                <h2 style={{ fontSize: '1.1rem', color: 'var(--color-bright)' }}>{activeAgent.name}</h2>
                <span className="badge badge-neutral">{activeAgent.role}</span>
                {!activeAgent.isAlive && <span style={{ fontSize: '0.8rem', color: 'var(--text-dim)' }}>Deceased</span>}
                <div style={{ marginLeft: 'auto', display: 'flex', gap: '1.5rem', fontSize: '0.8rem', color: 'var(--text-dim)' }}>
                  <span>W:{Math.round(activeAgent.currentStats.wealth)}</span>
                  <span>H:{Math.round(activeAgent.currentStats.health)}</span>
                  <span>Hap:{Math.round(activeAgent.currentStats.happiness)}</span>
                </div>
              </div>

              {/* Expandable reflection strip */}
              {activeReflection?.pass1 && (
                <ReflectionStrip reflection={activeReflection} />
              )}

              {/* Chat Messages */}
              <div style={{ flex: 1, overflowY: 'auto', padding: '2rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                {currentMessages.length === 0 && (
                  <div style={{ textAlign: 'center', color: 'var(--text-dim)', padding: '3rem' }}>
                    <p style={{ marginBottom: '0.5rem' }}>Ask {activeAgent.name.split(' ')[0]} about their experience…</p>
                    <p style={{ fontSize: '0.8rem' }}>They'll respond from their perspective as {activeAgent.role}.</p>
                  </div>
                )}

                {currentMessages.map((msg, idx) => (
                  <div key={idx} style={{
                    display: 'flex',
                    flexDirection: msg.role === 'user' ? 'row-reverse' : 'row',
                    gap: '1rem',
                    alignItems: 'flex-start',
                  }}>
                    <div style={{
                      width: '36px', height: '36px', borderRadius: '50%',
                      background: msg.role === 'user' ? 'var(--primary)' : 'var(--panel-alpha-10)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.1rem', flexShrink: 0,
                    }}>
                      {msg.role === 'user' ? '👤' : '😶'}
                    </div>
                    <div style={{
                      background: msg.role === 'user' ? 'rgba(79, 70, 229, 0.2)' : 'var(--panel-alpha-05)',
                      border: '1px solid',
                      borderColor: msg.role === 'user' ? 'rgba(79, 70, 229, 0.4)' : 'var(--glass-border)',
                      padding: '1rem',
                      borderRadius: '12px',
                      borderTopRightRadius: msg.role === 'user' ? 0 : '12px',
                      borderTopLeftRadius: msg.role === 'agent' ? 0 : '12px',
                      maxWidth: '75%',
                      whiteSpace: 'pre-wrap',
                      lineHeight: 1.5,
                      color: 'var(--text-main)',
                    }}>
                      {msg.role === 'agent' ? (
                        <MarkdownText>{msg.content}</MarkdownText>
                      ) : (
                        <span style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</span>
                      )}
                    </div>
                  </div>
                ))}

                {sending && (
                  <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-start' }}>
                    <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: 'var(--panel-alpha-10)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.1rem', flexShrink: 0 }}>😶</div>
                    <div style={{ background: 'var(--panel-alpha-05)', border: '1px solid var(--glass-border)', padding: '1rem', borderRadius: '12px', borderTopLeftRadius: 0, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
                      {activeAgent.name.split(' ')[0]} is thinking…
                    </div>
                  </div>
                )}

                <div ref={chatEndRef} />
              </div>

              {/* Input */}
              <div style={{ padding: '1.5rem 2rem', borderTop: '1px solid var(--glass-border)', background: 'var(--panel-dark-20)', flexShrink: 0 }}>
                <div style={{ display: 'flex', gap: '1rem' }}>
                  <input
                    type="text"
                    className="input-glass"
                    placeholder={`Ask ${activeAgent.name.split(' ')[0]} a question…`}
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && !sending && handleSend()}
                    disabled={sending}
                  />
                  <button
                    className="btn-primary"
                    onClick={handleSend}
                    disabled={sending || !input.trim()}
                    style={{ width: '50px', justifyContent: 'center', padding: 0 }}
                  >
                    <Send size={18} />
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-dim)' }}>
              Select an agent to begin the interview
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

function ReflectionStrip({ reflection }: { reflection: { pass1: string; pass2: string | null } }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div style={{
      borderBottom: '1px solid var(--glass-border)',
      background: 'var(--panel-alpha-02)',
      overflow: 'hidden',
      transition: 'max-height 0.3s ease-in-out',
      maxHeight: expanded ? '300px' : '3rem',
    }}>
      <div
        style={{
          padding: '0.75rem 2rem',
          fontSize: '0.85rem',
          color: 'var(--text-muted)',
          fontStyle: 'italic',
          display: 'flex',
          alignItems: 'flex-start',
          gap: '0.5rem',
          cursor: 'pointer',
        }}
        onClick={() => setExpanded(e => !e)}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <span style={{ color: 'var(--primary)', fontSize: '0.75rem', textTransform: 'uppercase', marginRight: '0.5rem', fontStyle: 'normal' }}>Reflected:</span>
          {!expanded && (
            <>"{reflection.pass1.slice(0, 150)}{reflection.pass1.length > 150 ? '…' : ''}"</>
          )}
        </div>
        <button
          style={{
            background: 'none', border: 'none', color: 'var(--primary)', cursor: 'pointer',
            padding: '0', flexShrink: 0, display: 'flex', alignItems: 'center',
          }}
          aria-label={expanded ? 'Collapse reflection' : 'Expand reflection'}
        >
          {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
      </div>
      {expanded && (
        <div style={{
          padding: '0 2rem 0.75rem',
          maxHeight: '240px',
          overflowY: 'auto',
          fontSize: '0.85rem',
          color: 'var(--text-muted)',
          fontStyle: 'italic',
          lineHeight: 1.6,
        }}>
          <p style={{ marginBottom: reflection.pass2 ? '0.75rem' : 0 }}>"{reflection.pass1}"</p>
          {reflection.pass2 && (
            <>
              <span style={{ color: 'var(--success)', fontSize: '0.75rem', textTransform: 'uppercase', fontStyle: 'normal' }}>After seeing the full picture:</span>
              <p style={{ marginTop: '0.25rem' }}>"{reflection.pass2}"</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default AgentReview;
