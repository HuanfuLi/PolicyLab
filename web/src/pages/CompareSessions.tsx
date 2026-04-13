import React, { useEffect, useRef, useState } from 'react';
import { ArrowRight, CheckSquare, Square, MessageSquare, Send, Users, Clock, Trash2, RefreshCw, Download } from 'lucide-react';
import { useCompareStore } from '../stores/compareStore';
import MarkdownText from '../components/MarkdownText';
import type { SessionMetadata, ComparisonDimension, ComparisonResult, EconomyParamDiff, TelemetryLog } from '@policylab/shared';

function sanitizeFilenamePart(s: string): string {
  return s.replace(/[^a-z0-9]/gi, '_').toLowerCase().replace(/_+/g, '_').slice(0, 40);
}

function downloadBlob(content: string, filename: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function buildComparisonMarkdown(
  comparison: ComparisonResult,
  s1: SessionMetadata | null,
  s2: SessionMetadata | null,
): string {
  const titleA = s1?.title ?? 'Society A';
  const titleB = s2?.title ?? 'Society B';
  const lines: string[] = [];

  lines.push(`# Comparison Report: ${titleA} vs ${titleB}`);
  lines.push('');
  lines.push(`_Generated ${new Date().toISOString()}_`);
  lines.push('');
  lines.push('## Sessions');
  lines.push('');
  lines.push(`- **Society A** — ${titleA} (${s1?.agentCount ?? '?'} agents, ${s1?.completedIterations ?? '?'} iterations) · id \`${comparison.session1Id}\``);
  lines.push(`- **Society B** — ${titleB} (${s2?.agentCount ?? '?'} agents, ${s2?.completedIterations ?? '?'} iterations) · id \`${comparison.session2Id}\``);
  lines.push('');

  if (comparison.economyParamDiffs && comparison.economyParamDiffs.length > 0) {
    lines.push('## Configuration Differences');
    lines.push('');
    lines.push('| Parameter | Society A | Society B |');
    lines.push('|---|---|---|');
    for (const d of comparison.economyParamDiffs) {
      const v1 = typeof d.session1Value === 'boolean' ? (d.session1Value ? 'Yes' : 'No') : d.session1Value;
      const v2 = typeof d.session2Value === 'boolean' ? (d.session2Value ? 'Yes' : 'No') : d.session2Value;
      lines.push(`| ${d.label} | ${v1} | ${v2} |`);
    }
    lines.push('');
  }

  lines.push('## Dimensions');
  lines.push('');
  lines.push('| Dimension | Society A | Society B | Δ |');
  lines.push('|---|---:|---:|---:|');
  for (const d of comparison.dimensions) {
    const delta = Math.abs(d.score1 - d.score2);
    lines.push(`| ${d.name} | ${d.score1} | ${d.score2} | ${delta} |`);
  }
  lines.push('');

  for (const d of comparison.dimensions) {
    lines.push(`### ${d.name}`);
    lines.push('');
    lines.push(`Society A: **${d.score1}/100** · Society B: **${d.score2}/100**`);
    lines.push('');
    lines.push(d.analysis);
    lines.push('');
  }

  lines.push('## Central Analysis');
  lines.push('');
  lines.push(comparison.narrative);
  lines.push('');
  lines.push('## Verdict');
  lines.push('');
  lines.push(comparison.verdict);
  lines.push('');

  return lines.join('\n');
}

const stageBadge: Record<string, { label: string; cls: string }> = {
  'completed': { label: '✓ Completed', cls: 'badge-success' },
  'reviewing': { label: 'Reviewing', cls: 'badge-info' },
  'reflection-complete': { label: 'Reflected', cls: 'badge-info' },
};

function ScoreBar({ score, color }: { score: number; color: string }) {
  return (
    <div style={{ flex: 1, background: 'var(--panel-alpha-05)', borderRadius: '4px', overflow: 'hidden', height: '8px' }}>
      <div style={{ width: `${score}%`, height: '100%', background: color, borderRadius: '4px', transition: 'width 0.5s ease' }} />
    </div>
  );
}

function DimensionRow({ dim }: { dim: ComparisonDimension; idx: number }) {
  const [open, setOpen] = useState(false);
  const colors = ['var(--primary)', 'var(--warning)'];

  const delta = Math.abs(dim.score1 - dim.score2);
  const deltaColor = dim.score1 === dim.score2
    ? 'var(--text-muted)'
    : dim.score1 > dim.score2 ? colors[0] : colors[1];

  return (
    <div style={{ borderBottom: '1px solid var(--glass-border)', paddingBottom: '0.75rem', marginBottom: '0.75rem' }}>
      <div
        style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', cursor: 'pointer', marginBottom: '0.5rem' }}
        onClick={() => setOpen(o => !o)}
      >
        <span style={{ width: '180px', color: 'var(--color-bright)', fontSize: '0.9rem', flexShrink: 0 }}>{dim.name}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flex: 1 }}>
          <span style={{ color: colors[0], fontWeight: 'bold', fontSize: '0.85rem', width: '32px', textAlign: 'right' }}>{dim.score1}</span>
          <ScoreBar score={dim.score1} color={colors[0]} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flex: 1 }}>
          <span style={{ color: colors[1], fontWeight: 'bold', fontSize: '0.85rem', width: '32px', textAlign: 'right' }}>{dim.score2}</span>
          <ScoreBar score={dim.score2} color={colors[1]} />
        </div>
        <span
          title="Absolute point gap between the two sessions on this dimension"
          style={{ color: deltaColor, fontWeight: 'bold', fontSize: '0.8rem', width: '44px', textAlign: 'right', flexShrink: 0 }}
        >
          Δ {delta}
        </span>
      </div>
      {open && (
        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', lineHeight: 1.6, margin: 0, paddingLeft: '180px' }}>
          <MarkdownText>{dim.analysis}</MarkdownText>
        </p>
      )}
    </div>
  );
}

