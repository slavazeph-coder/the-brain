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

export async function publishMission(configuration) {
  return request('/publish', { method: 'POST', body: JSON.stringify({ configuration }) });
}

export async function getPublishedMission(id) {
  return request(`/${encodeURIComponent(id)}`);
}

export async function listPublishedMissions() {
  return request('/');
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

export function proofUrl(missionId, submissionId) {
  return `${API}/${encodeURIComponent(missionId)}/submissions/${encodeURIComponent(submissionId)}/proof`;
}
