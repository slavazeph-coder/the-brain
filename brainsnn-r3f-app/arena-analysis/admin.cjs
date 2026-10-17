#!/usr/bin/env node
'use strict';

// Local owner operations only. No network clients, payment API, arbitrary
// credits, provider submission, or customer session credentials are exposed.
const fs = require('node:fs');
const path = require('node:path');
const {createStore} = require('./store.cjs');

function reject(message) { throw Object.assign(new Error(message), {code: 'ADMIN_INPUT'}); }
function parse(argv, env) {
  const [command, ...rest] = argv;
  if (!['status', 'reconcile', 'freeze', 'unfreeze'].includes(command)) reject('Use status, reconcile, freeze, or unfreeze. See arena-analysis/ADMIN.md.');
  const options = {};
  const flags = new Set(['db', 'failure-reserve-cents', 'max-outstanding-cost-cents', 'job', 'workspace', 'actual-provider-cost-cents', 'reason', 'confirm-no-result-no-charge']);
  for (let index = 0; index < rest.length; index++) {
    const key = rest[index].startsWith('--') ? rest[index].slice(2) : '';
    if (!flags.has(key) || Object.hasOwn(options, key)) reject('Unknown or repeated command option.');
    if (key === 'confirm-no-result-no-charge') options[key] = true;
    else {
      const value = rest[++index];
      if (value === undefined || value.startsWith('--')) reject('A command option is missing its value.');
      options[key] = value;
    }
  }
  const allowed = new Set(['db', 'failure-reserve-cents', 'max-outstanding-cost-cents', ...(command === 'status' ? [] : command === 'reconcile' ? ['job', 'actual-provider-cost-cents', 'reason', 'confirm-no-result-no-charge'] : ['workspace', 'reason'])]);
  if (Object.keys(options).some(key => !allowed.has(key))) reject('An option does not apply to this command.');
  const dbPath = options.db || env.ARENA_ANALYSIS_DB_PATH || (env.RAILWAY_VOLUME_MOUNT_PATH ? path.join(env.RAILWAY_VOLUME_MOUNT_PATH, 'arena-analysis/ledger.sqlite') : null);
  if (!dbPath || !path.isAbsolute(dbPath)) reject('Provide the absolute existing ledger path with --db or ARENA_ANALYSIS_DB_PATH.');
  let file;
  try { file = fs.lstatSync(dbPath); } catch { reject('Ledger file does not exist; administrative commands never create one.'); }
  if (!file.isFile() || file.isSymbolicLink()) reject('Ledger must be an existing regular file, not a symlink.');
  const number = (value, fallback) => {
    if (value === undefined) return fallback;
    if (!/^(0|[1-9][0-9]*)$/.test(String(value))) reject('Cost values must be nonnegative integer CAD cents.');
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed > 100000000) reject('Cost value is outside the supported range.');
    return parsed;
  };
  const failureReserveCents = number(options['failure-reserve-cents'] ?? env.ARENA_ANALYSIS_FAILURE_RESERVE_CENTS, 0);
  const maxOutstandingCostCents = number(options['max-outstanding-cost-cents'] ?? env.ARENA_ANALYSIS_MAX_OUTSTANDING_COST_CENTS, failureReserveCents);
  if (command !== 'status') {
    if (!options.reason || options.reason.trim().length < 8 || options.reason.length > 500) reject('Provide an owner review reason of 8–500 characters. Do not include secrets or media.');
    if (command === 'reconcile') {
      if (!/^job_[A-Za-z0-9_-]{1,100}$/.test(options.job || '')) reject('Provide the exact uncertain job ID.');
      if (!options['confirm-no-result-no-charge']) reject('Reconciliation requires --confirm-no-result-no-charge after checking delivery and billing.');
      if (options['actual-provider-cost-cents'] === undefined) reject('Provide the known actual provider cost, including thinking, in CAD cents.');
    } else if (!/^ws_[A-Za-z0-9_-]{1,100}$/.test(options.workspace || '')) reject('Provide the exact workspace ID.');
  }
  return {command, options, dbPath, failureReserveCents, maxOutstandingCostCents, actualProviderCostCents: options['actual-provider-cost-cents'] === undefined ? undefined : number(options['actual-provider-cost-cents'])};
}

function runAdmin(argv, {env = process.env, now = Date.now} = {}) {
  const input = parse(argv, env);
  const store = createStore({dbPath: input.dbPath, failureReserveCents: input.failureReserveCents, maxOutstandingCostCents: input.maxOutstandingCostCents, now, recoverOnOpen: false});
  try {
    if (input.command === 'status') return {paymentMode: store.getPaymentMode(), budget: store.getBudget(), accounting: store.getAccounting(), uncertainJobs: store.listUncertainJobs(), recentOwnerActions: store.getAdminAudit()};
    if (input.command === 'reconcile') {
      const job = store.reconcileJob({jobId: input.options.job, actualProviderCostCents: input.actualProviderCostCents, reason: input.options.reason, confirmedNoResultNoCharge: true});
      return {jobId: job.id, status: job.status, customerChargeCents: 0, actualProviderCostCents: input.actualProviderCostCents, budget: store.getBudget()};
    }
    const wallet = store[input.command === 'freeze' ? 'freezeWorkspace' : 'unfreezeWorkspace'](input.options.workspace, {reason: input.options.reason});
    return {workspaceId: input.options.workspace, wallet};
  } finally { store.close(); }
}

if (require.main === module) {
  try { process.stdout.write(`${JSON.stringify(runAdmin(process.argv.slice(2)), null, 2)}\n`); }
  catch (error) {
    const safe = ['ADMIN_INPUT', 'NOT_FOUND', 'IDEMPOTENCY_CONFLICT', 'JOB_NOT_UNCERTAIN', 'REVIEW_REQUIRED', 'WORKSPACE_STILL_BLOCKED'].includes(error.code);
    process.stderr.write(`${safe ? error.code : 'ADMIN_FAILED'}: ${safe ? error.message : 'Ledger operation failed. Check the database path, permissions, and server logs.'}\n`);
    process.exitCode = 1;
  }
}

module.exports = {runAdmin};
