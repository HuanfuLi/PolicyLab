import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { EconomyConfig } from '@policylab/shared';
import type { ScenarioMeta } from '@policylab/shared/scenarioDataMerge';

interface ConfigDiffHeaderProps {
  scenarios: ScenarioMeta[];
  configs: Record<string, Partial<EconomyConfig>>;
}

interface DiffRow {
  key: keyof EconomyConfig;
  values: Array<number | boolean | undefined>;
}

function formatValue(value: number | boolean | undefined) {
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }

  if (typeof value === 'number') {
    return Number.isInteger(value) ? String(value) : value.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
  }

  return '—';
}

export function ConfigDiffHeader({ scenarios, configs }: ConfigDiffHeaderProps) {
  const [expanded, setExpanded] = useState(false);

  const diffRows = useMemo(() => {
    if (scenarios.length <= 1) {
      return [];
    }

    const keys = new Set<keyof EconomyConfig>();
    for (const scenario of scenarios) {
      const config = configs[scenario.sessionId];
      if (!config) {
        continue;
      }

      for (const key of Object.keys(config) as Array<keyof EconomyConfig>) {
        const value = config[key];
        if (typeof value === 'number' || typeof value === 'boolean') {
          keys.add(key);
        }
      }
    }

    const baseline = configs[scenarios[0].sessionId] ?? {};

    return Array.from(keys)
      .sort((a, b) => String(a).localeCompare(String(b)))
      .reduce<DiffRow[]>((rows, key) => {
        const values = scenarios.map((scenario) => {
          const value = configs[scenario.sessionId]?.[key];
          return typeof value === 'number' || typeof value === 'boolean' ? value : undefined;
        });
        const baselineValue = baseline[key];
        const differs = values.some((value) => value !== baselineValue);

        if (differs) {
          rows.push({ key, values });
        }

        return rows;
      }, []);
  }, [configs, scenarios]);

  if (scenarios.length <= 1) {
    return null;
  }

  return (
    <div
      style={{
        background: 'var(--glass-bg)',
        border: '1px solid var(--glass-border)',
        borderRadius: 10,
        padding: 16,
      }}
    >
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        style={{
          width: '100%',
          background: 'none',
          border: 'none',
          color: 'var(--text-main)',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          fontSize: 14,
          fontWeight: 700,
          textAlign: 'left',
          padding: 0,
        }}
      >
        {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        {diffRows.length > 0
          ? `Config Differences (${diffRows.length} parameters differ)`
          : 'Config Differences'}
      </button>

      {expanded ? (
        diffRows.length > 0 ? (
          <div style={{ overflowX: 'auto', marginTop: 12 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr>
                  <th style={headerCellStyle}>Parameter</th>
                  {scenarios.map((scenario) => (
                    <th key={scenario.sessionId} style={headerCellStyle}>
                      {scenario.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {diffRows.map((row) => {
                  const baselineValue = row.values[0];
                  return (
                    <tr key={String(row.key)}>
                      <td style={keyCellStyle}>{String(row.key)}</td>
                      {row.values.map((value, index) => (
                        <td
                          key={`${String(row.key)}-${scenarios[index].sessionId}`}
                          style={{
                            ...valueCellStyle,
                            background: index > 0 && value !== baselineValue ? 'var(--primary-alpha)' : 'transparent',
                          }}
                        >
                          {formatValue(value)}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ marginTop: 12, color: 'var(--text-dim)', fontSize: 12 }}>
            All scenarios use identical configuration
          </div>
        )
      ) : null}
    </div>
  );
}

const headerCellStyle = {
  textAlign: 'left' as const,
  padding: '8px 10px',
  color: 'var(--text-dim)',
  borderBottom: '1px solid var(--glass-border)',
  fontSize: 12,
  fontWeight: 700,
};

const keyCellStyle = {
  padding: '8px 10px',
  color: 'var(--text-main)',
  borderBottom: '1px solid var(--glass-border)',
  fontSize: 12,
  fontWeight: 700,
  fontFamily: 'monospace',
};

const valueCellStyle = {
  padding: '8px 10px',
  color: 'var(--text-main)',
  borderBottom: '1px solid var(--glass-border)',
  fontSize: 12,
  fontFamily: 'monospace',
};
