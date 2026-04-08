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
}

/**
 * Simple SVG line chart. No external dependencies.
 */
export function LineChart({ series, width = 400, height = 180, xLabels }: LineChartProps) {
  if (series.length === 0 || series[0].data.length === 0) {
    return <div style={{ color: 'var(--text-dim)', fontSize: '0.85rem', textAlign: 'center', padding: '1rem' }}>No data</div>;
  }

  const padding = { top: 10, right: 12, bottom: 28, left: 36 };
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

  // Y-axis ticks
  const yTicks = [minVal, Math.round((minVal + maxVal) / 2), maxVal];

  // X-axis ticks (show ~5 evenly spaced)
  const xTickCount = Math.min(5, pointCount);
  const xTickStep = Math.max(1, Math.floor((pointCount - 1) / (xTickCount - 1)));
  const xTicks: number[] = [];
  for (let i = 0; i < pointCount; i += xTickStep) xTicks.push(i);
  if (xTicks[xTicks.length - 1] !== pointCount - 1) xTicks.push(pointCount - 1);

  return (
    <div style={{ width: '100%' }}>
      <svg viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', height: 'auto' }}>
        {/* Grid lines */}
        {yTicks.map((v, i) => (
          <line key={`grid-${i}`} x1={padding.left} x2={width - padding.right} y1={toY(v)} y2={toY(v)}
            stroke="rgba(255,255,255,0.06)" strokeWidth={1} />
        ))}

        {/* Y-axis labels */}
        {yTicks.map((v, i) => (
          <text key={`y-${i}`} x={padding.left - 4} y={toY(v) + 3} textAnchor="end"
            fill="rgba(255,255,255,0.35)" fontSize={9}>{Math.round(v)}</text>
        ))}

        {/* X-axis labels */}
        {xTicks.map(i => (
          <text key={`x-${i}`} x={toX(i)} y={height - 4} textAnchor="middle"
            fill="rgba(255,255,255,0.35)" fontSize={9}>{xLabels ? xLabels[i] : i + 1}</text>
        ))}

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

      {/* Legend */}
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
