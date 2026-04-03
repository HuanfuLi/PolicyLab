import React, { useState, useRef, useCallback, useEffect } from 'react';

interface LocationResult {
  name: string;
  country: string;
  countryCode: string;
  coordinates: { lat: number; lon: number };
  type: string;
  state?: string;
}

interface LocationSearchProps {
  onSelect: (location: LocationResult) => void;
  disabled?: boolean;
}

const LocationSearch: React.FC<LocationSearchProps> = ({ onSelect, disabled }) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<LocationResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const blurTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchLocations = useCallback(async (q: string) => {
    if (q.length < 2) {
      setResults([]);
      setShowDropdown(false);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/locations/search?q=${encodeURIComponent(q)}`);
      if (res.ok) {
        const data = await res.json() as LocationResult[];
        setResults(data);
        setShowDropdown(data.length > 0);
      }
    } catch {
      // ignore network errors
    } finally {
      setLoading(false);
    }
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setQuery(val);
    setSelectedName(null);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchLocations(val), 300);
  };

  const handleSelect = (loc: LocationResult) => {
    const displayName = loc.state
      ? `${loc.name}, ${loc.state}, ${loc.country}`
      : `${loc.name}, ${loc.country}`;
    setQuery(displayName);
    setSelectedName(displayName);
    setShowDropdown(false);
    setResults([]);
    onSelect(loc);
  };

  const handleBlur = () => {
    // Delay to allow click on dropdown items
    blurTimeoutRef.current = setTimeout(() => setShowDropdown(false), 200);
  };

  const handleFocus = () => {
    if (blurTimeoutRef.current) clearTimeout(blurTimeoutRef.current);
    if (results.length > 0 && !selectedName) setShowDropdown(true);
  };

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (blurTimeoutRef.current) clearTimeout(blurTimeoutRef.current);
    };
  }, []);

  const typeBadgeColor = (type: string) => {
    switch (type) {
      case 'city': return 'var(--primary)';
      case 'state': return 'var(--color-yellow, #eab308)';
      case 'country': return 'var(--color-green, #22c55e)';
      default: return 'var(--text-muted)';
    }
  };

  return (
    <div style={{ position: 'relative', width: '100%' }}>
      <div style={{ position: 'relative' }}>
        <input
          type="text"
          className="input-glass"
          style={{ width: '100%', fontSize: '1.05rem', paddingRight: '2.5rem' }}
          placeholder="Search for a city, state, or country..."
          value={query}
          onChange={handleChange}
          onBlur={handleBlur}
          onFocus={handleFocus}
          disabled={disabled}
          autoComplete="off"
        />
        {loading && (
          <div style={{
            position: 'absolute',
            right: '0.75rem',
            top: '50%',
            transform: 'translateY(-50%)',
            width: '18px',
            height: '18px',
            border: '2px solid var(--border)',
            borderTopColor: 'var(--primary)',
            borderRadius: '50%',
            animation: 'spin 0.8s linear infinite',
          }} />
        )}
      </div>

      {showDropdown && results.length > 0 && (
        <div style={{
          position: 'absolute',
          top: '100%',
          left: 0,
          right: 0,
          zIndex: 50,
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
          borderRadius: '8px',
          marginTop: '4px',
          maxHeight: '280px',
          overflowY: 'auto',
          boxShadow: '0 8px 24px rgba(0,0,0,0.2)',
        }}>
          {results.map((loc, i) => (
            <div
              key={`${loc.name}-${loc.countryCode}-${i}`}
              style={{
                padding: '0.75rem 1rem',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                borderBottom: i < results.length - 1 ? '1px solid var(--border)' : 'none',
                transition: 'background 0.15s',
              }}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => handleSelect(loc)}
              onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'var(--primary-alpha, rgba(99,102,241,0.1))'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
            >
              <span style={{ color: 'var(--text)' }}>
                {loc.name}
                {loc.state && <span style={{ color: 'var(--text-muted)' }}>, {loc.state}</span>}
                <span style={{ color: 'var(--text-muted)' }}>, {loc.country}</span>
              </span>
              <span style={{
                fontSize: '0.7rem',
                padding: '0.15rem 0.5rem',
                borderRadius: '10px',
                background: typeBadgeColor(loc.type),
                color: '#fff',
                textTransform: 'uppercase',
                fontWeight: 600,
                letterSpacing: '0.03em',
              }}>
                {loc.type}
              </span>
            </div>
          ))}
        </div>
      )}

      <style>{`
        @keyframes spin {
          to { transform: translateY(-50%) rotate(360deg); }
        }
      `}</style>
    </div>
  );
};

export default LocationSearch;
