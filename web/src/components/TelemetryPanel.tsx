import React, { useEffect, useState } from 'react';

interface TelemetryLog {
  iterationNumber: number;
  totalFiatSupply: number;
  ammFoodReserve_Y: number;
  ammFiatReserve_X: number;
  ammSpotPrice_Food: number;
  totalCaloriesBurned: number;
  totalCaloriesProduced: number;
  actionFailureRate: number;
  giniCoefficient?: number;
  socialMobilityIndex?: number;
  trustIndex?: number;
  crimeRate?: number;
  averageCortisol?: number;
  averageDopamine?: number;
}

// ── Chart color tokens (kept in sync with --chart-* CSS variables in index.css)
const CHART_BLUE    = 'var(--chart-blue)';
const CHART_ORANGE  = 'var(--chart-orange)';
const CHART_GREEN   = 'var(--chart-green)';
const CHART_TEAL    = 'var(--chart-teal)';
const CHART_RED     = 'var(--chart-red)';
const CHART_VIOLET  = 'var(--chart-violet)';
const CHART_EMERALD = 'var(--chart-emerald)';
const CHART_CORAL   = 'var(--chart-coral)';

// ── SVGLineChart ─────────────────────────────────────────────────────────────

interface SVGLineChartProps {
  data: Array<{ x: number; y: number }>;
  color: string;
  label: string;
  width?: number;
  height?: number;
  data2?: Array<{ x: number; y: number }>;
  color2?: string;
  label2?: string;
  sharedYAxis?: boolean;
}

