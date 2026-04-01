import React, { useState, useRef, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Send, CheckSquare, Square, Bot, Loader2, AlertCircle, RefreshCw, Check, Circle, Sparkles } from 'lucide-react';
import { useSessionDetailStore } from '../stores/sessionDetailStore';
import MarkdownText from '../components/MarkdownText';

const STEPS = [
  { key: 'overview' as const, label: 'Society Overview' },
  { key: 'law' as const, label: 'Virtual Law' },
  { key: 'agents' as const, label: 'Agent Roster' },
];

const CHECKLIST_LABELS = [
  { key: 'governance' as const, label: 'Governance' },
  { key: 'economy' as const, label: 'Economy' },
  { key: 'legal' as const, label: 'Legal' },
  { key: 'culture' as const, label: 'Culture' },
  { key: 'infrastructure' as const, label: 'Infrastructure' },
];

const Brainstorming = () => {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const chatEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const hasAutoSent = useRef(false);
  const lastLoadedId = useRef<string | null>(null);
  const [input, setInput] = useState('');

  const {
    session,
    brainstormMessages,
    loading,
    chatPending,
    designProgress,
    error,
    loadSession,
    sendBrainstormMessage,
    startDesignGeneration,
    reset,
  } = useSessionDetailStore();

  useEffect(() => {
    if (!id) return;
    // Guard against StrictMode double-invocation: only run once per unique id.
    // useRef persists across the simulated unmount/remount, so this correctly
    // allows re-loading when the id genuinely changes while skipping the extra
    // StrictMode call for the same id.
    if (lastLoadedId.current === id) return;
    lastLoadedId.current = id;
    reset();
    hasAutoSent.current = false;
    loadSession(id);
  }, [id]);

  // Auto-send the idea as the opening message to kick off brainstorming
  useEffect(() => {
    if (hasAutoSent.current) return;
    if (!session || !id || chatPending || loading) return;
    if (brainstormMessages.length > 0) return; // already has messages
    if (session.stage !== 'idea-input' && session.stage !== 'brainstorming') return;
    hasAutoSent.current = true;
    sendBrainstormMessage(id, session.idea);
  }, [session, brainstormMessages.length, chatPending, loading, id]);

  // Redirect if already past brainstorming stage
  useEffect(() => {
    if (!session) return;
    if (session.stage === 'design-review' || session.stage === 'refining' || session.stage === 'simulating' || session.stage === 'reflecting' || session.stage === 'completed') {
      navigate(`/session/${id}/design`, { replace: true });
    }
  }, [session?.stage]);

  // Auto-navigate when design generation completes
  useEffect(() => {
    if (session?.stage === 'design-review' && !designProgress.active) {
      navigate(`/session/${id}/design`, { replace: true });
    }
  }, [session?.stage, designProgress.active]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [brainstormMessages, chatPending]);

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

  const handleSend = async () => {
    if (!input.trim() || chatPending || !id) return;
    const text = input.trim();
    setInput('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    await sendBrainstormMessage(id, text);
  };

  const handleStartDesign = async () => {
    if (!id) return;
    await startDesignGeneration(id);
  };

  const checklist = session?.config?.checklist;
  const readyForDesign = session?.config?.readyForDesign ?? false;
  const isDesigning = session?.stage === 'designing' || designProgress.active || !!designProgress.error;

  if (loading && !session) {
    return (
      <div className="animate-fade-in" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh' }}>
        <Loader2 size={32} className="animate-spin" style={{ color: 'var(--primary)' }} />
      </div>
    );
  }

  return (
    <div className="animate-fade-in" style={{ height: 'calc(100vh - 4rem)', display: 'flex', flexDirection: 'column' }}>
      <div className="page-header" style={{ marginBottom: '1rem' }}>
        <h1 className="page-title" style={{ fontSize: '1.5rem' }}>Brainstorming</h1>
        <div className="badge badge-info"><Bot size={14} /> Central Agent</div>
      </div>

      <div className="glass-panel" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {isDesigning ? (
          /* Design Generation Progress Overlay */
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '2rem', padding: '2rem' }}>
            <h2 style={{ fontSize: '1.4rem', color: 'var(--color-bright)' }}>Generating your society design...</h2>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', width: '320px' }}>
              {STEPS.map(step => {
                const isDone = designProgress.completedSteps.includes(step.key);
                const isCurrent = designProgress.currentStep === step.key;
                return (
                  <div key={step.key} style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '0.75rem 1rem', borderRadius: '8px', background: 'var(--panel-alpha-05)', border: '1px solid var(--glass-border)' }}>
                    {isDone ? (
                      <Check size={20} style={{ color: 'var(--success)', flexShrink: 0 }} />
                    ) : isCurrent ? (
                      <Loader2 size={20} style={{ color: 'var(--primary)', flexShrink: 0, animation: 'spin 1s linear infinite' }} />
                    ) : (
                      <Circle size={20} style={{ color: 'var(--text-dim)', flexShrink: 0 }} />
                    )}
                    <span style={{ color: isDone ? 'var(--success)' : isCurrent ? 'var(--color-bright)' : 'var(--text-muted)' }}>
                      {step.label}
                    </span>
                  </div>
                );
              })}
            </div>

            {designProgress.error && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem', color: 'var(--danger)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <AlertCircle size={18} />
                  <span>{designProgress.error}</span>
                </div>
                <button className="btn-secondary" onClick={handleStartDesign} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <RefreshCw size={16} /> Retry
                </button>
              </div>
            )}
          </div>
        ) : (
          <>
            {/* Chat Area */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '2rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              {brainstormMessages.length === 0 && (
                <div style={{ textAlign: 'center', color: 'var(--text-dim)', marginTop: '4rem' }}>
                  <Sparkles size={48} style={{ marginBottom: '1rem', opacity: 0.4 }} />
                  <p>The Central Agent is reviewing your idea…</p>
                  <p style={{ fontSize: '0.85rem', marginTop: '0.5rem', color: 'var(--text-dim)' }}>
                    <em>"{session?.idea}"</em>
                  </p>
                </div>
              )}

              {brainstormMessages.map((msg, idx) => (
                <div key={msg.id ?? idx} style={{
                  display: 'flex',
                  flexDirection: msg.role === 'user' ? 'row-reverse' : 'row',
                  gap: '1rem',
                  alignItems: 'flex-start'
                }}>
                  <div style={{
                    width: '36px', height: '36px', borderRadius: '50%',
                    background: msg.role === 'user' ? 'var(--primary)' : 'var(--panel-alpha-10)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexShrink: 0, fontSize: '1.1rem'
                  }}>
                    {msg.role === 'user' ? '👤' : '🤖'}
                  </div>
                  <div style={{
                    background: msg.role === 'user' ? 'rgba(79, 70, 229, 0.2)' : 'var(--panel-alpha-05)',
                    border: '1px solid',
                    borderColor: msg.role === 'user' ? 'rgba(79, 70, 229, 0.4)' : 'var(--glass-border)',
                    padding: '1rem',
                    borderRadius: '12px',
                    borderTopRightRadius: msg.role === 'user' ? 0 : '12px',
                    borderTopLeftRadius: msg.role === 'assistant' ? 0 : '12px',
                    maxWidth: '75%',
                    lineHeight: 1.5
                  }}>
                    {msg.role === 'assistant' ? (
                      <MarkdownText>{msg.content}</MarkdownText>
                    ) : (
                      <span style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</span>
                    )}
                  </div>
                </div>
              ))}

              {chatPending && (
                <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-start' }}>
                  <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: 'var(--panel-alpha-10)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    🤖
                  </div>
                  <div style={{ background: 'var(--panel-alpha-05)', border: '1px solid var(--glass-border)', padding: '1rem', borderRadius: '12px', borderTopLeftRadius: 0, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
                    Central Agent is thinking…
                  </div>
                </div>
              )}

              {error && (
                <div style={{ color: 'var(--danger)', display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.75rem' }}>
                  <AlertCircle size={16} /> {error}
                </div>
              )}

              <div ref={chatEndRef} />
            </div>

            {/* Input Area */}
            <div style={{ padding: '1.5rem', borderTop: '1px solid var(--glass-border)', background: 'var(--panel-dark-20)' }}>
              <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem' }}>
                <textarea
                  ref={textareaRef}
                  className="input-glass"
                  placeholder="Type your response... (Shift+Enter for new line)"
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
                  style={{ width: '50px', justifyContent: 'center', padding: 0 }}
                >
                  <Send size={18} />
                </button>
                {readyForDesign && (
                  <button
                    className="btn-primary animate-fade-in"
                    onClick={handleStartDesign}
                    style={{ whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: '0.5rem' }}
                  >
                    <Bot size={16} /> Start Design
                  </button>
                )}
              </div>

              <div style={{ display: 'flex', gap: '1.5rem', color: 'var(--text-dim)', fontSize: '0.85rem', flexWrap: 'wrap' }}>
                {CHECKLIST_LABELS.map(({ key, label }) => {
                  const done = checklist?.[key] ?? false;
                  return (
                    <span key={key} style={{ color: done ? 'var(--success)' : 'var(--text-dim)', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                      {done ? <CheckSquare size={14} /> : <Square size={14} />} {label}
                    </span>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default Brainstorming;
