import React, { Suspense, lazy } from 'react';
import ErrorBoundary from '../../components/ErrorBoundary';
import AnalyticsDashboard from '../../components/AnalyticsDashboard';
import NarrativePanel from '../../components/NarrativePanel';
import ActivityCharts from '../../components/ActivityCharts';

const TimeSeriesPanel = lazy(() => import('../../components/TimeSeriesPanel'));
const CalendarHeatmapPanel = lazy(() => import('../../components/CalendarHeatmapPanel'));
const HeatmapTimeline = lazy(() => import('../../components/HeatmapTimeline'));
const ComparatorPanel = lazy(() => import('../../components/ComparatorPanel'));
const DrillDownPanel = lazy(() => import('../../components/DrillDownPanel'));

export default function AnalyzeWorkspace({ session }) {
  const { state, trends, firewallResult } = session;
  return (
    <div className="shell-workspace">
      <header className="shell-workspace-header">
        <div className="eyebrow">Analyze</div>
        <h1>Read the brain.</h1>
        <p className="muted">Live signals, trends, anomalies, and how today's activity stacks up.</p>
      </header>

      <ErrorBoundary name="Analytics Dashboard"><AnalyticsDashboard state={state} /></ErrorBoundary>
      <NarrativePanel state={state} trends={trends} firewallResult={firewallResult} />
      <ActivityCharts state={state} />

      <Suspense fallback={<div className="muted small-note">Loading…</div>}>
        <ErrorBoundary name="Time-Series"><TimeSeriesPanel /></ErrorBoundary>
        <ErrorBoundary name="Calendar Heatmap"><CalendarHeatmapPanel /></ErrorBoundary>
        <ErrorBoundary name="Heatmap Timeline"><HeatmapTimeline state={state} /></ErrorBoundary>
        <ErrorBoundary name="Comparator"><ComparatorPanel /></ErrorBoundary>
        <ErrorBoundary name="Drill-Down"><DrillDownPanel regions={state.regions} /></ErrorBoundary>
      </Suspense>
    </div>
  );
}
