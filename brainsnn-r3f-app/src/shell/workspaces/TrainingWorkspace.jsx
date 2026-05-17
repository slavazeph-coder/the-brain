import React, { Suspense, lazy } from 'react';
import ErrorBoundary from '../../components/ErrorBoundary';

const DailyChallengePanel = lazy(() => import('../../components/DailyChallengePanel'));
const QuizPanel = lazy(() => import('../../components/QuizPanel'));
const BadgesPanel = lazy(() => import('../../components/BadgesPanel'));
const TextAdventurePanel = lazy(() => import('../../components/TextAdventurePanel'));
const DebatePanel = lazy(() => import('../../components/DebatePanel'));
const MacrosPanel = lazy(() => import('../../components/MacrosPanel'));
const ReplayPanel = lazy(() => import('../../components/ReplayPanel'));
const WeeklyRecapPanel = lazy(() => import('../../components/WeeklyRecapPanel'));
const ComplimentPanel = lazy(() => import('../../components/ComplimentPanel'));
const GenrePanel = lazy(() => import('../../components/GenrePanel'));
const PersonaPanel = lazy(() => import('../../components/PersonaPanel'));
const ComposerPanel = lazy(() => import('../../components/ComposerPanel'));

export default function TrainingWorkspace({ session }) {
  const { incomingDaily } = session;
  return (
    <div className="shell-workspace">
      <header className="shell-workspace-header">
        <div className="eyebrow">Training</div>
        <h1>Sharpen the eye.</h1>
        <p className="muted">Daily challenges, badges, adversarial scenarios, and reply craft.</p>
      </header>

      <Suspense fallback={<div className="muted small-note">Loading…</div>}>
        <ErrorBoundary name="Daily Challenge"><DailyChallengePanel initialHash={incomingDaily} /></ErrorBoundary>
        <ErrorBoundary name="Quiz"><QuizPanel /></ErrorBoundary>
        <ErrorBoundary name="Badges"><BadgesPanel /></ErrorBoundary>

        <details className="shell-drawer">
          <summary>Scenarios</summary>
          <ErrorBoundary name="Text Adventure"><TextAdventurePanel /></ErrorBoundary>
          <ErrorBoundary name="Debate"><DebatePanel /></ErrorBoundary>
          <ErrorBoundary name="Macros"><MacrosPanel /></ErrorBoundary>
          <ErrorBoundary name="Replay"><ReplayPanel /></ErrorBoundary>
        </details>

        <details className="shell-drawer">
          <summary>Reply craft</summary>
          <ErrorBoundary name="Composer"><ComposerPanel /></ErrorBoundary>
          <ErrorBoundary name="Compliment"><ComplimentPanel /></ErrorBoundary>
          <ErrorBoundary name="Genre"><GenrePanel /></ErrorBoundary>
          <ErrorBoundary name="Persona"><PersonaPanel /></ErrorBoundary>
        </details>

        <details className="shell-drawer">
          <summary>Recap</summary>
          <ErrorBoundary name="Weekly Recap"><WeeklyRecapPanel /></ErrorBoundary>
        </details>
      </Suspense>
    </div>
  );
}
