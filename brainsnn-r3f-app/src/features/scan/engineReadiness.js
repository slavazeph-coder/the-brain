const GPU_FAILURE_LABELS = {
  invalid_configuration: 'GPU setup incomplete',
  unreachable: 'GPU unreachable',
  timeout: 'GPU timed out',
  busy: 'GPU busy',
  authentication_failed: 'GPU authentication failed',
  model_unavailable: 'GPU model unavailable',
  invalid_output: 'GPU output unavailable',
  response_too_large: 'GPU output unavailable',
  upstream_error: 'GPU unavailable',
};

export function analysisProviderReadiness(snapshot) {
  if (!snapshot) return { detail: 'Checking analysis provider', status: 'checking' };
  const engines = snapshot.engines || {};
  const gpu = engines.gpu;
  if (gpu?.configured || gpu?.status === 'invalid_configuration') {
    const failure = GPU_FAILURE_LABELS[gpu.status]
      || (gpu.status === 'reachable' && GPU_FAILURE_LABELS[gpu.lastInferenceStatus]);
    if (failure) return { detail: 'Built-in fallback available', status: failure };
    if (gpu.status === 'online' || (gpu.status === 'reachable' && gpu.lastInferenceStatus === 'completed')) {
      return { detail: 'Dedicated GPU', status: 'inference verified' };
    }
    return {
      detail: 'Dedicated GPU with built-in fallback',
      status: gpu.status === 'reachable' ? 'reachable; inference unverified' : 'not yet verified',
    };
  }
  // /api/analyze currently calls Gemini when GPU mode is disabled. Other
  // provider configuration flags do not establish an active analysis path.
  if (engines.gemini?.configured) return { detail: 'Gemini with built-in fallback', status: 'configured' };
  return { detail: 'Built-in engine on BrainSNN', status: 'ready' };
}
