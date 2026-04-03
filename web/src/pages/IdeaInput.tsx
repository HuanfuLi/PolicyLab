import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, ArrowLeft, Sparkles, Globe, Loader, CheckCircle, AlertTriangle, Circle, RotateCcw } from 'lucide-react';
import { useSessionsStore } from '../stores/sessionsStore';
import { useBootstrapStore } from '../stores/bootstrapStore';
import LocationSearch from '../components/LocationSearch';

const IdeaInput = () => {
  const [idea, setIdea] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'creative' | 'location' | null>(null);
  const navigate = useNavigate();
  const { createSession } = useSessionsStore();

  const bootstrapStore = useBootstrapStore();

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

  const handleStartBootstrap = async () => {
    if (!bootstrapStore.selectedLocation) return;
    setError(null);
    try {
      const locationName = bootstrapStore.selectedLocation.name;
      const id = await createSession(`Mirror: ${locationName}`);
      await bootstrapStore.startBootstrap(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start bootstrap');
    }
  };

  // Navigate to design-review when bootstrap completes
  useEffect(() => {
    if (bootstrapStore.mode === 'complete' && bootstrapStore.sessionId) {
      navigate(`/session/${bootstrapStore.sessionId}/design-review`);
      bootstrapStore.reset();
    }
  }, [bootstrapStore.mode, bootstrapStore.sessionId, navigate, bootstrapStore]);

  const handleBack = () => {
    setMode(null);
    bootstrapStore.reset();
    setError(null);
  };

  const stepLabels: Record<string, string> = {
    geocoding: 'Geocoding location',
    demographics: 'Fetching demographics',
    economics: 'Fetching economic indicators',
    governance: 'Fetching governance data',
    infrastructure: 'Fetching infrastructure data',
    generation: 'Generating simulation',
  };

  const renderStepIcon = (status: string) => {
    switch (status) {
      case 'active':
        return <Loader size={16} style={{ color: 'var(--primary)', animation: 'spin 1s linear infinite' }} />;
      case 'done':
        return <CheckCircle size={16} style={{ color: 'var(--color-green, #22c55e)' }} />;
      case 'fallback':
        return <AlertTriangle size={16} style={{ color: 'var(--color-yellow, #eab308)' }} />;
      default:
        return <Circle size={16} style={{ color: 'var(--text-dim)' }} />;
    }
  };

  // Mode selection screen
  if (mode === null) {
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
            Choose how to design your simulation.
          </p>
        </div>

        <div style={{
          display: 'flex',
          flexDirection: 'row',
          gap: '2rem',
          maxWidth: '800px',
          width: '100%',
        }}>
          <div
            style={{
              flex: 1,
              background: 'var(--bg-card)',
              border: '1px solid var(--border)',
              borderRadius: '12px',
              padding: '2rem',
              cursor: 'pointer',
              transition: 'border-color 0.2s, transform 0.2s',
              textAlign: 'center',
            }}
            onClick={() => setMode('creative')}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--primary)';
              (e.currentTarget as HTMLDivElement).style.transform = 'translateY(-2px)';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--border)';
              (e.currentTarget as HTMLDivElement).style.transform = 'translateY(0)';
            }}
          >
            <Sparkles size={40} color="var(--primary)" style={{ marginBottom: '1rem' }} />
            <h2 style={{ fontSize: '1.3rem', fontWeight: 600, marginBottom: '0.75rem', color: 'var(--text)' }}>
              Describe a Society
            </h2>
            <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>
              Start from your imagination. Describe the society you envision and let AI brainstorm the details.
            </p>
          </div>

          <div
            style={{
              flex: 1,
              background: 'var(--bg-card)',
              border: '1px solid var(--border)',
              borderRadius: '12px',
              padding: '2rem',
              cursor: 'pointer',
              transition: 'border-color 0.2s, transform 0.2s',
              textAlign: 'center',
            }}
            onClick={() => setMode('location')}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--primary)';
              (e.currentTarget as HTMLDivElement).style.transform = 'translateY(-2px)';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--border)';
              (e.currentTarget as HTMLDivElement).style.transform = 'translateY(0)';
            }}
          >
            <Globe size={40} color="var(--primary)" style={{ marginBottom: '1rem' }} />
            <h2 style={{ fontSize: '1.3rem', fontWeight: 600, marginBottom: '0.75rem', color: 'var(--text)' }}>
              Mirror a Real Location
            </h2>
            <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>
              Start from reality. Enter a real-world location and get a simulation calibrated to actual economic data.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Creative mode - existing flow
  if (mode === 'creative') {
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

        <button
          onClick={handleBack}
          style={{
            marginTop: '1.5rem',
            background: 'none',
            border: 'none',
            color: 'var(--text-muted)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            fontSize: '0.9rem',
          }}
        >
          <ArrowLeft size={16} /> Back to mode selection
        </button>
      </div>
    );
  }

  // Location mode
  if (mode === 'location') {
    const isBootstrapping = bootstrapStore.mode === 'bootstrapping';
    const isError = bootstrapStore.mode === 'error';

    // Progress panel during bootstrap
    if (isBootstrapping || isError) {
      return (
        <div className="animate-fade-in" style={{
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          paddingBottom: '10vh'
        }}>
          <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
            <h1 style={{
              fontSize: '2rem',
              fontWeight: 'bold',
              marginBottom: '0.5rem',
              color: 'var(--text)',
            }}>
              {isError ? 'Bootstrap Failed' : 'Building Simulation'}
            </h1>
            {bootstrapStore.selectedLocation && (
              <p style={{ fontSize: '1.1rem', color: 'var(--text-muted)' }}>
                {bootstrapStore.selectedLocation.name}, {bootstrapStore.selectedLocation.country}
              </p>
            )}
          </div>

          <div className="glass-card" style={{ width: '100%', maxWidth: '500px', padding: '2rem' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {bootstrapStore.steps.map((s) => (
                <div
                  key={s.step}
                  className="animate-fade-in"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.75rem',
                    opacity: s.status === 'pending' ? 0.5 : 1,
                    transition: 'opacity 0.3s ease',
                  }}
                >
                  {renderStepIcon(s.status)}
                  <span style={{ color: 'var(--text)', fontSize: '0.95rem' }}>
                    {stepLabels[s.step] || s.step}
                  </span>
                  {s.status === 'fallback' && s.fallbackSource && (
                    <span style={{
                      fontSize: '0.75rem',
                      color: 'var(--color-yellow, #eab308)',
                      marginLeft: 'auto',
                    }}>
                      (using {s.fallbackSource} fallback)
                    </span>
                  )}
                </div>
              ))}
            </div>

            {isError && bootstrapStore.errorMessage && (
              <div style={{
                marginTop: '1.5rem',
                padding: '0.75rem 1rem',
                background: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid var(--danger)',
                borderRadius: '8px',
                color: 'var(--danger)',
                fontSize: '0.9rem',
              }}>
                {bootstrapStore.errorMessage}
              </div>
            )}

            {isError && (
              <div style={{ display: 'flex', gap: '1rem', marginTop: '1.5rem', justifyContent: 'center' }}>
                <button
                  className="btn-secondary"
                  onClick={handleBack}
                  style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
                >
                  <ArrowLeft size={16} /> Back
                </button>
                <button
                  className="btn-primary"
                  onClick={() => {
                    bootstrapStore.reset();
                    // Re-trigger (user needs to fill in location again)
                  }}
                  style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
                >
                  <RotateCcw size={16} /> Retry
                </button>
              </div>
            )}
          </div>
        </div>
      );
    }

    // Location input form
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
            <Globe size={36} color="var(--primary)" /> Mirror a Real Location
          </h1>
          <p style={{ fontSize: '1.25rem', color: 'var(--text-muted)' }}>
            Enter a real-world location to calibrate your simulation.
          </p>
        </div>

        <div className="glass-card" style={{ width: '100%', maxWidth: '700px', padding: '2rem' }}>
          <div style={{ marginBottom: '1.5rem' }}>
            <label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--text)', fontWeight: 500 }}>
              Location
            </label>
            <LocationSearch
              onSelect={(loc) => bootstrapStore.setSelectedLocation(loc)}
              disabled={false}
            />
          </div>

          <div style={{ marginBottom: '1.5rem' }}>
            <label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--text)', fontWeight: 500 }}>
              Agent Count: {bootstrapStore.agentCount}
            </label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
              <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>20</span>
              <input
                type="range"
                min={20}
                max={150}
                value={bootstrapStore.agentCount}
                onChange={(e) => bootstrapStore.setAgentCount(Number(e.target.value))}
                style={{ flex: 1, accentColor: 'var(--primary)' }}
              />
              <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>150</span>
              <input
                type="number"
                min={20}
                max={150}
                value={bootstrapStore.agentCount}
                onChange={(e) => {
                  const val = Math.min(150, Math.max(20, Number(e.target.value) || 20));
                  bootstrapStore.setAgentCount(val);
                }}
                className="input-glass"
                style={{ width: '60px', textAlign: 'center', padding: '0.3rem' }}
              />
            </div>
          </div>

          <div style={{ marginBottom: '1.5rem' }}>
            <label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--text)', fontWeight: 500 }}>
              Policy Scenario (optional)
            </label>
            <textarea
              className="input-glass"
              rows={3}
              placeholder="e.g., What if we raise the minimum wage by 30%? What if we cut defense spending in half?"
              value={bootstrapStore.scenario}
              onChange={(e) => bootstrapStore.setScenario(e.target.value)}
              style={{ fontSize: '1rem', lineHeight: '1.5' }}
            />
          </div>

          {error && (
            <div style={{ marginTop: '1rem', color: 'var(--danger)', fontSize: '0.9rem' }}>
              {error}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '2rem' }}>
            <button
              className="btn-primary"
              disabled={!bootstrapStore.selectedLocation}
              onClick={handleStartBootstrap}
              style={{
                opacity: !bootstrapStore.selectedLocation ? 0.5 : 1,
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
              }}
            >
              Begin Bootstrap <ArrowRight size={18} />
            </button>
          </div>
        </div>

        <button
          onClick={handleBack}
          style={{
            marginTop: '1.5rem',
            background: 'none',
            border: 'none',
            color: 'var(--text-muted)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            fontSize: '0.9rem',
          }}
        >
          <ArrowLeft size={16} /> Back to mode selection
        </button>
      </div>
    );
  }

  return null;
};

export default IdeaInput;