function SVGLineChart({
  data,
  color,
  label,
  width = 820,
  height = 160,
  data2,
  color2,
  label2,
  sharedYAxis = false,
}: SVGLineChartProps) {
  const paddingTop = 28;
  const paddingBottom = 28;
  const paddingLeft = 12;
  const paddingRight = 72;

  const chartW = width - paddingLeft - paddingRight;
  const chartH = height - paddingTop - paddingBottom;

  if (!data || data.length === 0) {
    return (
      <svg width={width} height={height} style={{ display: 'block' }}>
        <rect x={paddingLeft} y={paddingTop} width={chartW} height={chartH}
          fill="rgba(255,255,255,0.03)" rx={4} />
        <text x={paddingLeft + chartW / 2} y={paddingTop + chartH / 2}
          textAnchor="middle" dominantBaseline="middle"
          fill="rgba(255,255,255,0.3)" fontSize={12}>
          No data
        </text>
      </svg>
    );
  }

  // Series 1 normalization
  let yVals1 = data.map(d => d.y);
  let yMin1 = Math.min(...yVals1);
  let yMax1 = Math.max(...yVals1);

  // Series 2 normalization (independent)
  const hasSeries2 = !!data2 && data2.length > 0;
  let yVals2 = hasSeries2 ? data2!.map(d => d.y) : [];
  let yMin2 = hasSeries2 ? Math.min(...yVals2) : 0;
  let yMax2 = hasSeries2 ? Math.max(...yVals2) : 1;

  if (hasSeries2 && sharedYAxis) {
    const globalMin = Math.min(yMin1, yMin2);
    const globalMax = Math.max(yMax1, yMax2);
    yMin1 = globalMin;
    yMax1 = globalMax;
    yMin2 = globalMin;
    yMax2 = globalMax;
  }

  const yRange1 = yMax1 - yMin1 || 1;
  const yRange2 = yMax2 - yMin2 || 1;

  // X range (shared)
  const xVals = data.map(d => d.x);
  const xMin = Math.min(...xVals);
  const xMax = Math.max(...xVals);
  const xRange = xMax - xMin || 1;

  const toSvgX = (x: number) => paddingLeft + ((x - xMin) / xRange) * chartW;
  const toSvgY1 = (y: number) => paddingTop + chartH - ((y - yMin1) / yRange1) * chartH;
  const toSvgY2 = (y: number) => paddingTop + chartH - ((y - yMin2) / yRange2) * chartH;

  const points1 = data.map(d => `${toSvgX(d.x)},${toSvgY1(d.y)}`).join(' ');
  const points2 = hasSeries2
    ? data2!.map(d => `${toSvgX(d.x)},${toSvgY2(d.y)}`).join(' ')
    : '';

  // Grid lines (5 horizontal)
  const gridLines = [0, 0.25, 0.5, 0.75, 1].map(t => paddingTop + t * chartH);

  const fmt = (n: number) => {
    if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
    if (Math.abs(n) >= 1_000) return (n / 1_000).toFixed(1) + 'k';
    return n.toFixed(2);
  };

  return (
    <svg width={width} height={height} style={{ display: 'block' }}>
      {/* Background */}
      <rect x={paddingLeft} y={paddingTop} width={chartW} height={chartH}
        fill="rgba(255,255,255,0.03)" rx={4} />

      {/* Grid lines */}
      {gridLines.map((gy, i) => (
        <line key={i} x1={paddingLeft} y1={gy} x2={paddingLeft + chartW} y2={gy}
          stroke="rgba(255,255,255,0.08)" strokeWidth={1} />
      ))}

      {/* Title */}
      <text x={paddingLeft + chartW / 2} y={paddingTop - 10}
        textAnchor="middle" fill="rgba(255,255,255,0.6)" fontSize={11} fontWeight="600">
        {label}{hasSeries2 && label2 ? ` vs ${label2}` : ''}
      </text>

      {/* Polyline 2 drawn first (below) — dashed so series 1 always visible on top */}
      {hasSeries2 && (
        <polyline
          points={points2}
          fill="none"
          style={{ stroke: color2 ?? CHART_ORANGE }}
          strokeWidth={1.5}
          strokeLinejoin="round"
          strokeLinecap="round"
          strokeDasharray="6,3"
          strokeOpacity={0.85}
        />
      )}

      {/* Polyline 1 drawn on top — solid, full opacity */}
      <polyline
        points={points1}
        fill="none"
        style={{ stroke: color }}
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />

      {/* Dots: first and last for series 1 */}
      <circle cx={toSvgX(data[0].x)} cy={toSvgY1(data[0].y)} r={3} style={{ fill: color }} />
      <circle cx={toSvgX(data[data.length - 1].x)} cy={toSvgY1(data[data.length - 1].y)} r={3} style={{ fill: color }} />

      {/* Dots: first and last for series 2 */}
      {hasSeries2 && data2 && data2.length > 0 && (
        <>
          <circle cx={toSvgX(data2[0].x)} cy={toSvgY2(data2[0].y)} r={3} style={{ fill: color2 ?? CHART_ORANGE }} />
          <circle cx={toSvgX(data2[data2.length - 1].x)} cy={toSvgY2(data2[data2.length - 1].y)} r={3} style={{ fill: color2 ?? CHART_ORANGE }} />
        </>
      )}

      {/* Right-axis: series 1 min/max */}
      <text x={paddingLeft + chartW + 6} y={paddingTop + 5}
        style={{ fill: color }} fontSize={9} dominantBaseline="hanging">
        {fmt(yMax1)}
      </text>
      <text x={paddingLeft + chartW + 6} y={paddingTop + chartH}
        style={{ fill: color }} fontSize={9} dominantBaseline="auto">
        {fmt(yMin1)}
      </text>

      {/* Right-axis: series 2 min/max (offset slightly if dual, hidden if shared) */}
      {hasSeries2 && !sharedYAxis && (
        <>
          <text x={paddingLeft + chartW + 6} y={paddingTop + 16}
            style={{ fill: color2 ?? CHART_ORANGE }} fontSize={9} dominantBaseline="hanging">
            {fmt(yMax2)}
          </text>
          <text x={paddingLeft + chartW + 6} y={paddingTop + chartH - 12}
            style={{ fill: color2 ?? CHART_ORANGE }} fontSize={9} dominantBaseline="auto">
            {fmt(yMin2)}
          </text>
        </>
      )}

      {/* X-axis labels */}
      <text x={paddingLeft} y={paddingTop + chartH + 14}
        fill="rgba(255,255,255,0.4)" fontSize={9} textAnchor="start">
        iter {xMin}
      </text>
      <text x={paddingLeft + chartW} y={paddingTop + chartH + 14}
        fill="rgba(255,255,255,0.4)" fontSize={9} textAnchor="end">
        iter {xMax}
      </text>

      {/* Legend dots */}
      <circle cx={paddingLeft + 8} cy={paddingTop + 8} r={4} style={{ fill: color }} />
      <text x={paddingLeft + 16} y={paddingTop + 8}
        style={{ fill: color }} fontSize={9} dominantBaseline="middle">
        {label}
      </text>
      {hasSeries2 && label2 && (
        <>
          <line x1={paddingLeft + 80} y1={paddingTop + 8} x2={paddingLeft + 96} y2={paddingTop + 8}
            style={{ stroke: color2 ?? CHART_ORANGE }} strokeWidth={1.5} strokeDasharray="4,2" />
          <text x={paddingLeft + 100} y={paddingTop + 8}
            style={{ fill: color2 ?? CHART_ORANGE }} fontSize={9} dominantBaseline="middle">
            {label2}
          </text>
        </>
      )}
    </svg>
  );
}

