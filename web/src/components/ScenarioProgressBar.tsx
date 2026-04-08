interface ScenarioProgressBarProps {
  label: string;
  current: number;
  total: number;
  color: string;
  isComplete: boolean;
  isPaused: boolean;
  error: string | null;
}

export function ScenarioProgressBar({
  label,
  current,
  total,
  color,
  isComplete,
  isPaused,
  error,
}: ScenarioProgressBarProps) {
  const pct = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0;
  const status = error ? 'Error' : isComplete ? 'Complete' : `${pct}%`;

  return (
    <div style={{ flex: '1 1 200px', minWidth: 150 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color, marginBottom: 2 }}>
        {label}: {status}
      </div>
      <div
        style={{
          height: 8,
          borderRadius: 4,
          background: 'var(--panel-alpha-10, rgba(255,255,255,0.1))',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: '100%',
            borderRadius: 4,
            background: error ? 'var(--danger)' : color,
            opacity: isPaused ? 0.65 : 0.8,
            animation: isPaused ? 'pulse 1.5s ease-in-out infinite' : undefined,
            transition: 'width 0.2s ease',
          }}
        />
      </div>
    </div>
  );
}
