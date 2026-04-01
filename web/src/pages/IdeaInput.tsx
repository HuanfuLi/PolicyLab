import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Sparkles } from 'lucide-react';
import { useSessionsStore } from '../stores/sessionsStore';

const IdeaInput = () => {
  const [idea, setIdea] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const { createSession } = useSessionsStore();

  const presets = [
    "A society where everyone shares all resources equitably.",
    "A pure free-market libertarian city state.",
    "An AI Technocracy where algorithms make all policy.",
    "A neo-medieval feudal society with digital serfs."
  ];

  const handleBegin = async () => {
    if (idea.trim().length < 10) return;
    setSubmitting(true);
    setError(null);
    try {
      const id = await createSession(idea.trim());
      navigate(`/session/${id}/brainstorm`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create session');
      setSubmitting(false);
    }
  };

  return (
    <div className="animate-fade-in" style={{
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      paddingBottom: '10vh'
    }}>

      <div style={{ textAlign: 'center', marginBottom: '3rem' }}>
        <h1 style={{
          fontSize: '3rem',
          fontWeight: 'bold',
          marginBottom: '1rem',
          background: 'linear-gradient(135deg, var(--color-bright) 0%, var(--primary) 100%)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '1rem'
        }}>
          <Sparkles size={36} color="var(--primary)" /> PolicyLab
        </h1>
        <p style={{ fontSize: '1.25rem', color: 'var(--text-muted)' }}>
          Describe the society you want to simulate.
        </p>
      </div>

      <div className="glass-card" style={{ width: '100%', maxWidth: '700px', padding: '2rem' }}>
        <textarea
          className="input-glass"
          style={{
            minHeight: '200px',
            resize: 'vertical',
            fontSize: '1.1rem',
            lineHeight: '1.6',
          }}
          placeholder="e.g., A sprawling cyberpunk metropolis where..."
          value={idea}
          onChange={(e) => setIdea(e.target.value)}
          autoFocus
          disabled={submitting}
        />

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', marginTop: '1.5rem' }}>
          {presets.map((p, i) => (
            <button
              key={i}
              className="btn-secondary"
              style={{ fontSize: '0.85rem', padding: '0.5rem 1rem', borderRadius: '20px' }}
              onClick={() => setIdea(p)}
              disabled={submitting}
            >
              {p.split(' ').slice(0, 3).join(' ')}...
            </button>
          ))}
        </div>

        {error && (
          <div style={{ marginTop: '1rem', color: 'var(--danger)', fontSize: '0.9rem' }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '3rem' }}>
          <span style={{ fontSize: '0.85rem', color: idea.length >= 10 ? 'var(--success)' : 'var(--text-dim)' }}>
            min 10 characters · {idea.length}/10
          </span>
          <button
            className="btn-primary"
            disabled={idea.trim().length < 10 || submitting}
            onClick={handleBegin}
            style={{ opacity: idea.trim().length < 10 || submitting ? 0.5 : 1 }}
          >
            {submitting ? 'Creating...' : 'Begin Brainstorming'} <ArrowRight size={18} />
          </button>
        </div>
      </div>

    </div>
  );
};

export default IdeaInput;
