import React, { useEffect, useState } from 'react';
import { Check, CreditCard, Database, Layers, Sparkles } from 'lucide-react';
import { Button } from '../../components/ui/Button.jsx';
import { Badge } from '../../components/ui/Badge.jsx';
import { LAYER_CATALOG } from '../../lib/layerCatalog.js';
import { LeadForm } from '../leads/LeadForm.jsx';
import { track } from '../../lib/analytics.js';
import { BETA_NOTE, PRICING_PLANS } from './pricingPlans.js';

function EngineStatusCard({ icon: Icon, label, status }) {
  const configured = status?.configured || status?.status === 'online';
  return (
    <div className="engine-status-card">
      <Icon size={18} aria-hidden="true" />
      <span>{label}</span>
      <strong>{configured ? status.status || 'configured' : 'not configured'}</strong>
    </div>
  );
}

export function PricingWorkspace() {
  const [status, setStatus] = useState(null);
  const [message, setMessage] = useState('');
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    track('pricing_viewed');
    let cancelled = false;
    fetch('/api/engines/status')
      .then((response) => response.json())
      .then((data) => { if (!cancelled) setStatus(data); })
      .catch(() => { if (!cancelled) setStatus(null); });
    return () => { cancelled = true; };
  }, []);

  function choosePlan(planId) {
    setMessage('');
    if (planId === 'free') {
      track('upgrade_clicked', { plan: 'free' });
      setMessage('Nothing to do — it is already running. Paste something into Analyze.');
      return;
    }
    track('pilot_clicked', { plan: planId, from: 'pricing' });
    setShowForm(true);
  }

  // Ops/config status is for operators, not customers; opt in with ?ops=1.
  const showOpsStatus = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('ops') === '1';
  const ctaLabel = (plan) => (plan.id === 'free' ? 'Start using it' : 'Start a pilot brief');

  return (
    <div className="pricing-workspace" data-testid="pricing-workspace">
      <header className="workspace-heading">
        <p className="bsn-kicker">Pricing</p>
        <h1>Free while we are in beta. Pilots are what you buy.</h1>
        <p>
          The full {LAYER_CATALOG.length}-layer engine runs in your browser with no account,
          no limit and nothing to cancel. What we sell today is a built interactive
          experience for your audience — so the honest version of this page is two options,
          not four tiers.
        </p>
      </header>

      <section className="pricing-grid" aria-label="Pricing plans">
        {PRICING_PLANS.map((plan) => (
          <article key={plan.id} className={plan.highlighted ? 'featured' : ''}>
            {plan.highlighted ? <Badge tone="cyan">Recommended beta</Badge> : null}
            <h3>{plan.name}</h3>
            <strong className="plan-price">{plan.price}</strong>
            <p>{plan.description}</p>
            <ul>
              {plan.features.map((feature) => (
                <li key={feature}><Check size={15} aria-hidden="true" /> {feature}</li>
              ))}
            </ul>
            <Button variant={plan.highlighted ? 'primary' : 'secondary'} onClick={() => choosePlan(plan.id)}>
              <CreditCard size={16} aria-hidden="true" /> {ctaLabel(plan)}
            </Button>
          </article>
        ))}
      </section>

      {showForm ? (
        <section className="pricing-lead" aria-label="Start a pilot brief">
          <LeadForm defaultSegment="brands" />
        </section>
      ) : null}

      <p className="bsn-note pricing-beta-note">{BETA_NOTE}</p>

      {showOpsStatus ? (
        <section className="engine-status-grid" aria-label="Engine readiness">
          <EngineStatusCard icon={Layers} label={`${status?.totalLayers || LAYER_CATALOG.length} layers`} status={{ configured: true, status: 'indexed' }} />
          <EngineStatusCard icon={CreditCard} label="Stripe" status={status?.engines?.stripe} />
          <EngineStatusCard icon={Database} label="Supabase" status={status?.engines?.supabase} />
          <EngineStatusCard icon={Sparkles} label="OpenAI / Gemini / Gemma" status={{ configured: Boolean(status?.engines?.openai?.configured || status?.engines?.gemini?.configured || status?.engines?.gemma?.configured), status: 'provider stack' }} />
        </section>
      ) : null}

      {message ? <p role="status" className="bsn-note pricing-message">{message}</p> : null}
    </div>
  );
}
