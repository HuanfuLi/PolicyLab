import React from 'react';

interface Series {
  label: string;
  color: string;
  data: number[];
}

interface LineChartProps {
  series: Series[];
  width?: number;
  height?: number;
  /** Labels for x-axis ticks */
  xLabels?: string[];
  /** Render each series as its own sub-chart with independent Y-axis */
  split?: boolean;
}

function formatYValue(v: number): string {
  if (Math.abs(v) >= 1000) return `${(v / 1000).toFixed(1)}k`;
  if (Number.isInteger(v)) return String(v);
  return v.toFixed(1);
}

function SingleChart({ series, width, height, xLabels, showXLabels }: {
  series: Series[];
  width: number;
  height: number;
  xLabels?: string[];
  showXLabels: boolean;
}) {
  const padding = { top: 14, right: 12, bottom: showXLabels ? 28 : 8, left: 42 };
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;

  const allValues = series.flatMap(s => s.data);
  const minVal = Math.min(...allValues);
  const maxVal = Math.max(...allValues);
  const range = maxVal - minVal || 1;

  const pointCount = series[0].data.length;
  const xStep = pointCount > 1 ? chartW / (pointCount - 1) : 0;

  const toX = (i: number) => padding.left + i * xStep;
  const toY = (v: number) => padding.top + chartH - ((v - minVal) / range) * chartH;

  const yTicks = [minVal, (minVal + maxVal) / 2, maxVal];

  const xTickCount = Math.min(5, pointCount);
  const xTickStep = Math.max(1, Math.floor((pointCount - 1) / (xTickCount - 1)));
  const xTicks: number[] = [];
  for (let i = 0; i < pointCount; i += xTickStep) xTicks.push(i);
  if (xTicks[xTicks.length - 1] !== pointCount - 1) xTicks.push(pointCount - 1);

  const axisLeft = padding.left;
  const axisRight = width - padding.right;
  const axisTop = padding.top;
  const axisBottom = padding.top + chartH;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
      {/* Y-axis line */}
      <line x1={axisLeft} x2={axisLeft} y1={axisTop} y2={axisBottom}
        style={{ stroke: 'var(--chart-axis)' }} strokeWidth={1} />

      {/* X-axis line */}
      <line x1={axisLeft} x2={axisRight} y1={axisBottom} y2={axisBottom}
        style={{ stroke: 'var(--chart-axis)' }} strokeWidth={1} />

      {/* Grid lines */}
      {yTicks.map((v, i) => (
        <line key={`grid-${i}`} x1={axisLeft} x2={axisRight} y1={toY(v)} y2={toY(v)}
          style={{ stroke: 'var(--chart-grid)' }} strokeWidth={1} />
      ))}

      {/* Y-axis tick marks + labels */}
      {yTicks.map((v, i) => (
        <g key={`y-${i}`}>
          <line x1={axisLeft - 3} x2={axisLeft} y1={toY(v)} y2={toY(v)}
            style={{ stroke: 'var(--chart-tick)' }} strokeWidth={1} />
          <text x={axisLeft - 5} y={toY(v) + 3} textAnchor="end"
            style={{ fill: 'var(--chart-label)' }} fontSize={9}>{formatYValue(v)}</text>
        </g>
      ))}

      {/* X-axis tick marks + labels */}
      {showXLabels && xTicks.map(i => (
        <g key={`x-${i}`}>
          <line x1={toX(i)} x2={toX(i)} y1={axisBottom} y2={axisBottom + 3}
            style={{ stroke: 'var(--chart-tick)' }} strokeWidth={1} />
          <text x={toX(i)} y={height - 4} textAnchor="middle"
            style={{ fill: 'var(--chart-label)' }} fontSize={9}>{xLabels ? xLabels[i] : i + 1}</text>
        </g>
      ))}

      {/* Label for this sub-chart */}
      {series.length === 1 && (
        <text x={axisLeft + 6} y={axisTop + 10} fontSize={9} style={{ fill: series[0].color }} fontWeight="600" opacity={0.9}>
          {series[0].label}
        </text>
      )}

      {/* Lines */}
      {series.map((s, si) => {
        const path = s.data.map((v, i) => `${i === 0 ? 'M' : 'L'}${toX(i).toFixed(1)},${toY(v).toFixed(1)}`).join(' ');
        return <path key={si} d={path} fill="none" style={{ stroke: s.color }} strokeWidth={1.5} strokeLinejoin="round" opacity={0.85} />;
      })}

      {/* Dots on last point */}
      {series.map((s, si) => {
        const lastIdx = s.data.length - 1;
        return <circle key={`dot-${si}`} cx={toX(lastIdx)} cy={toY(s.data[lastIdx])} r={3} style={{ fill: s.color }} />;
      })}
    </svg>
  );
}

/**
 * Simple SVG line chart. No external dependencies.
 * When `split` is true, renders each series as a separate sub-chart with its own Y-axis.
 */
export function LineChart({ series, width = 400, height = 180, xLabels, split }: LineChartProps) {
  if (series.length === 0 || series[0].data.length === 0) {
    return <div style={{ color: 'var(--text-dim)', fontSize: '0.85rem', textAlign: 'center', padding: '1rem' }}>No data</div>;
  }

  if (split && series.length > 1) {
    const subHeight = Math.round(height / series.length);
    return (
      <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        {series.map((s, i) => (
          <div key={i} style={{
            background: 'var(--panel-alpha-05)',
            border: '1px solid var(--glass-border)',
            borderRadius: '8px',
            padding: '0.5rem 0.5rem 0.35rem',
          }}>
            <SingleChart
              series={[s]}
              width={width}
              height={subHeight}
              xLabels={xLabels}
              showXLabels={i === series.length - 1}
            />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div style={{ width: '100%' }}>
      <SingleChart series={series} width={width} height={height} xLabels={xLabels} showXLabels={true} />
      {/* Legend (only needed when multiple series share one chart) */}
      <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', marginTop: '0.25rem' }}>
        {series.map((s, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.75rem', color: 'var(--text-dim)' }}>
            <div style={{ width: 10, height: 3, background: s.color, borderRadius: 1 }} />
            {s.label}
          </div>
        ))}
      </div>
    </div>
  );
}
