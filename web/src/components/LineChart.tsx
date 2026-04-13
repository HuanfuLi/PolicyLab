import React, { useLayoutEffect, useRef, useState } from 'react';

// Measure a DOM element's rendered width via ResizeObserver. Used to render
// SVG charts at 1:1 with their actual pixel container, so nothing scales
// vertically when the parent widens — which would otherwise overflow any
// fixed-height wrapper (e.g. the maxHeight cap in Reflection.tsx).
function useMeasuredWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.getBoundingClientRect().width);
    const ro = new ResizeObserver(entries => {
      const entry = entries[0];
      if (entry) setWidth(Math.floor(entry.contentRect.width));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

interface Series {
  label: string;
  color: string;
  data: number[];
  /** Fixed Y-axis range [min, max]. When omitted, auto-scaled from data. */
  yRange?: [number, number];
}

interface LineChartProps {
  series: Series[];
  width?: number;
  height?: number;
  /** Labels for x-axis ticks */
  xLabels?: string[];
  /** When true, each series is rendered as its own mini-chart with an independent Y axis. */
  splitAxes?: boolean;
}

// ── Single-series mini chart (used in splitAxes mode) ──────────────────────

function MiniChart({ s, width, height, xLabels, pointCount }: {
  s: Series; width: number; height: number; xLabels?: string[]; pointCount: number;
}) {
  const padding = { top: 6, right: 12, bottom: 4, left: 36 };
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;

  const [fixedMin, fixedMax] = s.yRange ?? [undefined, undefined];
  const dataMin = Math.min(...s.data);
  const dataMax = Math.max(...s.data);
  const minVal = fixedMin ?? dataMin;
  const maxVal = fixedMax ?? dataMax;
  const range = maxVal - minVal || 1;

  const xStep = pointCount > 1 ? chartW / (pointCount - 1) : 0;
  const toX = (i: number) => padding.left + i * xStep;
  const toY = (v: number) => padding.top + chartH - ((v - minVal) / range) * chartH;

  const fmt = (n: number) => {
    if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
    if (Math.abs(n) >= 1_000) return (n / 1_000).toFixed(1) + 'k';
    return Number.isInteger(n) ? n.toString() : n.toFixed(1);
  };

  const path = s.data.map((v, i) => `${i === 0 ? 'M' : 'L'}${toX(i).toFixed(1)},${toY(v).toFixed(1)}`).join(' ');
  const lastIdx = s.data.length - 1;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', marginBottom: '0.1rem' }}>
        <div style={{ width: 10, height: 3, background: s.color, borderRadius: 1 }} />
        <span style={{ fontSize: '0.72rem', color: s.color, fontWeight: 600 }}>{s.label}</span>
      </div>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: 'block' }}>
        {/* Grid */}
        <line x1={padding.left} x2={width - padding.right} y1={toY(minVal)} y2={toY(minVal)}
          stroke="rgba(255,255,255,0.06)" strokeWidth={1} />
        <line x1={padding.left} x2={width - padding.right} y1={toY((minVal + maxVal) / 2)} y2={toY((minVal + maxVal) / 2)}
          stroke="rgba(255,255,255,0.06)" strokeWidth={1} strokeDasharray="3,3" />
        <line x1={padding.left} x2={width - padding.right} y1={toY(maxVal)} y2={toY(maxVal)}
          stroke="rgba(255,255,255,0.06)" strokeWidth={1} />

        {/* Y labels */}
        <text x={padding.left - 4} y={toY(maxVal) + 3} textAnchor="end" fill="rgba(255,255,255,0.35)" fontSize={8}>{fmt(maxVal)}</text>
        <text x={padding.left - 4} y={toY(minVal) + 3} textAnchor="end" fill="rgba(255,255,255,0.35)" fontSize={8}>{fmt(minVal)}</text>

        {/* Line */}
        <path d={path} fill="none" style={{ stroke: s.color }} strokeWidth={1.5} strokeLinejoin="round" opacity={0.85} />
        <circle cx={toX(lastIdx)} cy={toY(s.data[lastIdx])} r={2.5} style={{ fill: s.color }} />
      </svg>
    </div>
  );
}

// ── Main LineChart ──────────────────────────────────────────────────────────

/**
 * Simple SVG line chart. No external dependencies.
 * When `splitAxes` is true, each series is rendered as a stacked mini-chart
 * with its own Y axis — useful when series have very different value ranges.
 */
export function LineChart({ series, width: widthProp, height = 180, xLabels, splitAxes }: LineChartProps) {
  const [containerRef, measuredWidth] = useMeasuredWidth<HTMLDivElement>();

  if (series.length === 0 || series[0].data.length === 0) {
    return (
      <div ref={containerRef} style={{ color: 'var(--text-dim)', fontSize: '0.85rem', textAlign: 'center', padding: '1rem' }}>
        No data
      </div>
    );
  }

  // Render width: prefer the measured container width so the SVG renders 1:1
  // with its actual pixel container (no aspect-ratio scaling that would make
  // the chart grow vertically when the parent widens). Falls back to caller-
  // supplied width or a sensible default during the throwaway first render
  // (useLayoutEffect updates measuredWidth before paint, so the user sees
  // only the corrected render).
  const width = measuredWidth || widthProp || 400;

  const pointCount = series[0].data.length;

  // ── Split-axes mode: independent mini-charts ────────────────────────────
  if (splitAxes) {
    // Divide total height among series, with space for x-axis labels at bottom
    const xAxisHeight = 22;
    const gap = 4;
    const miniH = Math.max(40, Math.floor((height - xAxisHeight - gap * (series.length - 1)) / series.length));

    // X-axis ticks (reused from shared mode)
    const xTickCount = Math.min(5, pointCount);
    const xTickStep = Math.max(1, Math.floor((pointCount - 1) / (xTickCount - 1)));
    const xTicks: number[] = [];
    for (let i = 0; i < pointCount; i += xTickStep) xTicks.push(i);
    if (xTicks[xTicks.length - 1] !== pointCount - 1) xTicks.push(pointCount - 1);

    const padding = { left: 36, right: 12 };
    const chartW = width - padding.left - padding.right;
    const xStep = pointCount > 1 ? chartW / (pointCount - 1) : 0;
    const toX = (i: number) => padding.left + i * xStep;

    return (
      <div ref={containerRef} style={{ width: '100%' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: `${gap}px` }}>
          {series.map((s, si) => (
            <MiniChart key={si} s={s} width={width} height={miniH} xLabels={xLabels} pointCount={pointCount} />
          ))}
        </div>
        {/* Shared x-axis */}
        <svg width={width} height={xAxisHeight} viewBox={`0 0 ${width} ${xAxisHeight}`} style={{ display: 'block' }}>
          {xTicks.map(i => (
            <text key={`x-${i}`} x={toX(i)} y={14} textAnchor="middle"
              fill="rgba(255,255,255,0.35)" fontSize={9}>{xLabels ? xLabels[i] : i + 1}</text>
          ))}
        </svg>
      </div>
    );
  }

  // ── Shared-axis mode (original behavior) ────────────────────────────────
  const padding = { top: 10, right: 12, bottom: 28, left: 36 };
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;

  const allValues = series.flatMap(s => s.data);
  const minVal = Math.min(...allValues);
  const maxVal = Math.max(...allValues);
  const range = maxVal - minVal || 1;

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
    <div ref={containerRef} style={{ width: '100%' }}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: 'block' }}>
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
