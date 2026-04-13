import React from 'react';
import {
  ResponsiveContainer,
  LineChart, Line,
  AreaChart, Area,
  BarChart, Bar,
  XAxis, YAxis,
  CartesianGrid, Tooltip, Legend,
} from 'recharts';
import { AlertTriangle } from 'lucide-react';
import type { TelemetryLog, FiscalCategory } from '@policylab/shared';

// ── Chart color tokens (kept in sync with --chart-* CSS variables in index.css)
const CHART_BLUE    = 'var(--chart-blue)';
const CHART_ORANGE  = 'var(--chart-orange)';
const CHART_GREEN   = 'var(--chart-green)';
const CHART_TEAL    = 'var(--chart-teal)';
const CHART_RED     = 'var(--chart-red)';
const CHART_VIOLET  = 'var(--chart-violet)';

// ── Styles shared with TelemetryPanel ───────────────────────────────────────

const sectionStyle: React.CSSProperties = {
  margin: '0 0 20px 0',
  background: 'var(--glass-bg)',
  border: '1px solid var(--glass-border)',
  borderRadius: 10,
  padding: '16px 16px 8px',
};

const sectionTitleStyle: React.CSSProperties = {
  fontSize: '0.78rem',
  fontWeight: 700,
  color: 'var(--text-dim)',
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  marginBottom: 12,
};

const emptyStateStyle: React.CSSProperties = {
  color: 'var(--text-dim)',
  fontSize: '0.82rem',
  textAlign: 'center',
  padding: '24px 0 16px',
  fontStyle: 'italic',
};

// ── Helpers ──────────────────────────────────────────────────────────────────