function ConfigDiffSection({ diffs, session1Title, session2Title }: {
  diffs: EconomyParamDiff[];
  session1Title: string;
  session2Title: string;
}) {
  return (
    <div style={{
      background: 'var(--panel-alpha-05)',
      borderRadius: 12,
      padding: '20px 24px',
      marginBottom: 24,
      border: '1px solid var(--glass-border)',
    }}>
      <h3 style={{ margin: '0 0 16px', color: 'var(--primary)', fontSize: 16 }}>
        Configuration Differences
      </h3>
      <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 16 }}>
        These economic parameters were changed between the two sessions.
      </p>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--glass-border)' }}>
            <th style={{ textAlign: 'left', padding: '8px 12px', color: 'var(--text-muted)' }}>Parameter</th>
            <th style={{ textAlign: 'right', padding: '8px 12px', color: 'var(--text-muted)' }}>{session1Title}</th>
            <th style={{ textAlign: 'right', padding: '8px 12px', color: 'var(--text-muted)' }}>{session2Title}</th>
          </tr>
        </thead>
        <tbody>
          {diffs.map(d => (
            <tr key={d.param} style={{ borderBottom: '1px solid var(--glass-border)' }}>
              <td style={{ padding: '8px 12px' }}>{d.label}</td>
              <td style={{ textAlign: 'right', padding: '8px 12px', fontFamily: 'monospace' }}>
                {typeof d.session1Value === 'boolean' ? (d.session1Value ? 'Yes' : 'No') : d.session1Value}
              </td>
              <td style={{ textAlign: 'right', padding: '8px 12px', fontFamily: 'monospace' }}>
                {typeof d.session2Value === 'boolean' ? (d.session2Value ? 'Yes' : 'No') : d.session2Value}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MiniLineChart({ label, color, values, yMin, yMax }: {
  label: string; color: string;
  values: Array<{ idx: number; val: number }>;
  yMin: number; yMax: number;
}) {
  const width = 400;
  const height = 70;
  const padL = 40;
  const padR = 8;
  const padY = 10;

  const xRange = Math.max(1, values.length - 1);
  const yRange = yMax - yMin || 1;

  const sx = (i: number) => padL + (i / xRange) * (width - padL - padR);
  const sy = (v: number) => padY + (height - 2 * padY) - ((v - yMin) / yRange) * (height - 2 * padY);

  const pts = values.map((d, i) => `${sx(i)},${sy(d.val)}`).join(' ');

  const fmt = (n: number) => {
    if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
    if (Math.abs(n) >= 1_000) return (n / 1_000).toFixed(1) + 'k';
    return Number.isInteger(n) ? n.toString() : n.toFixed(1);
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.15rem' }}>
        <span style={{ color, fontSize: '0.75rem', fontWeight: 600 }}>{label}</span>
      </div>
      <svg width="100%" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet">
        {/* Y-axis labels */}
        <text x={padL - 4} y={sy(yMax) + 3} fill="var(--text-dim)" fontSize="8" textAnchor="end">{fmt(yMax)}</text>
        <text x={padL - 4} y={sy(yMin) + 3} fill="var(--text-dim)" fontSize="8" textAnchor="end">{fmt(yMin)}</text>
        {/* Grid */}
        <line x1={padL} y1={sy(yMin)} x2={width - padR} y2={sy(yMin)} stroke="var(--glass-border)" strokeWidth="0.5" />
        <line x1={padL} y1={sy((yMin + yMax) / 2)} x2={width - padR} y2={sy((yMin + yMax) / 2)} stroke="var(--glass-border)" strokeWidth="0.5" strokeDasharray="3,3" />
        <line x1={padL} y1={sy(yMax)} x2={width - padR} y2={sy(yMax)} stroke="var(--glass-border)" strokeWidth="0.5" />
        {/* Line */}
        <polyline points={pts} fill="none" style={{ stroke: color }} strokeWidth="2" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

function SVGLineChart({ title, iterations }: { title: string, iterations: Array<{ statistics?: { avgWealth?: number; avgHealth?: number; avgHappiness?: number } }> }) {
  const empty = (
    <div style={{ flex: 1, background: 'var(--panel-alpha-05)', borderRadius: '8px', padding: '1rem', textAlign: 'center', color: 'var(--text-dim)', fontSize: '0.85rem' }}>
      No metric history available for {title}
    </div>
  );

  if (!iterations || iterations.length === 0) return empty;

  // Filter to only iterations that have statistics — missing statistics would create
  // synthetic flat lines at the midpoint, causing the "locked at middle" visual bug
  const valid = iterations
    .map((it, i) => ({ it, i }))
    .filter(({ it }) => it.statistics != null);

  if (valid.length === 0) return empty;

  const wealthVals = valid.map(({ it, i }) => ({ idx: i, val: it.statistics?.avgWealth ?? 0 }));
  const healthVals = valid.map(({ it, i }) => ({ idx: i, val: it.statistics?.avgHealth ?? 0 }));
  const happyVals  = valid.map(({ it, i }) => ({ idx: i, val: it.statistics?.avgHappiness ?? 0 }));

  // Adaptive Y range for wealth; fixed 0-100 for health & happiness
  const wealthMin = Math.min(...wealthVals.map(d => d.val));
  const wealthMax = Math.max(...wealthVals.map(d => d.val));
  const wealthPad = (wealthMax - wealthMin) * 0.1 || 10;

  return (
    <div style={{ flex: 1, background: 'var(--panel-alpha-05)', borderRadius: '8px', padding: '1rem' }}>
      <h4 style={{ margin: '0 0 0.75rem 0', fontSize: '0.9rem', color: 'var(--color-bright)', textAlign: 'center' }}>
        {title} Metrics Over Time
      </h4>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
        <MiniLineChart label="Wealth" color="var(--success)" values={wealthVals}
          yMin={Math.floor(wealthMin - wealthPad)} yMax={Math.ceil(wealthMax + wealthPad)} />
        <MiniLineChart label="Health" color="var(--danger)" values={healthVals} yMin={0} yMax={100} />
        <MiniLineChart label="Happiness" color="var(--chart-sapphire)" values={happyVals} yMin={0} yMax={100} />
      </div>
    </div>
  );
}

/** Dual-series comparison chart: one line per session, with auto-scaling Y axis */
function ComparisonChart({ title, data1, data2, label1, label2, color1, color2 }: {
  title: string;
  data1: Array<{ x: number; y: number }>;
  data2: Array<{ x: number; y: number }>;
  label1: string;
  label2: string;
  color1?: string;
  color2?: string;
}) {
  const c1 = color1 ?? 'var(--primary)';
  const c2 = color2 ?? 'var(--warning)';
  const width = 440;
  const height = 140;
  const pad = 20;
  const padRight = 48;

  const allY = [...data1.map(d => d.y), ...data2.map(d => d.y)];
  const allX = [...data1.map(d => d.x), ...data2.map(d => d.x)];
  const yMin = Math.min(...allY);
  const yMax = Math.max(...allY);
  const xMin = Math.min(...allX);
  const xMax = Math.max(...allX);
  const yRange = yMax - yMin || 1;
  const xRange = xMax - xMin || 1;

  const sx = (v: number) => pad + ((v - xMin) / xRange) * (width - pad - padRight);
  const sy = (v: number) => pad + (height - 2 * pad) - ((v - yMin) / yRange) * (height - 2 * pad);

  const pts1 = data1.map(d => `${sx(d.x)},${sy(d.y)}`).join(' ');
  const pts2 = data2.map(d => `${sx(d.x)},${sy(d.y)}`).join(' ');

  const fmt = (n: number) => {
    if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
    if (Math.abs(n) >= 1_000) return (n / 1_000).toFixed(1) + 'k';
    return n.toFixed(2);
  };

  return (
    <div style={{ flex: 1, minWidth: '420px', background: 'var(--panel-alpha-05)', borderRadius: '8px', padding: '0.75rem' }}>
      <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '0.8rem', color: 'var(--color-bright)', textAlign: 'center' }}>
        {title}
      </h4>
      <svg width="100%" viewBox={`0 0 ${width} ${height}`} style={{ overflow: 'visible' }}>
        <line x1={pad} y1={sy(yMin)} x2={width - padRight} y2={sy(yMin)} stroke="var(--glass-border)" strokeWidth="1" />
        <line x1={pad} y1={sy((yMin + yMax) / 2)} x2={width - padRight} y2={sy((yMin + yMax) / 2)} stroke="var(--glass-border)" strokeWidth="1" strokeDasharray="4,4" />
        <line x1={pad} y1={sy(yMax)} x2={width - padRight} y2={sy(yMax)} stroke="var(--glass-border)" strokeWidth="1" />
        <polyline points={pts1} fill="none" stroke={c1} strokeWidth="2" strokeLinejoin="round" />
        <polyline points={pts2} fill="none" stroke={c2} strokeWidth="1.5" strokeLinejoin="round" strokeDasharray="6,3" strokeOpacity="0.85" />
        <text x={width - padRight + 4} y={sy(yMax) + 4} fill="var(--text-dim)" fontSize="8">{fmt(yMax)}</text>
        <text x={width - padRight + 4} y={sy(yMin)} fill="var(--text-dim)" fontSize="8">{fmt(yMin)}</text>
      </svg>
      <div style={{ display: 'flex', justifyContent: 'center', gap: '1rem', marginTop: '0.25rem', fontSize: '0.7rem' }}>
        <span style={{ color: c1, display: 'flex', alignItems: 'center', gap: '0.2rem' }}>● {label1}</span>
        <span style={{ color: c2, display: 'flex', alignItems: 'center', gap: '0.2rem' }}>┅ {label2}</span>
      </div>
    </div>
  );
}

/** Renders comparison charts for economic indicators available in telemetry data. Silently skips missing indicators. */
function EconomyComparisonCharts({ t1, t2, title1, title2 }: {
  t1: TelemetryLog[];
  t2: TelemetryLog[];
  title1: string;
  title2: string;
}) {
  type Indicator = { key: keyof TelemetryLog; label: string; color1?: string; color2?: string };
  const indicators: Indicator[] = [
    { key: 'giniCoefficient', label: 'Gini Coefficient' },
    { key: 'cpi', label: 'CPI (Consumer Price Index)' },
    { key: 'inflationRate', label: 'Inflation Rate (%)' },
    { key: 'm1', label: 'Money Supply M1' },
    { key: 'loansOutstanding', label: 'Loans Outstanding' },
    { key: 'totalFiatSupply', label: 'Fiat Supply' },
    { key: 'ammSpotPrice_Food', label: 'Food Price (AMM)' },
    { key: 'trustIndex', label: 'Trust Index' },
    { key: 'crimeRate', label: 'Crime Rate' },
    { key: 'averageCortisol', label: 'Avg Cortisol' },
    { key: 'infrastructureQuality', label: 'Infrastructure Quality' },
    { key: 'educationQuality', label: 'Education Quality' },
  ];

  const toXY = (logs: TelemetryLog[], key: keyof TelemetryLog) =>
    logs.filter(l => l[key] != null).map(l => ({ x: l.iterationNumber, y: l[key] as number }));

  const charts = indicators
    .map(ind => {
      const d1 = toXY(t1, ind.key);
      const d2 = toXY(t2, ind.key);
      // Silent fallback: skip if neither session has data for this indicator
      if (d1.length < 2 && d2.length < 2) return null;
      return { ...ind, d1, d2 };
    })
    .filter(Boolean) as Array<Indicator & { d1: Array<{ x: number; y: number }>; d2: Array<{ x: number; y: number }> }>;

  if (charts.length === 0) return null;

  return (
    <div className="glass-card" style={{ marginBottom: '2rem' }}>
      <h3 style={{ fontSize: '1rem', color: 'var(--color-bright)', marginBottom: '1.25rem' }}>
        Economic Indicators
        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginLeft: '1rem', fontWeight: 'normal' }}>
          (side-by-side telemetry comparison)
        </span>
      </h3>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem' }}>
        {charts.map(ch => (
          <ComparisonChart
            key={ch.key}
            title={ch.label}
            data1={ch.d1}
            data2={ch.d2}
            label1={title1}
            label2={title2}
          />
        ))}
      </div>
    </div>
  );
}

function SessionCard({ session, selected, eligible, onToggle }: {
  session: SessionMetadata;
  selected: boolean;
  eligible: boolean;
  onToggle: () => void;
}) {
  const badge = stageBadge[session.stage];
  return (
    <div
      onClick={eligible ? onToggle : undefined}
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: '1rem',
        padding: '0.75rem 1rem',
        background: selected ? 'var(--panel-alpha-05)' : 'transparent',
        borderRadius: '8px',
        cursor: eligible ? 'pointer' : 'not-allowed',
        border: selected ? '1px solid var(--primary)' : '1px solid transparent',
        opacity: eligible ? 1 : 0.45,
        transition: 'all 0.15s',
      }}
    >
      <div style={{ marginTop: '2px', color: selected ? 'var(--primary)' : 'var(--text-muted)', flexShrink: 0 }}>
        {selected ? <CheckSquare size={18} /> : <Square size={18} />}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.25rem' }}>
          <strong style={{ color: 'var(--color-bright)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {session.title}
          </strong>
          {badge && <span className={`badge ${badge.cls}`} style={{ fontSize: '0.75rem' }}>{badge.label}</span>}
          {!eligible && <span style={{ color: 'var(--text-dim)', fontSize: '0.8rem' }}>(not completed)</span>}
        </div>
        <div style={{ display: 'flex', gap: '1rem', fontSize: '0.8rem', color: 'var(--text-dim)' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}><Users size={13} /> {session.agentCount}</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}><Clock size={13} /> {session.completedIterations} iter</span>
        </div>
      </div>
    </div>
  );
}

const CompareSessions = () => {
  const {
    allSessions, selectedIds, comparison, messages, history, session1Iterations, session2Iterations,
    session1Telemetry, session2Telemetry,
    loading, chatPending, error,
    loadSessions, loadHistory, selectHistoryItem, deleteComparison, toggleSession, runComparison, sendMessage,
  } = useCompareStore();

  const [chatInput, setChatInput] = useState('');
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => { loadSessions(); loadHistory(); }, []);
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const completedSessions = allSessions.filter(
    s => s.stage === 'completed' || s.stage === 'reviewing' || s.stage === 'reflection-complete'
  );

  const handleChat = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = chatInput.trim();
    if (!text || chatPending) return;
    setChatInput('');
    await sendMessage(text);
  };

  const selected1 = selectedIds[0] ? allSessions.find(s => s.id === selectedIds[0]) ?? null : null;
  const selected2 = selectedIds[1] ? allSessions.find(s => s.id === selectedIds[1]) ?? null : null;

  const buildDownloadFilename = (ext: 'json' | 'md'): string => {
    const a = sanitizeFilenamePart(selected1?.title ?? 'sessionA');
    const b = sanitizeFilenamePart(selected2?.title ?? 'sessionB');
    const date = new Date().toISOString().slice(0, 10);
    return `comparison_${a}_vs_${b}_${date}.${ext}`;
  };

  const handleDownloadJSON = () => {
    if (!comparison) return;
    const payload = {
      generatedAt: new Date().toISOString(),
      session1: { id: comparison.session1Id, title: selected1?.title ?? null, agentCount: selected1?.agentCount ?? null, completedIterations: selected1?.completedIterations ?? null },
      session2: { id: comparison.session2Id, title: selected2?.title ?? null, agentCount: selected2?.agentCount ?? null, completedIterations: selected2?.completedIterations ?? null },
      comparison,
    };
    downloadBlob(JSON.stringify(payload, null, 2), buildDownloadFilename('json'), 'application/json');
  };

  const handleDownloadMarkdown = () => {
    if (!comparison) return;
    downloadBlob(buildComparisonMarkdown(comparison, selected1, selected2), buildDownloadFilename('md'), 'text/markdown');
  };

  return (
    <div className="animate-fade-in" style={{ maxWidth: '1000px', margin: '0 auto', paddingBottom: '3rem' }}>
      <div className="page-header" style={{ marginBottom: '2rem' }}>
        <h1 className="page-title">Compare Sessions</h1>
      </div>

      {/* Session selection */}
      <div className="glass-card" style={{ marginBottom: '2rem' }}>
        <h3 style={{ fontSize: '1rem', marginBottom: '1rem', color: 'var(--text-muted)' }}>
          Select exactly 2 completed sessions to compare
          {selectedIds.length > 0 && (
            <span style={{ color: 'var(--primary)', marginLeft: '0.75rem' }}>
              ({selectedIds.length}/2 selected)
            </span>
          )}
        </h3>

        {allSessions.length === 0 && (
          <p style={{ color: 'var(--text-dim)', textAlign: 'center', padding: '2rem' }}>
            No sessions found. Create and complete a session first.
          </p>
        )}

        {completedSessions.length < 2 && allSessions.length > 0 && (
          <p style={{ color: 'var(--text-dim)', marginBottom: '1rem', fontSize: '0.9rem' }}>
            You need at least 2 completed sessions to compare. Only completed, reviewing, or reflected sessions are eligible.
          </p>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', marginBottom: '1.5rem' }}>
          {allSessions.filter(s => s.stage !== 'idea-input').map(session => {
            const eligible = session.stage === 'completed' || session.stage === 'reviewing' || session.stage === 'reflection-complete';
            const selected = selectedIds.includes(session.id);
            const disabled = !selected && selectedIds.length === 2;
            return (
              <SessionCard
                key={session.id}
                session={session}
                selected={selected}
                eligible={eligible && !disabled}
                onToggle={() => toggleSession(session.id)}
              />
            );
          })}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button
            className="btn-primary"
            disabled={selectedIds.length !== 2 || loading}
            onClick={runComparison}
          >
            {loading ? 'Analysing...' : 'Generate Comparison'} <ArrowRight size={18} />
          </button>
        </div>
      </div>

      {/* Historical comparisons */}
      <div className="glass-card" style={{ marginBottom: '2rem' }}>
        <h3 style={{ fontSize: '1rem', marginBottom: '1rem', color: 'var(--text-muted)' }}>Historical Comparisons</h3>
        {history.length === 0 ? (
          <p style={{ color: 'var(--text-dim)', textAlign: 'center', padding: '1rem', fontSize: '0.9rem' }}>No past reports found.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            {history.map(item => {
              const s1 = allSessions.find(s => s.id === item.comparison.session1Id)?.title || 'Society A';
              const s2 = allSessions.find(s => s.id === item.comparison.session2Id)?.title || 'Society B';
              const isSelected = !!comparison && comparison.session1Id === item.comparison.session1Id && comparison.session2Id === item.comparison.session2Id;
              return (
                <div
                  key={item.id}
                  onClick={() => selectHistoryItem(item.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.75rem 1rem',
                    background: isSelected ? 'var(--panel-alpha-05)' : 'transparent',
                    border: isSelected ? '1px solid var(--primary)' : '1px solid transparent',
                    borderRadius: '8px', cursor: 'pointer', transition: 'all 0.15s'
                  }}
                >
                  <Clock size={16} color={isSelected ? "var(--primary)" : "var(--text-dim)"} />
                  <div style={{ flex: 1 }}>
                    <div style={{ color: isSelected ? 'var(--primary)' : 'var(--color-bright)', fontSize: '0.9rem' }}>{s1} vs {s2}</div>
                    <div style={{ color: 'var(--text-dim)', fontSize: '0.75rem' }}>{new Date(item.timestamp).toLocaleString()}</div>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); deleteComparison(item.id); }}
                    style={{
                      background: 'transparent', border: 'none', color: 'var(--text-dim)',
                      cursor: 'pointer', padding: '4px', borderRadius: '4px', display: 'flex',
                      alignItems: 'center', justifyContent: 'center',
                    }}
                    title="Delete comparison"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Error */}
      {error && !loading && (
        <div style={{ color: 'var(--danger)', padding: '1rem', background: 'rgba(239,68,68,0.1)', borderRadius: '8px', marginBottom: '2rem' }}>
          {error}
        </div>
      )}

      {/* Loading spinner */}
      {loading && (
        <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
          <p>The Central Agent is analysing both societies…</p>
        </div>
      )}

      {/* Results */}
      {comparison && !loading && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
            <h2 style={{ fontSize: '1.25rem', color: 'var(--color-bright)', margin: 0 }}>
              Comparison Report
            </h2>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button
                className="btn-secondary"
                style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', padding: '0.4rem 0.8rem' }}
                onClick={handleDownloadMarkdown}
                title="Download report as Markdown"
              >
                <Download size={14} /> Markdown
              </button>
              <button
                className="btn-secondary"
                style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', padding: '0.4rem 0.8rem' }}
                onClick={handleDownloadJSON}
                title="Download report as JSON"
              >
                <Download size={14} /> JSON
              </button>
              <button
                className="btn-secondary"
                style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', padding: '0.4rem 0.8rem' }}
                disabled={loading || selectedIds.length !== 2}
                onClick={runComparison}
              >
                <RefreshCw size={14} /> Re-generate
              </button>
            </div>
          </div>

          {/* Side-by-side stat cards */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', marginBottom: '2rem' }}>
            {[selected1, selected2].map((s, idx) => s && (
              <div key={s.id} className="glass-card" style={{ borderTop: `4px solid ${idx === 0 ? 'var(--primary)' : 'var(--warning)'}` }}>
                <h3 style={{ fontSize: '1.1rem', color: 'var(--color-bright)', marginBottom: '1rem', textAlign: 'center' }}>
                  {idx === 0 ? 'Society A' : 'Society B'}: {s.title}
                </h3>
                <div style={{ display: 'flex', gap: '1.5rem', justifyContent: 'center', fontSize: '0.85rem', color: 'var(--text-dim)' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}><Users size={14} /> {s.agentCount} agents</span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}><Clock size={14} /> {s.completedIterations} iter</span>
                </div>
              </div>
            ))}
          </div>

          {/* Configuration Differences */}
          {comparison.economyParamDiffs && comparison.economyParamDiffs.length > 0 && (
            <ConfigDiffSection
              diffs={comparison.economyParamDiffs}
              session1Title={selected1?.title ?? 'Session A'}
              session2Title={selected2?.title ?? 'Session B'}
            />
          )}

          {/* Dimensions */}
          <div className="glass-card" style={{ marginBottom: '2rem' }}>
            <h3 style={{ fontSize: '1rem', color: 'var(--color-bright)', marginBottom: '1.25rem' }}>
              Dimensions
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginLeft: '1rem', fontWeight: 'normal' }}>
                (click to expand analysis)
              </span>
            </h3>
            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', paddingLeft: '180px' }}>
              <div style={{ flex: 1, textAlign: 'center', fontSize: '0.8rem', color: 'var(--primary)' }}>Society A</div>
              <div style={{ flex: 1, textAlign: 'center', fontSize: '0.8rem', color: 'var(--warning)' }}>Society B</div>
            </div>
            {comparison.dimensions.map((dim, idx) => (
              <DimensionRow key={dim.name} dim={dim} idx={idx} />
            ))}

            <div style={{ display: 'flex', gap: '1.5rem', marginTop: '2rem', flexWrap: 'wrap' }}>
              <SVGLineChart title={selected1?.title || 'Society A'} iterations={session1Iterations} />
              <SVGLineChart title={selected2?.title || 'Society B'} iterations={session2Iterations} />
            </div>
          </div>

          {/* Economic Indicator Comparison Charts */}
          {(session1Telemetry.length > 0 || session2Telemetry.length > 0) && (
            <EconomyComparisonCharts
              t1={session1Telemetry}
              t2={session2Telemetry}
              title1={selected1?.title || 'Society A'}
              title2={selected2?.title || 'Society B'}
            />
          )}

          {/* Narrative */}
          <div className="glass-panel" style={{ padding: '1.5rem', marginBottom: '2rem' }}>
            <h3 style={{ fontSize: '1rem', color: 'var(--color-bright)', marginBottom: '1rem' }}>Central Analysis</h3>
            <MarkdownText>{comparison.narrative}</MarkdownText>
          </div>

          {/* Verdict callout */}
          <div style={{
            padding: '1.25rem 1.5rem',
            background: 'var(--panel-alpha-05)',
            borderLeft: '4px solid var(--primary)',
            borderRadius: '8px',
            marginBottom: '2rem',
          }}>
            <p style={{ color: 'var(--color-bright)', fontWeight: 'bold', marginBottom: '0.25rem' }}>Verdict</p>
            <MarkdownText>{comparison.verdict}</MarkdownText>
          </div>

          {/* Follow-up chat */}
          <div className="glass-card">
            <h3 style={{ fontSize: '1rem', color: 'var(--color-bright)', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <MessageSquare size={18} /> Follow-up Questions
            </h3>

            {messages.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1rem', maxHeight: '320px', overflowY: 'auto' }}>
                {messages.map((msg, idx) => (
                  <div
                    key={idx}
                    style={{
                      padding: '0.75rem 1rem',
                      borderRadius: '8px',
                      background: msg.role === 'user' ? 'var(--panel-alpha-05)' : 'rgba(99,102,241,0.1)',
                      alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
                      maxWidth: '85%',
                    }}
                  >
                    <p style={{ color: msg.role === 'user' ? 'var(--text-main)' : 'var(--color-bright)', fontSize: '0.9rem', lineHeight: 1.6 }}>
                      {msg.role === 'assistant' ? (
                        <MarkdownText>{msg.content}</MarkdownText>
                      ) : (
                        msg.content
                      )}
                    </p>
                  </div>
                ))}
                {chatPending && (
                  <div style={{ padding: '0.75rem 1rem', borderRadius: '8px', background: 'rgba(99,102,241,0.1)', alignSelf: 'flex-start' }}>
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Thinking…</span>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>
            )}

            <form onSubmit={handleChat} style={{ display: 'flex', gap: '0.75rem' }}>
              <input
                type="text"
                className="input-glass"
                placeholder="Ask a follow-up question about these societies…"
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                disabled={chatPending}
                style={{ flex: 1 }}
              />
              <button
                type="submit"
                className="btn-secondary"
                style={{ padding: '0.5rem 1rem' }}
                disabled={!chatInput.trim() || chatPending}
              >
                <Send size={16} />
              </button>
            </form>
          </div>
        </>
      )}
    </div>
  );
};

export default CompareSessions;
