import React from 'react';

interface DiffMarkerProps {
  baselineValue: number | boolean | string;
  currentValue: number | boolean | string;
  label?: string;
}

/**
 * Inline diff display showing baseline vs current value.
 * Renders nothing when values are equal.
 */
export default function DiffMarker({ baselineValue, currentValue, label }: DiffMarkerProps) {
  if (baselineValue === currentValue) return null;

  const isNumeric = typeof baselineValue === 'number' && typeof currentValue === 'number';
  const delta = isNumeric ? (currentValue as number) - (baselineValue as number) : null;

  const deltaStr =
    delta !== null
      ? delta > 0
        ? `(+${formatNum(delta)})`
        : `(${formatNum(delta)})`
      : null;

  const deltaColor =
    delta !== null
      ? delta > 0
        ? 'var(--color-yellow, #eab308)'
        : 'var(--color-blue, #3b82f6)'
      : 'var(--text-muted)';

  return (
    <span
      style={{
        fontSize: '0.75rem',
        color: 'var(--text-muted)',
        marginLeft: '0.4rem',
        whiteSpace: 'nowrap',
      }}
    >
      <span style={{ opacity: 0.7 }}>
        baseline: {String(baselineValue)}
      </span>
      {' -> '}
      <span>{String(currentValue)}</span>
      {deltaStr && (
        <span style={{ color: deltaColor, marginLeft: '0.25rem', fontWeight: 600 }}>
          {deltaStr}
        </span>
      )}
    </span>
  );
}

function formatNum(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
}
