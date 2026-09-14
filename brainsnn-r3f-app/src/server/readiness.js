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
  add('workerContact', future || fresh.length > 1 ? 'blocked' : fresh.length === 1 ? 'pass' : 'unknown', 'machine', future ? 'worker_clock_conflict' : fresh.length > 1 ? 'multiple_recent_workers' : fresh.length === 1 ? 'authenticated_contact_only' : contacts.length ? 'worker_contact_stale' : 'worker_contact_absent');
  for (const id of ASSERTIONS) {
    const item = evidence?.[id];
    const valid = item?.source === 'operator' && typeof item.reference === 'string' && item.reference.trim().length > 0
      && Number.isFinite(item.observedAt) && Number.isFinite(item.expiresAt)
      && item.observedAt <= now && now - item.observedAt <= MAX_ASSERTION_AGE_MS && item.expiresAt > now && item.expiresAt > item.observedAt;
    add(id, valid && item.value === true ? 'pass' : valid && item.value === false ? 'blocked' : 'unknown', 'operator', !valid ? 'assertion_missing_invalid_or_stale' : item.value === true ? 'human_assertion_not_independently_verified' : item.value === false ? 'operator_reports_blocker' : 'assertion_value_unknown');
  }
  return { ready: checks.every(c => c.state === 'pass'), advisoryOnly: true, assessedAt: now, checks, reasons: checks.filter(c => c.state !== 'pass').map(c => `${c.id}:${c.reason}`) };
}
