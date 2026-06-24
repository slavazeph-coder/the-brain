import React from 'react';

export function SegmentedControl({ label, options, value, onChange }) {
  return (
    <div className="content-type-selector">
      {label ? <span className="bsn-mono">{label}</span> : null}
      <div className="bsn-segmented" role="radiogroup" aria-label={label || 'Options'}>
        {options.map((option) => {
          const active = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              className={active ? 'active' : ''}
              role="radio"
              aria-checked={active}
              onClick={() => onChange(option.value)}
            >
              {option.icon ? <option.icon size={16} aria-hidden="true" /> : null}
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
