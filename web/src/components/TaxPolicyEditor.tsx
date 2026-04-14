import { useState, useEffect } from 'react';
import type { TaxPolicy, DataSource } from '@policylab/shared';
import DataConfidenceBadge from './DataConfidenceBadge';

export interface TaxPolicyEditorProps {
  policy: TaxPolicy | undefined;
  /** Data source for the current policy — 'api' | 'llm' → Estimate badge; 'user' → Custom badge */
  source: DataSource | undefined;
  /** When true, all inputs are visually locked (post-simulation-start). Mirrors GovernanceToggle. */
  isPastCheckpoint: boolean;
  /** Called on every change. Patch includes the new policy + source='user' for tracking. */
  onChange: (patch: { taxPolicy: TaxPolicy; source: DataSource }) => void;
}

const sectionStyle: React.CSSProperties = {
  padding: '16px 16px 8px',
  borderRadius: '10px',
  background: 'var(--glass-bg)',
  border: '1px solid var(--glass-border)',
  marginBottom: '16px',
};

const sectionTitleStyle: React.CSSProperties = {
  fontSize: '0.78rem',
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  color: 'var(--text-main)',
  marginBottom: '8px',
};

const labelStyle: React.CSSProperties = {
  fontSize: '0.82rem',
  color: 'var(--text-muted)',
  fontWeight: 500,
  display: 'block',
  marginBottom: '4px',
};

const inputStyle: React.CSSProperties = {
  width: '80px',
  padding: '0.2rem 0.4rem',
  borderRadius: '6px',
  border: '1px solid var(--glass-border)',
  background: 'var(--glass-bg)',
  color: 'var(--text-main)',
  fontSize: '0.82rem',
  fontFamily: 'inherit',
  textAlign: 'right' as const,
};

const errorStyle: React.CSSProperties = {
  fontSize: '0.78rem',
  color: 'var(--color-red)',
  marginTop: '4px',
};

/** Default bracket seeded when user adds a row — rate stored in percent form (20 = 20%) */
function nextBracketDefault(brackets: Array<{ upto: number; rate: number }>): { upto: number; rate: number } {
  const last = brackets[brackets.length - 1];
  return { upto: last ? last.upto + 1000 : 1000, rate: 20 };
}

/** Validate bracket array: non-empty, strictly-increasing upto, first upto > 0 */
function validateBrackets(brackets: Array<{ upto: number; rate: number }>): string | null {
  if (brackets.length === 0) return 'At least one bracket is required for progressive tax';
  if (brackets[0].upto <= 0) return 'First bracket must start above zero';
  for (let i = 1; i < brackets.length; i++) {
    if (brackets[i].upto <= brackets[i - 1].upto) {
      return 'Brackets must have strictly increasing wealth thresholds';
    }
  }
  return null;
}

/** Build a TaxPolicy from the current form state */
function buildPolicy(
  kind: 'flat' | 'progressive',
  rates: { income: number; vat: number; capitalGains: number },
  brackets: Array<{ upto: number; rate: number }>,
): TaxPolicy {
  if (kind === 'flat') {
    return { kind: 'flat', rates };
  }
  return { kind: 'progressive', rates, brackets };
}

