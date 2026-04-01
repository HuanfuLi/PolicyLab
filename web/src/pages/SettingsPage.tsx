import React, { useEffect, useRef, useState } from 'react';
import { Server, CheckCircle2, AlertTriangle, Key, XCircle, ToggleLeft, ToggleRight, FlaskConical } from 'lucide-react';
import { useSettingsStore } from '../stores/settingsStore';
import type { AppSettings } from '@policylab/shared';
import PhysicsLaboratory from './PhysicsLaboratory';

type Provider = AppSettings['provider'];

const PROVIDERS: { id: Provider; name: string }[] = [
  { id: 'claude', name: 'Anthropic (Claude)' },
  { id: 'openai', name: 'OpenAI' },
  { id: 'gemini', name: 'Gemini (Google AI Studio)' },
  { id: 'vertex', name: 'Vertex AI (Google Cloud)' },
  { id: 'local', name: 'Local (LM Studio/Ollama)' },
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
};

const DEFAULT_CITIZEN: Record<Provider, string> = {
  claude: 'claude-haiku-4-5-20251001',
  openai: 'gpt-5-mini',
  gemini: 'gemini-2.5-flash-lite',
  vertex: 'gemini-1.5-flash-001',
  local: '',
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

  // Stores per-provider form values so switching back restores what the user entered
  const savedConfigs = useRef<Partial<Record<Provider, SavedConfig>>>({});

  useEffect(() => { loadSettings(); }, []);

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
        (updates as any).citizenProvider = null;
        (updates as any).citizenApiKey = null;
        (updates as any).citizenBaseUrl = null;
        (updates as any).citizenVertexProjectId = null;
        (updates as any).citizenVertexLocation = null;
      }

      await updateSettings(updates as Parameters<typeof updateSettings>[0]);
      setApiKey('');
      setCitizenApiKey('');
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

  const needsApiKey = provider !== 'local' && provider !== 'vertex';
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
            const savedKeysMap = (settings as any)?.savedApiKeys ?? {};
            const hasSavedKey = Boolean(savedKeysMap[provider] && !apiKey);
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

          {/* Local endpoint field */}
          {provider === 'local' && (
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
          )}

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
                const savedKeysMap = (settings as any)?.savedApiKeys ?? {};
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
              {citizenProvider === 'local' && (
                <div>
                  <label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--text-dim)', fontSize: '0.9rem' }}>
                    Citizen Endpoint URL
                  </label>
                  <input
                    type="text"
                    className="input-glass"
                    value={citizenBaseUrl}
                    onChange={e => setCitizenBaseUrl(e.target.value)}
                    placeholder="http://127.0.0.1:1234/v1"
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

      {/* Physics Laboratory — interactive debugging & transparency tool */}
      <PhysicsLaboratory />
    </div>
  );
};

export default SettingsPage;
