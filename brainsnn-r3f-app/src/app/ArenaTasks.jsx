import React, { useEffect, useState } from 'react';
import { listOwnedMissions, listPublishedMissions } from '../features/missions/missionMarketplaceApi.js';
import { PublicNav, PublicFooter } from './PublicNav.jsx';
import { RefundAuthorityMissionPage } from './RefundAuthorityMissionPage.jsx';
import { WorkflowEfficiencyMissionPage } from './WorkflowEfficiencyMissionPage.jsx';
import { ExtendedProofMissionPage } from './ExtendedProofMissionPage.jsx';
import { PublishedMissionPage } from './PublishedMissionPage.jsx';
import { MissionBuilderPage } from './MissionBuilderPage.jsx';

const TASKS = [
  ['refund-authority', 'Refund authority', 'A deterministic transaction ledger judges a synthetic refund policy.'],
  ['workflow-efficiency', 'Workflow efficiency', 'A cost ledger judges a bounded synthetic workflow.'],
  ['authorized-bug-hunt', 'Authorized bug hunt', 'A planted manifest judges findings in a closed synthetic target.'],
  ['reproduce-result', 'Reproduce a result', 'A predeclared coefficient judges a seeded numerical experiment.'],
  ['navigation-baseline', 'Navigation baseline', 'A route ledger judges synthetic collisions and energy use.'],
];
export function ArenaTasks() {
  const slug = window.location.pathname.replace(/^\/arena\/tasks\/?/, '').replace(/\/$/, '');
  const [published, setPublished] = useState([]);
  const [owned, setOwned] = useState([]);
  const [error, setError] = useState('');
  useEffect(() => {
    if (slug) return;
    let active = true;
    Promise.all([listPublishedMissions(), listOwnedMissions()]).then(([publicTasks, ownTasks]) => {
      if (active) { setPublished(publicTasks.missions || []); setOwned(ownTasks.missions || []); }
    }).catch(() => { if (active) setError('Published tasks are temporarily unavailable. Local tasks still run.'); });
    return () => { active = false; };
  }, [slug]);
  const task = TASKS.find(([id]) => id === slug);
  let content;
  if (slug === 'refund-authority') content = <RefundAuthorityMissionPage embedded />;
  else if (slug === 'workflow-efficiency') content = <WorkflowEfficiencyMissionPage embedded />;
  else if (slug === 'authorized-bug-hunt') content = <ExtendedProofMissionPage missionId="003" embedded />;
  else if (slug === 'reproduce-result') content = <ExtendedProofMissionPage missionId="004" embedded />;
  else if (slug === 'navigation-baseline') content = <ExtendedProofMissionPage missionId="005" embedded />;
  else if (slug.startsWith('published/')) content = <PublishedMissionPage embedded />;
  else if (slug === 'build') content = <MissionBuilderPage embedded />;
  return <div className="bh-site task-shell"><PublicNav active="arena" />
    {content ? <><p className="task-context"><a href="/arena/tasks">Arena tasks</a> / {task?.[1] || 'Custom task'} · Local synthetic execution</p>{content}</> : <main className="lab-index">
      <p className="bh-kicker"><a href="/arena/">Arena</a> / Tasks</p><h1>{slug ? 'Task unavailable' : 'Arena tasks'}</h1>
      <p>{slug ? 'This task has no available implementation. Choose one of the supported tasks below.' : 'Finite synthetic tasks with explicit judges. These runs do not score a named model.'}</p>
      <div className="lab-cards">{TASKS.map(([id, title, description]) => <a className="lab-card" key={id} href={`/arena/tasks/${id}`}><h2>{title}</h2><p>{description}</p><span>Open task →</span></a>)}</div>
      {error && <p role="status">{error}</p>}
      {!slug && <section id="creator-dashboard"><h2>Your published tasks</h2>{owned.length ? <ul>{owned.map(item => <li key={item.id}><a href={`/arena/tasks/published/${item.id}`}>{item.contract?.title || item.id}</a></li>)}</ul> : <p>No saved published tasks in this browser workspace.</p>}<h2>Public tasks</h2>{published.length ? <ul>{published.map(item => <li key={item.id}><a href={`/arena/tasks/published/${item.id}`}>{item.contract?.title || item.id}</a></li>)}</ul> : <p>No public tasks available.</p>}</section>}
      <p><a href="/arena/tasks/build">Build a custom task</a></p>
    </main>}<PublicFooter /></div>;
}
