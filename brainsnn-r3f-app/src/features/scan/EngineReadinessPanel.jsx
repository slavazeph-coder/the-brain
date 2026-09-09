import React, { useEffect, useState } from 'react';
import { CreditCard, Database, Layers, RadioTower, Sparkles } from 'lucide-react';
import { Badge } from '../../components/ui/Badge.jsx';
import { LAYER_CATALOG } from '../../lib/layerCatalog.js';
import { analysisProviderReadiness } from './engineReadiness.js';

function statusLabel(status) {
  if (!status) return 'checking';
  if (status.status === 'online') return 'online';
  if (status.configured) return status.status || 'configured';
  return 'local mode';
}

function ReadinessItem({ icon: Icon, label, detail, status, tone = 'cyan' }) {
  return (
    <article className="readiness-item">
      <div className="readiness-icon"><Icon size={17} aria-hidden="true" /></div>
      <div>
        <span>{label}</span>
        <strong>{detail}</strong>
      </div>
      <Badge tone={tone}>{status}</Badge>
    </article>
  );
}

export function EngineReadinessPanel() {
  const [status, setStatus] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/engines/status')
      .then((response) => response.json())
      .then((data) => { if (!cancelled) setStatus(data); })
      .catch(() => { if (!cancelled) setStatus(null); });
    return () => { cancelled = true; };
  }, []);

  const modelProvider = analysisProviderReadiness(status);

  const persistenceReady = Boolean(status?.engines?.supabase?.configured);
  const billingReady = Boolean(status?.engines?.stripe?.configured);

  return (
    <section className="engine-readiness-panel" aria-labelledby="engine-readiness-heading">
      <div>
        <p className="bsn-eyebrow">Engine status</p>
        <h2 id="engine-readiness-heading">What powers this scan</h2>
        <p className="bsn-note">
          Scans are sent to BrainSNN's server. Connected AI providers may process the content;
          the built-in engine supplies a fallback when a provider is unavailable.
        </p>
      </div>
      <div className="readiness-grid">
        <ReadinessItem
          icon={Layers}
          label="Layer stack"
          detail={`${status?.totalLayers || LAYER_CATALOG.length} analysis layers`}
          status="active"
        />
        <ReadinessItem
          icon={Sparkles}
          label="Model"
          detail={modelProvider.detail}
          status={modelProvider.status}
        />
        <ReadinessItem
          icon={RadioTower}
          label="TRIBE projection"
          detail={status?.engines?.tribe?.configured ? 'external service connected' : 'built-in projection layer'}
          status={statusLabel(status?.engines?.tribe)}
        />
        <ReadinessItem
          icon={Database}
          label="History"
          detail={persistenceReady ? 'synced to your account' : 'stays in this browser'}
          status={persistenceReady ? 'synced' : 'private'}
        />
        <ReadinessItem
          icon={CreditCard}
          label="Plan"
          detail={billingReady ? 'checkout available' : 'free mode'}
          status={billingReady ? 'ready' : 'free'}
        />
      </div>
    </section>
  );
}
