const API_BASE = 'http://localhost:8642';

export async function checkServerHealth() {
  try {
    const res = await fetch(`${API_BASE}/health`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return { online: false };
    const data = await res.json();
    return { online: true, modelLoaded: data.model_loaded };
  } catch {
    return { online: false };
  }
}

export async function fetchTribePrediction(file, modality = 'video') {
  const formData = new FormData();
  formData.append('file', file);

  const res = await fetch(`${API_BASE}/predict?modality=${modality}`, {
    method: 'POST',
    body: formData
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Server error' }));
    throw new Error(err.detail || `Prediction failed: ${res.status}`);
  }

  return res.json();
}

export async function fetchScenarioList() {
  const res = await fetch(`${API_BASE}/scenarios`);
  if (!res.ok) throw new Error('Failed to fetch scenarios');
  return res.json();
}

export async function fetchPrecomputedScenario(name) {
  // Try server first
  try {
    const res = await fetch(`${API_BASE}/scenarios/${name}`, {
      signal: AbortSignal.timeout(3000)
    });
    if (res.ok) return res.json();
  } catch {
    // Server offline, try local fallback
  }

  // Fallback: load from public/scenarios/ directory
  try {
    const res = await fetch(`/scenarios/${name}.json`);
    if (res.ok) return res.json();
  } catch {
    // No local fallback either
  }

  throw new Error(`Scenario "${name}" not available`);
}
