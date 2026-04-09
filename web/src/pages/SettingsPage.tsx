import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Server, CheckCircle2, AlertTriangle, Key, XCircle, ToggleLeft, ToggleRight, FlaskConical, Plus, Trash2, Database } from 'lucide-react';
import { useSettingsStore } from '../stores/settingsStore';
import type { AppSettings, ProviderConfig, ProviderConfigResponse, LLMProviderType } from '@policylab/shared';
import PhysicsLaboratory from './PhysicsLaboratory';

type Provider = AppSettings['provider'];

const PROVIDERS: { id: Provider; name: string }[] = [
  { id: 'claude', name: 'Anthropic (Claude)' },
  { id: 'openai', name: 'OpenAI' },
  { id: 'gemini', name: 'Gemini (Google AI Studio)' },
  { id: 'vertex', name: 'Vertex AI (Google Cloud)' },
  { id: 'local', name: 'Local (LM Studio/Ollama)' },
  { id: 'custom', name: 'Custom (OpenAI-compatible)' },
];

const apiKeyPlaceholder: Record<string, string> = {
  claude: 'sk-ant-api03-................................',
  openai: 'sk-...................................',
  gemini: 'AIzaSy.............................',
  vertex: '', // Handled separately
};

const CLAUDE_MODELS = [
  { value: 'claude-opus-4-6', label: 'claude-opus-4-6' },
  { value: 'claude-sonnet-4-6', label: 'claude-sonnet-4-6' },
  { value: 'claude-haiku-4-5-20251001', label: 'claude-haiku-4-5' },
];

const OPENAI_MODELS = [
  { value: 'gpt-5.2', label: 'GPT-5.2' },
  { value: 'gpt-5', label: 'GPT-5' },
  { value: 'gpt-5-mini', label: 'GPT-5 mini' },
  { value: 'gpt-4o', label: 'GPT-4o' },
  { value: 'gpt-4o-mini', label: 'GPT-4o mini' },
  { value: 'o3-mini', label: 'o3-mini' },
];

