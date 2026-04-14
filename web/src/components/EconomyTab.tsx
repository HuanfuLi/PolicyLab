import React, { useState, useEffect } from 'react';
import DataConfidenceBadge from './DataConfidenceBadge';
import { TaxPolicyEditor } from './TaxPolicyEditor';
import type { DataSource, ConfidenceLevel } from '@policylab/shared';
import { ChevronDown, ChevronRight, Info } from 'lucide-react';
import type { EconomyConfig, BudgetAllocation } from '@policylab/shared';
import { DEFAULT_ECONOMY_CONFIG } from '@policylab/shared';

// ── Parameter metadata ──────────────────────────────────────────────────────

type Section = 'banking' | 'fiscal' | 'inflation' | 'capitalMarkets';

interface ParamMeta {
  key: keyof EconomyConfig;
  label: string;
  min: number;
  max: number;
  step: number;
  defaultVal: number;
  softMin: number;
  softMax: number;
  tooltip: string;
  section: Section;
}

const PARAM_META: ParamMeta[] = [
  // Banking
  {
    key: 'reserveRequirement',
    label: 'Reserve Ratio',
    min: 0.01, max: 0.50, step: 0.01, defaultVal: 0.10,
    softMin: 0.05, softMax: 0.20,
    tooltip: 'Fraction of deposits banks must hold in reserve. US: 10%, EU: 1%, China: 12.5%',
    section: 'banking',
  },
  {
    key: 'baseLoanInterestRate',
    label: 'Loan Interest Rate (per iter)',
    min: 0.001, max: 0.05, step: 0.001, defaultVal: 0.005,
    softMin: 0.002, softMax: 0.015,
    tooltip: 'Interest charged per iteration on outstanding loans. 0.5%/iter is roughly 6% annual at 12 iter/year',
    section: 'banking',
  },
  {
    key: 'depositInterestRate',
    label: 'Deposit Interest Rate (per iter)',
    min: 0.0, max: 0.02, step: 0.001, defaultVal: 0.002,
    softMin: 0.001, softMax: 0.008,
    tooltip: 'Interest paid to depositors per iteration. Should be lower than loan rate',
    section: 'banking',
  },
  {
    key: 'defaultLoanTermIterations',
    label: 'Loan Term (iterations)',
    min: 5, max: 50, step: 1, defaultVal: 20,
    softMin: 10, softMax: 30,
    tooltip: 'Number of iterations before a loan must be fully repaid',
    section: 'banking',
  },
  {
    key: 'defaultThresholdIterations',
    label: 'Default Threshold (missed payments)',
    min: 1, max: 10, step: 1, defaultVal: 3,
    softMin: 2, softMax: 5,
    tooltip: 'Consecutive missed repayments before loan defaults and collateral is seized',
    section: 'banking',
  },
  // Fiscal
  {
    key: 'budgetSpendingRate',
    label: 'Budget Spending Rate',
    min: 0.01, max: 0.50, step: 0.01, defaultVal: 0.10,
    softMin: 0.05, softMax: 0.25,
    tooltip: 'Fraction of treasury spent per iteration across all budget categories',
    section: 'fiscal',
  },
  {
    key: 'infrastructureMultiplier',
    label: 'Infrastructure Productivity Bonus',
    min: 0.001, max: 0.02, step: 0.001, defaultVal: 0.005,
    softMin: 0.002, softMax: 0.01,
    tooltip: 'Productivity boost per infrastructure quality point. Higher values make infrastructure spending more impactful',
    section: 'fiscal',
  },
  {
    key: 'educationMultiplier',
    label: 'Education Skill Gain Bonus',
    min: 0.001, max: 0.02, step: 0.001, defaultVal: 0.005,
    softMin: 0.002, softMax: 0.01,
    tooltip: 'Skill learning speed bonus per education quality point',
    section: 'fiscal',
  },
  {
    key: 'defenseMultiplier',
    label: 'Defense Enforcement Bonus',
    min: 0.001, max: 0.02, step: 0.001, defaultVal: 0.003,
    softMin: 0.001, softMax: 0.008,
    tooltip: 'Theft resistance per defense quality point. Reduces successful STEAL actions',
    section: 'fiscal',
  },
  {
    key: 'welfareMultiplier',
    label: 'Welfare UBI Supplement',
    min: 0.001, max: 0.01, step: 0.001, defaultVal: 0.002,
    softMin: 0.001, softMax: 0.005,
    tooltip: 'Direct fiat supplement per welfare quality point per iteration',
    section: 'fiscal',
  },
  {
    key: 'publicGoodsDecayRate',
    label: 'Public Goods Decay (per iter)',
    min: 0.1, max: 5.0, step: 0.1, defaultVal: 0.5,
    softMin: 0.2, softMax: 2.0,
    tooltip: 'Quality points lost per iteration without spending. Higher values punish neglect more',
    section: 'fiscal',
  },
  {
    key: 'publicGoodsGainDiminishing',
    label: 'Diminishing Returns Exponent',
    min: 0.3, max: 1.0, step: 0.05, defaultVal: 0.7,
    softMin: 0.5, softMax: 0.9,
    tooltip: 'Controls spending efficiency curve. 1.0 = linear returns, 0.5 = square root diminishing returns',
    section: 'fiscal',
  },
  // Capital Markets
  {
    key: 'dividendPayoutRatio',
    label: 'Dividend Payout Ratio',
    min: 0.0, max: 0.30, step: 0.01, defaultVal: 0.05,
    softMin: 0.02, softMax: 0.15,
    tooltip: 'Fraction of enterprise owner wealth distributed as dividends each iteration',
    section: 'capitalMarkets',
  },
  {
    key: 'govBondCouponRate',
    label: 'Gov Bond Coupon (per iter)',
    min: 0.001, max: 0.03, step: 0.001, defaultVal: 0.008,
    softMin: 0.003, softMax: 0.015,
    tooltip: 'Interest rate paid to government bond holders each iteration',
    section: 'capitalMarkets',
  },
  {
    key: 'govBondTermIterations',
    label: 'Gov Bond Maturity (iterations)',
    min: 5, max: 30, step: 1, defaultVal: 10,
    softMin: 5, softMax: 20,
    tooltip: 'Iterations until government bonds mature and principal is returned',
    section: 'capitalMarkets',
  },
  // Inflation
  {
    key: 'm1InflationCoeff',
    label: 'M1 Inflation Coefficient',
    min: 0.0, max: 1.0, step: 0.05, defaultVal: 0.3,
    softMin: 0.1, softMax: 0.5,
    tooltip: 'How strongly M1 growth feeds into price levels. Higher = more monetary-driven inflation',
    section: 'inflation',
  },
  {
    key: 'inflationAmmThreshold',
    label: 'AMM Price Pressure Threshold',
    min: 0.0, max: 2.0, step: 0.1, defaultVal: 0.5,
    softMin: 0.2, softMax: 1.0,
    tooltip: 'Minimum inflation expectation before AMM applies price pressure',
    section: 'inflation',
  },
  {
    key: 'inflationAmmCap',
    label: 'AMM Price Change Cap (%)',
    min: 0.5, max: 10.0, step: 0.5, defaultVal: 2.0,
    softMin: 1.0, softMax: 5.0,
    tooltip: 'Maximum price adjustment per iteration from inflation feedback',
    section: 'inflation',
  },
];

