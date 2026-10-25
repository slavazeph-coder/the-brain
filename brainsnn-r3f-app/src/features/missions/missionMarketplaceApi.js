const API = '/api/v1/missions';

async function request(path, options = {}) {
  const response = await fetch(`${API}${path}`, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  let body = null;
  try { body = await response.json(); } catch { body = null; }
  if (!response.ok || !body?.ok) throw new Error(body?.error || `Mission request failed (${response.status}).`);
  return body;
}

export async function publishMission(configuration, terms = {}) {
  return request('/publish', { method: 'POST', body: JSON.stringify({ configuration, terms }) });
}

export async function getPublishedMission(id) {
  return request(`/${encodeURIComponent(id)}`);
}

export async function listPublishedMissions() {
  return request('/');
}

export async function listOwnedMissions() {
  return request('/mine');
}

export async function getMissionLeaderboard(id) {
  return request(`/${encodeURIComponent(id)}/leaderboard`);
}

export async function submitMissionPolicy(id, participant, policy) {
  return request(`/${encodeURIComponent(id)}/submissions`, {
    method: 'POST',
    body: JSON.stringify({ participant, policy }),
  });
}

export async function closeOwnedMission(id) {
  return request(`/${encodeURIComponent(id)}/owner/close`, { method: 'POST', body: '{}' });
}

export async function reopenOwnedMission(id) {
  return request(`/${encodeURIComponent(id)}/owner/reopen`, { method: 'POST', body: '{}' });
}

export async function selectMissionWinner(id) {
  return request(`/${encodeURIComponent(id)}/owner/select-winner`, { method: 'POST', body: '{}' });
}

export function proofUrl(missionId, submissionId) {
  return `${API}/${encodeURIComponent(missionId)}/submissions/${encodeURIComponent(submissionId)}/proof`;
}