export function TaxPolicyEditor({
  policy,
  source,
  isPastCheckpoint,
  onChange,
}: TaxPolicyEditorProps) {
  // ── Derive initial form state from policy prop ─────────────────────────────
  const initialKind: 'flat' | 'progressive' = policy?.kind ?? 'flat';
  const initialRates = {
    income: (policy?.rates?.income ?? 0.15) * 100,
    vat: (policy?.rates?.vat ?? 0.10) * 100,
    capitalGains: (policy?.rates?.capitalGains ?? 0.15) * 100,
  };
  const initialBrackets: Array<{ upto: number; rate: number }> =
    policy?.brackets?.map(b => ({ upto: b.upto, rate: b.rate * 100 })) ??
    [{ upto: 1000, rate: 10 }, { upto: 10000, rate: 20 }];

  const [kind, setKind] = useState<'flat' | 'progressive'>(initialKind);
  const [rates, setRates] = useState(initialRates);
  const [brackets, setBrackets] = useState(initialBrackets);
  const [bracketError, setBracketError] = useState<string | null>(null);
  // Local edit flag — the parent store does not persist bootstrapSources.taxPolicy,
  // so the `source` prop never flips to 'user'. Track user edits here instead.
  const [hasUserEdited, setHasUserEdited] = useState(false);

  // Sync form state when policy prop changes (e.g. scenario tab switch)
  useEffect(() => {
    setKind(policy?.kind ?? 'flat');
    setRates({
      income: (policy?.rates?.income ?? 0.15) * 100,
      vat: (policy?.rates?.vat ?? 0.10) * 100,
      capitalGains: (policy?.rates?.capitalGains ?? 0.15) * 100,
    });
    setBrackets(
      policy?.brackets?.map(b => ({ upto: b.upto, rate: b.rate * 100 })) ??
      [{ upto: 1000, rate: 10 }, { upto: 10000, rate: 20 }]
    );
    setBracketError(null);
    setHasUserEdited(false);
  }, [policy]);

  // ── Emit change upward ─────────────────────────────────────────────────────
  function emitChange(
    newKind: 'flat' | 'progressive',
    newRates: typeof rates,
    newBrackets: typeof brackets,
  ) {
    const clamp = (v: number) => Math.max(0, Math.min(50, v)) / 100;
    const normalizedRates = {
      income: clamp(newRates.income),
      vat: clamp(newRates.vat),
      capitalGains: clamp(newRates.capitalGains),
    };
    const normalizedBrackets = newBrackets.map(b => ({
      upto: b.upto,
      rate: clamp(b.rate),
    }));
    const taxPolicy = buildPolicy(newKind, normalizedRates, normalizedBrackets);
    setHasUserEdited(true);
    onChange({ taxPolicy, source: 'user' });
  }

  // ── Event handlers ─────────────────────────────────────────────────────────
  function handleKindChange(newKind: 'flat' | 'progressive') {
    setKind(newKind);
    setBracketError(null);
    emitChange(newKind, rates, brackets);
  }

  function handleRateChange(field: keyof typeof rates, value: number) {
    const newRates = { ...rates, [field]: value };
    setRates(newRates);
    emitChange(kind, newRates, brackets);
  }

  function handleBracketChange(index: number, field: 'upto' | 'rate', value: number) {
    const newBrackets = brackets.map((b, i) =>
      i === index ? { ...b, [field]: value } : b
    );
    setBrackets(newBrackets);
    const error = validateBrackets(newBrackets);
    setBracketError(error);
    if (!error) {
      emitChange(kind, rates, newBrackets);
    }
  }

  function handleAddBracket() {
    const newBrackets = [...brackets, nextBracketDefault(brackets)];
    setBrackets(newBrackets);
    const error = validateBrackets(newBrackets);
    setBracketError(error);
    if (!error) {
      emitChange(kind, rates, newBrackets);
    }
  }

  function handleRemoveBracket(index: number) {
    const newBrackets = brackets.filter((_, i) => i !== index);
    setBrackets(newBrackets);
    const error = validateBrackets(newBrackets);
    setBracketError(error);
    if (!error) {
      emitChange(kind, rates, newBrackets);
    }
  }

  // ── Disabled overlay (post-checkpoint lock) ────────────────────────────────
  const disabledOverlay: React.CSSProperties = isPastCheckpoint
    ? { opacity: 0.5, pointerEvents: 'none', cursor: 'not-allowed' }
    : {};

  // ── Badge ──────────────────────────────────────────────────────────────────
  // Parent store does not persist bootstrapSources.taxPolicy, so prefer local
  // hasUserEdited flag. Fall back to source prop for initial bootstrap state.
  const isUserSource = hasUserEdited || source === 'user';
  const badgeSource: DataSource = isUserSource ? 'user' : (source ?? 'llm');
  const badgeConfidence = isUserSource ? 'high' : 'medium';
  const badgeNote = isUserSource
    ? 'Custom — set by you in the design stage'
    : 'Estimate — generated from bootstrap data';

  // ── Subheading copy ────────────────────────────────────────────────────────
  const subheading = isUserSource
    ? 'Custom tax policy. Reset by re-running bootstrap if you want the data-driven default back.'
    : 'Suggested by the Central Agent from real-world context. Adjust if the default does not reflect your policy.';

  return (
    <div
      style={{ ...sectionStyle, ...disabledOverlay }}
      title={isPastCheckpoint ? 'Locked after simulation starts.' : undefined}
    >
      {/* Section heading */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
        <div style={sectionTitleStyle as React.CSSProperties}>Tax Policy</div>
        <DataConfidenceBadge source={badgeSource} confidence={badgeConfidence} sourceNote={badgeNote} />
      </div>

      {/* Subheading */}
      <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: '12px' }}>
        {subheading}
      </div>

      {/* Empty state for sessions without taxPolicy */}
      {policy === undefined ? (
        <div style={{ fontSize: '0.82rem', color: 'var(--text-main)', marginBottom: '8px' }}>
          No tax policy configured — this session predates Phase 11. Default flat 10% will apply.
          Start editing to add a custom policy.
        </div>
      ) : null}

      {/* Kind selector */}
      <div style={{ display: 'flex', gap: '16px', marginBottom: '12px', alignItems: 'center' }}>
        <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)', fontWeight: 500 }}>Type:</span>
        {(['flat', 'progressive'] as const).map(k => (
          <label
            key={k}
            style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: isPastCheckpoint ? 'not-allowed' : 'pointer', fontSize: '0.82rem', color: 'var(--text-main)' }}
          >
            <input
              type="radio"
              name="taxKind"
              value={k}
              checked={kind === k}
              onChange={() => handleKindChange(k)}
              disabled={isPastCheckpoint}
              style={{ accentColor: 'var(--primary)' }}
            />
            {k === 'flat' ? 'Flat' : 'Progressive'}
          </label>
        ))}
      </div>

      {/* Rate inputs */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px', marginBottom: '12px' }}>
        {(
          [
            { field: 'income', label: 'Income rate' },
            { field: 'vat', label: 'VAT rate' },
            { field: 'capitalGains', label: 'Capital gains rate' },
          ] as Array<{ field: keyof typeof rates; label: string }>
        ).map(({ field, label }) => (
          <div key={field}>
            <label style={labelStyle}>{label}</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <input
                type="number"
                min={0}
                max={50}
                step={0.5}
                value={rates[field]}
                disabled={isPastCheckpoint}
                onChange={e => {
                  const v = parseFloat(e.target.value);
                  if (!isNaN(v)) handleRateChange(field, v);
                }}
                style={inputStyle}
              />
              <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>%</span>
            </div>
          </div>
        ))}
      </div>

      {/* Progressive bracket editor */}
      {kind === 'progressive' && (
        <div>
          <div style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '8px' }}>
            Income brackets
          </div>

          {brackets.map((bracket, index) => (
            <div
              key={index}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                marginBottom: '6px',
                padding: '6px 8px',
                borderRadius: '6px',
                background: 'var(--panel-alpha-05)',
                border: bracketError ? '1px solid var(--color-red)' : '1px solid var(--glass-border)',
              }}
            >
              <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', minWidth: '60px' }}>
                Up to wealth:
              </span>
              <input
                type="number"
                min={index === 0 ? 1 : (brackets[index - 1]?.upto ?? 0) + 1}
                step={100}
                value={bracket.upto}
                disabled={isPastCheckpoint}
                onChange={e => {
                  const v = parseFloat(e.target.value);
                  if (!isNaN(v)) handleBracketChange(index, 'upto', v);
                }}
                style={{ ...inputStyle, width: '90px' }}
              />
              <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Rate:</span>
              <input
                type="number"
                min={0}
                max={50}
                step={0.5}
                value={bracket.rate}
                disabled={isPastCheckpoint}
                onChange={e => {
                  const v = parseFloat(e.target.value);
                  if (!isNaN(v)) handleBracketChange(index, 'rate', v);
                }}
                style={{ ...inputStyle, width: '60px' }}
              />
              <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>%</span>
              {brackets.length > 1 && (
                <button
                  onClick={() => handleRemoveBracket(index)}
                  disabled={isPastCheckpoint}
                  style={{
                    marginLeft: 'auto',
                    padding: '2px 8px',
                    borderRadius: '4px',
                    border: '1px solid var(--glass-border)',
                    background: 'transparent',
                    color: 'var(--color-red)',
                    fontSize: '0.75rem',
                    cursor: isPastCheckpoint ? 'not-allowed' : 'pointer',
                    fontFamily: 'inherit',
                  }}
                >
                  Remove
                </button>
              )}
            </div>
          ))}

          {/* Validation errors */}
          {bracketError && (
            <div style={errorStyle}>{bracketError}</div>
          )}

          {/* Add bracket button */}
          <button
            onClick={handleAddBracket}
            disabled={isPastCheckpoint}
            style={{
              marginTop: '6px',
              padding: '4px 12px',
              borderRadius: '6px',
              border: '1px solid var(--glass-border)',
              background: 'transparent',
              color: 'var(--text-muted)',
              fontSize: '0.82rem',
              cursor: isPastCheckpoint ? 'not-allowed' : 'pointer',
              fontFamily: 'inherit',
            }}
          >
            + Add bracket
          </button>
        </div>
      )}
    </div>
  );
}
