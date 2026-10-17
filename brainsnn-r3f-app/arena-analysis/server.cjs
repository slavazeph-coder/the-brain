'use strict';
const express = require('express');
const {timingSafeEqual} = require('node:crypto');
const {settings, readiness, paymentMode, LIMITS} = require('./config.cjs');
const {createStore, SESSION_TTL} = require('./store.cjs');
const {quoteCost, actualProviderCost} = require('./pricing.cjs');
const {validateEvidence, evidenceMetadata} = require('./evidence.cjs');
const {createProvider} = require('./provider.cjs');
const {createCommerce} = require('./commerce.cjs');

const reject = (status, code, message) => { throw Object.assign(new Error(message), {status, code}); };
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && /^[A-Za-z0-9_-]{43}$/.test(a) && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const wrap = fn => (req, res, next) => Promise.resolve().then(() => fn(req, res, next)).catch(next);

function createPaidAnalysisRouter(options = {}) {
  const config = options.config || settings();
  const router = express.Router();
  const now = options.now || Date.now;
  const log = options.log || (code => console.warn('[arena-analysis]', code));
  const cookieName = config.production ? '__Host-brainsnn_analysis' : 'brainsnn_analysis_dev';
  const cookieOptions = {httpOnly:true, secure:config.production, sameSite:'strict', path:'/', maxAge:SESSION_TTL};
  const ledgerMode = paymentMode(config.stripeKey);
  let store = options.store || null, storageError = false;
  if (!store && config.storageConfirmed && config.singleReplica && config.dbPath) {
    try {
      store = createStore({dbPath:config.dbPath, failureReserveCents:config.failureReserveCents, maxOutstandingCostCents:config.maxOutstandingCostCents,
        now, ...(ledgerMode ? {paymentMode:ledgerMode} : {})});
    } catch { storageError = true; log('storage_unavailable'); }
  }
  if (store && ledgerMode && store.assertPaymentMode) {
    try { store.assertPaymentMode(ledgerMode); }
    catch { storageError = true; log('payment_mode_mismatch'); }
  }
  let stripe = options.stripe;
  if (!stripe && config.stripeKey) {
    const Stripe = require('stripe');
    stripe = new Stripe(config.stripeKey, {apiVersion:config.stripeApiVersion, maxNetworkRetries:1, timeout:20000});
  }
  const commerce = store && stripe ? createCommerce({store, stripe, config}) : null;
  let provider = options.provider;
  const buckets = new Map();
  function throttle(req, label, maximum, duration = 60000) {
    const clock = now(), key = label + ':' + (req.session?.workspaceId || req.ip);
    if (buckets.size > 5000) {
      for (const [name, value] of buckets) if (value.until <= clock) buckets.delete(name);
      if (buckets.size > 5000 && !buckets.has(key)) reject(429, 'rate_limited', 'Please try again later.');
    }
    let row = buckets.get(key);
    if (!row || row.until <= clock) buckets.set(key, row = {count:0, until:clock+duration});
    if (++row.count > maximum) reject(429, 'rate_limited', 'Please try again later.');
  }
  const requireStore = () => { if (!store || storageError) reject(503, 'storage_unavailable', 'Billing storage is unavailable. No charge was made.'); };
  function capabilities() {
    const result = readiness(config, quoteCost, now());
    if (!store || storageError) {
      result.analysisEnabled = result.purchaseEnabled = false;
      result.reasons.push('Billing storage is unavailable.');
    } else {
      const budget = store.getBudget();
      if (budget.paused) {
        result.analysisEnabled = result.purchaseEnabled = false;
        result.reasons.push('Analysis capacity is awaiting cost reconciliation.');
      }
      if (result.analysisEnabled) {
        const maximum = quoteCost({inputTokenUpperBound:32000}, {...config.pricing, now:now()});
        if (maximum.maxCostCents > budget.failureReserveRemainingCents || maximum.maxCostCents + budget.outstandingCostCents > budget.maxOutstandingCostCents || maximum.amountCents > 5000) {
          // Keep existing job inspection available, but do not sell more credit
          // while a legal maximum-size analysis cannot be funded safely.
          result.purchaseEnabled = false;
          result.reasons.push('New purchases are paused until analysis capacity is available.');
        }
      }
    }
    return result;
  }
  function origin(req) {
    if (req.get('Origin') !== config.origin || req.get('Sec-Fetch-Site') === 'cross-site') reject(403, 'origin', 'Open analysis from the BrainSNN website.');
  }
  function token(req) {
    const cookies = (req.get('Cookie') || '').split(';').map(c => c.trim());
    const found = cookies.filter(c => c.startsWith(cookieName+'='));
    return found.length === 1 ? found[0].slice(cookieName.length+1) : '';
  }
  function authenticate(req, _res, next) {
    try {
      requireStore();
      req.session = store.getSession(token(req));
      if (!req.session) reject(401, 'unauthorized', 'Open or recover your analysis balance.');
      if (!['GET','HEAD'].includes(req.method)) {
        origin(req);
        if (!same(req.get('X-Analysis-CSRF'), req.session.csrfToken)) reject(403, 'csrf', 'Refresh your analysis balance before continuing.');
      }
      throttle(req, 'workspace', 180);
      next();
    } catch (error) { next(error); }
  }
  function publicJob(job) {
    const {result, ...rest} = job;
    return result ? {...rest, result:result.analysis, evidenceSummary:result.evidenceSummary} : rest;
  }
  router.use((_req, res, next) => {
    res.set({'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff', 'Referrer-Policy':'same-origin'});
    next();
  });
  // This router is mounted before the application's general JSON parser.
  // Payment fulfillment remains available when new purchases are switched off.
  router.post('/webhook', express.raw({type:'application/json', limit:'256kb'}), wrap(async (req, res) => {
    requireStore();
    if (!commerce || !config.webhookSecret) reject(503, 'payments_unavailable', 'Payment fulfillment is unavailable.');
    const event = commerce.verify(req.body, req.get('Stripe-Signature'));
    await commerce.payment(event);
    res.json({received:true});
  }));
  router.get('/capabilities', wrap((req, res) => { throttle(req, 'capabilities', 120); res.json(capabilities()); }));
  const smallBody = express.json({limit:'4kb', strict:true});
  for (const route of ['/workspaces','/recover']) router.post(route, wrap((req, _res, next) => {
    origin(req); requireStore(); throttle(req, 'identity', 10, 3600000); next();
  }), smallBody, wrap((req, res) => {
    const data = route === '/recover' ? store.recoverWorkspace(req.body?.recoveryCode) : store.createWorkspace();
    res.cookie(cookieName, data.sessionToken, cookieOptions);
    const {sessionToken, ...visible} = data;
    res.status(route === '/recover' ? 200 : 201).json(visible);
  }));
  router.use(authenticate);
  router.get('/workspace', wrap((req, res) => res.json({...store.getWorkspace(req.session.workspaceId), csrfToken:req.session.csrfToken})));
  router.post('/logout', smallBody, wrap((req, res) => {
    store.logout(token(req)); res.clearCookie(cookieName, {...cookieOptions, maxAge:undefined}); res.json({ok:true});
  }));
  router.post('/checkout', smallBody, wrap(async (req, res) => {
    throttle(req, 'checkout', 5, 3600000);
    if (!capabilities().purchaseEnabled || !commerce) reject(503, 'purchases_unavailable', 'New purchases are unavailable. Your existing balance is preserved.');
    const wallet = store.getWorkspace(req.session.workspaceId).wallet;
    let maximum;
    try { maximum = quoteCost({inputTokenUpperBound:32000}, {...config.pricing, paymentFeeBps:Math.max(config.pricing.paymentFeeBps, wallet.maxPaymentFeeBps), now:now()}); }
    catch { reject(503, 'funding_cost_review', 'This balance requires payment-cost review before another top-up.'); }
    if (maximum.amountCents > 5000) reject(503, 'funding_cost_review', 'This balance requires payment-cost review before another top-up.');
    res.json(await commerce.checkout(req.session.workspaceId, req.body?.requestId));
  }));
  const evidenceBody = express.json({limit:LIMITS.maxRequestBytes, strict:true});
  const evidenceThrottle = wrap((req, _res, next) => { throttle(req, 'evidence', 12); next(); });
  router.post('/quotes', evidenceThrottle, evidenceBody, wrap((req, res) => {
    if (!capabilities().analysisEnabled) reject(503, 'analysis_unavailable', 'Analysis is unavailable. No charge was made.');
    const validated = validateEvidence(req.body?.evidence);
    const wallet = store.getWorkspace(req.session.workspaceId).wallet;
    const pricing = {...config.pricing, paymentFeeBps:Math.max(config.pricing.paymentFeeBps, wallet.maxPaymentFeeBps), now:now()};
    const cost = quoteCost(validated.stats, pricing);
    const budget = store.getBudget();
    if (cost.maxCostCents > budget.failureReserveRemainingCents || cost.maxCostCents + budget.outstandingCostCents > budget.maxOutstandingCostCents) reject(503, 'cost_capacity', 'Analysis capacity is awaiting cost reconciliation.');
    const quote = store.createQuote({workspaceId:req.session.workspaceId, inputDigest:validated.inputDigest, ...cost, pricing});
    res.status(201).json({quote, preview:{imageCount:validated.stats.imageCount, eventCount:validated.stats.eventCount}});
  }));
  async function execute(job, validated, quote) {
    let attempted = false, usage;
    try {
      provider ||= createProvider({apiKey:config.apiKey});
      attempted = true;
      const analysis = await provider.analyze(validated);
      usage = analysis.usage;
      if (!usage?.complete) throw Object.assign(new Error(), {providerAttempted:true, usage});
      const actualProviderCostCents = actualProviderCost({inputTokens:usage.inputTokens, generatedTokens:usage.billedOutputTokens}, quote.pricing);
      store.completeJob({jobId:job.id, result:{analysis, evidenceSummary:evidenceMetadata(validated.evidence)}, actualProviderCostCents});
    } catch (error) {
      const reportedUsage = error.usage || usage;
      const wasAttempted = error.providerAttempted ?? attempted;
      let known = !wasAttempted, actualProviderCostCents = wasAttempted ? undefined : 0;
      if (reportedUsage?.complete) {
        try {
          actualProviderCostCents = actualProviderCost({inputTokens:reportedUsage.inputTokens, generatedTokens:reportedUsage.billedOutputTokens}, quote.pricing);
          known = true;
        } catch { /* malformed usage is an unknown expense, never a zero charge */ }
      }
      try {
        store.failJob({jobId:job.id, actualProviderCostCents, uncertain:wasAttempted && !known,
          error:wasAttempted && !known ? 'The analysis could not be confirmed. No charge; this balance is paused while provider usage is reconciled.' : 'Analysis could not produce a usable result. No charge was made.'});
      } catch { log('job_settlement_requires_reconciliation'); }
    }
  }
  router.post('/jobs', evidenceThrottle, evidenceBody, wrap((req, res) => {
    if (typeof req.body?.quoteId !== 'string' || req.body.quoteId.length > 100) reject(400, 'quote_id', 'A valid quote is required.');
    const validated = validateEvidence(req.body?.evidence);
    const quote = store.getQuote(req.session.workspaceId, req.body.quoteId);
    if (quote.inputDigest !== validated.inputDigest) reject(400, 'EVIDENCE_CHANGED', 'Evidence changed; request a new quote.');
    const existing = store.getJobByQuote(req.session.workspaceId, quote.id);
    if (existing) return res.json({job:publicJob(existing)});
    // Readiness changes never start another provider call. Accepted requests are
    // idempotent in the store; GET /jobs remains available during maintenance.
    if (!capabilities().analysisEnabled) reject(503, 'analysis_unavailable', 'Analysis is unavailable. No new charge was made.');
    const wallet = store.getWorkspace(req.session.workspaceId).wallet;
    const pricing = {...config.pricing, paymentFeeBps:Math.max(config.pricing.paymentFeeBps, wallet.maxPaymentFeeBps)};
    const snapshot = value => JSON.stringify(Object.entries(value || {}).filter(([key]) => key !== 'now').sort(([left], [right]) => left.localeCompare(right)));
    if (snapshot(pricing) !== snapshot(quote.pricing)) reject(409, 'PRICING_CHANGED', 'Cost assumptions changed; request a new quote before running.');
    const reservation = store.reserveJob({workspaceId:req.session.workspaceId, quoteId:quote.id, inputDigest:validated.inputDigest});
    if (reservation.created) setImmediate(() => { void execute(reservation.job, validated, quote); });
    res.status(reservation.created ? 202 : 200).json({job:publicJob(reservation.job)});
  }));
  router.get('/jobs/:id', wrap((req, res) => res.json({job:publicJob(store.getJob(req.session.workspaceId, req.params.id))})));
  router.use((_req, res) => res.status(404).json({error:'Analysis endpoint not found.', code:'not_found'}));
  router.use((error, _req, res, _next) => {
    if (error.type === 'entity.too.large') return res.status(413).json({error:'Selected evidence exceeds the upload limit.', code:'body_limit'});
    if (error.type === 'entity.parse.failed') return res.status(400).json({error:'A valid JSON request is required.', code:'invalid_json'});
    const trusted = Number.isInteger(error.status) && error.status >= 400 && error.status <= 503 && typeof error.code === 'string';
    const status = trusted ? error.status : 503;
    if (!trusted) log('request_failed');
    res.status(status).json({error:trusted ? error.message : 'This operation is temporarily unavailable. Refresh your balance before retrying.', code:trusted ? error.code : 'unavailable'});
  });
  const cleanup = store && setInterval(() => { try { store.expireResults(); } catch { log('retention_cleanup_failed'); } }, 3600000);
  cleanup?.unref();
  router.close = () => { clearInterval(cleanup); if (!options.store) store?.close(); };
  return router;
}
module.exports = {createPaidAnalysisRouter};
