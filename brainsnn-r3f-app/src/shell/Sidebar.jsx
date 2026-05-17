import React, { Suspense, lazy } from 'react';
import InspectorPanel from '../components/InspectorPanel';

const RoleTourPanel = lazy(() => import('../components/RoleTourPanel'));
const MilestonePanel = lazy(() => import('../components/MilestonePanel'));

/**
 * Sidebar — right rail. InspectorPanel always visible (it's the persistent
 * context for whichever region is selected). Below it, a collapsible role
 * tour + milestone widget so first-time users can find their way without
 * those panels needing dedicated workspace slots.
 */
export default function Sidebar({ state, timelineFrame, onSelect }) {
  return (
    <aside className="shell-sidebar">
      <InspectorPanel
        state={state}
        timelineFrame={timelineFrame}
        onSelect={onSelect}
      />

      <details className="shell-side-section">
        <summary>Quick tours</summary>
        <Suspense fallback={<div className="muted small-note">Loading…</div>}>
          <RoleTourPanel />
        </Suspense>
      </details>

      <details className="shell-side-section">
        <summary>Layer atlas</summary>
        <Suspense fallback={<div className="muted small-note">Loading…</div>}>
          <MilestonePanel />
        </Suspense>
      </details>
    </aside>
  );
}
