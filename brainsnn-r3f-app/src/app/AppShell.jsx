import React, { useEffect, useLayoutEffect, useState } from 'react';
import { track } from '../lib/analytics.js';
import { WorldHome } from './WorldHome.jsx';
import { WorldScan } from './WorldScan.jsx';
import { BehaviourHome } from './BehaviourHome.jsx';
import { LabIndex } from './LabIndex.jsx';
import { PublicNav, PublicFooter } from './PublicNav.jsx';
import { CommandPalette } from './CommandPalette.jsx';
import { getNavItem } from './navigation.js';
import { legacyRedirect } from './legacyRoutes.js';
import { resolveRouteMeta } from '../lib/routeMeta.js';

const CoherenceLanding = React.lazy(() => import('./CoherenceLanding.jsx').then(m => ({ default: m.CoherenceLanding })));
const ReviewWorkbench = React.lazy(() => import('./ReviewWorkbench.jsx').then(m => ({ default: m.ReviewWorkbench })));
const ArenaTasks = React.lazy(() => import('./ArenaTasks.jsx').then(m => ({ default: m.ArenaTasks })));
const LandingPage = React.lazy(() => import('./LandingPage.jsx').then(m => ({ default: m.LandingPage })));
const SurvivalWorldPage = React.lazy(() => import('./SurvivalWorldPage.jsx').then(m => ({ default: m.SurvivalWorldPage })));
const HoldoutEvidencePage = React.lazy(() => import('../features/research/HoldoutEvidencePage.jsx').then(m => ({ default: m.HoldoutEvidencePage })));
const PowderLabPage = React.lazy(() => import('../features/powder/PowderLabPage.tsx').then(m => ({ default: m.PowderLabPage })));
const FoolTheDetector = React.lazy(() => import('../features/toys/fool/FoolTheDetector.jsx').then(m => ({ default: m.FoolTheDetector })));
const DraftDuel = React.lazy(() => import('../features/toys/duel/DraftDuel.jsx').then(m => ({ default: m.DraftDuel })));
const DefendTheBrainToy = React.lazy(() => import('../features/toys/defend/DefendTheBrainToy.jsx').then(m => ({ default: m.DefendTheBrainToy })));

export function resolveRoute(pathname) {
  const path = pathname.replace(/\/+$/, '') || '/';
  if (path.startsWith('/toys/fool-the-detector')) return 'toy-fool';
  if (path.startsWith('/toys/draft-duel')) return 'toy-duel';
  if (path.startsWith('/toys/defend-the-brain')) return 'toy-defend';
  if (path === '/office' || path.startsWith('/office/')) return 'review';
  if (path === '/arena/tasks' || path.startsWith('/arena/tasks/')) return 'tasks';
  if (path === '/lab/powder') return 'powder';
  if (path === '/lab/survival') return 'survival';
  if (path === '/lab') return 'lab';
  if (path === '/arcade') return 'arcade';
  if (path === '/evidence') return 'evidence';
  if (path === '/play') return 'play';
  if (path === '/coherence') return 'coherence';
  if (path === '/scan') return 'scan';
  if (path === '/') return 'home';
  return 'missing';
}

function currentRoute() {
  const redirect = legacyRedirect(window.location.pathname, window.location.search);
  if (redirect) {
    if (redirect.startsWith('/arena/') && !redirect.startsWith('/arena/tasks')) {
      window.location.replace(redirect + window.location.hash);
      return 'redirect';
    }
    window.history.replaceState({}, '', redirect + window.location.hash);
  }
  return resolveRoute(window.location.pathname);
}

let visitTracked = false;
export function AppShell() {
  const [route, setRoute] = useState(currentRoute);
  const [commandOpen, setCommandOpen] = useState(false);
  const [initialInput, setInitialInput] = useState('');
  useEffect(() => {
    if (!visitTracked) { visitTracked = true; track('visit', { route }); }
    function sync() { setRoute(currentRoute()); }
    function shortcut(event) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setCommandOpen(true); }
    }
    window.addEventListener('popstate', sync);
    window.addEventListener('keydown', shortcut);
    return () => { window.removeEventListener('popstate', sync); window.removeEventListener('keydown', shortcut); };
  }, []);
  // Establish a fallback before page effects run. A resolved lazy page mounts
  // in the same commit as the shell, so a parent passive effect would otherwise
  // overwrite its more specific tab/task title on history navigation.
  useLayoutEffect(() => {
    document.title = resolveRouteMeta(window.location.pathname, window.location.search).title;
  }, [route]);
  function openReview(input = '') {
    setInitialInput(typeof input === 'string' ? input : '');
    window.history.pushState({}, '', '/office?tab=passage'); setRoute('review');
    window.scrollTo(0, 0);
  }
  function navigate(id) { window.location.assign(getNavItem(id).href); }
  let content;
  if (route === 'home') content = <WorldHome />;
  else if (route === 'scan') content = <WorldScan />;
  else if (route === 'coherence') content = <CoherenceLanding onNavigate={navigate} onStart={openReview} />;
  else if (route === 'review') content = <div className="bh-site"><a className="bh-skip" href="#review-main">Skip to content</a><PublicNav active="review" /><ReviewWorkbench initialInput={initialInput} /><PublicFooter /></div>;
  else if (route === 'tasks') content = <ArenaTasks />;
  else if (route === 'lab') content = <LabIndex />;
  else if (route === 'powder') content = <div className="bh-site"><PublicNav active="lab" /><PowderLabPage /><PublicFooter /></div>;
  else if (route === 'survival') content = <div className="bh-site"><PublicNav active="lab" /><SurvivalWorldPage /><PublicFooter /></div>;
  else if (route === 'arcade') content = <LandingPage onStart={openReview} />;
  else if (route === 'play') content = <BehaviourHome />;
  else if (route === 'evidence') content = <div className="bh-site"><PublicNav active="evidence" /><HoldoutEvidencePage onHome={() => window.location.assign('/')} onStart={openReview} /><PublicFooter /></div>;
  else if (route === 'toy-fool') content = <FoolTheDetector />;
  else if (route === 'toy-duel') content = <DraftDuel />;
  else if (route === 'toy-defend') content = <DefendTheBrainToy />;
  else content = <div className="bh-site"><PublicNav /><main className="lab-index"><h1>{route === 'redirect' ? 'Opening Arena…' : 'Page unavailable'}</h1><a href="/">Return to BrainSNN</a></main></div>;
  return <><React.Suspense fallback={<div className="bh-site"><PublicNav /><main className="lab-index" role="status">Loading…</main></div>}>{content}</React.Suspense><CommandPalette open={commandOpen} onClose={() => setCommandOpen(false)} onNavigate={navigate} /></>;
}
