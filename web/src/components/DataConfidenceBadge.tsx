import React from 'react';
import type { ConfidenceLevel } from '@policylab/shared';

interface DataConfidenceBadgeProps {
  confidence: ConfidenceLevel;
  source?: string;
}

const COLORS: Record<ConfidenceLevel, string> = {
  high: 'var(--success, #22c55e)',
  medium: 'var(--warning, #eab308)',
  low: 'var(--danger, #ef4444)',
};

/**
 * Small inline badge showing data confidence level.
 * If plan 07-03 provides a richer version, that should supersede this file.
 */
export default function DataConfidenceBadge({ confidence, source }: DataConfidenceBadgeProps) {
  return (
    <span
      title={source ? `Source: ${source} (${confidence} confidence)` : `${confidence} confidence`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.2rem',
        fontSize: '0.65rem',
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
        color: COLORS[confidence],
        marginLeft: '0.35rem',
        cursor: 'help',
      }}
    >
      <span
        style={{
          width: '6px',
          height: '6px',
          borderRadius: '50%',
          background: COLORS[confidence],
          flexShrink: 0,
        }}
      />
      {confidence}
    </span>
  );
}
