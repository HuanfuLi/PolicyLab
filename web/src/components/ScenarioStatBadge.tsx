interface ScenarioStatBadgeProps {
  label: string;
  value: number | null | undefined;
  color: string;
  formatter?: (value: number) => string;
}

export function ScenarioStatBadge({ label, value, color, formatter }: ScenarioStatBadgeProps) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        color,
        fontSize: '0.75rem',
        fontWeight: 700,
        whiteSpace: 'nowrap',
      }}
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: color,
          flexShrink: 0,
        }}
      />
      {label}: {value != null ? (formatter ? formatter(value) : value.toFixed(1)) : '--'}
    </span>
  );
}
