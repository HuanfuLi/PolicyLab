import React, { useState, useEffect, useRef } from 'react';
import { FlaskConical, ChevronDown, ChevronRight, AlertTriangle, RefreshCw, Play, CheckCircle, XCircle } from 'lucide-react';
import { settingsApi } from '../api/settings';
import type { PhysicsConfigValues, TracePhysicsOutput, SandboxJsonOutput } from '../api/settings';
import { LineChart } from '../components/LineChart';

const ALL_ACTION_CODES = [
  'WORK', 'REST', 'PRODUCE_AND_SELL', 'POST_BUY_ORDER', 'POST_SELL_ORDER',
  'STEAL', 'HELP', 'INVEST', 'STRIKE',
  'FOUND_ENTERPRISE', 'POST_JOB_OFFER', 'APPLY_FOR_JOB',
  'HIRE_EMPLOYEE', 'FIRE_EMPLOYEE', 'WORK_AT_ENTERPRISE', 'QUIT_JOB',
  'SABOTAGE', 'EMBEZZLE', 'ADJUST_TAX', 'SUPPRESS', 'NONE',
];

const SKILL_NAMES = [
  'farming', 'crafting', 'trading', 'mining',
  'healing', 'leadership', 'combat', 'scholarship', 'management',
];

const CONFIG_GROUPS: { label: string; keys: (keyof PhysicsConfigValues)[] }[] = [
  {
    label: 'Economy & Income',
    keys: ['passiveStarvationHealthPenalty', 'clampDeltaMax', 'roleIncomeElite', 'roleIncomeArtisan', 'roleIncomeScholar', 'roleIncomeDefault'],
  },
  {
    label: 'Steal Mechanic',
    keys: ['stealRatio', 'stealMax', 'stealFallback'],
  },
  {
    label: 'Stress Thresholds',
    keys: ['lowWealthThreshold', 'lowWealthCortisolPenalty', 'lowHealthThreshold', 'lowHealthCortisolPenalty', 'suppressionCortisolPenalty', 'suppressionHappinessPenalty', 'dopamineDecay'],
  },
  {
    label: 'Interrupt Thresholds',
    keys: ['starvationHealthInterrupt', 'mentalBreakdownCortisolInterrupt'],
  },
  {
    label: 'Allostatic / Metabolic',
    keys: ['satietyKcalPerPoint', 'tickDurationHrs', 'strainElasticityLimit', 'loadDiseaseThreshold', 'strainDecay', 'loadAccumulationRate', 'healthDecayRate'],
  },
];

function DeltaBadge({ label, value, clamped }: { label: string; value: number; clamped?: boolean }) {
  const color = value > 0
    ? 'var(--success, #4ade80)'
    : value < 0
      ? 'var(--danger, #f87171)'
      : 'var(--text-dim, #94a3b8)';
  const sign = value > 0 ? '+' : '';
  return (
    <span className="text-sm" style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      background: `${color}22`, border: `1px solid ${clamped ? 'rgba(251,191,36,0.6)' : color + '66'}`,
      borderRadius: 6, padding: '3px 10px', color: clamped ? 'var(--warning)' : color,
      fontFamily: 'monospace',
    }}>
      {clamped && <AlertTriangle size={12} />}
      {label}: {sign}{value.toFixed(2)}
      {clamped && ' ⚠'}
    </span>
  );
}

function StatSlider({ label, value, max, setter }: { label: string; value: number; max: number; setter: (v: number) => void }) {
  const pct = (value / max) * 100;
  const color = label === 'Cortisol'
    ? (pct > 60 ? 'var(--danger)' : pct > 30 ? 'var(--warning)' : 'var(--success)')
    : label === 'Health'
      ? (pct < 30 ? 'var(--danger)' : pct < 60 ? 'var(--warning)' : 'var(--success)')
      : 'var(--accent, #818cf8)';
  return (
    <div style={{ marginBottom: '0.55rem' }}>
      <div className="text-sm" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
        <span style={{ color: 'var(--text-dim)' }}>{label}</span>
        <span style={{ fontWeight: 700, fontFamily: 'monospace', color }}>{value}</span>
      </div>
      <input
        type="range" min={0} max={max} value={value}
        onChange={e => setter(Number(e.target.value))}
        style={{ width: '100%', accentColor: color, cursor: 'pointer' }}
      />
    </div>
  );
}

