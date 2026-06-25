import React, { useEffect, useMemo, useState } from 'react';
import { CreditCard, Database, Layers, RadioTower, Sparkles } from 'lucide-react';
import { Badge } from '../../components/ui/Badge.jsx';

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

  const modelStack = useMemo(() => {
    const engines = status?.engines || {};
    const configured = ['openai', 'gemini', 'gemma'].filter((key) => engines[key]?.configured);
    return configured.length ? configured.map((key) => key.toUpperCase()).join(' + ') : 'deterministic local fallback';
  }, [status]);

  const persistenceReady = Boolean(status?.engines?.supabase?.configured);
  const billingReady = Boolean(status?.engines?.stripe?.configured);

  return (
    <section className="engine-readiness-panel" aria-labelledby="engine-readiness-heading">
      <div>
        <p className="bsn-eyebrow">Launch readiness</p>
        <h2 id="engine-readiness-heading">What BrainSNN will use on this scan</h2>
        <p className="bsn-note">
          The production workflow is honest about what is configured: local fallback remains usable,
          provider layers activate when env vars exist, and public links stay disabled until persistence is real.
        </p>
      </div>
      <div className="readiness-grid">
        <ReadinessItem
          icon={Layers}
          label="Layer stack"
          detail={`${status?.totalLayers || 102} indexed layers`}
          status="active"
        />
        <ReadinessItem
          icon={Sparkles}
          label="Model path"
          detail={modelStack}
          status={status ? 'ready' : 'checking'}
          tone={modelStack.includes('fallback') ? 'warning' : 'cyan'}
        />
        <ReadinessItem
          icon={RadioTower}
          label="TRIBE v2"
          detail="projection layer with optional service"
          status={statusLabel(status?.engines?.tribe)}
          tone={status?.engines?.tribe?.configured ? 'cyan' : 'warning'}
        />
        <ReadinessItem
          icon={Database}
          label="Memory"
          detail={persistenceReady ? 'cloud persistence ready' : 'local browser history'}
          status={persistenceReady ? 'configured' : 'local only'}
          tone={persistenceReady ? 'cyan' : 'warning'}
        />
        <ReadinessItem
          icon={CreditCard}
          label="Payments"
          detail={billingReady ? 'Stripe Checkout ready' : 'waitlist / free mode'}
          status={billingReady ? 'configured' : 'not live'}
          tone={billingReady ? 'cyan' : 'warning'}
        />
      </div>
    </section>
  );
}
