import React, { useEffect, useRef, useState } from 'react';
import Topbar from './Topbar';
import WorkspaceTabs, { WORKSPACES } from './WorkspaceTabs';
import BrainViewport from './BrainViewport';
import Sidebar from './Sidebar';
import Composer from './Composer';
import HomeWorkspace from './workspaces/HomeWorkspace';
import AnalyzeWorkspace from './workspaces/AnalyzeWorkspace';
import DefendWorkspace from './workspaces/DefendWorkspace';
import BrainWorkspace from './workspaces/BrainWorkspace';
import KnowledgeWorkspace from './workspaces/KnowledgeWorkspace';
import TrainingWorkspace from './workspaces/TrainingWorkspace';
import ConnectWorkspace from './workspaces/ConnectWorkspace';
import { bus } from './bus';

const WORKSPACE_COMPONENT = {
  home:      HomeWorkspace,
  analyze:   AnalyzeWorkspace,
  defend:    DefendWorkspace,
  brain:     BrainWorkspace,
  knowledge: KnowledgeWorkspace,
  training:  TrainingWorkspace,
  connect:   ConnectWorkspace
};

const VALID = new Set(Object.keys(WORKSPACE_COMPONENT));
const STORAGE_KEY = 'brainsnn_shell_workspace';

function initialWorkspace() {
  if (typeof window === 'undefined') return 'home';
  try {
    const url = new URLSearchParams(window.location.search).get('w');
    if (url && VALID.has(url)) return url;
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && VALID.has(stored)) return stored;
  } catch { /* noop */ }
  return 'home';
}

/**
 * AppShell — Claude-design workspace shell.
 *
 * Layout:
 *   <Topbar>                                           full-width
 *   <main>
 *     <WorkspaceTabs>     <workspace-column>           <Sidebar>
 *                         <BrainViewport persistent>
 *                         <Composer>
 *                         <ActiveWorkspace>
 *
 * The brain viewport is mounted once and never unmounted; tab navigation
 * only swaps the workspace body below it.
 */
export default function AppShell({ session, modeLabel }) {
  const [workspace, setWorkspace] = useState(initialWorkspace);

  // Persist + URL-sync on workspace change.
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, workspace); } catch { /* noop */ }
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('w', workspace);
      window.history.replaceState(null, '', url.toString());
    } catch { /* noop */ }
  }, [workspace]);

  // Listen for cross-component workspace navigation (palette, hotkeys,
  // onboarding, flashLayer).
  useEffect(() => bus.on('shell:goto', ({ workspace: w }) => {
    if (w && VALID.has(w)) setWorkspace(w);
  }), []);

  // g+letter chord listener (gh ga gd gb gk gt gc).
  useEffect(() => {
    let pending = false;
    let timer = null;
    const onKey = (e) => {
      if (e.target?.matches?.('input, textarea, [contenteditable]')) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'g') {
        pending = true;
        clearTimeout(timer);
        timer = setTimeout(() => { pending = false; }, 900);
        return;
      }
      if (pending) {
        pending = false;
        clearTimeout(timer);
        const match = WORKSPACES.find((w) => w.chord[1] === e.key.toLowerCase());
        if (match) {
          e.preventDefault();
          setWorkspace(match.id);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const activeMeta = WORKSPACES.find((w) => w.id === workspace) || WORKSPACES[0];
  const Workspace = WORKSPACE_COMPONENT[workspace] || HomeWorkspace;
  const promoted = workspace === 'brain';
  const workspaceHostRef = useRef(null);

  // Move focus to the workspace heading on every change. Screen-reader
  // users hear the new workspace title; sighted keyboard users get a
  // visible focus ring at the top of the body so further Tab presses
  // walk into the workspace, not back into the tab rail.
  // Skips the initial mount so the page doesn't steal focus.
  const didMount = useRef(false);
  useEffect(() => {
    if (!didMount.current) { didMount.current = true; return; }
    const heading = workspaceHostRef.current?.querySelector('.shell-workspace-header h1');
    if (heading) {
      heading.setAttribute('tabindex', '-1');
      heading.focus({ preventScroll: false });
    }
  }, [workspace]);

  return (
    <div className="shell-root">
      <a href="#shell-workspace-host" className="shell-skip-link">Skip to workspace content</a>
      <Topbar
        workspace={activeMeta.label}
        firewallResult={session.firewallResult}
        immunity={session.immunityScore}
        onShowHelp={session.onShowHelp}
      />

      <main className="shell-main">
        <WorkspaceTabs active={workspace} onChange={setWorkspace} />

        <div className="shell-column">
          <BrainViewport
            state={session.state}
            quality={session.quality}
            knowledgeMode={session.knowledgeMode}
            affectOverride={session.affectOverride}
            promoted={promoted}
            onSelect={session.onSelectRegion}
            onQualityChange={session.onControls.onSetQuality}
            modeLabel={modeLabel}
          />

          <Composer />

          <div
            id="shell-workspace-host"
            ref={workspaceHostRef}
            className="shell-workspace-host"
            role="tabpanel"
            aria-labelledby={`shell-tab-${workspace}`}
            tabIndex={-1}
          >
            <Workspace session={session} />
          </div>
        </div>

        <Sidebar
          state={session.state}
          timelineFrame={session.timelineFrame}
          onSelect={session.onSelectRegion}
        />
      </main>
    </div>
  );
}
