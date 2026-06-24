import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Mail, Users } from 'lucide-react';
import { Modal } from '../components/ui/Modal.jsx';
import { Button } from '../components/ui/Button.jsx';
import { track } from '../lib/analytics.js';
import { excerpt } from '../lib/formatters.js';
import { loadQueue, saveQueue } from '../lib/storage.js';
import { useScanEngine } from '../features/scan/useScanEngine.js';
import { useScanHistory } from '../features/memory/useScanHistory.js';
import { ScanWorkspace } from '../features/scan/ScanWorkspace.jsx';
import { ImprovementWorkspace } from '../features/improve/ImprovementWorkspace.jsx';
import { ScanHistory } from '../features/memory/ScanHistory.jsx';
import { ApprovalQueue } from '../features/approvals/ApprovalQueue.jsx';
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

function UpgradeModal({ open, onClose }) {
  function mailto(subject) {
    window.location.href = `mailto:hello@brainsnn.com?subject=${encodeURIComponent(subject)}`;
  }
  return (
    <Modal open={open} onClose={onClose} title="BrainSNN plans">
      <div className="pricing-grid">
        <article>
          <h3>Free Explorer</h3>
          <p>Core verdict, basic rewrite, watermarked exports and local history.</p>
          <Button variant="secondary" onClick={onClose}>Continue Free</Button>
        </article>
        <article>
          <h3>Pro</h3>
          <p>More scans, full version comparisons, advanced memory and export polish as they ship.</p>
          <Button variant="primary" onClick={() => { track('upgrade_clicked'); mailto('Join BrainSNN Pro waitlist'); }}>
            <Mail size={16} aria-hidden="true" /> Join Pro Waitlist
          </Button>
        </article>
        <article>
          <h3>Team Pilot</h3>
          <p>Brand rules, batch reviews, reports and pilot onboarding when shared workflows are implemented.</p>
          <Button variant="secondary" onClick={() => { track('pilot_clicked'); mailto('Book a BrainSNN Team Pilot'); }}>
            <Users size={16} aria-hidden="true" /> Book a Team Pilot
          </Button>
        </article>
      </div>
    </Modal>
  );
}

export function AppShell() {
  const scan = useScanEngine();
  const history = useScanHistory();
  const [active, setActive] = useState('cortex');
  const [collapsed, setCollapsed] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportResult, setExportResult] = useState(null);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
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
    setActive(id);
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
      navigate('cortex');
    }
  }, [navigate, scan]);

  const duplicateMemoryItem = useCallback((item) => {
    scan.setInput(item.result?.rawContent || item.excerpt || '');
    navigate('cortex');
  }, [navigate, scan]);

  const content = useMemo(() => {
    if (active === 'synapse') {
      return (
        <ImprovementWorkspace
          result={scan.state.result}
          onGoToCortex={() => navigate('cortex')}
          onSaveVersion={(result, contentValue, comparison) => { history.addVersion(result, contentValue, comparison); track('version_created'); }}
          onQueue={(result, contentValue, comparison) => { addToQueue(result, contentValue, comparison, 'Ready'); navigate('queue'); }}
          onApprove={approve}
        />
      );
    }
    if (active === 'memory') {
      return <ScanHistory history={history} onOpen={openMemoryItem} onDuplicate={duplicateMemoryItem} onGoToCortex={() => navigate('cortex')} />;
    }
    if (active === 'queue') {
      return (
        <ApprovalQueue
          queue={queue}
          onGoToCortex={() => navigate('cortex')}
          onOpen={(item) => { if (item.result) scan.loadResult(item.result); navigate('cortex'); }}
          onApprove={(item) => persistQueue(queue.map((entry) => entry.id === item.id ? { ...entry, status: 'Approved', updatedAt: new Date().toISOString() } : entry))}
          onReturn={(item) => { if (item.versions?.[0]?.result) scan.loadResult(item.versions[0].result); navigate('synapse'); }}
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
        onImprove={(result) => { scan.loadResult(result); navigate('synapse'); }}
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
        onUpgrade={() => setUpgradeOpen(true)}
      />
      <div className="brain-main-shell">
        <AppHeader
          active={active}
          onOpenCommand={() => setCommandOpen(true)}
          onExport={() => openExport(scan.state.result)}
          onUpgrade={() => setUpgradeOpen(true)}
          hasResult={Boolean(scan.state.result)}
        />
        <main className="brain-content">{content}</main>
      </div>
      <MobileNavigation active={active} onNavigate={navigate} />
      <CommandPalette open={commandOpen} onClose={() => setCommandOpen(false)} onNavigate={navigate} />
      <ShareDialog open={exportOpen} onClose={() => setExportOpen(false)} result={exportResult || scan.state.result} />
      <UpgradeModal open={upgradeOpen} onClose={() => setUpgradeOpen(false)} />
    </div>
  );
}
