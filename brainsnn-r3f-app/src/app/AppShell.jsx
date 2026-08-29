import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { track } from '../lib/analytics.js';
import { excerpt } from '../lib/formatters.js';
import { loadQueue, saveQueue } from '../lib/storage.js';
import { useScanEngine } from '../features/scan/useScanEngine.js';
import { useScanHistory } from '../features/memory/useScanHistory.js';
import { ScanWorkspace } from '../features/scan/ScanWorkspace.jsx';
import { ImprovementWorkspace } from '../features/improve/ImprovementWorkspace.jsx';
import { AutopsyWorkspace } from '../features/autopsy/AutopsyWorkspace.jsx';
import { ScanHistory } from '../features/memory/ScanHistory.jsx';
import { ApprovalQueue } from '../features/approvals/ApprovalQueue.jsx';
import { PricingWorkspace } from '../features/pricing/PricingWorkspace.jsx';
import { ResearchWorkspaceV2 } from '../features/research/ResearchWorkspaceV2.jsx';
import { ShareDialog } from '../features/export/ShareDialog.jsx';
import { AppHeader } from './AppHeader.jsx';
import { BehaviourHome } from './BehaviourHome.jsx';
import { ProofMissionsPage } from './ProofMissionsPage.jsx';
import { RefundAuthorityMissionPage } from './RefundAuthorityMissionPage.jsx';
import { WorkflowEfficiencyMissionPage } from './WorkflowEfficiencyMissionPage.jsx';
import { ExtendedProofMissionPage } from './ExtendedProofMissionPage.jsx';
import { CommandPalette } from './CommandPalette.jsx';
import { DesktopSidebar } from './DesktopSidebar.jsx';
import { LandingPage } from './LandingPage.jsx';
import { MobileNavigation } from './MobileNavigation.jsx';
import { ReconstructPage } from './ReconstructPage.jsx';
import { SurvivalWorldPage } from './SurvivalWorldPage.jsx';
import { HoldoutEvidencePage } from '../features/research/HoldoutEvidencePage.jsx';

const PowderLabPage = React.lazy(() => import('../features/powder/PowderLabPage.tsx').then((module) => ({ default: module.PowderLabPage })));

function resolveRoute(pathname) {
  if (pathname.startsWith('/missions/refund-authority')) return 'refund-mission';
  if (pathname.startsWith('/missions/workflow-efficiency')) return 'workflow-mission';
  if (pathname.startsWith('/missions/authorized-bug-hunt')) return 'mission-003';
  if (pathname.startsWith('/missions/reproduce-result')) return 'mission-004';
  if (pathname.startsWith('/missions/navigation-baseline')) return 'mission-005';
  if (pathname.startsWith('/missions')) return 'missions';
  if (pathname.startsWith('/lab/survival')) return 'survival';
  if (pathname.startsWith('/arcade')) return 'arcade';
  if (pathname.startsWith('/app')) return 'app';
  if (pathname.startsWith('/reconstruct')) return 'reconstruct';
  if (pathname.startsWith('/evidence')) return 'evidence';
  if (pathname.startsWith('/lab')) return 'lab';
  return 'home';
}

let visitTracked = false;
function makeQueueItem(result, content, comparison, status = 'Draft') { const sourceContent = content || result?.rawContent || ''; return { id: `${result?.id || 'draft'}-${Date.now().toString(36)}`, title: result?.title || 'Untitled draft', excerpt: excerpt(sourceContent), verdict: result?.summary || 'Pending review', status, currentVersion: content ? 2 : 1, updatedAt: new Date().toISOString(), versions: [{ id: 'v1', label: 'Original', content: result?.rawContent || '', result }, ...(content ? [{ id: 'v2', label: 'Improved', content, result: comparison || null }] : [])], result: comparison || result }; }

