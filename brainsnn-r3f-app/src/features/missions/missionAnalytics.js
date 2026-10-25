import { track } from '../../lib/analytics.js';

function missionKey(missionId) {
  if (missionId === '004') return '004';
  if (missionId === '005') return '005';
  return '003';
}

export function trackMissionViewed(missionId) {
  const key = missionKey(missionId);
  if (key === '003') track('bug_hunt_mission_viewed');
  if (key === '004') track('reproduce_mission_viewed');
  if (key === '005') track('navigation_mission_viewed');
}

export function trackMissionRun(missionId, properties) {
  const key = missionKey(missionId);
  if (key === '003') track('bug_hunt_mission_run', properties);
  if (key === '004') track('reproduce_mission_run', properties);
  if (key === '005') track('navigation_mission_run', properties);
}

export function trackMissionForked(missionId, properties) {
  const key = missionKey(missionId);
  if (key === '003') track('bug_hunt_mission_forked', properties);
  if (key === '004') track('reproduce_mission_forked', properties);
  if (key === '005') track('navigation_mission_forked', properties);
}

export function trackMissionProofExported(missionId, properties) {
  const key = missionKey(missionId);
  if (key === '003') track('bug_hunt_mission_proof_exported', properties);
  if (key === '004') track('reproduce_mission_proof_exported', properties);
  if (key === '005') track('navigation_mission_proof_exported', properties);
}
