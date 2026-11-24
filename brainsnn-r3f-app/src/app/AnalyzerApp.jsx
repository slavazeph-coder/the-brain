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
import { ANALYZER_ITEMS, ANALYZER_MORE_ITEMS, analyzerItem, analyzerSection } from '../features/analyzer/analyzerNavigation.js';
import { NAV_ITEMS, OVERFLOW_ITEMS } from './navigation.js';
import { AppHeader } from './AppHeader.jsx';
import { DesktopSidebar } from './DesktopSidebar.jsx';
import { MobileNavigation } from './MobileNavigation.jsx';
import { CommandPalette } from './CommandPalette.jsx';
import '../styles/analyzer.css';

const SECTION_ITEMS = [...ANALYZER_ITEMS, ...ANALYZER_MORE_ITEMS];
const PALETTE_ITEMS = [...SECTION_ITEMS, ...[...NAV_ITEMS, ...OVERFLOW_ITEMS].filter((item) => item.id !== 'creative-engine')];
const SECTION_IDS = new Set(SECTION_ITEMS.map((item) => item.id));

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

/** Stripe returns here with ?checkout=success|cancelled; say what happened, then drop the query. */
function checkoutNotice(search) {
  const params = new URLSearchParams(search);
  const outcome = params.get('checkout');
  if (outcome === 'success') return { tone: 'success', text: 'Checkout complete. Your plan starts once Stripe confirms the payment; this can take a minute.' };
  if (outcome === 'cancelled') return { tone: 'info', text: 'Checkout cancelled. Nothing was charged.' };
  return null;
}

/**
 * The Creative Engine at /app: scan a draft, improve it, compare versions, queue approvals,
 * keep a local history, read the research layers and see pricing. Every section is a URL.
 */
export function AnalyzerApp() {
  const scan = useScanEngine();
  const history = useScanHistory();
  const [active, setActive] = useState(() => analyzerSection(window.location.pathname));
  const [collapsed, setCollapsed] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportResult, setExportResult] = useState(null);
  const [queue, setQueue] = useState([]);
  const [notice, setNotice] = useState(() => checkoutNotice(window.location.search));

  useEffect(() => { setQueue(loadQueue()); }, []);

  useEffect(() => {
    if (!notice) return;
    track('analyzer_checkout_returned', { outcome: notice.tone });
    const url = new URL(window.location.href);
    url.searchParams.delete('checkout');
    url.searchParams.delete('plan');
    window.history.replaceState({}, '', url.pathname + url.search + url.hash);
  }, [notice]);

  useEffect(() => {
    const sync = () => setActive(analyzerSection(window.location.pathname));
    const shortcut = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setCommandOpen(true); }
    };
    window.addEventListener('popstate', sync);
    window.addEventListener('keydown', shortcut);
    return () => { window.removeEventListener('popstate', sync); window.removeEventListener('keydown', shortcut); };
  }, []);

  useEffect(() => {
    document.title = active === 'analyze' ? 'BrainSNN | Creative Engine' : `${analyzerItem(active).label} | BrainSNN Creative Engine`;
  }, [active]);

  const persistQueue = useCallback((next) => setQueue(saveQueue(next)), []);

  const navigate = useCallback((id) => {
    if (!SECTION_IDS.has(id)) {
      const destination = [...NAV_ITEMS, ...OVERFLOW_ITEMS].find((item) => item.id === id);
      if (destination) window.location.assign(destination.href);
      return;
    }
    const path = analyzerItem(id).path;
    if (window.location.pathname.replace(/\/+$/, '') !== path) window.history.pushState({}, '', path);
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

  const content = useMemo(() => {
    if (active === 'improve') {
      return (
        <ImprovementWorkspace
          result={scan.state.result}
          onGoToCortex={() => navigate('analyze')}
          onSaveVersion={(result, value, comparison) => { history.addVersion(result, value, comparison); track('version_created'); }}
          onQueue={(result, value, comparison) => { addToQueue(result, value, comparison, 'Ready'); navigate('queue'); }}
          onApprove={approve}
        />
      );
    }
    if (active === 'compare') {
      return (
        <AutopsyWorkspace
          onSendToImprove={(result, value) => {
            scan.loadResult(result);
            if (value) scan.setInput(value);
            navigate('improve');
          }}
        />
      );
    }
    if (active === 'history') {
      return (
        <ScanHistory
          history={history}
          onOpen={(item) => { if (item?.result) { scan.loadResult(item.result); navigate('analyze'); } }}
          onDuplicate={(item) => { scan.setInput(item.result?.rawContent || item.excerpt || ''); navigate('analyze'); }}
          onGoToCortex={() => navigate('analyze')}
        />
      );
    }
    if (active === 'pricing') return <PricingWorkspace />;
    if (active === 'queue') {
      return (
        <ApprovalQueue
          queue={queue}
          onGoToCortex={() => navigate('analyze')}
          onOpen={(item) => { if (item.result) scan.loadResult(item.result); navigate('analyze'); }}
          onApprove={(item) => persistQueue(queue.map((entry) => entry.id === item.id ? { ...entry, status: 'Approved', updatedAt: new Date().toISOString() } : entry))}
          onReturn={(item) => { if (item.versions?.[0]?.result) scan.loadResult(item.versions[0].result); navigate('improve'); }}
          onExport={(item) => {
            persistQueue(queue.map((entry) => entry.id === item.id ? { ...entry, status: 'Exported', updatedAt: new Date().toISOString() } : entry));
            openExport(item.result || item.versions?.[0]?.result);
          }}
        />
      );
    }
    if (active === 'research') return <ResearchWorkspaceV2 />;
    return (
      <ScanWorkspace
        scan={scan}
        onImprove={(result) => { scan.loadResult(result); navigate('improve'); }}
        onSave={saveResult}
        onQueue={(result) => { addToQueue(result); navigate('queue'); }}
        onExport={openExport}
      />
    );
  }, [active, addToQueue, approve, history, navigate, openExport, persistQueue, queue, saveResult, scan]);

  return (
    <div className="brain-app analyzer-app">
      <a className="analyzer-skip" href="#analyzer-main">Skip to content</a>
      <DesktopSidebar active={active} onNavigate={navigate} collapsed={collapsed} onToggle={() => setCollapsed((value) => !value)} />
      <div className="brain-main-shell">
        <AppHeader
          active={active}
          onOpenCommand={() => setCommandOpen(true)}
          onExport={() => openExport(scan.state.result)}
          hasResult={Boolean(scan.state.result)}
        />
        {notice ? (
          <p className={`analyzer-notice analyzer-notice-${notice.tone}`} role="status">
            {notice.text} <button type="button" onClick={() => setNotice(null)}>Dismiss</button>
          </p>
        ) : null}
        <main id="analyzer-main" className="brain-content">{content}</main>
      </div>
      <MobileNavigation active={active} onNavigate={navigate} />
      <CommandPalette open={commandOpen} onClose={() => setCommandOpen(false)} onNavigate={navigate} items={PALETTE_ITEMS} placeholder="Go to Improve, Compare, History, Walk…" />
      <ShareDialog open={exportOpen} onClose={() => setExportOpen(false)} result={exportResult || scan.state.result} />
    </div>
  );
}
