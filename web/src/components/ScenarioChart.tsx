import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { ScenarioMeta, MergedDataPoint } from '@policylab/shared/scenarioDataMerge';
import { ScenarioStatBadge } from './ScenarioStatBadge';

export const SCENARIO_COLORS = [
  'var(--chart-blue)',
  'var(--chart-orange)',
  'var(--chart-green)',
  'var(--chart-violet)',
];

export const SCENARIO_DASHES = ['', '8 4', '4 4', '2 4'];

interface ScenarioChartProps {
  data: MergedDataPoint[];
  scenarios: ScenarioMeta[];
  field: string;
  title: string;
  yFormatter?: (value: number) => string;
  chartType?: 'line' | 'area' | 'bar';
}

const panelStyle = {
  background: 'var(--glass-bg)',
  border: '1px solid var(--glass-border)',
  borderRadius: 10,
  padding: 16,
};

const titleStyle = {
  fontSize: 16,
  fontWeight: 700,
  color: 'var(--text-main)',
  marginBottom: 12,
};

const tooltipStyle = {
  background: 'var(--bg-color)',
  border: '1px solid var(--primary)',
  borderRadius: 8,
  padding: '8px 12px',
};

function getScenarioColor(index: number) {
  return SCENARIO_COLORS[index] ?? SCENARIO_COLORS[0];
}

function getScenarioDash(index: number) {
  return SCENARIO_DASHES[index] ?? SCENARIO_DASHES[0];
}

function getLatestValue(data: MergedDataPoint[], key: string) {
  for (let index = data.length - 1; index >= 0; index -= 1) {
    const value = data[index]?.[key];
    if (typeof value === 'number') {
      return value;
    }
  }

  return null;
}

export function ScenarioChart({
  data,
  scenarios,
  field,
  title,
  yFormatter,
  chartType = 'line',
}: ScenarioChartProps) {
  const sharedProps = {
    data,
    margin: { top: 4, right: 16, left: 0, bottom: 4 },
  };

  const commonAxes = (
    <>
      <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" />
      <XAxis
        dataKey="iterationNumber"
        tick={{ fill: 'var(--text-dim)', fontSize: 10 }}
      />
      <YAxis
        tickFormatter={yFormatter}
        tick={{ fill: 'var(--text-dim)', fontSize: 10 }}
        width={48}
      />
      <Tooltip contentStyle={tooltipStyle} />
      <Legend wrapperStyle={{ fontSize: '0.75rem' }} />
    </>
  );

  return (
    <div style={panelStyle}>
      <div style={titleStyle}>{title}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 8 }}>
        {scenarios.map((scenario) => {
          const key = `${field}_${scenario.label}`;
          return (
            <ScenarioStatBadge
              key={scenario.sessionId}
              label={scenario.label}
              value={getLatestValue(data, key)}
              color={getScenarioColor(scenario.index)}
              formatter={yFormatter}
            />
          );
        })}
      </div>
      <ResponsiveContainer width="100%" height={200}>
        {chartType === 'area' ? (
          <AreaChart {...sharedProps}>
            {commonAxes}
            {scenarios.map((scenario) => (
              <Area
                key={scenario.sessionId}
                type="monotone"
                dataKey={`${field}_${scenario.label}`}
                stroke={getScenarioColor(scenario.index)}
                strokeDasharray={getScenarioDash(scenario.index)}
                fill={getScenarioColor(scenario.index)}
                fillOpacity={0.16}
                strokeWidth={2}
                dot={false}
                name={scenario.label}
                connectNulls
              />
            ))}
          </AreaChart>
        ) : chartType === 'bar' ? (
          <BarChart {...sharedProps}>
            {commonAxes}
            {scenarios.map((scenario) => (
              <Bar
                key={scenario.sessionId}
                dataKey={`${field}_${scenario.label}`}
                fill={getScenarioColor(scenario.index)}
                name={scenario.label}
                radius={[3, 3, 0, 0]}
              />
            ))}
          </BarChart>
        ) : (
          <LineChart {...sharedProps}>
            {commonAxes}
            {scenarios.map((scenario) => (
              <Line
                key={scenario.sessionId}
                type="monotone"
                dataKey={`${field}_${scenario.label}`}
                stroke={getScenarioColor(scenario.index)}
                strokeDasharray={SCENARIO_DASHES[scenario.index]}
                strokeWidth={2}
                dot={false}
                name={scenario.label}
                connectNulls
              />
            ))}
          </LineChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}
