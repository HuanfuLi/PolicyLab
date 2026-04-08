import React, { useState, useEffect, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { Search, FileText, Download, Copy, FolderOpen, Loader2, CheckCircle } from 'lucide-react';
import MarkdownText from '../components/MarkdownText';

interface ArtifactItem {
  id: string;
  type: string;
  title: string;
  content: string;
  generatedAt: string;
  timestamp: string;
  agentId?: string;
  iterationNumber?: number;
}

// ── Grouping ─────────────────────────────────────────────────────────────────

interface ArtifactGroup {
  label: string;
  types: string[];
}

const GROUPS: ArtifactGroup[] = [
  { label: 'Design', types: ['brainstorming-transcript', 'society-overview', 'virtual-law', 'agent-roster', 'refinement-transcript'] },
  { label: 'Simulation', types: ['iteration-summary'] },
  { label: 'Reflection', types: ['society-evaluation', 'agent-reflection'] },
  { label: 'Q&A', types: ['qa-transcript'] },
];



// ── Main component ───────────────────────────────────────────────────────────

const Artifacts = () => {
  const { id } = useParams<{ id: string }>();
  const [artifacts, setArtifacts] = useState<ArtifactItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    fetch(`/api/sessions/${id}/artifacts`)
      .then(r => r.json())
      .then((data: { artifacts: ArtifactItem[] }) => {
        setArtifacts(data.artifacts ?? []);
        if (data.artifacts?.length > 0) setActiveId(data.artifacts[0].id);
      })
      .catch(() => { /* ignore */ })
      .finally(() => setLoading(false));
  }, [id]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return artifacts;
    return artifacts.filter(a =>
      a.title.toLowerCase().includes(q) || a.content.toLowerCase().includes(q)
    );
  }, [artifacts, search]);

  const activeArtifact = artifacts.find(a => a.id === activeId) ?? null;

  const handleCopy = () => {
    if (!activeArtifact) return;
    navigator.clipboard.writeText(activeArtifact.content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleExport = () => {
    if (!activeArtifact) return;
    const blob = new Blob([activeArtifact.content], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${activeArtifact.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Group the filtered list
  const groupedItems = GROUPS.map(group => ({
    ...group,
    items: filtered.filter(a => group.types.includes(a.type)),
  })).filter(g => g.items.length > 0);

  // Items that don't belong to any group
  const ungrouped = filtered.filter(a => !GROUPS.some(g => g.types.includes(a.type)));

  return (
    <div className="animate-fade-in" style={{ height: 'calc(100vh - 4rem)', display: 'flex', flexDirection: 'column' }}>
      <div className="page-header" style={{ marginBottom: '1rem' }}>
        <h1 className="page-title" style={{ fontSize: '1.5rem' }}>Session Artifacts</h1>
        <span style={{ fontSize: '0.85rem', color: 'var(--text-dim)' }}>{artifacts.length} documents</span>
      </div>

      <div className="glass-panel" style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

        {/* Left Sidebar: Document Tree */}
        <div style={{ width: '280px', borderRight: '1px solid var(--glass-border)', display: 'flex', flexDirection: 'column', background: 'var(--panel-dark-20)', flexShrink: 0 }}>
          <div style={{ padding: '1rem', borderBottom: '1px solid var(--glass-border)' }}>
            <div style={{ position: 'relative' }}>
              <Search size={14} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-dim)' }} />
              <input
                type="text"
                placeholder="Search artifacts…"
                className="input-glass"
                style={{ padding: '0.5rem 1rem 0.5rem 2.25rem', fontSize: '0.85rem' }}
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
          </div>

          <div style={{ flex: 1, overflowY: 'auto' }}>
            {loading && (
              <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-dim)' }}>
                <Loader2 size={20} style={{ animation: 'spin 1s linear infinite', marginBottom: '0.5rem' }} />
                <div style={{ fontSize: '0.85rem' }}>Loading…</div>
              </div>
            )}

            {!loading && artifacts.length === 0 && (
              <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-dim)', fontSize: '0.85rem' }}>
                <p>No artifacts yet.</p>
                <p style={{ marginTop: '0.5rem' }}>Artifacts are generated as you progress through the simulation.</p>
              </div>
            )}

            {!loading && groupedItems.map(group => (
              <div key={group.label}>
                <div style={{ padding: '0.75rem 1rem 0.4rem', color: 'var(--primary)', display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.06em', background: 'var(--panel-alpha-02)' }}>
                  <FolderOpen size={14} /> {group.label}
                </div>
                {group.items.map(artifact => (
                  <div
                    key={artifact.id}
                    onClick={() => setActiveId(artifact.id)}
                    style={{
                      padding: '0.5rem 1rem 0.5rem 1.5rem',
                      cursor: 'pointer',
                      display: 'flex', alignItems: 'center', gap: '0.5rem',
                      background: activeId === artifact.id ? 'var(--panel-alpha-05)' : 'transparent',
                      borderLeft: activeId === artifact.id ? '3px solid var(--primary)' : '3px solid transparent',
                      color: activeId === artifact.id ? 'var(--color-bright)' : 'var(--text-muted)',
                      fontSize: '0.85rem',
                    }}
                  >
                    <FileText size={14} style={{ flexShrink: 0 }} />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{artifact.title}</span>
                  </div>
                ))}
              </div>
            ))}

            {!loading && ungrouped.map(artifact => (
              <div
                key={artifact.id}
                onClick={() => setActiveId(artifact.id)}
                style={{
                  padding: '0.5rem 1rem',
                  cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: '0.5rem',
                  background: activeId === artifact.id ? 'var(--panel-alpha-05)' : 'transparent',
                  borderLeft: activeId === artifact.id ? '3px solid var(--primary)' : '3px solid transparent',
                  color: activeId === artifact.id ? 'var(--color-bright)' : 'var(--text-muted)',
                  fontSize: '0.85rem',
                }}
              >
                <FileText size={14} style={{ flexShrink: 0 }} />
                <span>{artifact.title}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Right Area: Document Viewer */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {activeArtifact ? (
            <>
              <div style={{ padding: '1.25rem 2rem', borderBottom: '1px solid var(--glass-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
                <div>
                  <h2 style={{ fontSize: '1.1rem', color: 'var(--color-bright)' }}>{activeArtifact.title}</h2>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-dim)', marginTop: '0.2rem' }}>
                    Generated during: {activeArtifact.generatedAt.replace(/-/g, ' ')}
                    {activeArtifact.timestamp && ` · ${new Date(activeArtifact.timestamp).toLocaleString()}`}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '0.75rem' }}>
                  <button className="btn-secondary" style={{ padding: '0.4rem 0.9rem', display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem' }} onClick={handleCopy}>
                    {copied ? <CheckCircle size={14} style={{ color: 'var(--success)' }} /> : <Copy size={14} />}
                    {copied ? 'Copied!' : 'Copy'}
                  </button>
                  <button className="btn-primary" style={{ padding: '0.4rem 0.9rem', display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem' }} onClick={handleExport}>
                    <Download size={14} /> Export .md
                  </button>
                </div>
              </div>

              <div style={{ flex: 1, overflowY: 'auto', padding: '2rem 3rem', lineHeight: 1.8 }}>
                <MarkdownText>{activeArtifact.content}</MarkdownText>
              </div>
            </>
          ) : (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-dim)', flexDirection: 'column', gap: '0.5rem' }}>
              <FileText size={40} style={{ opacity: 0.3 }} />
              <p>{loading ? 'Loading artifacts…' : 'Select a document from the list'}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Artifacts;
