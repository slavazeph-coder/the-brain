'use strict';
const path = require('node:path');
const VERSION = 'paid-analysis-2026-10-17-v1';
const MODEL = 'gemini-4-argon';
const LIMITS = Object.freeze({maxObservations:6,maxImages:12,maxEvents:100,maxRequestBytes:8*1024*1024,maxImageEdge:512,maxOutputTokens:32768});
function paymentMode(key) {
  return /^(sk|rk)_live_/.test(key || '') ? 'live' : /^(sk|rk)_test_/.test(key || '') ? 'test' : null;
}
function safeOrigin(value, production) {
  try {
    const u = new URL(value);
    if(u.username || u.password || (u.protocol!=='https:' && (production || u.protocol!=='http:' || !['localhost','127.0.0.1','[::1]'].includes(u.hostname)))) return null;
    return u.origin;
  } catch { return null; }
}
function settings(env = process.env) {
  const production = env.NODE_ENV === 'production';
  const number = (name, fallback) => env[name] === undefined ? fallback : Number(env[name]);
  const volume = env.RAILWAY_VOLUME_MOUNT_PATH;
  const dbPath = env.ARENA_ANALYSIS_DB_PATH || (volume ? path.join(volume,'arena-analysis/ledger.sqlite') : null);
  const relative = volume && dbPath ? path.relative(path.resolve(volume),path.resolve(dbPath)) : null;
  const onVolume = relative !== null && relative !== '' && !relative.startsWith('..'+path.sep) && relative!=='..' && !path.isAbsolute(relative);
  let pricing = null;
  try { pricing = JSON.parse(env.ARENA_ANALYSIS_PRICING_JSON || 'null'); } catch { /* refuse instead of inventing rates */ }
  return {
    production, version:VERSION, model:MODEL, limits:LIMITS,
    origin: safeOrigin(env.APP_URL || env.PUBLIC_APP_URL || 'https://www.brainsnn.com',production),
    enabled:env.ARENA_ANALYSIS_ENABLED === 'true', purchasesEnabled:env.ARENA_ANALYSIS_PAYMENTS_ENABLED === 'true',
    singleReplica:env.ARENA_ANALYSIS_SINGLE_REPLICA === 'true',
    storageConfirmed:onVolume || env.ARENA_ANALYSIS_STORAGE_CONFIRMED === 'true', dbPath,
    apiKey:env.ARENA_ANALYSIS_GEMINI_API_KEY || '', stripeKey:env.ARENA_ANALYSIS_STRIPE_KEY || '',
    paymentMode:paymentMode(env.ARENA_ANALYSIS_STRIPE_KEY),
    webhookSecret:env.ARENA_ANALYSIS_STRIPE_WEBHOOK_SECRET || '',
    stripeApiVersion:'2026-08-26.dahlia',
    providerVerified:env.ARENA_ANALYSIS_PROVIDER_VERIFIED === 'true',
    paymentVerified:env.ARENA_ANALYSIS_PAYMENT_VERIFIED === 'true',
    failureReserveCents:number('ARENA_ANALYSIS_FAILURE_RESERVE_CENTS',0),
    maxOutstandingCostCents:number('ARENA_ANALYSIS_MAX_OUTSTANDING_COST_CENTS',1000),
    pricing,
    taxMode:env.ARENA_ANALYSIS_TAX_MODE || '', taxCode:env.ARENA_ANALYSIS_TAX_CODE || '',
  };
}
function readiness(config, quoteCost, now = Date.now()) {
  const reasons=[];
  if(!config.enabled) reasons.push('Analysis is not enabled.');
  if(!config.origin || !safeOrigin(config.origin,config.production)) reasons.push('The service origin is not configured securely.');
  if(config.production && paymentMode(config.stripeKey)!=='live') reasons.push('Production analysis requires live payment funding.');
  if(!config.apiKey) reasons.push('The analysis provider is not configured.');
  if(!config.providerVerified) reasons.push('Provider delivery validation is pending.');
  if(!config.singleReplica) reasons.push('Single-replica ledger operation is not confirmed.');
  if(!config.storageConfirmed || !config.dbPath || !path.isAbsolute(config.dbPath)) reasons.push('Persistent billing storage is not configured.');
  if(!Number.isSafeInteger(config.failureReserveCents) || config.failureReserveCents<=0 || config.failureReserveCents>100000000) reasons.push('A provider-failure reserve is not funded.');
  if(!Number.isSafeInteger(config.maxOutstandingCostCents) || config.maxOutstandingCostCents<=0 || config.maxOutstandingCostCents>100000000) reasons.push('The outstanding provider-cost limit is not configured.');
  try { if(!config.pricing) throw new Error(); quoteCost({inputTokenUpperBound:32000},{...config.pricing,now}); }
  catch { reasons.push('Cost and exchange-rate assumptions require a current verified configuration.'); }
  const analysisEnabled = reasons.length === 0;
  const purchaseReasons=[];
  if(!config.purchasesEnabled) purchaseReasons.push('Purchases are not enabled.');
  if(!paymentMode(config.stripeKey) || !config.webhookSecret) purchaseReasons.push('Payment processing is not configured.');
  if(!config.paymentVerified) purchaseReasons.push('Payment fulfillment validation is pending.');
  if(!['registered','not_required'].includes(config.taxMode) || (config.taxMode==='registered'&&!config.taxCode)) purchaseReasons.push('The package tax treatment is not configured.');
  return {version:1,build:VERSION,model:MODEL,analysisEnabled,purchaseEnabled:analysisEnabled&&!purchaseReasons.length,reasons:[...reasons,...purchaseReasons],package:{amountCents:5000,currency:'cad'},limits:LIMITS};
}
module.exports={settings,readiness,paymentMode,VERSION,MODEL,LIMITS};
