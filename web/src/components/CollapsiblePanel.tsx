import type { CSSProperties, ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface CollapsiblePanelProps {
  side: 'left' | 'right';
  collapsed: boolean;
  onToggle: () => void;
  label: string;
  children: ReactNode;
}

export function CollapsiblePanel({
  side,
  collapsed,
  onToggle,
  label,
  children,
}: CollapsiblePanelProps) {
  const ExpandIcon = side === 'left' ? ChevronRight : ChevronLeft;
  const CollapseIcon = side === 'left' ? ChevronLeft : ChevronRight;

  const toggleButtonStyle: CSSProperties = {
    position: 'absolute',
    top: 8,
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    color: 'var(--text-dim)',
    zIndex: 1,
    padding: 4,
    [side === 'left' ? 'right' : 'left']: 8,
  };

  return (
    <div
      style={{
        width: collapsed ? 40 : undefined,
        minWidth: collapsed ? 40 : 300,
        transition: 'width 0.3s ease, min-width 0.3s ease',
        overflow: 'hidden',
        position: 'relative',
        background: 'var(--glass-bg)',
        border: '1px solid var(--glass-border)',
        borderRadius: 10,
      }}
    >
      {collapsed ? (
        <button
          onClick={onToggle}
          title={`Expand ${label}`}
          aria-label={`Expand ${label}`}
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--text-dim)',
            padding: 4,
          }}
        >
          <ExpandIcon size={20} />
        </button>
      ) : (
        <>
          <button
            onClick={onToggle}
            title={`Collapse ${label}`}
            aria-label={`Collapse ${label}`}
            style={toggleButtonStyle}
          >
            <CollapseIcon size={16} />
          </button>
          {children}
        </>
      )}
    </div>
  );
}
