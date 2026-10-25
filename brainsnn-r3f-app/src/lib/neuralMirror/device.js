export const COMPUTE_DEVICE_TYPES = Object.freeze(['cpu', 'cuda', 'remote']);

function finiteMemory(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : undefined;
}

export function normalizeComputeDevice(value = {}) {
  const type = COMPUTE_DEVICE_TYPES.includes(value.type) ? value.type : 'cpu';
  const capabilities = Array.isArray(value.capabilities)
    ? [...new Set(value.capabilities.map((item) => String(item).trim()).filter(Boolean))].slice(0, 50)
    : type === 'cpu' ? ['vision_encoder', 'audio_encoder', 'language_encoder', 'neural_mirror'] : [];
  return {
    id: String(value.id || `${type}-default`).slice(0, 120),
    type,
    name: String(value.name || (type === 'cpu' ? 'local CPU' : type)).slice(0, 160),
    ...(finiteMemory(value.memoryMb) ? { memoryMb: finiteMemory(value.memoryMb) } : {}),
    capabilities,
  };
}

export function discoverComputeDevice(options = {}) {
  const processInfo = typeof process !== 'undefined' ? process : null;
  const navigatorInfo = typeof navigator !== 'undefined' ? navigator : null;
  const arch = options.arch || processInfo?.arch || 'unknown-architecture';
  const platform = options.platform || processInfo?.platform || 'local';
  return normalizeComputeDevice({
    id: options.id || `cpu-${platform}-${arch}`,
    type: 'cpu',
    name: options.name || `${platform} ${arch} CPU`,
    memoryMb: options.memoryMb,
    capabilities: options.capabilities || ['vision_encoder', 'audio_encoder', 'language_encoder', 'neural_mirror'],
    hardwareConcurrency: navigatorInfo?.hardwareConcurrency,
  });
}
