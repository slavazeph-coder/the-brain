// Pure advisory assessment. Never clears controls, fetches evidence, or authorizes work.
const ASSERTIONS = ['hardwareClearance', 'exclusiveOwnership', 'maintenanceClear', 'durableVolume', 'singleReplica', 'modelPinned', 'workflowPinned', 'backupRestoreVerified'];
const MAX_ASSERTION_AGE_MS = 86400000;
export function assessReadiness(status = {}, evidence = {}, now = Date.now()) {
  const checks = [];
  const add = (id, state, source, reason) => checks.push({ id, state, source, reason });
  add('controlPlane', status.configured === true ? 'pass' : 'unknown', 'machine', status.configured === true ? 'configured_local_store' : 'control_plane_unavailable');
  if (status.maintenanceHold === true) add('maintenanceHold', 'blocked', 'machine', 'runtime_maintenance_hold_active');
  const control = status.control || {};
  const holds = ['paused', 'kill', 'hardwarePaused', 'gpuQuarantined'];
  const held = holds.some(key => control[key] === true);
  add('schedulerHolds', held ? 'blocked' : holds.every(key => control[key] === false) && control.externalExecution === false ? 'pass' : 'unknown', 'machine', held ? 'scheduler_hold_active' : 'scheduler_controls_checked');
  const contacts = Array.isArray(status.workerContacts) ? status.workerContacts : [];
  const fresh = contacts.filter(c => Number.isFinite(c?.lastSeenAt) && c.lastSeenAt <= now && now - c.lastSeenAt <= 60000);
  const future = contacts.some(c => Number.isFinite(c?.lastSeenAt) && c.lastSeenAt > now);
  // A heartbeat proves liveness, not capability. Without a declared kind, a
  // research-only worker on a laptop certifies the machine while the GPU box is
  // gone -- the outage is then hidden by the very signal meant to reveal it.
  const declared = fresh.filter(c => Array.isArray(c?.kinds) && c.kinds.length > 0);
  const servableKinds = [...new Set(declared.flatMap(c => c.kinds))];
  add('workerContact',
    future || fresh.length > 1 ? 'blocked'
      : fresh.length === 1 && declared.length === 1 ? 'pass'
        : 'unknown',
    'machine',
    future ? 'worker_clock_conflict'
      : fresh.length > 1 ? 'multiple_recent_workers'
        : fresh.length === 1 && declared.length === 1 ? 'authenticated_contact_with_declared_kinds'
          : fresh.length === 1 ? 'worker_declares_no_servable_kinds'
            : contacts.length ? 'worker_contact_stale' : 'worker_contact_absent');
  // A reachable host is not a working card. Conflating the two queued 16 real
  // jobs against a faulted GPU on 2026-09-17, so they are separate states:
  // `reachable` only means SSH answered, `healthy` means the driver initialised.
  const gpu = status.gpu || {};
  add('gpuHealth',
    gpu.healthy === true ? 'pass' : gpu.reachable === true ? 'blocked' : 'unknown',
    'machine',
    gpu.healthy === true ? 'gpu_initialised'
      : gpu.reachable === true ? 'host_reachable_gpu_uninitialised'
        : 'gpu_not_reported');
  // Machine-observable workload. The build produces work far faster than
  // anything consumes it: 117 ready-for-review, 0 deliveries. That is the
  // condition a dashboard must lead with -- not eight unfed attestations.
  const jobs = Array.isArray(status.jobs) ? status.jobs : [];
  const by = {};
  for (const j of jobs) by[j.status] = (by[j.status] || 0) + 1;
  const backlog = by['ready-for-review'] || 0;
  const delivered = Array.isArray(status.deliveries) ? status.deliveries.length : 0;
  add('workload',
    delivered > 0 ? 'pass' : backlog > 0 ? 'blocked' : 'unknown',
    'machine',
    delivered > 0 ? 'output_is_being_delivered'
      : backlog > 0 ? `backlog_unconsumed:${backlog}_ready_for_review_${delivered}_delivered`
        : 'no_workload_reported');
  for (const id of ASSERTIONS) {
    const item = evidence?.[id];
    const valid = item?.source === 'operator' && typeof item.reference === 'string' && item.reference.trim().length > 0
      && Number.isFinite(item.observedAt) && Number.isFinite(item.expiresAt)
      && item.observedAt <= now && now - item.observedAt <= MAX_ASSERTION_AGE_MS && item.expiresAt > now && item.expiresAt > item.observedAt;
    add(id, valid && item.value === true ? 'pass' : valid && item.value === false ? 'blocked' : 'unknown', 'operator', !item ? 'assertion_never_supplied' : !valid ? 'assertion_invalid_or_stale' : item.value === true ? 'human_assertion_not_independently_verified' : item.value === false ? 'operator_reports_blocker' : 'assertion_value_unknown');
  }
  return { ready: checks.every(c => c.state === 'pass'), advisoryOnly: true, assessedAt: now, servableKinds, checks, reasons: checks.filter(c => c.state !== 'pass').map(c => `${c.id}:${c.reason}`) };
}