const SECTION_LABELS: Record<Section, string> = {
  banking: 'Banking',
  fiscal: 'Fiscal Policy',
  capitalMarkets: 'Capital Markets',
  inflation: 'Inflation',
};

const BUDGET_CATEGORIES = ['infrastructure', 'education', 'defense', 'welfare'] as const;

// ── Component props ──────────────────────────────────────────────────────────

interface EconomyTabProps {
  sessionId: string;
  economyConfig: Partial<EconomyConfig>;
  budgetAllocation: BudgetAllocation;
  onConfigChange: (patch: Partial<EconomyConfig>) => void;
  onBudgetChange: (budget: BudgetAllocation) => void;
  /** Confidence metadata from bootstrap — maps param key → 'high' | 'medium' | 'low' */
  bootstrapConfidence?: Record<string, string>;
  /** Data source metadata from bootstrap — maps param key → 'api' | 'web' | 'llm' */
  bootstrapSources?: Record<string, string>;
  /** When rendered inside ScenarioTabs, identifies the active tab for state reset */
  tabId?: string;
  /** Phase 11 D-17: when true, disables the governance toggle (post-simulation-start) */
  isPastCheckpoint?: boolean;
}

// ── Phase 11 D-17: Governance toggle ─────────────────────────────────────────

function GovernanceToggle({ value, onChange, disabled }: {
  value: boolean;
  onChange: (v: boolean) => void;
  disabled: boolean;
}) {
  const toggleAriaLabel = value ? 'Disable emergent governance' : 'Enable emergent governance';
  return (
    <label
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: '8px',
        padding: '8px 0',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
      }}
      title={disabled ? 'Locked after simulation starts.' : undefined}
    >
      <input
        type="checkbox"
        checked={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        aria-label={toggleAriaLabel}
        style={{ marginTop: '2px' }}
      />
      <div>
        <div style={{ fontSize: '0.82rem', fontWeight: 500, color: 'var(--text-main)' }}>
          Emergent Governance
        </div>
        <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
          When off, agents cannot amend policy mid-simulation. Use for clean A/B policy comparison.
        </div>
      </div>
    </label>
  );
}