export function AppShell() {
  const scan=useScanEngine(), history=useScanHistory(); const [route,setRoute]=useState(()=>resolveRoute(window.location.pathname)); const [active,setActive]=useState('analyze'); const [collapsed,setCollapsed]=useState(false); const [commandOpen,setCommandOpen]=useState(false); const [exportOpen,setExportOpen]=useState(false); const [exportResult,setExportResult]=useState(null); const [queue,setQueue]=useState([]);
  useEffect(()=>setQueue(loadQueue()),[]); useEffect(()=>{if(!visitTracked){visitTracked=true;track('visit',{route:resolveRoute(window.location.pathname)})}},[]); useEffect(()=>{const sync=()=>setRoute(resolveRoute(window.location.pathname));window.addEventListener('popstate',sync);return()=>window.removeEventListener('popstate',sync)},[]); useEffect(()=>{if(route==='app')document.title='BrainSNN | Creative Decision Intelligence'},[route]); useEffect(()=>{const key=(e)=>{if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'){e.preventDefault();setCommandOpen(true)}};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key)},[]);
  const persistQueue=useCallback((next)=>{const saved=saveQueue(next);setQueue(saved)},[]); const navigate=useCallback((id)=>{const aliases={cortex:'analyze',synapse:'improve',memory:'history'};if(id==='home'){window.history.pushState({},'','/');setRoute('home');return}if(id==='worlds'){window.history.pushState({},'','/lab/survival');setRoute('survival');return}if(id==='arcade'){window.history.pushState({},'','/arcade');setRoute('arcade');return}if(route!=='app'){window.history.pushState({},'','/app');setRoute('app')}setActive(aliases[id]||id);window.scrollTo({top:0,behavior:'smooth'})},[route]);
  const openWorkspace=useCallback((prefill='')=>{if(typeof prefill==='string')scan.setInput(prefill);window.history.pushState({},'','/app');setRoute('app');setActive('analyze')},[scan]); const openLanding=useCallback(()=>{window.history.pushState({},'','/');setRoute('home')},[]); const openReconstruct=useCallback(()=>{window.history.pushState({},'','/reconstruct');setRoute('reconstruct')},[]); const openEvidence=useCallback(()=>{window.history.pushState({},'','/evidence');setRoute('evidence')},[]); const saveResult=useCallback((r)=>{const record=history.addResult(r);track('memory_saved');return record},[history]); const addToQueue=useCallback((r,c,x,status='Ready')=>{if(!r)return null;const item=makeQueueItem(r,c,x,status);persistQueue([item,...queue]);track('queue_added');return item},[persistQueue,queue]); const approve=useCallback((r,c,x)=>{const item=addToQueue(r,c,x,'Approved');track('content_approved');navigate('queue');return item},[addToQueue,navigate]); const openExport=useCallback((r)=>{const target=r?.result||r||scan.state.result;if(!target)return;setExportResult(target);setExportOpen(true);track('export_opened')},[scan.state.result]); const openMemoryItem=useCallback((item)=>{if(item?.result){scan.loadResult(item.result);navigate('analyze')}},[navigate,scan]); const duplicateMemoryItem=useCallback((item)=>{scan.setInput(item.result?.rawContent||item.excerpt||'');navigate('analyze')},[navigate,scan]);
  const content=useMemo(()=>{if(active==='improve')return <ImprovementWorkspace result={scan.state.result} onGoToCortex={()=>navigate('analyze')} onSaveVersion={(r,c,x)=>{history.addVersion(r,c,x);track('version_created')}} onQueue={(r,c,x)=>{addToQueue(r,c,x,'Ready');navigate('queue')}} onApprove={approve}/>;if(active==='autopsy')return <AutopsyWorkspace onSendToImprove={(r,c)=>{scan.loadResult(r);if(c)scan.setInput(c);navigate('improve')}}/>;if(active==='history')return <ScanHistory history={history} onOpen={openMemoryItem} onDuplicate={duplicateMemoryItem} onGoToCortex={()=>navigate('analyze')}/>;if(active==='pricing')return <PricingWorkspace/>;if(active==='queue')return <ApprovalQueue queue={queue} onGoToCortex={()=>navigate('analyze')} onOpen={(i)=>{if(i.result)scan.loadResult(i.result);navigate('analyze')}} onApprove={(i)=>persistQueue(queue.map(e=>e.id===i.id?{...e,status:'Approved',updatedAt:new Date().toISOString()}:e))} onReturn={(i)=>{if(i.versions?.[0]?.result)scan.loadResult(i.versions[0].result);navigate('improve')}} onExport={(i)=>openExport(i.result||i.versions?.[0]?.result)}/>;if(active==='research')return <ResearchWorkspaceV2/>;return <ScanWorkspace scan={scan} onImprove={(r)=>{scan.loadResult(r);navigate('improve')}} onSave={saveResult} onQueue={(r)=>{addToQueue(r);navigate('queue')}} onExport={openExport}/>},[active,addToQueue,approve,duplicateMemoryItem,history,navigate,openExport,openMemoryItem,persistQueue,queue,saveResult,scan]);
  if(route==='home')return <BehaviourHome/>; if(route==='refund-mission')return <RefundAuthorityMissionPage/>; if(route==='workflow-mission')return <WorkflowEfficiencyMissionPage/>; if(route==='mission-003')return <ExtendedProofMissionPage missionId="003"/>; if(route==='mission-004')return <ExtendedProofMissionPage missionId="004"/>; if(route==='mission-005')return <ExtendedProofMissionPage missionId="005"/>; if(route==='missions')return <ProofMissionsPage/>; if(route==='survival')return <SurvivalWorldPage/>; if(route==='lab')return <React.Suspense fallback={<div className="powder-boot">Loading the lab…</div>}><PowderLabPage/></React.Suspense>; if(route==='reconstruct')return <ReconstructPage onHome={openLanding} onStart={openWorkspace}/>; if(route==='evidence')return <HoldoutEvidencePage onHome={openLanding} onStart={openWorkspace}/>; if(route==='arcade')return <LandingPage onStart={openWorkspace} onNavigate={navigate} onOpenReconstruct={openReconstruct} onOpenEvidence={openEvidence}/>;
  return <div className="brain-app"><DesktopSidebar active={active} onNavigate={navigate} collapsed={collapsed} onToggle={()=>setCollapsed(v=>!v)} onUpgrade={()=>navigate('pricing')}/><div className="brain-main-shell"><AppHeader active={active} onOpenCommand={()=>setCommandOpen(true)} onExport={()=>openExport(scan.state.result)} onUpgrade={()=>navigate('pricing')} hasResult={Boolean(scan.state.result)}/><main className="brain-content">{content}</main></div><MobileNavigation active={active} onNavigate={navigate}/><CommandPalette open={commandOpen} onClose={()=>setCommandOpen(false)} onNavigate={navigate}/><ShareDialog open={exportOpen} onClose={()=>setExportOpen(false)} result={exportResult||scan.state.result}/></div>;
}