// ── TelemetryPanel ───────────────────────────────────────────────────────────

interface TelemetryPanelProps {
  sessionId: string;
  onClose: () => void;
}

export default function TelemetryPanel({ sessionId, onClose }: TelemetryPanelProps) {
  const [logs, setLogs] = useState<TelemetryLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = () => setRefreshKey(k => k + 1);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/sessions/${sessionId}/simulate/telemetry`)
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data: TelemetryLog[]) => {
        setLogs(data ?? []);
        setLoading(false);
      })
      .catch(err => {
        setError(err.message);
        setLoading(false);
      });
  }, [sessionId, refreshKey]);

  // Map logs to chart data
  const toXY = (key: keyof TelemetryLog) =>
    logs.map(l => ({ x: l.iterationNumber, y: l[key] as number }));

  const fiatData = toXY('totalFiatSupply');
  const foodReserveData = toXY('ammFoodReserve_Y');
  const spotPriceData = toXY('ammSpotPrice_Food');
  const calProducedData = toXY('totalCaloriesProduced');
  const calBurnedData = toXY('totalCaloriesBurned');

  const latest = logs.length > 0 ? logs[logs.length - 1] : null;

  const fmt = (n: number, decimals = 2) => {
    if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M';
    if (Math.abs(n) >= 1_000) return (n / 1_000).toFixed(2) + 'k';
    return n.toFixed(decimals);
  };

  // ── Styles ──────────────────────────────────────────────────────────────────

  const overlayStyle: React.CSSProperties = {
    position: 'fixed',
    inset: 0,
    zIndex: 1000,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.72)',
    backdropFilter: 'blur(4px)',
  };

  const panelStyle: React.CSSProperties = {
    width: '100%',
    maxWidth: 960,
    maxHeight: '92vh',
    overflowY: 'auto',
    background: 'rgba(15,20,35,0.97)',
    border: '1px solid rgba(99,102,241,0.35)',
    borderRadius: 16,
    boxShadow: '0 24px 80px rgba(0,0,0,0.6)',
    backdropFilter: 'blur(16px)',
    padding: '0 0 24px 0',
  };

  const headerStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '20px 28px 16px',
    borderBottom: '1px solid rgba(255,255,255,0.08)',
    position: 'sticky',
    top: 0,
    background: 'rgba(15,20,35,0.97)',
    zIndex: 1,
    borderRadius: '16px 16px 0 0',
  };

  const titleStyle: React.CSSProperties = {
    margin: 0,
    fontSize: '1.15rem',
    fontWeight: 700,
    color: 'var(--text-main)',
    letterSpacing: '0.02em',
  };

  const closeBtnStyle: React.CSSProperties = {
    background: 'rgba(255,255,255,0.08)',
    border: '1px solid rgba(255,255,255,0.15)',
    borderRadius: 8,
    color: 'var(--text-main)',
    cursor: 'pointer',
    fontSize: '1.1rem',
    width: 34,
    height: 34,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    lineHeight: 1,
  };

  const sectionStyle: React.CSSProperties = {
    margin: '20px 24px 0',
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.07)',
    borderRadius: 10,
    padding: '16px 16px 8px',
  };

  const sectionTitleStyle: React.CSSProperties = {
    fontSize: '0.78rem',
    fontWeight: 700,
    color: 'rgba(255,255,255,0.45)',
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    marginBottom: 12,
  };

  const tableStyle: React.CSSProperties = {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: '0.78rem',
  };

  const thStyle: React.CSSProperties = {
    textAlign: 'left',
    padding: '6px 10px',
    color: 'rgba(255,255,255,0.45)',
    fontWeight: 600,
    borderBottom: '1px solid rgba(255,255,255,0.08)',
    fontSize: '0.72rem',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  };

  const tdStyle: React.CSSProperties = {
    padding: '8px 10px',
    color: 'var(--text-main)',
    fontVariantNumeric: 'tabular-nums',
    fontFamily: 'monospace',
    fontSize: '0.82rem',
  };

  const footerStyle: React.CSSProperties = {
    margin: '20px 24px 0',
    padding: '10px 14px',
    background: 'rgba(99,102,241,0.08)',
    border: '1px solid rgba(99,102,241,0.2)',
    borderRadius: 8,
    fontSize: '0.72rem',
    color: 'rgba(255,255,255,0.4)',
    textAlign: 'center',
    letterSpacing: '0.01em',
  };

  return (
    <div style={overlayStyle} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={panelStyle}>
        {/* Header */}
        <div style={headerStyle}>
          <h2 style={titleStyle}>📊 Economy Telemetry Terminal</h2>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button
              onClick={refresh}
              disabled={loading}
              style={{ background: 'rgba(99,102,241,0.2)', border: '1px solid rgba(99,102,241,0.4)', color: 'rgba(255,255,255,0.8)', borderRadius: 6, padding: '4px 12px', fontSize: '0.8rem', cursor: loading ? 'not-allowed' : 'pointer' }}
            >
              {loading ? '...' : 'Refresh'}
            </button>
            <button style={closeBtnStyle} onClick={onClose} aria-label="Close">×</button>
          </div>
        </div>

        {/* Body */}
        {loading ? (
          <div style={{ padding: '48px 28px', textAlign: 'center', color: 'rgba(255,255,255,0.5)', fontSize: '0.9rem' }}>
            ⏳ Loading telemetry data...
          </div>
        ) : error || logs.length === 0 ? (
          <div style={{ padding: '48px 28px', textAlign: 'center', color: 'rgba(255,255,255,0.4)', fontSize: '0.88rem' }}>
            No telemetry data available yet. Run a simulation to generate data.
          </div>
        ) : (
          <>
            {/* Chart 1A: Fiat Liquidity */}
            <div style={sectionStyle}>
              <div style={sectionTitleStyle}>Chart 1A — Fiat Supply</div>
              <SVGLineChart
                data={fiatData}
                color={CHART_BLUE}
                label="Fiat Supply"
                width={860}
                height={170}
              />
            </div>

            {/* Chart 1B: Food Reserve */}
            <div style={sectionStyle}>
              <div style={sectionTitleStyle}>Chart 1B — AMM Food Reserve</div>
              <SVGLineChart
                data={foodReserveData}
                color={CHART_ORANGE}
                label="Food Reserve"
                width={860}
                height={170}
              />
            </div>

            {/* Chart 2: Food Price Action */}
            <div style={sectionStyle}>
              <div style={sectionTitleStyle}>Chart 2 — Food Price Action</div>
              <SVGLineChart
                data={spotPriceData}
                color={CHART_GREEN}
                label="AMM Spot Price (Food)"
                width={860}
                height={170}
              />
            </div>

            {/* Chart 3: Thermodynamic Balance */}
            <div style={sectionStyle}>
              <div style={sectionTitleStyle}>Chart 3 — Thermodynamic Balance</div>
              <SVGLineChart
                data={calProducedData}
                color={CHART_TEAL}
                label="Cal Produced"
                data2={calBurnedData}
                color2={CHART_RED}
                label2="Cal Burned"
                sharedYAxis={true}
                width={860}
                height={170}
              />
            </div>

            {/* Chart 4: Wealth Inequality (Gini) */}
            {logs.some(l => l.giniCoefficient != null) && (
              <div style={sectionStyle}>
                <div style={sectionTitleStyle}>Chart 4 — Wealth Inequality (Gini Coefficient)</div>
                <SVGLineChart
                  data={logs.filter(l => l.giniCoefficient != null).map(l => ({ x: l.iterationNumber, y: l.giniCoefficient! }))}
                  color={CHART_VIOLET}
                  label="Gini (0=equal, 1=total inequality)"
                  width={860}
                  height={170}
                />
              </div>
            )}

            {/* Chart 5: Trust vs Crime */}
            {logs.some(l => l.trustIndex != null) && (
              <div style={sectionStyle}>
                <div style={sectionTitleStyle}>Chart 5 — Social Trust vs Crime Rate</div>
                <SVGLineChart
                  data={logs.filter(l => l.trustIndex != null).map(l => ({ x: l.iterationNumber, y: l.trustIndex! }))}
                  color={CHART_EMERALD}
                  label="Trust Index"
                  data2={logs.filter(l => l.crimeRate != null).map(l => ({ x: l.iterationNumber, y: l.crimeRate! }))}
                  color2={CHART_RED}
                  label2="Crime Rate"
                  sharedYAxis={true}
                  width={860}
                  height={170}
                />
              </div>
            )}

            {/* Chart 6: Population Psychology */}
            {logs.some(l => l.averageCortisol != null) && (
              <div style={sectionStyle}>
                <div style={sectionTitleStyle}>Chart 6 — Population Psychology</div>
                <SVGLineChart
                  data={logs.filter(l => l.averageCortisol != null).map(l => ({ x: l.iterationNumber, y: l.averageCortisol! }))}
                  color={CHART_CORAL}
                  label="Avg Cortisol"
                  data2={logs.filter(l => l.averageDopamine != null).map(l => ({ x: l.iterationNumber, y: l.averageDopamine! }))}
                  color2={CHART_BLUE}
                  label2="Avg Dopamine"
                  sharedYAxis={true}
                  width={860}
                  height={170}
                />
              </div>
            )}

            {/* Latest Stats Table */}
            {latest && (
              <div style={sectionStyle}>
                <div style={sectionTitleStyle}>Latest Iteration Stats (iter {latest.iterationNumber})</div>
                <table style={tableStyle}>
                  <thead>
                    <tr>
                      <th style={thStyle}>Fiat Supply</th>
                      <th style={thStyle}>AMM Food</th>
                      <th style={thStyle}>Spot Price</th>
                      <th style={thStyle}>Cal P/B</th>
                      <th style={thStyle}>Fail%</th>
                      <th style={thStyle}>Gini</th>
                      <th style={thStyle}>Trust</th>
                      <th style={thStyle}>Crime</th>
                      <th style={thStyle}>Cortisol</th>
                      <th style={thStyle}>Dopamine</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td style={tdStyle}>{fmt(latest.totalFiatSupply)}</td>
                      <td style={tdStyle}>{fmt(latest.ammFoodReserve_Y)}</td>
                      <td style={tdStyle}>{fmt(latest.ammSpotPrice_Food, 4)}</td>
                      <td style={tdStyle}>{fmt(latest.totalCaloriesProduced)}/{fmt(latest.totalCaloriesBurned)}</td>
                      <td style={tdStyle}>{(latest.actionFailureRate * 100).toFixed(1)}%</td>
                      <td style={tdStyle}>{latest.giniCoefficient?.toFixed(3) ?? '—'}</td>
                      <td style={tdStyle}>{latest.trustIndex?.toFixed(2) ?? '—'}</td>
                      <td style={tdStyle}>{latest.crimeRate?.toFixed(2) ?? '—'}</td>
                      <td style={tdStyle}>{latest.averageCortisol ?? '—'}</td>
                      <td style={tdStyle}>{latest.averageDopamine ?? '—'}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}

            {/* Footer */}
            <div style={footerStyle}>
              Data reflects deterministic physics engine output — no LLM inference.
            </div>
          </>
        )}
      </div>
    </div>
  );
}
