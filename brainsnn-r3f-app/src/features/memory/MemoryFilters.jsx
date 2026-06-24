import React from 'react';

const filters = ['All', 'High potential', 'Trust risk', 'High manipulation risk', 'Approved', 'Draft'];

export function MemoryFilters({ value, onChange }) {
  return (
    <div className="memory-filters" aria-label="Memory filters">
      {filters.map((filter) => (
        <button key={filter} className={value === filter ? 'active' : ''} type="button" onClick={() => onChange(filter)}>
          {filter}
        </button>
      ))}
    </div>
  );
}