/** Render a DataConfidenceBadge for a param if bootstrap data exists for it */
function ParamBadge({ paramKey, confidence, sources }: {
  paramKey: string;
  confidence?: Record<string, string>;
  sources?: Record<string, string>;
}) {
  const conf = confidence?.[paramKey] as ConfidenceLevel | undefined;
  const src = sources?.[paramKey] as DataSource | undefined;
  if (!conf || !src) return null;
  return <DataConfidenceBadge source={src} confidence={conf} />;
}

// ── EconomyTab ───────────────────────────────────────────────────────────────

export default function EconomyTab({
  economyConfig,
  budgetAllocation,
  onConfigChange,
  onBudgetChange,
  bootstrapConfidence,
  bootstrapSources,
  tabId,
  isPastCheckpoint = false,
}: EconomyTabProps) {
  // Phase 11 D-17: governance toggle state — undefined (legacy) defaults to enabled,
  // matching the backend's `governanceEnabled !== false` gate.
  const governanceEnabled = economyConfig.governanceEnabled ?? true;
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    banking: true,
    fiscal: true,
    capitalMarkets: false,
    inflation: false,
  });

  // Local pending values — changes are staged here until blur/mouseUp
  const [pendingValues, setPendingValues] = useState<Partial<Record<keyof EconomyConfig, number>>>({});
  const [pendingBudget, setPendingBudget] = useState<BudgetAllocation>({ ...budgetAllocation });

  // H2 fix: Reset pending state when scenario tab changes (prevents value bleed between tabs)
  useEffect(() => {
    setPendingValues({});
    setPendingBudget({ ...budgetAllocation });
  }, [tabId, budgetAllocation]);

  // Soft-limit warning: only set in event handlers, never on mount
  const [softWarning, setSoftWarning] = useState<{
    key: keyof EconomyConfig | 'budget';
    value: number;
    meta: ParamMeta | null;
    prevValue: number;
  } | null>(null);

  // Tooltip hover state
  const [hoveredParam, setHoveredParam] = useState<string | null>(null);

  const toggleSection = (section: string) => {
    setOpenSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  const getValue = (meta: ParamMeta): number => {
    if (pendingValues[meta.key] !== undefined) return pendingValues[meta.key]!;
    const cv = economyConfig[meta.key];
    if (cv !== undefined && typeof cv === 'number') return cv;
    const dv = DEFAULT_ECONOMY_CONFIG[meta.key];
    return typeof dv === 'number' ? dv : meta.defaultVal;
  };

  const handleParamChange = (meta: ParamMeta, rawVal: number) => {
    setPendingValues(prev => ({ ...prev, [meta.key]: rawVal }));
  };

  const commitParam = (meta: ParamMeta, rawVal: number) => {
    const isOutsideSoft = rawVal < meta.softMin || rawVal > meta.softMax;
    if (isOutsideSoft) {
      const prevVal = getValue(meta);
      setSoftWarning({ key: meta.key, value: rawVal, meta, prevValue: prevVal });
      return;
    }
    onConfigChange({ [meta.key]: rawVal } as Partial<EconomyConfig>);
    setPendingValues(prev => {
      const next = { ...prev };
      delete next[meta.key];
      return next;
    });
  };

  const confirmSoftWarning = () => {
    if (!softWarning || !softWarning.meta) return;
    onConfigChange({ [softWarning.meta.key]: softWarning.value } as Partial<EconomyConfig>);
    setPendingValues(prev => {
      const next = { ...prev };
      if (softWarning.meta) delete next[softWarning.meta.key];
      return next;
    });
    setSoftWarning(null);
  };

  const cancelSoftWarning = () => {
    if (!softWarning || !softWarning.meta) { setSoftWarning(null); return; }
    // Revert to previous value
    setPendingValues(prev => {
      const next = { ...prev };
      if (softWarning.meta) delete next[softWarning.meta.key];
      return next;
    });
    setSoftWarning(null);
  };

  // Budget allocation handlers
  const handleBudgetSliderChange = (cat: keyof BudgetAllocation, pct: number) => {
    // Proportional redistribution: when one changes, scale the rest
    const frac = pct / 100;
    const remaining = 1 - frac;
    const others = BUDGET_CATEGORIES.filter(c => c !== cat);
    const currentOthersSum = others.reduce((s, c) => s + pendingBudget[c], 0);
    const newBudget = { ...pendingBudget, [cat]: frac } as BudgetAllocation;
    if (currentOthersSum > 0) {
      for (const other of others) {
        newBudget[other] = (pendingBudget[other] / currentOthersSum) * remaining;
      }
    } else {
      const split = remaining / others.length;
      for (const other of others) newBudget[other] = split;
    }
    setPendingBudget(newBudget);
  };

  const commitBudget = () => {
    const sum = BUDGET_CATEGORIES.reduce((s, c) => s + pendingBudget[c], 0);
    if (sum === 0) {
      // All categories zero — distribute equally to avoid NaN from division by zero
      const equal = 1 / BUDGET_CATEGORIES.length;
      const normalized = {} as BudgetAllocation;
      for (const c of BUDGET_CATEGORIES) normalized[c] = equal;
      onBudgetChange(normalized);
      setPendingBudget(normalized);
    } else if (Math.abs(sum - 1.0) > 0.01) {
      // Normalize
      const normalized = { ...pendingBudget } as BudgetAllocation;
      for (const c of BUDGET_CATEGORIES) normalized[c] = pendingBudget[c] / sum;
      onBudgetChange(normalized);
      setPendingBudget(normalized);
    } else {
      onBudgetChange(pendingBudget);
    }
  };

  // Check if economy config is essentially empty (pre-v1.0 session)
  const hasNoConfig = !economyConfig.bankingEnabled
    && !economyConfig.fiscalEnabled
    && !economyConfig.inflationEnabled
    && !economyConfig.capitalMarketsEnabled
    && Object.keys(economyConfig).length === 0;

  const sectionHasParams = (section: Section): boolean =>
    PARAM_META.filter(m => m.section === section).length > 0;

  const isSectionVisible = (section: Section): boolean => {
    const flagMap: Record<Section, keyof EconomyConfig> = {
      banking: 'bankingEnabled',
      fiscal: 'fiscalEnabled',
      capitalMarkets: 'capitalMarketsEnabled',
      inflation: 'inflationEnabled',
    };
    return !!economyConfig[flagMap[section]];
  };

  return (
    <div style={{ padding: '0.5rem 0' }}>

      {/* Pre-v1.0 session banner */}
      {hasNoConfig && (
        <div style={{
          marginBottom: '1.5rem',
          padding: '0.75rem 1rem',
          background: 'rgba(234, 179, 8, 0.1)',
          border: '1px solid rgba(234, 179, 8, 0.3)',
          borderRadius: '8px',
          color: 'var(--warning)',
          fontSize: '0.875rem',
        }}>
          Economy features were not configured for this session. These defaults will apply if you fork and re-simulate.
        </div>
      )}

      {/* Data source legend (only shown for bootstrapped sessions) */}
      {bootstrapConfidence && Object.keys(bootstrapConfidence).length > 0 && (
        <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem', fontSize: '0.75rem', color: 'var(--text-dim)', alignItems: 'center', flexWrap: 'wrap' }}>
          <DataConfidenceBadge source="api" confidence="high" /> From real data
          <DataConfidenceBadge source="api" confidence="medium" /> Estimated from data
          <span style={{ opacity: 0.7 }}>No badge = default value</span>
        </div>
      )}

      {/* Feature toggle pills */}
      <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
        {(['bankingEnabled', 'fiscalEnabled', 'capitalMarketsEnabled', 'inflationEnabled'] as const).map(flag => {
          const labels: Record<string, string> = {
            bankingEnabled: 'Banking',
            fiscalEnabled: 'Fiscal Policy',
            capitalMarketsEnabled: 'Capital Markets',
            inflationEnabled: 'Inflation',
          };
          const enabled = !!(economyConfig[flag]);
          return (
            <button
              key={flag}
              onClick={() => onConfigChange({ [flag]: !enabled } as Partial<EconomyConfig>)}
              style={{
                padding: '0.3rem 0.75rem',
                borderRadius: '999px',
                border: `1px solid ${enabled ? 'var(--primary)' : 'var(--glass-border)'}`,
                background: enabled ? 'rgba(79, 70, 229, 0.15)' : 'transparent',
                color: enabled ? 'var(--primary)' : 'var(--text-muted)',
                cursor: 'pointer',
                fontSize: '0.8rem',
                fontFamily: 'inherit',
              }}
            >
              {labels[flag]}
            </button>
          );
        })}
      </div>

      {/* Soft-limit warning inline dialog */}
      {softWarning && softWarning.meta && (
        <div style={{
          marginBottom: '1.5rem',
          padding: '1rem',
          background: 'rgba(234, 179, 8, 0.1)',
          border: '1px solid rgba(234, 179, 8, 0.4)',
          borderRadius: '8px',
          color: 'var(--warning)',
          fontSize: '0.875rem',
        }}>
          <div style={{ marginBottom: '0.5rem' }}>
            <strong>{softWarning.meta.label}</strong>: value {softWarning.value} is outside the recommended range
            ({softWarning.meta.softMin}–{softWarning.meta.softMax}). Extreme values may produce unrealistic simulation results.
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              onClick={confirmSoftWarning}
              style={{
                padding: '0.3rem 0.75rem', borderRadius: '6px',
                background: 'rgba(234, 179, 8, 0.2)',
                border: '1px solid rgba(234, 179, 8, 0.5)',
                color: 'var(--warning)', cursor: 'pointer', fontSize: '0.8rem', fontFamily: 'inherit',
              }}
            >
              I understand the risks
            </button>
            <button
              onClick={cancelSoftWarning}
              style={{
                padding: '0.3rem 0.75rem', borderRadius: '6px',
                background: 'transparent',
                border: '1px solid var(--glass-border)',
                color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.8rem', fontFamily: 'inherit',
              }}
            >
              Revert
            </button>
          </div>
        </div>
      )}

      {/* Collapsible sections */}
      {(['banking', 'fiscal', 'capitalMarkets', 'inflation'] as Section[]).map(section => {
        if (!sectionHasParams(section)) return null;
        const isVisible = isSectionVisible(section);
        const isOpen = openSections[section];
        const params = PARAM_META.filter(m => m.section === section);

        return (
          <React.Fragment key={section}>
            {/* Phase 11 D-17: governance toggle sits directly above the Fiscal section */}
            {section === 'fiscal' && (
              <GovernanceToggle
                value={governanceEnabled}
                onChange={(v) => onConfigChange({ governanceEnabled: v })}
                disabled={isPastCheckpoint}
              />
            )}
          <div
            style={{
              marginBottom: '1rem',
              border: '1px solid var(--glass-border)',
              borderRadius: '8px',
              overflow: 'hidden',
              opacity: isVisible ? 1 : 0.4,
            }}
          >
            {/* Section header */}
            <button
              onClick={() => {
                if (isVisible) {
                  toggleSection(section);
                } else {
                  // Enable the feature when clicking the disabled section header
                  const flagMap: Record<Section, keyof EconomyConfig> = {
                    banking: 'bankingEnabled',
                    fiscal: 'fiscalEnabled',
                    capitalMarkets: 'capitalMarketsEnabled',
                    inflation: 'inflationEnabled',
                  };
                  onConfigChange({ [flagMap[section]]: true } as Partial<EconomyConfig>);
                  setOpenSections(prev => ({ ...prev, [section]: true }));
                }
              }}
              style={{
                width: '100%',
                padding: '0.75rem 1rem',
                background: 'var(--panel-alpha-05)',
                border: 'none',
                color: 'var(--color-bright)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                fontSize: '0.9rem',
                fontWeight: 600,
                fontFamily: 'inherit',
                textAlign: 'left' as const,
              }}
            >
              {isOpen && isVisible ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              {SECTION_LABELS[section]}
              {!isVisible && (
                <span style={{ marginLeft: 'auto', fontSize: '0.75rem', color: 'var(--text-dim)', fontWeight: 400 }}>
                  Click to enable
                </span>
              )}
            </button>

            {/* Section content */}
            {isOpen && isVisible && (
              <div style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>

                {/* Phase 11 GC4: Editable TaxPolicyEditor at top of Fiscal section */}
                {section === 'fiscal' && (
                  <TaxPolicyEditor
                    policy={economyConfig.taxPolicy}
                    source={bootstrapSources?.taxPolicy as DataSource | undefined}
                    isPastCheckpoint={isPastCheckpoint ?? false}
                    onChange={({ taxPolicy, source }) => onConfigChange({
                      taxPolicy,
                      sources: { ...(bootstrapSources ?? {}), taxPolicy: source },
                    } as Partial<EconomyConfig>)}
                  />
                )}

                {/* Budget allocation sub-section in Fiscal */}
                {section === 'fiscal' && (
                  <div style={{ marginBottom: '0.5rem' }}>
                    <div style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
                      Budget Allocation
                      <ParamBadge paramKey="budgetAllocation" confidence={bootstrapConfidence} sources={bootstrapSources} />
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.5rem' }}>
                      {BUDGET_CATEGORIES.map(cat => (
                        <div key={cat}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                            <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textTransform: 'capitalize' }}>
                              {cat}
                            </label>
                            <span style={{ fontSize: '0.8rem', color: 'var(--primary)', fontWeight: 600 }}>
                              {Math.round(pendingBudget[cat] * 100)}%
                            </span>
                          </div>
                          <input
                            type="range"
                            min={0}
                            max={100}
                            step={1}
                            value={Math.round(pendingBudget[cat] * 100)}
                            onChange={e => handleBudgetSliderChange(cat, Number(e.target.value))}
                            onMouseUp={commitBudget}
                            style={{ width: '100%', accentColor: 'var(--primary)' }}
                          />
                        </div>
                      ))}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>
                      Total: {Math.round(BUDGET_CATEGORIES.reduce((s, c) => s + pendingBudget[c], 0) * 100)}%
                      {Math.abs(BUDGET_CATEGORIES.reduce((s, c) => s + pendingBudget[c], 0) - 1.0) > 0.01 && (
                        <span style={{ marginLeft: '0.5rem', color: 'var(--warning)' }}>Allocations must sum to 100%</span>
                      )}
                    </div>
                    <hr style={{ border: 'none', borderTop: '1px solid var(--glass-border)', margin: '0.75rem 0' }} />
                  </div>
                )}

                {/* Parameter rows */}
                {params.map(meta => {
                  const value = getValue(meta);
                  const isOutside = value < meta.softMin || value > meta.softMax;
                  const tooltipKey = `${section}-${meta.key}`;

                  return (
                    <div key={String(meta.key)}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', position: 'relative' }}>
                          <label style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                            {meta.label}
                            <ParamBadge paramKey={String(meta.key)} confidence={bootstrapConfidence} sources={bootstrapSources} />
                          </label>
                          <span
                            style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', cursor: 'help' }}
                            onMouseEnter={() => setHoveredParam(tooltipKey)}
                            onMouseLeave={() => setHoveredParam(null)}
                          >
                            <Info size={13} style={{ color: 'var(--text-dim)' }} />
                            {hoveredParam === tooltipKey && (
                              <div style={{
                                position: 'absolute',
                                bottom: '130%',
                                left: '50%',
                                transform: 'translateX(-50%)',
                                background: 'var(--bg-color)',
                                border: '1px solid var(--glass-border)',
                                borderRadius: '6px',
                                padding: '0.5rem 0.75rem',
                                fontSize: '0.78rem',
                                color: 'var(--text-main)',
                                maxWidth: '280px',
                                whiteSpace: 'normal',
                                zIndex: 100,
                                pointerEvents: 'none',
                                boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                              } as React.CSSProperties}>
                                {meta.tooltip}
                              </div>
                            )}
                          </span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <input
                            type="number"
                            value={value}
                            min={meta.min}
                            max={meta.max}
                            step={meta.step}
                            onChange={e => {
                              const val = Number(e.target.value);
                              if (!isNaN(val)) handleParamChange(meta, val);
                            }}
                            onBlur={e => {
                              const val = Number(e.target.value);
                              if (!isNaN(val) && val >= (meta.min ?? 0)) {
                                commitParam(meta, val);
                              }
                            }}
                            style={{
                              width: '80px',
                              padding: '0.2rem 0.4rem',
                              background: 'var(--panel-alpha-05)',
                              border: `1px solid ${isOutside ? 'var(--warning)' : 'var(--glass-border)'}`,
                              borderRadius: '4px',
                              color: 'var(--color-bright)',
                              fontSize: '0.82rem',
                              fontFamily: 'inherit',
                              textAlign: 'right' as const,
                              outline: 'none',
                            }}
                          />
                        </div>
                      </div>
                      <input
                        type="range"
                        min={meta.min}
                        max={meta.max}
                        step={meta.step}
                        value={value}
                        onChange={e => handleParamChange(meta, Number(e.target.value))}
                        onMouseUp={e => commitParam(meta, Number((e.target as HTMLInputElement).value))}
                        style={{
                          width: '100%',
                          accentColor: isOutside ? 'var(--warning)' : 'var(--primary)',
                        }}
                      />
                      {isOutside && softWarning?.key !== meta.key && (
                        <div style={{ fontSize: '0.75rem', color: 'var(--warning)', marginTop: '0.2rem' }}>
                          Outside recommended range ({meta.softMin}–{meta.softMax})
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          </React.Fragment>
        );
      })}
    </div>
  );
}