const GEMINI_MODELS = [
  { value: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro' },
  { value: 'gemini-3-flash-preview', label: 'Gemini 3 Flash' },
  { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
  { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
  { value: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite' },
];

const DEFAULT_CENTRAL: Record<Provider, string> = {
  claude: 'claude-sonnet-4-6',
  openai: 'gpt-5',
  gemini: 'gemini-3-flash-preview',
  vertex: 'gemini-1.5-flash-001',
  local: '',
  custom: '',
};

const DEFAULT_CITIZEN: Record<Provider, string> = {
  claude: 'claude-haiku-4-5-20251001',
  openai: 'gpt-5-mini',
  gemini: 'gemini-2.5-flash-lite',
  vertex: 'gemini-1.5-flash-001',
  local: '',
  custom: '',
};

function getModelOptions(p: Provider) {
  return p === 'claude' ? CLAUDE_MODELS :
    p === 'openai' ? OPENAI_MODELS :
      p === 'gemini' ? GEMINI_MODELS : null;
}

type SavedConfig = {
  apiKey: string;
  centralAgentModel: string;
  citizenAgentModel: string;
  baseUrl?: string;
  vertexProjectId?: string;
  vertexLocation?: string;
};

interface ExtraProviderSlot {
  provider: LLMProviderType;
  apiKey: string;
  hasApiKey: boolean;
  baseUrl: string;
  model: string;
  rateLimit: string; // stored as string for input; empty = unlimited
  vertexProjectId: string;
  vertexLocation: string;
}

const SettingsPage = () => {
  const { settings, testStatus, testMessage, loadSettings, updateSettings, testConnection } = useSettingsStore();

  const [provider, setProvider] = useState<Provider>('claude');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('http://localhost:1234/v1');
  const [vertexProjectId, setVertexProjectId] = useState('');
  const [vertexLocation, setVertexLocation] = useState('');
  const [centralAgentModel, setCentralAgent] = useState('claude-sonnet-4-6');
  const [citizenAgentModel, setCitizenAgent] = useState('claude-haiku-4-5-20251001');
  const [maxConcurrency, setMaxConcurrency] = useState(10);
  const [maxMessageLength, setMaxMessageLength] = useState(64000);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Developer tools
  const [sandboxRunning, setSandboxRunning] = useState(false);
  const [sandboxOutput, setSandboxOutput] = useState<string | null>(null);
  const [sandboxExitCode, setSandboxExitCode] = useState<number | null>(null);

  // Separate citizen provider state
  const [separateCitizen, setSeparateCitizen] = useState(false);
  const [citizenProvider, setCitizenProvider] = useState<Provider>('local');
  const [citizenApiKey, setCitizenApiKey] = useState('');
  const [citizenBaseUrl, setCitizenBaseUrl] = useState('http://localhost:1234/v1');
  const [citizenVertexProjectId, setCitizenVertexProjectId] = useState('');
  const [citizenVertexLocation, setCitizenVertexLocation] = useState('');

  // Extra providers for parallel simulation
  const [extraProviders, setExtraProviders] = useState<ExtraProviderSlot[]>([]);

  // Cache management
  const [cacheStats, setCacheStats] = useState<{ fileCount: number; totalSizeKB: number; countries: string[] } | null>(null);
  const [cacheClearing, setCacheClearing] = useState(false);
  const [cacheClearResult, setCacheClearResult] = useState<string | null>(null);

  const loadCacheStats = useCallback(async () => {
    try {
      const res = await fetch('/api/settings/cache');
      if (res.ok) setCacheStats(await res.json());
    } catch { /* ignore */ }
  }, []);

  const handleClearCache = useCallback(async () => {
    setCacheClearing(true);
    setCacheClearResult(null);
    try {
      const res = await fetch('/api/settings/cache', { method: 'DELETE' });
      if (res.ok) {
        const data = await res.json();
        setCacheClearResult(`Cleared ${data.filesDeleted} cached files`);
        setCacheStats({ fileCount: 0, totalSizeKB: 0, countries: [] });
      }
    } catch {
      setCacheClearResult('Failed to clear cache');
    } finally {
      setCacheClearing(false);
    }
  }, []);

  // Stores per-provider form values so switching back restores what the user entered
  const savedConfigs = useRef<Partial<Record<Provider, SavedConfig>>>({});

  useEffect(() => { loadSettings(); loadCacheStats(); }, []);

  useEffect(() => {
    if (!settings) return;
    setProvider(settings.provider);
    setBaseUrl(settings.baseUrl);
    setCentralAgent(settings.centralAgentModel);
    setCitizenAgent(settings.citizenAgentModel);
    setMaxConcurrency(settings.maxConcurrency);
    setMaxMessageLength(settings.maxMessageLength ?? 64000);
    setVertexProjectId(settings.vertexProjectId ?? '');
    setVertexLocation(settings.vertexLocation ?? '');

    // Seed the saved config for the active provider from server values
    savedConfigs.current[settings.provider] = {
      apiKey: '',
      centralAgentModel: settings.centralAgentModel,
      citizenAgentModel: settings.citizenAgentModel,
      baseUrl: settings.baseUrl,
      vertexProjectId: settings.vertexProjectId,
      vertexLocation: settings.vertexLocation,
    };
    // Restore citizen provider state from server
    if (settings.citizenProvider) {
      setSeparateCitizen(true);
      setCitizenProvider(settings.citizenProvider);
      setCitizenBaseUrl(settings.citizenBaseUrl ?? 'http://localhost:1234/v1');
      setCitizenVertexProjectId(settings.citizenVertexProjectId ?? '');
      setCitizenVertexLocation(settings.citizenVertexLocation ?? '');
    } else {
      setSeparateCitizen(false);
    }
    // Restore extra providers
    if (settings.providers && settings.providers.length > 0) {
      setExtraProviders(settings.providers.map((p: ProviderConfigResponse) => ({
        provider: p.provider,
        apiKey: '',
        hasApiKey: p.hasApiKey,
        baseUrl: p.baseUrl ?? 'http://localhost:1234/v1',
        model: p.model,
        rateLimit: p.rateLimit != null ? String(p.rateLimit) : '',
        vertexProjectId: p.vertexProjectId ?? '',
        vertexLocation: p.vertexLocation ?? '',
      })));
    } else {
      setExtraProviders([]);
    }
  }, [settings]);

  const handleProviderSwitch = (p: Provider) => {
    // Snapshot current form before switching
    savedConfigs.current[provider] = { apiKey, centralAgentModel, citizenAgentModel, baseUrl, vertexProjectId, vertexLocation };

    // Restore previously entered values, or fall back to defaults
    const saved = savedConfigs.current[p];
    setProvider(p);
    setApiKey(saved?.apiKey ?? '');
    setCentralAgent(saved?.centralAgentModel ?? DEFAULT_CENTRAL[p]);
    setCitizenAgent(saved?.citizenAgentModel ?? DEFAULT_CITIZEN[p]);
    setBaseUrl(saved?.baseUrl ?? 'http://localhost:1234/v1');
    setVertexProjectId(saved?.vertexProjectId ?? '');
    setVertexLocation(saved?.vertexLocation ?? '');
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const updates: Partial<AppSettings> = {
        provider,
        baseUrl,
        centralAgentModel,
        citizenAgentModel,
        maxConcurrency,
        maxMessageLength,
        vertexProjectId,
        vertexLocation,
      };
      if (apiKey.trim()) updates.apiKey = apiKey.trim();

      if (separateCitizen) {
        updates.citizenProvider = citizenProvider;
        updates.citizenBaseUrl = citizenBaseUrl;
        updates.citizenVertexProjectId = citizenVertexProjectId;
        updates.citizenVertexLocation = citizenVertexLocation;
        if (citizenApiKey.trim()) updates.citizenApiKey = citizenApiKey.trim();
      } else {
        // JSON.stringify drops undefined, so backend never clears these fields.
        // We use null to forcefully overwrite them in the backend merge.
        (updates as Record<string, unknown>).citizenProvider = null;
        (updates as Record<string, unknown>).citizenApiKey = null;
        (updates as Record<string, unknown>).citizenBaseUrl = null;
        (updates as Record<string, unknown>).citizenVertexProjectId = null;
        (updates as Record<string, unknown>).citizenVertexLocation = null;
      }

      // Extra providers for load balancer
      updates.providers = extraProviders.map(ep => ({
        provider: ep.provider,
        ...(ep.apiKey.trim() ? { apiKey: ep.apiKey.trim() } : {}),
        baseUrl: ep.baseUrl,
        model: ep.model,
        rateLimit: ep.rateLimit.trim() ? Number(ep.rateLimit) : null,
        vertexProjectId: ep.vertexProjectId || undefined,
        vertexLocation: ep.vertexLocation || undefined,
      }));

      await updateSettings(updates as Parameters<typeof updateSettings>[0]);
      setApiKey('');
      setCitizenApiKey('');
      setExtraProviders(prev => prev.map(ep => ({ ...ep, apiKey: '', hasApiKey: ep.hasApiKey || !!ep.apiKey.trim() })));
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const runSandbox = async () => {
    setSandboxRunning(true);
    setSandboxOutput(null);
    setSandboxExitCode(null);
    try {
      const res = await fetch('/api/settings/sandbox', { method: 'POST' });
      const data = await res.json() as { output: string; exitCode: number };
      setSandboxOutput(data.output);
      setSandboxExitCode(data.exitCode);
    } catch (err) {
      setSandboxOutput(`Network error: ${err instanceof Error ? err.message : String(err)}`);
      setSandboxExitCode(1);
    } finally {
      setSandboxRunning(false);
    }
  };

  const citizenNeedsApiKey = citizenProvider !== 'local' && citizenProvider !== 'vertex';

  const modelOptions = getModelOptions(provider);
  const citizenModelOptions = getModelOptions(citizenProvider);

  return (
    <div className="animate-fade-in" style={{ maxWidth: '800px', margin: '0 auto' }}>
      <div className="page-header">
        <h1 className="page-title">Settings</h1>
      </div>

      <div className="glass-panel" style={{ marginBottom: '2rem', padding: '1.5rem' }}>
        <h2 style={{ fontSize: '1.25rem', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Server size={20} /> LLM Provider Configuration
        </h2>

        {/* Provider selector */}
        <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', marginBottom: '2rem' }}>
          {PROVIDERS.map(p => (
            <label key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
              <input
                type="radio"
                name="provider"
                checked={provider === p.id}
                onChange={() => handleProviderSwitch(p.id)}
                style={{ accentColor: 'var(--primary)' }}
              />
              {p.name}
            </label>
          ))}
        </div>

        <hr style={{ border: 'none', borderTop: '1px solid var(--glass-border)', margin: '0 0 2rem' }} />

        <div className="animate-fade-in" style={{ display: 'grid', gap: '1.5rem', marginBottom: '2rem' }}>

          {/* Active provider config area */}
          {(() => {
            if (provider === 'local') return (
              <div>
                <label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--text-dim)', fontSize: '0.9rem' }}>
                  Endpoint URL <span style={{ color: 'var(--text-dim)', fontWeight: 400 }}>(e.g. http://127.0.0.1:1234/v1)</span>
                </label>
                <input
                  type="text"
                  className="input-glass"
                  value={baseUrl}
                  onChange={e => setBaseUrl(e.target.value)}
                  placeholder="http://127.0.0.1:1234/v1"
                />
              </div>
            );
            if (provider === 'custom') {
              const hasSavedKey = Boolean(settings?.hasApiKey && !apiKey);
              return (
                <>
                  <div>
                    <label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--text-dim)', fontSize: '0.9rem' }}>
                      Endpoint URL <span style={{ color: 'var(--text-dim)', fontWeight: 400 }}>(OpenAI-compatible API base)</span>
                    </label>
                    <input
                      type="text"
                      className="input-glass"
                      value={baseUrl}
                      onChange={e => setBaseUrl(e.target.value)}
                      placeholder="https://api.example.com/v1"
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--text-dim)', fontSize: '0.9rem' }}>
                      API Key{' '}
                      {hasSavedKey && <span style={{ color: 'var(--success)', fontSize: '0.8rem' }}>(saved)</span>}
                    </label>
                    <div style={{ position: 'relative' }}>
                      <Key size={18} style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-dim)' }} />
                      <input
                        type="password"
                        placeholder={hasSavedKey ? '............. (leave blank to keep)' : 'API key for this endpoint'}
                        className="input-glass"
                        style={{ paddingLeft: '3rem' }}
                        value={apiKey}
                        onChange={e => setApiKey(e.target.value)}
                      />
                    </div>
                  </div>
                </>
              );
            }
            if (provider === 'vertex') return (
              <div style={{ display: 'flex', gap: '1rem' }}>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--text-dim)', fontSize: '0.9rem' }}>
                    Google Cloud Project ID <span style={{ color: 'var(--text-dim)', fontWeight: 400 }}>(optional)</span>
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. my-agent-project-123"
                    className="input-glass"
                    value={vertexProjectId}
                    onChange={e => setVertexProjectId(e.target.value)}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--text-dim)', fontSize: '0.9rem' }}>
                    Location <span style={{ color: 'var(--text-dim)', fontWeight: 400 }}>(optional)</span>
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. us-central1"
                    className="input-glass"
                    value={vertexLocation}
                    onChange={e => setVertexLocation(e.target.value)}
                  />
                </div>
              </div>
            );
            const hasSavedKey = Boolean(settings?.hasApiKey && !apiKey);
            return (
              <div>
                <label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--text-dim)', fontSize: '0.9rem' }}>
                  API Key{' '}
                  {hasSavedKey && <span style={{ color: 'var(--success)', fontSize: '0.8rem' }}>(saved)</span>}
                </label>
                <div style={{ position: 'relative' }}>
                  <Key size={18} style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-dim)' }} />
                  <input
                    type="password"
                    placeholder={hasSavedKey ? '............. (leave blank to keep)' : apiKeyPlaceholder[provider]}
                    className="input-glass"
                    style={{ paddingLeft: '3rem' }}
                    value={apiKey}
                    onChange={e => setApiKey(e.target.value)}
                  />
                </div>
              </div>
            );
          })()}

          {/* Model selectors */}
          <div style={{ display: 'grid', gridTemplateColumns: separateCitizen ? '1fr' : '1fr 1fr', gap: '1.5rem', marginTop: '1.5rem' }}>
            <div>
              <label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--text-dim)', fontSize: '0.9rem' }}>
                Central Agent Model
              </label>
              {modelOptions ? (
                <select className="input-glass" value={centralAgentModel} onChange={e => setCentralAgent(e.target.value)}>
                  {modelOptions.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
              ) : (
                <input type="text" className="input-glass" placeholder="e.g. liquid/lfm2.5-1.2b"
                  value={centralAgentModel} onChange={e => setCentralAgent(e.target.value)} />
              )}
            </div>
            {!separateCitizen && (
              <div>
                <label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--text-dim)', fontSize: '0.9rem' }}>
                  Citizen Agent Model
                </label>
                {modelOptions ? (
                  <select className="input-glass" value={citizenAgentModel} onChange={e => setCitizenAgent(e.target.value)}>
                    {modelOptions.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                  </select>
                ) : (
                  <input type="text" className="input-glass" placeholder="e.g. liquid/lfm2.5-1.2b"
                    value={citizenAgentModel} onChange={e => setCitizenAgent(e.target.value)} />
                )}
              </div>
            )}
          </div>

          {/* Local warning */}
          {provider === 'local' && (
            <div style={{ background: 'rgba(245, 158, 11, 0.1)', border: '1px solid rgba(245, 158, 11, 0.2)', padding: '1rem', borderRadius: '8px', color: 'var(--warning)', display: 'flex', gap: '0.75rem', fontSize: '0.9rem' }}>
              <AlertTriangle size={20} style={{ flexShrink: 0 }} />
              <div>
                <strong>No API key required</strong> — LM Studio and Ollama run locally.<br />
                Set the endpoint to your server's base URL (include <code>/v1</code>).
                Concurrency is typically limited to 1 for local models.
              </div>
            </div>
          )}

          {/* Vertex API note */}
          {provider === 'vertex' && (
            <div style={{ background: 'rgba(59, 130, 246, 0.1)', border: '1px solid rgba(59, 130, 246, 0.2)', padding: '1rem', borderRadius: '8px', color: 'var(--color-info)', display: 'flex', gap: '0.75rem', fontSize: '0.9rem', marginTop: '1rem' }}>
              <Server size={20} style={{ flexShrink: 0 }} />
              <div>
                <strong>Uses Application Default Credentials (ADC)</strong>. Configure via <code>gcloud auth application-default login</code> in your terminal. Project ID and Location will be inferred automatically if left blank.
              </div>
            </div>
          )}
        </div>

        <hr style={{ border: 'none', borderTop: '1px solid var(--glass-border)', margin: '0 0 2rem' }} />

        {/* Separate citizen provider toggle */}
        <div style={{ marginBottom: '2rem' }}>
          <div
            style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', cursor: 'pointer', marginBottom: separateCitizen ? '1.5rem' : 0 }}
            onClick={() => setSeparateCitizen(!separateCitizen)}
          >
            {separateCitizen
              ? <ToggleRight size={28} style={{ color: 'var(--primary)' }} />
              : <ToggleLeft size={28} style={{ color: 'var(--text-dim)' }} />
            }
            <span style={{ fontSize: '0.95rem' }}>Use different provider for citizen agents</span>
          </div>

          {separateCitizen && (
            <div className="animate-fade-in" style={{ display: 'grid', gap: '1.5rem', marginBottom: '2rem' }}>
              {/* Citizen Provider selector */}
              <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
                {PROVIDERS.map(p => (
                  <label key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                    <input
                      type="radio"
                      name="citizenProvider"
                      checked={citizenProvider === p.id}
                      onChange={() => {
                        const newP = p.id as Provider;
                        setCitizenProvider(newP);
                        setCitizenAgent(DEFAULT_CITIZEN[newP] || '');
                      }}
                      style={{ accentColor: 'var(--primary)' }}
                    />
                    {p.name}
                  </label>
                ))}
              </div>

              {/* Citizen API key */}
              {citizenNeedsApiKey && (() => {
                const hasSavedKey = Boolean(settings?.hasCitizenApiKey && !citizenApiKey);
                return (
                  <div>
                    <label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--text-dim)', fontSize: '0.9rem' }}>
                      Citizen API Key{' '}
                      {hasSavedKey && <span style={{ color: 'var(--success)', fontSize: '0.8rem' }}>(saved)</span>}
                    </label>
                    <div style={{ position: 'relative' }}>
                      <Key size={18} style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-dim)' }} />
                      <input
                        type="password"
                        placeholder={hasSavedKey ? '............. (leave blank to keep)' : apiKeyPlaceholder[citizenProvider]}
                        className="input-glass"
                        style={{ paddingLeft: '3rem' }}
                        value={citizenApiKey}
                        onChange={e => setCitizenApiKey(e.target.value)}
                      />
                    </div>
                  </div>
                );
              })()}

              {/* Citizen base URL */}
              {(citizenProvider === 'local' || citizenProvider === 'custom') && (
                <div>
                  <label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--text-dim)', fontSize: '0.9rem' }}>
                    Citizen Endpoint URL
                  </label>
                  <input
                    type="text"
                    className="input-glass"
                    value={citizenBaseUrl}
                    onChange={e => setCitizenBaseUrl(e.target.value)}
                    placeholder={citizenProvider === 'custom' ? 'https://api.example.com/v1' : 'http://127.0.0.1:1234/v1'}
                  />
                </div>
              )}

              {/* Citizen model */}
              <div>
                <label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--text-dim)', fontSize: '0.9rem' }}>
                  Citizen Agent Model
                </label>
                {citizenModelOptions ? (
                  <select className="input-glass" value={citizenAgentModel} onChange={e => setCitizenAgent(e.target.value)}>
                    {citizenModelOptions.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                  </select>
                ) : (
                  <input type="text" className="input-glass" placeholder="e.g. liquid/lfm2.5-1.2b"
                    value={citizenAgentModel} onChange={e => setCitizenAgent(e.target.value)} />
                )}
              </div>
            </div>
          )}
        </div>

        <hr style={{ border: 'none', borderTop: '1px solid var(--glass-border)', margin: '0 0 2rem' }} />

        {/* Additional Providers for Parallel Simulation */}
        <div style={{ marginBottom: '2rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
            <div>
              <label style={{ display: 'block', marginBottom: '0.25rem', color: 'var(--text-dim)', fontSize: '0.9rem' }}>
                Additional Providers for Parallel Simulation
              </label>
              <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                Add extra LLM endpoints to distribute citizen agent calls via round-robin.
              </span>
            </div>
            <button
              className="btn-secondary"
              style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexShrink: 0 }}
              onClick={() => setExtraProviders(prev => [...prev, {
                provider: 'local' as LLMProviderType,
                apiKey: '',
                hasApiKey: false,
                baseUrl: 'http://localhost:1234/v1',
                model: '',
                rateLimit: '',
                vertexProjectId: '',
                vertexLocation: '',
              }])}
            >
              <Plus size={16} /> Add Provider
            </button>
          </div>

          {extraProviders.length === 0 && (
            <div style={{
              color: 'var(--text-muted)', fontSize: '0.9rem', padding: '1.25rem',
              background: 'var(--panel-alpha-05)', border: '1px solid var(--glass-border)',
              borderRadius: '8px', textAlign: 'center',
            }}>
              No additional providers. The primary citizen provider will be used alone.
            </div>
          )}

          <div style={{ display: 'grid', gap: '1rem' }}>
            {extraProviders.map((ep, idx) => {
              const epModelOptions = getModelOptions(ep.provider);
              const epNeedsApiKey = ep.provider !== 'local' && ep.provider !== 'vertex';
              const updateSlot = (patch: Partial<ExtraProviderSlot>) =>
                setExtraProviders(prev => prev.map((s, i) => i === idx ? { ...s, ...patch } : s));
              const removeSlot = () =>
                setExtraProviders(prev => prev.filter((_, i) => i !== idx));

              return (
                <div key={idx} style={{
                  border: '1px solid var(--glass-border)', borderRadius: '8px', padding: '1.25rem',
                  background: 'var(--panel-alpha-02)',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                    <span style={{ fontSize: '0.9rem', color: 'var(--text-dim)' }}>Provider {idx + 1}</span>
                    <button
                      className="btn-secondary"
                      onClick={removeSlot}
                      style={{ padding: '0.4rem', color: 'var(--danger)', borderColor: 'rgba(239,68,68,0.3)' }}
                      title="Remove provider"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
                    {/* Provider type */}
                    <div>
                      <label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--text-dim)', fontSize: '0.9rem' }}>Provider</label>
                      <select className="input-glass" value={ep.provider} onChange={e => {
                        const p = e.target.value as LLMProviderType;
                        updateSlot({ provider: p, model: DEFAULT_CITIZEN[p] || '', apiKey: '', hasApiKey: false });
                      }}>
                        {PROVIDERS.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                    </div>

                    {/* Model */}
                    <div>
                      <label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--text-dim)', fontSize: '0.9rem' }}>Model</label>
                      {epModelOptions ? (
                        <select className="input-glass" value={ep.model} onChange={e => updateSlot({ model: e.target.value })}>
                          {epModelOptions.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                        </select>
                      ) : (
                        <input type="text" className="input-glass" placeholder="e.g. liquid/lfm2.5-1.2b"
                          value={ep.model} onChange={e => updateSlot({ model: e.target.value })} />
                      )}
                    </div>

                    {/* API Key (if needed) */}
                    {epNeedsApiKey && (
                      <div>
                        <label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--text-dim)', fontSize: '0.9rem' }}>
                          API Key{' '}
                          {ep.hasApiKey && <span style={{ color: 'var(--success)', fontSize: '0.8rem' }}>(saved)</span>}
                        </label>
                        <div style={{ position: 'relative' }}>
                          <Key size={18} style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-dim)' }} />
                          <input type="password" className="input-glass"
                            style={{ paddingLeft: '3rem' }}
                            placeholder={ep.hasApiKey ? '............. (leave blank to keep)' : apiKeyPlaceholder[ep.provider] ?? ''}
                            value={ep.apiKey} onChange={e => updateSlot({ apiKey: e.target.value })} />
                        </div>
                      </div>
                    )}

                    {/* Endpoint URL (local or custom) */}
                    {(ep.provider === 'local' || ep.provider === 'custom') && (
                      <div>
                        <label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--text-dim)', fontSize: '0.9rem' }}>
                          Endpoint URL <span style={{ color: 'var(--text-dim)', fontWeight: 400 }}>
                            {ep.provider === 'custom' ? '(OpenAI-compatible API base)' : '(e.g. http://127.0.0.1:1234/v1)'}
                          </span>
                        </label>
                        <input type="text" className="input-glass" value={ep.baseUrl}
                          onChange={e => updateSlot({ baseUrl: e.target.value })}
                          placeholder={ep.provider === 'custom' ? 'https://api.example.com/v1' : 'http://127.0.0.1:1234/v1'} />
                      </div>
                    )}

                    {/* Vertex fields */}
                    {ep.provider === 'vertex' && (
                      <>
                        <div>
                          <label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--text-dim)', fontSize: '0.9rem' }}>
                            Google Cloud Project ID <span style={{ color: 'var(--text-dim)', fontWeight: 400 }}>(optional)</span>
                          </label>
                          <input type="text" className="input-glass" value={ep.vertexProjectId}
                            onChange={e => updateSlot({ vertexProjectId: e.target.value })} placeholder="e.g. my-agent-project-123" />
                        </div>
                        <div>
                          <label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--text-dim)', fontSize: '0.9rem' }}>
                            Location <span style={{ color: 'var(--text-dim)', fontWeight: 400 }}>(optional)</span>
                          </label>
                          <input type="text" className="input-glass" value={ep.vertexLocation}
                            onChange={e => updateSlot({ vertexLocation: e.target.value })} placeholder="e.g. us-central1" />
                        </div>
                      </>
                    )}

                    {/* Rate Limit */}
                    <div>
                      <label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--text-dim)', fontSize: '0.9rem' }}>
                        Rate Limit <span style={{ color: 'var(--text-dim)', fontWeight: 400 }}>(calls/min, empty = unlimited)</span>
                      </label>
                      <input type="number" className="input-glass" style={{ maxWidth: '150px' }}
                        value={ep.rateLimit} onChange={e => updateSlot({ rateLimit: e.target.value })}
                        min={1} placeholder="No limit" />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <hr style={{ border: 'none', borderTop: '1px solid var(--glass-border)', margin: '0 0 2rem' }} />

        <div style={{ marginBottom: '2rem', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
          <div>
            <label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--text-dim)', fontSize: '0.9rem' }}>
              Max Concurrent Requests (1-50)
            </label>
            <input type="number" className="input-glass" style={{ maxWidth: '150px' }}
              value={maxConcurrency} onChange={e => setMaxConcurrency(Number(e.target.value))} min={1} max={50} />
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--text-dim)', fontSize: '0.9rem' }}>
              Max Message Length (Characters)
            </label>
            <input type="number" className="input-glass" style={{ maxWidth: '150px' }}
              value={maxMessageLength} onChange={e => setMaxMessageLength(Number(e.target.value))} min={100} />
          </div>
        </div>

        {saveError && (
          <div style={{ color: 'var(--danger)', marginBottom: '1rem', fontSize: '0.9rem' }}>{saveError}</div>
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <button
              className="btn-secondary"
              disabled={testStatus === 'testing'}
              onClick={() => {
                // Pass current form values so the server can test with the
                // live key/provider even before the user clicks Save.
                const overrides: Record<string, string> = { provider, baseUrl, centralAgentModel };
                if (apiKey.trim()) overrides.apiKey = apiKey.trim();
                testConnection(overrides as Parameters<typeof testConnection>[0]);
              }}
            >
              {testStatus === 'testing' ? 'Testing...' : 'Test Connection'}
            </button>
            {testStatus === 'success' && (
              <span style={{ color: 'var(--success)', display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.9rem' }} className="animate-fade-in">
                <CheckCircle2 size={18} /> {testMessage}
              </span>
            )}
            {testStatus === 'error' && (
              <span style={{ color: 'var(--danger)', display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.9rem' }} className="animate-fade-in">
                <XCircle size={18} /> {testMessage}
              </span>
            )}
          </div>
          <button className="btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Applying...' : 'Apply Configuration'}
          </button>
        </div>
      </div>
      {/* Developer Tools */}
      <div className="glass-panel" style={{ marginBottom: '2rem', padding: '1.5rem' }}>
        <h2 style={{ fontSize: '1.25rem', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <FlaskConical size={20} /> Developer Tools
        </h2>
        <p style={{ color: 'var(--text-dim)', fontSize: '0.88rem', marginBottom: '1.5rem' }}>
          Run deterministic engine tests that make no LLM calls. Use these to verify the physics
          and economy algorithms are working correctly before starting a simulation.
        </p>

        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: sandboxOutput ? '1.25rem' : 0 }}>
          <button
            className="btn-secondary"
            onClick={runSandbox}
            disabled={sandboxRunning}
            style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
          >
            <FlaskConical size={16} />
            {sandboxRunning ? 'Running sandbox…' : 'Run Physics Sandbox'}
          </button>
          {sandboxExitCode !== null && (
            <span
              style={{
                fontSize: '0.85rem',
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
                color: sandboxExitCode === 0 ? 'var(--success)' : 'var(--danger)',
              }}
              className="animate-fade-in"
            >
              {sandboxExitCode === 0
                ? <><CheckCircle2 size={16} /> All tests passed</>
                : <><XCircle size={16} /> Tests failed (exit {sandboxExitCode})</>}
            </span>
          )}
        </div>

        {sandboxOutput && (
          <pre
            className="animate-fade-in"
            style={{
              background: 'rgba(0,0,0,0.45)',
              border: `1px solid ${sandboxExitCode === 0 ? 'rgba(74,222,128,0.25)' : 'rgba(248,113,113,0.25)'}`,
              borderRadius: 8,
              padding: '1rem 1.25rem',
              fontSize: '0.78rem',
              lineHeight: 1.65,
              color: 'var(--text-main)',

              fontFamily: 'monospace',
              overflowX: 'auto',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              maxHeight: '420px',
              overflowY: 'auto',
            }}
          >
            {sandboxOutput}
          </pre>
        )}
      </div>

      {/* Location Data Cache */}
      <div style={{
        background: 'var(--glass-bg)', border: '1px solid var(--glass-border)',
        borderRadius: 12, padding: '1.5rem', marginBottom: '1.5rem',
      }}>
        <h2 style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 0 }}>
          <Database size={20} /> Location Data Cache
        </h2>
        <p style={{ color: 'var(--text-dim)', fontSize: '0.9rem', margin: '0.5rem 0 1rem' }}>
          Cached World Bank indicators and LLM-generated governance/infrastructure descriptions.
          Cache is per-country with a 30-day TTL.
        </p>
        {cacheStats && (
          <div style={{ display: 'flex', gap: '2rem', marginBottom: '1rem', fontSize: '0.9rem' }}>
            <span><strong>{cacheStats.fileCount}</strong> cached files</span>
            <span><strong>{cacheStats.totalSizeKB}</strong> KB total</span>
            {cacheStats.countries.length > 0 && (
              <span>Countries: {cacheStats.countries.join(', ')}</span>
            )}
          </div>
        )}
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          <button
            onClick={handleClearCache}
            disabled={cacheClearing || (cacheStats?.fileCount === 0)}
            style={{
              padding: '0.5rem 1rem', borderRadius: 8, cursor: 'pointer',
              background: 'var(--color-red, #ef4444)', color: '#fff', border: 'none',
              opacity: cacheClearing || (cacheStats?.fileCount === 0) ? 0.5 : 1,
              display: 'flex', alignItems: 'center', gap: 6,
            }}
          >
            <Trash2 size={14} />
            {cacheClearing ? 'Clearing...' : 'Clear Cache'}
          </button>
          {cacheClearResult && (
            <span style={{ fontSize: '0.85rem', color: 'var(--color-green, #22c55e)' }}>
              {cacheClearResult}
            </span>
          )}
        </div>
      </div>

      {/* Physics Laboratory — interactive debugging & transparency tool */}
      <PhysicsLaboratory />
    </div>
  );
};

export default SettingsPage;
