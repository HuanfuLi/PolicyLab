import React, { useState } from 'react';
import type { DataSource, ConfidenceLevel } from '@policylab/shared';

interface DataConfidenceBadgeProps {
  source: DataSource;
  confidence: ConfidenceLevel;
  sourceNote?: string;
}

const sourceLabels: Record<DataSource, string> = {
  api: 'API',
  web: 'Web',
  llm: 'Estimate',
};

const confidenceColors: Record<ConfidenceLevel, string> = {
  high: 'var(--color-green, #22c55e)',
  medium: 'var(--color-yellow, #eab308)',
  low: 'var(--color-red, #ef4444)',
};

const DataConfidenceBadge: React.FC<DataConfidenceBadgeProps> = ({ source, confidence, sourceNote }) => {
  const [showTooltip, setShowTooltip] = useState(false);

  return (
    <span
      style={{
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.25rem',
        fontSize: '0.7rem',
        padding: '0.1rem 0.4rem',
        borderRadius: '6px',
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        cursor: sourceNote ? 'help' : 'default',
        lineHeight: 1.4,
      }}
      onMouseEnter={() => sourceNote && setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      <span style={{
        width: '6px',
        height: '6px',
        borderRadius: '50%',
        background: confidenceColors[confidence],
        flexShrink: 0,
      }} />
      <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>
        {sourceLabels[source]}
      </span>

      {showTooltip && sourceNote && (
        <span style={{
          position: 'absolute',
          bottom: '100%',
          left: '50%',
          transform: 'translateX(-50%)',
          marginBottom: '4px',
          padding: '0.35rem 0.6rem',
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
          borderRadius: '6px',
          fontSize: '0.7rem',
          color: 'var(--text)',
          whiteSpace: 'nowrap',
          zIndex: 100,
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
        }}>
          {sourceNote}
        </span>
      )}
    </span>
  );
};

export default DataConfidenceBadge;