const fmtK = (n: number) => {
  if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (Math.abs(n) >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return n.toFixed(0);
};

const FISCAL_CATEGORIES: FiscalCategory[] = ['infrastructure', 'education', 'defense', 'welfare'];

const FISCAL_COLORS: Record<FiscalCategory, string> = {
  infrastructure: CHART_BLUE,
  education: CHART_TEAL,
  defense: CHART_RED,
  welfare: CHART_GREEN,
};

// ── Props ─────────────────────────────────────────────────────────────────────

interface EconomicDashboardProps {
  data: TelemetryLog[];
}

// ── Panel 1: CPI Line Chart ───────────────────────────────────────────────────

function CpiChart({ data }: { data: TelemetryLog[] }) {
  const filtered = data.filter(d => d.cpi != null);

  if (filtered.length === 0) {
    return (
      <div style={sectionStyle}>
        <div style={sectionTitleStyle}>CPI — Laspeyres Price Index</div>
        <div style={emptyStateStyle}>No CPI data — enable Inflation in Design Review to track price indices</div>
      </div>
    );
  }

  // Compute 5-point EWMA trend overlay (alpha=0.3)
  const alpha = 0.3;
  const chartData = filtered.reduce<Array<{ iterationNumber: number; cpi: number | null; trend: number }>>((acc, d, i) => {
    const prevEma = i === 0 ? d.cpi! : acc[i - 1].trend;
    const nextEma = alpha * d.cpi! + (1 - alpha) * prevEma;
    acc.push({ iterationNumber: d.iterationNumber, cpi: d.cpi ?? null, trend: parseFloat(nextEma.toFixed(4)) });
    return acc;
  }, []);

  return (
    <div style={sectionStyle}>
      <div style={sectionTitleStyle}>CPI — Laspeyres Price Index</div>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={chartData} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" />
          <XAxis dataKey="iterationNumber" label={{ value: 'Iteration', position: 'insideBottomRight', offset: -4, fill: 'var(--text-dim)', fontSize: 10 }} tick={{ fill: 'var(--text-dim)', fontSize: 10 }} />
          <YAxis tickFormatter={v => v.toFixed(1)} tick={{ fill: 'var(--text-dim)', fontSize: 10 }} width={48} />
          <Tooltip contentStyle={{ background: 'var(--bg-color)', border: '1px solid var(--primary)', borderRadius: 8, fontSize: '0.78rem', color: 'var(--text-main)' }} labelStyle={{ color: 'var(--text-muted)' }} />
          <Legend wrapperStyle={{ fontSize: '0.75rem', color: 'var(--text-muted)' }} />
          <Line type="monotone" dataKey="cpi" stroke={CHART_BLUE} strokeWidth={2} dot={false} name="CPI" />
          <Line type="monotone" dataKey="trend" stroke={CHART_ORANGE} strokeWidth={1.5} strokeDasharray="5 3" dot={false} name="Trend (EWMA)" />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Panel 2: Money Supply Area Chart ─────────────────────────────────────────

function MoneySupplyChart({ data }: { data: TelemetryLog[] }) {
  const filtered = data.filter(d => d.m0 != null || d.m1 != null);

  if (filtered.length === 0) {
    return (
      <div style={sectionStyle}>
        <div style={sectionTitleStyle}>Money Supply — M0 / M1 / M2</div>
        <div style={emptyStateStyle}>No banking data — enable Banking in Design Review to track money supply</div>
      </div>
    );
  }

  const hasDeposits = filtered.some(d => (d.bankingDeposits ?? 0) > 0);

  const chartData = filtered.map(d => ({
    iterationNumber: d.iterationNumber,
    m0: d.m0 ?? 0,
    loanExpansion: Math.max(0, (d.m1 ?? d.m0 ?? 0) - (d.m0 ?? 0)),
    deposits: d.bankingDeposits ?? 0,
  }));

  return (
    <div style={sectionStyle}>
      <div style={sectionTitleStyle}>Money Supply — M0 / M1 / M2</div>
      <ResponsiveContainer width="100%" height={200}>
        <AreaChart data={chartData} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" />
          <XAxis dataKey="iterationNumber" tick={{ fill: 'var(--text-dim)', fontSize: 10 }} />
          <YAxis tickFormatter={fmtK} tick={{ fill: 'var(--text-dim)', fontSize: 10 }} width={48} />
          <Tooltip contentStyle={{ background: 'var(--bg-color)', border: '1px solid var(--primary)', borderRadius: 8, fontSize: '0.78rem', color: 'var(--text-main)' }} labelStyle={{ color: 'var(--text-muted)' }} formatter={(v) => fmtK(Number(v))} />
          <Legend wrapperStyle={{ fontSize: '0.75rem', color: 'var(--text-muted)' }} />
          <Area type="monotone" dataKey="m0" stackId="money" stroke={CHART_BLUE} fill={CHART_BLUE} fillOpacity={0.25} name="M0 (Base Money)" />
          <Area type="monotone" dataKey="loanExpansion" stackId="money" stroke={CHART_GREEN} fill={CHART_GREEN} fillOpacity={0.4} name="Loan Expansion (M1-M0)" />
          {hasDeposits && (
            <Area type="monotone" dataKey="deposits" stackId="money" stroke={CHART_VIOLET} fill={CHART_VIOLET} fillOpacity={0.3} name="Deposits" />
          )}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Panel 3: Fiscal Budget Bar Chart ─────────────────────────────────────────

function FiscalChart({ data }: { data: TelemetryLog[] }) {
  const filtered = data.filter(d => d.fiscalSpending != null);

  if (filtered.length === 0) {
    return (
      <div style={sectionStyle}>
        <div style={sectionTitleStyle}>Fiscal Budget — Spending & Public Goods Quality</div>
        <div style={emptyStateStyle}>No fiscal data — enable Fiscal Policy in Design Review to track government spending</div>
      </div>
    );
  }

  const latest = filtered[filtered.length - 1];

  const chartData = FISCAL_CATEGORIES.map(cat => ({
    name: cat,
    spending: latest.fiscalSpending?.[cat] ?? 0,
    quality: (latest.publicGoodsQuality?.[cat] ?? 0) * 100,
  }));

  return (
    <div style={sectionStyle}>
      <div style={sectionTitleStyle}>
        Fiscal Budget — Spending & Public Goods Quality
        <span style={{ marginLeft: 8, fontSize: '0.68rem', fontWeight: 400, textTransform: 'none', color: 'var(--text-dim)' }}>
          (latest iteration; quality scaled 0–100)
        </span>
      </div>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={chartData} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" />
          <XAxis dataKey="name" tick={{ fill: 'var(--text-dim)', fontSize: 10 }} />
          <YAxis tickFormatter={fmtK} tick={{ fill: 'var(--text-dim)', fontSize: 10 }} width={48} />
          <Tooltip
            contentStyle={{ background: 'var(--bg-color)', border: '1px solid var(--primary)', borderRadius: 8, fontSize: '0.78rem', color: 'var(--text-main)' }}
            labelStyle={{ color: 'var(--text-muted)' }}
            formatter={(v, name) => [
              name === 'quality' ? `${Number(v).toFixed(1)} / 100` : fmtK(Number(v)),
              name === 'quality' ? 'Quality (0–100)' : 'Spending',
            ]}
          />
          <Legend wrapperStyle={{ fontSize: '0.75rem', color: 'var(--text-muted)' }} />
          <Bar dataKey="spending" fill={CHART_BLUE} name="Spending" radius={[3, 3, 0, 0]} />
          <Bar dataKey="quality" fill={CHART_ORANGE} name="Quality (scaled 0-100)" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
      <div style={{ display: 'flex', gap: 12, marginTop: 6, marginBottom: 4 }}>
        {FISCAL_CATEGORIES.map(cat => (
          <div key={cat} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <div style={{ width: 8, height: 8, borderRadius: 2, background: FISCAL_COLORS[cat] }} />
            <span style={{ fontSize: '0.68rem', color: 'var(--text-dim)', textTransform: 'capitalize' }}>{cat}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Panel 4: Bond Yield Line Chart ────────────────────────────────────────────

function BondYieldChart({ data }: { data: TelemetryLog[] }) {
  const filtered = data.filter(
    d => d.bondYields != null &&
      (d.bondYields.governmentYield != null || d.bondYields.corporateYield != null)
  );

  if (filtered.length === 0) {
    return (
      <div style={sectionStyle}>
        <div style={sectionTitleStyle}>Bond Yields — Government & Corporate</div>
        <div style={emptyStateStyle}>No bond data — enable Capital Markets in Design Review, or no bonds have been issued yet</div>
      </div>
    );
  }

  const chartData = filtered.map(d => ({
    iterationNumber: d.iterationNumber,
    governmentYield: d.bondYields?.governmentYield ?? null,
    corporateYield: d.bondYields?.corporateYield ?? null,
  }));

  const yieldPct = (v: number) => (v * 100).toFixed(2) + '%';

  return (
    <div style={sectionStyle}>
      <div style={sectionTitleStyle}>Bond Yields — Government & Corporate</div>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={chartData} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" />
          <XAxis dataKey="iterationNumber" label={{ value: 'Iteration', position: 'insideBottomRight', offset: -4, fill: 'var(--text-dim)', fontSize: 10 }} tick={{ fill: 'var(--text-dim)', fontSize: 10 }} />
          <YAxis tickFormatter={yieldPct} tick={{ fill: 'var(--text-dim)', fontSize: 10 }} width={52} />
          <Tooltip
            contentStyle={{ background: 'var(--bg-color)', border: '1px solid var(--primary)', borderRadius: 8, fontSize: '0.78rem', color: 'var(--text-main)' }}
            labelStyle={{ color: 'var(--text-muted)' }}
            formatter={(v) => [yieldPct(Number(v))]}
          />
          <Legend wrapperStyle={{ fontSize: '0.75rem', color: 'var(--text-muted)' }} />
          <Line type="monotone" dataKey="governmentYield" stroke={CHART_BLUE} strokeWidth={2} dot={false} name="Gov Yield" connectNulls />
          <Line type="monotone" dataKey="corporateYield" stroke={CHART_ORANGE} strokeWidth={2} dot={false} name="Corp Yield" connectNulls />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Panel 5: SFC Drift — Subsystem Balance ────────────────────────────────────
// Phase 11 D-21: surfaces per-subsystem sfcDriftBySubsystem from TelemetryLog.

function SfcDriftChart({ data }: { data: TelemetryLog[] }) {
  const chartData = data
    .filter(d => d.sfcDriftBySubsystem)
    .map(d => ({
      iteration: d.iterationNumber,
      banking: d.sfcDriftBySubsystem!.banking,
      capmkt: d.sfcDriftBySubsystem!.capmkt,
      fiscal: d.sfcDriftBySubsystem!.fiscal,
      enforcement: d.sfcDriftBySubsystem!.enforcement,
      trade: d.sfcDriftBySubsystem!.trade,
      physicsActions: d.sfcDriftBySubsystem!.physicsActions,
      total: d.sfcDrift ?? 0,
    }));

  if (chartData.length === 0) {
    return (
      <div id="sfc-drift-panel" style={sectionStyle}>
        <div style={sectionTitleStyle}>SFC DRIFT — SUBSYSTEM BALANCE</div>
        <div style={emptyStateStyle}>
          No drift data yet — start a simulation to observe subsystem balance.
        </div>
      </div>
    );
  }

  return (
    <div id="sfc-drift-panel" style={sectionStyle}>
      <div style={sectionTitleStyle}>SFC DRIFT — SUBSYSTEM BALANCE</div>
      <div style={{ fontSize: '0.82rem', color: 'var(--text-dim)', marginBottom: '8px' }}>
        Per-iteration fiat delta by subsystem. All values should approach zero.
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={chartData} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" />
          <XAxis dataKey="iteration" stroke="var(--text-dim)" tick={{ fill: 'var(--text-dim)', fontSize: 10 }} />
          <YAxis stroke="var(--text-dim)" tick={{ fill: 'var(--text-dim)', fontSize: 10 }} width={48} />
          <Tooltip
            formatter={(value, name) => [`${Number(value).toFixed(3)} fiat`, String(name)]}
            contentStyle={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', fontSize: '0.78rem', color: 'var(--text-main)' }}
            labelStyle={{ color: 'var(--text-muted)' }}
          />
          <Legend wrapperStyle={{ fontSize: '0.75rem', color: 'var(--text-muted)' }} />
          <Line type="monotone" dataKey="banking" name="Banking" stroke="var(--chart-blue)" dot={false} />
          <Line type="monotone" dataKey="capmkt" name="Capital Mkt" stroke="var(--chart-violet)" dot={false} />
          <Line type="monotone" dataKey="fiscal" name="Fiscal" stroke="var(--chart-green)" dot={false} />
          <Line type="monotone" dataKey="enforcement" name="Enforcement" stroke="var(--chart-orange)" dot={false} />
          <Line type="monotone" dataKey="trade" name="Trade/AMM" stroke="var(--chart-teal)" dot={false} />
          <Line type="monotone" dataKey="physicsActions" name="Physics" stroke="var(--chart-yellow)" dot={false} />
          <Line type="monotone" dataKey="total" name="Total (overlay)" stroke="var(--chart-red)" strokeDasharray="5 3" dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── SFC Drift Alert Banner ───────────────────────────────────────────────────
// Phase 11 D-23: renders above the dashboard whenever |sfcDrift| exceeds 0.1.

function SfcDriftBanner({ data }: { data: TelemetryLog[] }) {
  const latest = data[data.length - 1];
  if (!latest || latest.sfcDrift === undefined) return null;
  const absDrift = Math.abs(latest.sfcDrift);
  if (absDrift <= 0.1) return null;

  return (
    <div
      role="alert"
      aria-live="polite"
      style={{
        padding: '8px 12px',
        marginBottom: '16px',
        borderRadius: '8px',
        background: 'var(--panel-alpha-10)',
        border: '1px solid var(--color-red)',
        display: 'flex',
        alignItems: 'flex-start',
        gap: '8px',
      }}
    >
      <AlertTriangle size={16} color="var(--color-red)" aria-hidden="true" />
      <div>
        <div style={{ fontSize: '0.82rem', fontWeight: 500, color: 'var(--text-main)' }}>
          SFC drift over threshold
        </div>
        <div style={{ fontSize: '0.82rem', color: 'var(--text-main)' }}>
          Iteration {latest.iterationNumber}: total drift is {latest.sfcDrift.toFixed(2)} fiat (threshold 0.10). The simulation has not been paused; review the drift panel below to identify the leaking subsystem.
        </div>
        <a
          href="#sfc-drift-panel"
          onClick={(e) => {
            e.preventDefault();
            document.getElementById('sfc-drift-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }}
          style={{ fontSize: '0.82rem', color: 'var(--text-main)' }}
        >
          Jump to drift panel →
        </a>
      </div>
    </div>
  );
}

// ── EconomicDashboard (default export) ───────────────────────────────────────

export default function EconomicDashboard({ data }: EconomicDashboardProps) {
  return (
    <div>
      <SfcDriftBanner data={data} />
      <CpiChart data={data} />
      <MoneySupplyChart data={data} />
      <FiscalChart data={data} />
      <BondYieldChart data={data} />
      <SfcDriftChart data={data} />
    </div>
  );
}