const PhysicsLaboratory: React.FC = () => {
  // ── Mock agent state ────────────────────────────────────────────────────
  const [role, setRole] = useState('FARMER');
  const [wealth, setWealth] = useState(50);
  const [health, setHealth] = useState(70);
  const [happiness, setHappiness] = useState(60);
  const [cortisol, setCortisol] = useState(20);
  const [dopamine, setDopamine] = useState(50);
  const [actionCode, setActionCode] = useState('WORK');
  const [isSabotaged, setIsSabotaged] = useState(false);
  const [isSuppressed, setIsSuppressed] = useState(false);
  const [skillLevels, setSkillLevels] = useState<Record<string, number>>(
    Object.fromEntries(SKILL_NAMES.map(s => [s, 10]))
  );

  // ── Trace result ────────────────────────────────────────────────────────
  const [result, setResult] = useState<TracePhysicsOutput | null>(null);
  const [loading, setLoading] = useState(false);

  // ── Long-run sandbox state ───────────────────────────────────────────────
  const [sandboxData, setSandboxData] = useState<SandboxJsonOutput | null>(null);
  const [sandboxRunning, setSandboxRunning] = useState(false);

  // ── Physics config state ────────────────────────────────────────────────
  const [config, setConfig] = useState<PhysicsConfigValues | null>(null);
  const [configDraft, setConfigDraft] = useState<PhysicsConfigValues | null>(null);
  const [showConfig, setShowConfig] = useState(false);
  const [configSaving, setConfigSaving] = useState(false);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load config on mount
  useEffect(() => {
    settingsApi.getPhysicsConfig().then(c => {
      setConfig(c);
      setConfigDraft(c);
    }).catch(() => { /* server may not be up yet */ });
  }, []);

  // Auto-run trace on any input change (debounced 300ms)
  const skillKey = JSON.stringify(skillLevels);
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(runTrace, 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, wealth, health, happiness, cortisol, dopamine, actionCode, isSabotaged, isSuppressed, skillKey]);

  const runTrace = async () => {
    setLoading(true);
    try {
      const skills = Object.fromEntries(
        SKILL_NAMES.map(k => [k, { level: skillLevels[k] ?? 10, experience: 0 }])
      ) as Record<string, { level: number; experience: number }>;

      const res = await settingsApi.tracePhysics({
        role,
        stats: { wealth, health, happiness, cortisol, dopamine },
        skills,
        actionCode,
        isSabotaged,
        isSuppressed,
      });
      setResult(res);
    } catch {
      // Silently keep stale result; server might be restarting
    } finally {
      setLoading(false);
    }
  };

  const applyConfig = async () => {
    if (!configDraft) return;
    setConfigSaving(true);
    try {
      const updated = await settingsApi.updatePhysicsConfig(configDraft);
      setConfig(updated);
      setConfigDraft(updated);
      // Retrigger trace so results reflect new constants
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(runTrace, 100);
    } catch { /* ignore */ }
    finally { setConfigSaving(false); }
  };

  const resetConfig = async () => {
    try {
      const reset = await settingsApi.resetPhysicsConfig();
      setConfig(reset);
      setConfigDraft(reset);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(runTrace, 100);
    } catch { /* ignore */ }
  };

  const runSandbox = async () => {
    setSandboxRunning(true);
    try {
      const data = await settingsApi.runSandboxJson();
      setSandboxData(data);
    } catch {
      // Silently keep stale result
    } finally {
      setSandboxRunning(false);
    }
  };

  const updateSkill = (name: string, val: number) =>
    setSkillLevels(prev => ({ ...prev, [name]: Math.max(1, Math.min(100, val)) }));

  // Compute projected final stats for display
  const projected = result ? {
    wealth: Math.max(0, wealth + result.wealthDelta),
    health: Math.max(0, Math.min(100, health + result.healthDelta)),
    happiness: result.happinessClamped ? result.clampedHappiness : Math.max(0, Math.min(100, happiness + result.happinessDelta)),
    cortisol: Math.max(0, Math.min(100, cortisol + result.cortisolDelta)),
    dopamine: Math.max(0, Math.min(100, dopamine + result.dopamineDelta)),
  } : null;

  return (
    <div className="glass-panel animate-fade-in" style={{ padding: '1.5rem', marginBottom: '2rem' }}>
      {/* Header */}
      <h2 className="text-xl" style={{ marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <FlaskConical size={20} /> Physics Laboratory
      </h2>
      <p className="text-sm" style={{ color: 'var(--text-dim)', marginBottom: '1.5rem' }}>
        Test any action against a mock agent and see the exact math trace in real-time.
        Tweak global constants → Run Sandbox → Check Charts → Apply to World.
      </p>

      {/* Two-column layout: Mock Agent | Action + Trace */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: '1.5rem' }}>

        {/* ── Left: Mock Agent Configuration ──────────────────────────────── */}
        <div>
          <div className="text-xs" style={{ fontWeight: 700, letterSpacing: '0.07em', color: 'var(--text-dim)', textTransform: 'uppercase', marginBottom: '0.75rem' }}>
            Mock Agent
          </div>

          <div style={{ marginBottom: '0.65rem' }}>
            <label className="text-sm" style={{ color: 'var(--text-dim)', display: 'block', marginBottom: 3 }}>Role</label>
            <input
              type="text" value={role}
              onChange={e => setRole(e.target.value.toUpperCase())}
              placeholder="e.g. FARMER, MERCHANT, KING"
              className="text-sm"
              style={{
                width: '100%', padding: '5px 9px', borderRadius: 6,
                background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.12)',
                color: 'var(--text-main)', boxSizing: 'border-box',
              }}
            />
          </div>

          <StatSlider label="Wealth" value={wealth} max={200} setter={setWealth} />
          <StatSlider label="Health" value={health} max={100} setter={setHealth} />
          <StatSlider label="Happiness" value={happiness} max={100} setter={setHappiness} />
          <StatSlider label="Cortisol" value={cortisol} max={100} setter={setCortisol} />
          <StatSlider label="Dopamine" value={dopamine} max={100} setter={setDopamine} />

          <div style={{ borderTop: '1px solid rgba(255,255,255,0.07)', paddingTop: '0.65rem', marginTop: '0.3rem' }}>
            <div className="text-xs" style={{ color: 'var(--text-dim)', marginBottom: '0.5rem', fontWeight: 600 }}>
              Skill Levels (1–100)
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '6px' }}>
              {SKILL_NAMES.map(sk => (
                <label key={sk} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span className="text-[0.68rem] capitalize" style={{ color: 'var(--text-dim)' }}>{sk}</span>
                  <input
                    type="number" min={1} max={100} value={skillLevels[sk] ?? 10}
                    onChange={e => updateSkill(sk, Number(e.target.value))}
                    className="text-xs"
                    style={{
                      width: '100%', padding: '2px 5px', borderRadius: 4,
                      background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.1)',
                      color: 'var(--text-main)',
                    }}
                  />
                </label>
              ))}
            </div>
          </div>
        </div>

        {/* ── Right: Action Selector + Trace Output ───────────────────────── */}
        <div>
          <div className="text-xs" style={{ fontWeight: 700, letterSpacing: '0.07em', color: 'var(--text-dim)', textTransform: 'uppercase', marginBottom: '0.75rem' }}>
            Action Simulator
          </div>

          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: '0.75rem' }}>
            <div style={{ flex: 1, minWidth: 150 }}>
              <label className="text-sm" style={{ color: 'var(--text-dim)', display: 'block', marginBottom: 3 }}>Action</label>
              <select
                value={actionCode}
                onChange={e => setActionCode(e.target.value)}
                className="text-sm"
                style={{
                  width: '100%', padding: '5px 8px', borderRadius: 6,
                  background: 'rgba(0,0,0,0.5)', border: '1px solid rgba(255,255,255,0.12)',
                  color: 'var(--text-main)',
                }}
              >
                {ALL_ACTION_CODES.map(code => <option key={code} value={code}>{code}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <label className="text-xs" style={{ display: 'flex', alignItems: 'center', gap: 7, color: 'var(--text-dim)', cursor: 'pointer' }}>
                <input type="checkbox" checked={isSabotaged} onChange={e => setIsSabotaged(e.target.checked)} />
                Sabotaged (×0.5 productivity)
              </label>
              <label className="text-xs" style={{ display: 'flex', alignItems: 'center', gap: 7, color: 'var(--text-dim)', cursor: 'pointer' }}>
                <input type="checkbox" checked={isSuppressed} onChange={e => setIsSuppressed(e.target.checked)} />
                Suppressed (enforcement active)
              </label>
            </div>
          </div>

          {/* Computing indicator */}
          {loading && (
            <div className="text-sm" style={{ color: 'var(--text-dim)', display: 'flex', alignItems: 'center', gap: 6, marginBottom: '0.5rem' }}>
              <RefreshCw size={13} className="animate-spin" /> Computing trace…
            </div>
          )}

          {/* Trace result panel */}
          {result && (
            <div style={{
              background: 'rgba(0,0,0,0.35)', borderRadius: 8, padding: '0.9rem',
              border: '1px solid rgba(255,255,255,0.08)',
            }}>

              {/* Happiness clamp alert */}
              {result.happinessClamped && (
                <div className="text-alert" style={{
                  display: 'flex', alignItems: 'flex-start', gap: 8,
                  background: 'rgba(251,191,36,0.1)', border: '1px solid rgba(251,191,36,0.35)',
                  borderRadius: 6, padding: '7px 11px', marginBottom: '0.75rem',
                  color: 'var(--warning)',
                }}>
                  <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
                  <span>
                    <strong>Happiness Clamped by Physiology</strong><br />
                    Raw {(happiness + result.happinessDelta).toFixed(2)} → clamped to {result.clampedHappiness.toFixed(2)}
                    {' '}(formula: health({Math.max(0, Math.min(100, health + result.healthDelta)).toFixed(2)}) − cortisol({Math.max(0, Math.min(100, cortisol + result.cortisolDelta)).toFixed(2)})×0.5
                    {' '}= max {Math.max(0, Math.max(0, Math.min(100, health + result.healthDelta)) - Math.max(0, Math.min(100, cortisol + result.cortisolDelta)) * 0.5).toFixed(2)})
                  </span>
                </div>
              )}

              {/* Stat delta badges */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: '0.75rem' }}>
                <DeltaBadge label="Wealth" value={result.wealthDelta} />
                <DeltaBadge label="Health" value={result.healthDelta} />
                <DeltaBadge
                  label="Happiness"
                  value={result.happinessClamped ? result.clampedHappiness - happiness : result.happinessDelta}
                  clamped={result.happinessClamped}
                />
                <DeltaBadge label="Cortisol" value={result.cortisolDelta} />
                <DeltaBadge label="Dopamine" value={result.dopamineDelta} />
              </div>

              {/* Projected final stats */}
              {projected && (
                <div className="text-xs" style={{ display: 'flex', flexWrap: 'wrap', gap: 12, color: 'var(--text-dim)', marginBottom: '0.75rem', paddingBottom: '0.65rem', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
                  <span>→ W: <strong style={{ color: 'var(--text-main)' }}>{projected.wealth.toFixed(0)}</strong></span>
                  <span>H: <strong style={{ color: projected.health < 30 ? 'var(--danger)' : 'var(--text-main)' }}>{projected.health.toFixed(0)}</strong></span>
                  <span>Hap: <strong style={{ color: result.happinessClamped ? 'var(--warning)' : 'var(--text-main)' }}>{projected.happiness.toFixed(0)}</strong></span>
                  <span>Cor: <strong style={{ color: projected.cortisol > 60 ? 'var(--danger)' : 'var(--text-main)' }}>{projected.cortisol.toFixed(0)}</strong></span>
                  <span>Dop: <strong style={{ color: 'var(--text-main)' }}>{projected.dopamine.toFixed(0)}</strong></span>
                </div>
              )}

              {/* Math trace */}
              <div>
                <div className="text-xs" style={{ fontWeight: 700, letterSpacing: '0.06em', color: 'var(--text-dim)', textTransform: 'uppercase', marginBottom: '0.4rem' }}>
                  Math Trace
                </div>
                {result.trace.length === 0 ? (
                  <span className="text-sm" style={{ color: 'var(--text-dim)' }}>No trace available</span>
                ) : (
                  <div className="text-trace" style={{ maxHeight: 280, overflowY: 'auto' }}>
                    {result.trace.map((line, i) => (
                      <div key={i} style={{
                        color: line.startsWith('⚠')
                          ? 'var(--warning)'
                          : line.startsWith('→')
                            ? 'var(--color-trace-arrow)'
                            : line.startsWith('  Δ') || line.startsWith('  Note')
                              ? 'var(--text-muted)'
                              : 'var(--text-main)',
                        paddingLeft: line.startsWith('  ') ? 0 : undefined,
                      }}>
                        {line}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Empty state */}
          {!result && !loading && (
            <div className="text-sm" style={{ color: 'var(--text-dim)', padding: '1rem 0' }}>
              Adjust the mock agent or select an action to see the math trace.
            </div>
          )}
        </div>
      </div>

      {/* ── Long-Run Sandbox ──────────────────────────────────────────────────── */}
      <div style={{ marginTop: '1.5rem', borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
          <div>
            <div className="text-xs" style={{ fontWeight: 700, letterSpacing: '0.07em', color: 'var(--text-dim)', textTransform: 'uppercase' }}>
              Long-Run Sandbox
            </div>
            <p className="text-sm" style={{ color: 'var(--text-dim)', margin: '0.2rem 0 0' }}>
              Run 100 deterministic iterations to detect poverty traps or price collapses.
            </p>
          </div>
          <button
            className="btn-primary text-sm"
            onClick={runSandbox}
            disabled={sandboxRunning}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 16px' }}
          >
            {sandboxRunning
              ? <><RefreshCw size={13} className="animate-spin" /> Running…</>
              : <><Play size={13} /> Run Long-Run Sandbox</>}
          </button>
        </div>

        {sandboxData && !sandboxData.error && (
          <div className="animate-fade-in">
            {/* Pass/fail banner */}
            <div className="text-sm" style={{
              display: 'flex', alignItems: 'center', gap: 8,
              background: sandboxData.allPassed ? 'rgba(74,222,128,0.08)' : 'rgba(248,113,113,0.08)',
              border: `1px solid ${sandboxData.allPassed ? 'rgba(74,222,128,0.3)' : 'rgba(248,113,113,0.3)'}`,
              borderRadius: 6, padding: '7px 12px', marginBottom: '1rem',
              color: sandboxData.allPassed ? 'var(--success)' : 'var(--danger)',
            }}>
              {sandboxData.allPassed
                ? <><CheckCircle size={14} /> {sandboxData.passed}/{sandboxData.passed + sandboxData.failed} tests passed — Economy is mathematically sound</>
                : <><XCircle size={14} /> {sandboxData.failed} test(s) failed — {sandboxData.firstDeathIteration !== null ? `First death at iteration ${sandboxData.firstDeathIteration}` : 'Check AMM stability'}</>}
            </div>

            {/* Charts — 2×2 grid */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              {/* Row 1, Col 1: Vitals (0-100 stats) */}
              <div>
                <div className="text-xs" style={{ fontWeight: 700, letterSpacing: '0.06em', color: 'var(--text-dim)', textTransform: 'uppercase', marginBottom: '0.4rem' }}>
                  Survival Vitals
                </div>
                <LineChart
                  series={[
                    { label: 'Avg Health', color: 'var(--chart-green)', data: sandboxData.iterations.map(d => d.avgHealth) },
                    { label: 'Avg Happiness', color: 'var(--chart-pink)', data: sandboxData.iterations.map(d => d.avgHappiness) },
                    { label: 'Avg Cortisol', color: 'var(--chart-red)', data: sandboxData.iterations.map(d => d.avgCortisol) },
                  ]}
                  height={160}
                  xLabels={sandboxData.iterations.map((_, i) => String(i + 1))}
                />
              </div>
              {/* Row 1, Col 2: Economy */}
              <div>
                <div className="text-xs" style={{ fontWeight: 700, letterSpacing: '0.06em', color: 'var(--text-dim)', textTransform: 'uppercase', marginBottom: '0.4rem' }}>
                  Economy (Avg Wealth)
                </div>
                <LineChart
                  series={[
                    { label: 'Avg Wealth', color: 'var(--chart-blue)', data: sandboxData.iterations.map(d => d.avgWealth) },
                  ]}
                  height={160}
                  xLabels={sandboxData.iterations.map((_, i) => String(i + 1))}
                />
              </div>
              {/* Row 2, Col 1: Market */}
              <div>
                <div className="text-xs" style={{ fontWeight: 700, letterSpacing: '0.06em', color: 'var(--text-dim)', textTransform: 'uppercase', marginBottom: '0.4rem' }}>
                  Market Stability (AMM Spot Price)
                </div>
                <LineChart
                  series={[
                    { label: 'Spot Price', color: 'var(--chart-coral)', data: sandboxData.iterations.map(d => d.spotPrice) },
                  ]}
                  height={160}
                  xLabels={sandboxData.iterations.map((_, i) => String(i + 1))}
                />
              </div>
              {/* Row 2, Col 2: Allostatic Load (hidden stress signal) */}
              <div>
                <div className="text-xs" style={{ fontWeight: 700, letterSpacing: '0.06em', color: 'var(--text-dim)', textTransform: 'uppercase', marginBottom: '0.4rem' }}>
                  Allostatic Load (Cumulative Stress)
                </div>
                <LineChart
                  series={[
                    { label: 'Allostatic Load', color: 'var(--chart-yellow)', data: sandboxData.iterations.map(d => d.avgAllostaticLoad) },
                  ]}
                  height={160}
                  xLabels={sandboxData.iterations.map((_, i) => String(i + 1))}
                />
              </div>
            </div>
          </div>
        )}

        {sandboxData?.error && (
          <div className="text-sm" style={{ color: 'var(--danger)', padding: '0.5rem', background: 'rgba(248,113,113,0.08)', borderRadius: 6, marginTop: '0.5rem' }}>
            {sandboxData.error}
          </div>
        )}
      </div>

      {/* ── Global Physics Constants Editor ──────────────────────────────────── */}
      <div style={{ marginTop: '1.5rem', borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '1rem' }}>
        <button
          onClick={() => setShowConfig(v => !v)}
          className="text-sm"
          style={{
            display: 'flex', alignItems: 'center', gap: 7,
            background: 'none', border: 'none', color: 'var(--text-dim)',
            cursor: 'pointer', fontWeight: 600, padding: 0,
          }}
        >
          {showConfig ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          Global Physics Constants
          {!config && <span className="text-sm" style={{ fontWeight: 400 }}> (loading…)</span>}
        </button>

        {showConfig && configDraft && (
          <div className="animate-fade-in" style={{ marginTop: '1rem' }}>
            <p className="text-sm" style={{ color: 'var(--text-dim)', marginBottom: '1rem' }}>
              Edit constants, then <strong>Run Long-Run Sandbox</strong> above to preview the impact.
              Click <strong>Apply to World</strong> to push to the server, or <strong>Reset to Defaults</strong> to revert.
            </p>

            {CONFIG_GROUPS.map(group => (
              <div key={group.label} style={{ marginBottom: '1.1rem' }}>
                <div className="text-xs" style={{
                  fontWeight: 700, letterSpacing: '0.07em',
                  color: 'var(--text-dim)', textTransform: 'uppercase', marginBottom: '0.5rem',
                }}>
                  {group.label}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '8px' }}>
                  {group.keys.map(key => (
                    <label key={key} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                      <span className="text-xs" style={{ color: 'var(--text-dim)', fontFamily: 'monospace' }}>
                        {key}
                        {config && configDraft[key] !== config[key] && (
                          <span style={{ color: 'var(--warning)', marginLeft: 4 }}>●</span>
                        )}
                      </span>
                      <input
                        type="number"
                        step="any"
                        value={configDraft[key]}
                        onChange={e => setConfigDraft(prev => prev ? { ...prev, [key]: Number(e.target.value) } : prev)}
                        className="text-sm"
                        style={{
                          padding: '3px 7px', borderRadius: 5,
                          background: configDraft[key] !== (config?.[key] ?? configDraft[key])
                            ? 'rgba(251,191,36,0.08)'
                            : 'rgba(0,0,0,0.3)',
                          border: `1px solid ${configDraft[key] !== (config?.[key] ?? configDraft[key]) ? 'rgba(251,191,36,0.4)' : 'rgba(255,255,255,0.1)'}`,
                          color: 'var(--text-main)',
                        }}
                      />
                    </label>
                  ))}
                </div>
              </div>
            ))}

            <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.75rem' }}>
              <button
                className="btn-primary text-sm"
                onClick={applyConfig}
                disabled={configSaving}
                style={{ padding: '6px 16px' }}
              >
                {configSaving ? 'Applying…' : 'Apply to World'}
              </button>
              <button
                className="btn-secondary text-sm"
                onClick={resetConfig}
                style={{ padding: '6px 16px', borderColor: 'rgba(248,113,113,0.4)', color: 'var(--danger)' }}
              >
                Reset to Defaults
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default PhysicsLaboratory;
