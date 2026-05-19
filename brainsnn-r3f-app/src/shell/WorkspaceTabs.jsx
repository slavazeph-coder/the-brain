import React, { useRef } from 'react';

export const WORKSPACES = [
  { id: 'home',      label: 'Home',      chord: 'gh', glyph: '◉' },
  { id: 'analyze',   label: 'Analyze',   chord: 'ga', glyph: '◯' },
  { id: 'defend',    label: 'Defend',    chord: 'gd', glyph: '◇' },
  { id: 'brain',     label: 'Brain',     chord: 'gb', glyph: '◐' },
  { id: 'knowledge', label: 'Knowledge', chord: 'gk', glyph: '◑' },
  { id: 'training',  label: 'Training',  chord: 'gt', glyph: '◒' },
  { id: 'connect',   label: 'Connect',   chord: 'gc', glyph: '◓' }
];

function WorkspaceTabsImpl({ active, onChange }) {
  const ref = useRef(null);
  const activeIdx = WORKSPACES.findIndex((w) => w.id === active);

  function onKeyDown(e) {
    const idx = WORKSPACES.findIndex((w) => w.id === active);
    if (idx < 0) return;
    let next = idx;
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') next = (idx + 1) % WORKSPACES.length;
    else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') next = (idx - 1 + WORKSPACES.length) % WORKSPACES.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = WORKSPACES.length - 1;
    else return;
    e.preventDefault();
    onChange(WORKSPACES[next].id);
    // Move focus to the newly active tab so the user can keep arrowing.
    requestAnimationFrame(() => {
      const btns = ref.current?.querySelectorAll('[role="tab"]');
      btns?.[next]?.focus();
    });
  }

  return (
    <nav
      ref={ref}
      className="shell-tabs"
      role="tablist"
      aria-label="Workspaces"
      aria-orientation="vertical"
      onKeyDown={onKeyDown}
    >
      {WORKSPACES.map((w, i) => (
        <button
          key={w.id}
          role="tab"
          id={`shell-tab-${w.id}`}
          aria-controls={`shell-panel-${w.id}`}
          aria-selected={active === w.id}
          // Roving tabindex so only the active tab is in the tab order;
          // ArrowKeys cycle through the others.
          tabIndex={active === w.id ? 0 : -1}
          className={`shell-tab ${active === w.id ? 'is-active' : ''}`}
          onClick={() => onChange(w.id)}
          title={`${w.label} (${w.chord})`}
        >
          <span className="shell-tab-glyph" aria-hidden>{w.glyph}</span>
          <span className="shell-tab-label">{w.label}</span>
          <span className="shell-tab-chord" aria-hidden>{w.chord}</span>
        </button>
      ))}
    </nav>
  );
}

// Tabs depend only on { active, onChange }. AppShell re-renders every
// 180ms (simulation tick) but neither of these change with it.
export default React.memo(WorkspaceTabsImpl);
