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
import { ResearchDrawer } from '../features/research/ResearchDrawer.jsx';
import { ShareDialog } from '../features/export/ShareDialog.jsx';
import { AppHeader } from './AppHeader.jsx';
import { CommandPalette } from './CommandPalette.jsx';
import { DesktopSidebar } from './DesktopSidebar.jsx';
import { MobileNavigation } from './MobileNavigation.jsx';

function makeQueueItem(result, content, comparison, status = 'Draft') {
  const sourceContent = content || result?.rawContent || '';
  return {
    id: `${result?.id || 'draft'}-${Date.now().toString(36)}`,
    title: result?.title || 'Untitled draft',
    excerpt: excerpt(sourceContent),
    verdict: result?.summary || 'Pending review',
    status,
    currentVersion: content ? 2 : 1,
    updatedAt: new Date().toISOString(),
    versions: [
      { id: 'v1', label: 'Original', content: result?.rawContent || '', result },
      ...(content ? [{ id: 'v2', label: 'Improved', content, result: comparison || null }] : []),
    ],
    result: comparison || result,
  };
}

export function AppShell() {
  const scan = useScanEngine();
  const history = useScanHistory();
  const [active, setActive] = useState('analyze');
  const [collapsed, setCollapsed] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportResult, setExportResult] = useState(null);
  const [queue, setQueue] = useState([]);

  useEffect(() => {
    setQueue(loadQueue());
  }, []);

  useEffect(() => {
    function handleKeyDown(event) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setCommandOpen(true);
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const persistQueue = useCallback((next) => {
    const saved = saveQueue(next);
    setQueue(saved);
  }, []);

  const navigate = useCallback((id) => {
    const aliases = { cortex: 'analyze', synapse: 'improve', memory: 'history' };
    setActive(aliases[id] || id);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const saveResult = useCallback((result) => {
    const record = history.addResult(result);
    track('memory_saved');
    return record;
  }, [history]);

  const addToQueue = useCallback((result, content, comparison, status = 'Ready') => {
    if (!result) return null;
    const item = makeQueueItem(result, content, comparison, status);
    persistQueue([item, ...queue]);
    track('queue_added');
    return item;
  }, [persistQueue, queue]);

  const approve = useCallback((result, content, comparison) => {
    const item = addToQueue(result, content, comparison, 'Approved');
    track('content_approved');
    navigate('queue');
    return item;
  }, [addToQueue, navigate]);

  const openExport = useCallback((result) => {
    const target = result?.result || result || scan.state.result;
    if (!target) return;
    setExportResult(target);
    setExportOpen(true);
    track('export_opened');
  }, [scan.state.result]);

  const openMemoryItem = useCallback((item) => {
    if (item?.result) {
      scan.loadResult(item.result);
      navigate('analyze');
    }
  }, [navigate, scan]);

  const duplicateMemoryItem = useCallback((item) => {
    scan.setInput(item.result?.rawContent || item.excerpt || '');
    navigate('analyze');
  }, [navigate, scan]);

  const content = useMemo(() => {
    if (active === 'improve') {
      return (
        <ImprovementWorkspace
          result={scan.state.result}
          onGoToCortex={() => navigate('analyze')}
          onSaveVersion={(result, contentValue, comparison) => { history.addVersion(result, contentValue, comparison); track('version_created'); }}
          onQueue={(result, contentValue, comparison) => { addToQueue(result, contentValue, comparison, 'Ready'); navigate('queue'); }}
          onApprove={approve}
        />
      );
    }
    if (active === 'autopsy') {
      return (
        <AutopsyWorkspace
          onSendToImprove={(result, contentValue) => {
            scan.loadResult(result);
            if (contentValue) scan.setInput(contentValue);
            navigate('improve');
          }}
        />
      );
    }
    if (active === 'history') {
      return <ScanHistory history={history} onOpen={openMemoryItem} onDuplicate={duplicateMemoryItem} onGoToCortex={() => navigate('analyze')} />;
    }
    if (active === 'pricing') {
      return <PricingWorkspace />;
    }
    if (active === 'queue') {
      return (
        <ApprovalQueue
          queue={queue}
          onGoToCortex={() => navigate('analyze')}
          onOpen={(item) => { if (item.result) scan.loadResult(item.result); navigate('analyze'); }}
          onApprove={(item) => persistQueue(queue.map((entry) => entry.id === item.id ? { ...entry, status: 'Approved', updatedAt: new Date().toISOString() } : entry))}
          onReturn={(item) => { if (item.versions?.[0]?.result) scan.loadResult(item.versions[0].result); navigate('improve'); }}
          onExport={(item) => openExport(item.result || item.versions?.[0]?.result)}
        />
      );
    }
    if (active === 'research') {
      return <ResearchDrawer />;
    }
    return (
      <ScanWorkspace
        scan={scan}
        onImprove={(result) => { scan.loadResult(result); navigate('improve'); }}
        onSave={saveResult}
        onQueue={(result) => { addToQueue(result); navigate('queue'); }}
        onExport={openExport}
      />
    );
  }, [active, addToQueue, approve, duplicateMemoryItem, history, navigate, openExport, openMemoryItem, persistQueue, queue, saveResult, scan]);

  return (
    <div className="brain-app">
      <DesktopSidebar
        active={active}
        onNavigate={navigate}
        collapsed={collapsed}
        onToggle={() => setCollapsed((value) => !value)}
        onUpgrade={() => navigate('pricing')}
      />
      <div className="brain-main-shell">
        <AppHeader
          active={active}
          onOpenCommand={() => setCommandOpen(true)}
          onExport={() => openExport(scan.state.result)}
          onUpgrade={() => navigate('pricing')}
          hasResult={Boolean(scan.state.result)}
        />
        <main className="brain-content">{content}</main>
      </div>
      <MobileNavigation active={active} onNavigate={navigate} />
      <CommandPalette open={commandOpen} onClose={() => setCommandOpen(false)} onNavigate={navigate} />
      <ShareDialog open={exportOpen} onClose={() => setExportOpen(false)} result={exportResult || scan.state.result} />
    </div>
  );
}
