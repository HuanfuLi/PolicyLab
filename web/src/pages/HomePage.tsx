import React, { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Trash2, Play, Users, Clock, Download, Upload } from 'lucide-react';
import { useSessionsStore } from '../stores/sessionsStore';
import type { SessionMetadata, SessionStage } from '@policylab/shared';

const stageRoutes: Record<SessionStage, string> = {
  'idea-input': '/session/:id/idea',
  'brainstorming': '/session/:id/brainstorm',
  'designing': '/session/:id/brainstorm',
  'design-review': '/session/:id/design',
  'refining': '/session/:id/design',
  'simulating': '/session/:id/simulation',
  'simulation-paused': '/session/:id/simulation',
  'simulation-complete': '/session/:id/simulation',
  'reflecting': '/session/:id/reflection',
  'reflection-complete': '/session/:id/reflection',
  'reviewing': '/session/:id/agents',
  'completed': '/session/:id/agents',
};

const stageBadge: Record<SessionStage, { label: string; cls: string }> = {
  'idea-input': { label: 'Idea', cls: 'badge-info' },
  'brainstorming': { label: 'Brainstorming', cls: 'badge-warning' },
  'designing': { label: 'Designing', cls: 'badge-warning' },
  'design-review': { label: 'Design Review', cls: 'badge-warning' },
  'refining': { label: 'Refining', cls: 'badge-warning' },
  'simulating': { label: 'Simulating', cls: 'badge-warning' },
  'simulation-paused': { label: 'Paused', cls: 'badge-warning' },
  'simulation-complete': { label: 'Sim Complete', cls: 'badge-info' },
  'reflecting': { label: 'Reflecting', cls: 'badge-warning' },
  'reflection-complete': { label: 'Reflected', cls: 'badge-info' },
  'reviewing': { label: 'Reviewing', cls: 'badge-info' },
  'completed': { label: '✓ Completed', cls: 'badge-success' },
};

function getResumeRoute(session: SessionMetadata): string {
  const template = stageRoutes[session.stage] ?? '/session/:id/idea';
  return template.replace(':id', session.id);
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

const HomePage = () => {
  const navigate = useNavigate();
  const { sessions, loading, error, loadSessions, deleteSession, importSession } = useSessionsStore();
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadSessions();
  }, []);

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!window.confirm('Delete this session? This cannot be undone.')) return;
    try {
      await deleteSession(id);
    } catch (err) {
      alert(`Failed to delete session: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  };

  const handleExport = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    window.location.href = `/api/sessions/${id}/export`;
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = ''; // reset so same file can be re-imported
    try {
      const id = await importSession(file);
      navigate(`/session/${id}/idea`);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Import failed');
    }
  };

  return (
    <div className="animate-fade-in">
      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        style={{ display: 'none' }}
        onChange={handleImportFile}
      />
      <div className="page-header">
        <h1 className="page-title">Your Societies</h1>
        <div style={{ display: 'flex', gap: '1rem' }}>
          <button className="btn-secondary" onClick={handleImportClick}>
            <Upload size={18} /> Import Session
          </button>
          <button className="btn-primary" onClick={() => navigate('/session/new/idea')}>
            <Plus size={18} /> New Session
          </button>
        </div>
      </div>

      {error && (
        <div style={{ color: 'var(--danger)', marginBottom: '1rem', padding: '1rem', background: 'rgba(239,68,68,0.1)', borderRadius: '8px' }}>
          {error}
        </div>
      )}

      {loading && sessions.length === 0 && (
        <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '3rem' }}>
          Loading sessions...
        </div>
      )}

      {!loading && sessions.length === 0 && !error && (
        <div className="glass-card" style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', padding: '4rem', textAlign: 'center'
        }}>
          <p style={{ color: 'var(--text-muted)', fontSize: '1.1rem', marginBottom: '1.5rem' }}>
            No sessions yet. Create your first society.
          </p>
          <button className="btn-primary" onClick={() => navigate('/session/new/idea')}>
            <Plus size={18} /> New Session
          </button>
        </div>
      )}

      {sessions.length > 0 && (
        <div className="dashboard-grid">
          {sessions.filter(s => s.stage !== 'idea-input').map(session => {
            const badge = stageBadge[session.stage] ?? { label: session.stage, cls: 'badge-info' };
            const resumeRoute = getResumeRoute(session);
            return (
              <div key={session.id} className="glass-card">
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
                  <h3 style={{ fontSize: '1.1rem', color: 'var(--color-bright)', flex: 1, marginRight: '1rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {session.title}
                  </h3>
                  <span className={`badge ${badge.cls}`}>{badge.label}</span>
                </div>
                <p className="text-muted" style={{ marginBottom: '1.5rem', minHeight: '48px', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                  "{session.idea}"
                </p>
                <div style={{ display: 'flex', gap: '1.5rem', marginBottom: '1.5rem', fontSize: '0.9rem', color: 'var(--text-dim)' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <Users size={16} /> {session.agentCount} agents
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <Clock size={16} /> {session.completedIterations} iter
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-dim)' }}>
                    {formatDate(session.createdAt)}
                  </span>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button
                      className="btn-secondary"
                      style={{ padding: '0.5rem' }}
                      onClick={() => navigate(resumeRoute)}
                      title="Resume"
                    >
                      <Play size={16} />
                    </button>
                    <button
                      className="btn-secondary"
                      style={{ padding: '0.5rem' }}
                      title="Export session"
                      onClick={(e) => handleExport(e, session.id)}
                    >
                      <Download size={16} />
                    </button>
                    <button
                      className="btn-secondary"
                      style={{ padding: '0.5rem', color: 'var(--danger)' }}
                      title="Delete"
                      onClick={(e) => handleDelete(e, session.id)}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}

          <div
            className="glass-card"
            style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center',
              justifyContent: 'center', cursor: 'pointer', borderStyle: 'dashed',
              textAlign: 'center', minHeight: '220px'
            }}
            onClick={() => navigate('/session/new/idea')}
          >
            <div style={{
              background: 'var(--glass-bg)', padding: '1rem', borderRadius: '50%',
              marginBottom: '1rem', color: 'var(--primary)'
            }}>
              <Plus size={32} />
            </div>
            <h3 style={{ color: 'var(--color-bright)', marginBottom: '0.5rem' }}>New Session</h3>
            <p className="text-muted" style={{ fontSize: '0.9rem' }}>Click to design a new society</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default HomePage;
