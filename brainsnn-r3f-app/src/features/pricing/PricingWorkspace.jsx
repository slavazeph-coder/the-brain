import React, { useEffect, useState } from 'react';
import { Check, CreditCard, Database, Layers, ShieldCheck, Sparkles } from 'lucide-react';
import { Button } from '../../components/ui/Button.jsx';
import { Badge } from '../../components/ui/Badge.jsx';
import { LAYER_CATALOG } from '../../lib/layerCatalog.js';

const plans = [
  {
    id: 'free',
    name: 'Free',
    price: '$0',
    description: 'Try the decision engine with local history and watermarked exports.',
    features: ['5 analyses/month', 'Verdict + top fix on every scan', 'See which checks fired', 'Local history'],
  },
  {
    id: 'basic',
    name: 'Basic',
    price: '$9/mo',
    description: 'Enough scans for a solo creator or founder testing weekly content.',
    features: ['30 analyses/month', 'Improve workflow', 'PNG/text exports', 'Synced history when Supabase is configured'],
    highlighted: true,
  },
  {
    id: 'pro',
    name: 'Pro',
    price: '$29/mo',
    description: 'For marketers and small agencies running repeated variants.',
    features: ['200 analyses/month', 'Compare mode for A/B variants', 'Engine remembers your past scans', 'Export-ready reports and deeper layer traces'],
  },
  {
    id: 'team',
    name: 'Team Pilot',
    price: 'Pilot',
    description: 'Brand rules, batch reviews and reporting with onboarding.',
    features: ['Brand rules', 'Batch reviews', 'Team reports', 'Pilot onboarding'],
  },
];

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
  const [email, setEmail] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetch('/api/engines/status')
      .then((response) => response.json())
      .then((data) => { if (!cancelled) setStatus(data); })
      .catch(() => { if (!cancelled) setStatus(null); });
    return () => { cancelled = true; };
  }, []);

  async function startCheckout(planId) {
    setMessage('');
    if (planId === 'free') {
      setMessage('Free mode is active. Your scans stay available in this browser until you connect persistence.');
      return;
    }
    if (planId === 'team') {
      window.location.href = 'mailto:hello@brainsnn.com?subject=Book%20a%20BrainSNN%20Team%20Pilot';
      return;
    }
    if (!stripeReady) {
      setMessage(`You're on the ${planId === 'pro' ? 'Pro' : 'Basic'} list. We'll open checkout soon — everything stays free in the meantime.`);
      return;
    }
    try {
      const response = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: planId, email: email || undefined }),
      });
      const body = await response.json();
      if (!response.ok || !body.url) {
        setMessage(body.error || 'Checkout is not configured yet.');
        return;
      }
      window.location.href = body.url;
    } catch {
      setMessage('Checkout could not start. Try again after Stripe env vars are configured.');
    }
  }

  const stripeReady = Boolean(status?.engines?.stripe?.configured);
  // Ops/config status is for operators, not customers; opt in with ?ops=1.
  const showOpsStatus = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('ops') === '1';
  const ctaLabel = (plan) => {
    if (plan.id === 'free') return 'Continue Free';
    if (plan.id === 'team') return 'Book Pilot';
    return stripeReady ? `Start ${plan.name}` : `Join ${plan.name} Waitlist`;
  };

  async function sendMagicLink() {
    setMessage('');
    try {
      const response = await fetch('/api/auth/magic-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const body = await response.json();
      setMessage(response.ok ? 'Magic link requested. Check your email.' : body.error || 'Supabase Auth is not configured yet.');
    } catch {
      setMessage('Could not request a magic link.');
    }
  }

  return (
    <div className="pricing-workspace" data-testid="pricing-workspace">
      <header className="workspace-heading">
        <p className="bsn-kicker">Pricing</p>
        <h1>Start free. Upgrade when you need more scans.</h1>
        <p>The free plan runs the full {LAYER_CATALOG.length}-layer engine in your browser. Paid beta plans add more scans per month, variant comparison, synced history and deeper reports.</p>
      </header>

      <section className="account-connect-panel">
        <div>
          <p className="bsn-eyebrow">Account layer</p>
          <h2>Connect email for persistence readiness</h2>
          <p className="bsn-note">Supabase magic links activate when `SUPABASE_URL` and `SUPABASE_ANON_KEY` are configured. Until then, local history still works.</p>
        </div>
        <label>
          Email
          <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@company.com" />
        </label>
        <Button variant="secondary" onClick={sendMagicLink} disabled={!email.includes('@')}>
          <ShieldCheck size={16} aria-hidden="true" /> Send magic link
        </Button>
      </section>

      <section className="pricing-grid" aria-label="Pricing plans">
        {plans.map((plan) => (
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
            <Button variant={plan.highlighted ? 'primary' : 'secondary'} onClick={() => startCheckout(plan.id)}>
              <CreditCard size={16} aria-hidden="true" /> {ctaLabel(plan)}
            </Button>
          </article>
        ))}
      </section>

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
