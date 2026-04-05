export async function connectMuseEEG() {
  if (!navigator.bluetooth) throw new Error('Web Bluetooth is not supported in this browser.');
  const MUSE_SERVICE = 0xfe8d;
  const device = await navigator.bluetooth.requestDevice({
    filters: [{ services: [MUSE_SERVICE] }],
    optionalServices: [MUSE_SERVICE]
  });
  const server = await device.gatt.connect();
  return { deviceName: device.name || 'Muse-compatible EEG device', transport: 'bluetooth', server };
}

export async function connectSerialEEG() {
  if (!navigator.serial) throw new Error('Web Serial is not supported in this browser.');
  const port = await navigator.serial.requestPort();
  await port.open({ baudRate: 115200 });
  return { transport: 'serial', port };
}

export function parseMusePacket(dataView) {
  const values = [];
  for (let i = 0; i < dataView.byteLength; i += 2) {
    values.push(dataView.getInt16(i, false));
  }
  return values;
}

export function mapEEGToRegions(state, channels) {
  const avg = channels.reduce((a, v) => a + Math.abs(v), 0) / Math.max(channels.length, 1);
  const norm = Math.min(0.28, avg / 4096);
  return {
    ...state,
    regions: {
      ...state.regions,
      THL: Math.min(0.95, state.regions.THL + norm),
      PFC: Math.min(0.95, state.regions.PFC + norm * 0.8),
      HPC: Math.min(0.95, state.regions.HPC + norm * 0.6)
    },
    burst: Math.max(state.burst, 6),
    scenario: 'Live EEG Input'
  };
}

export function applyMockEEG(state) {
  return mapEEGToRegions(state, [620, 420, 510, 470]);
}
