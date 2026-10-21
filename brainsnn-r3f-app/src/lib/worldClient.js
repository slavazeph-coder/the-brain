// Browser side of the World Engine reconstruction flow. The capture goes from
// this browser straight to the reconstruction worker with a single-use ticket
// from /api/world/ticket; the worker returns a per-scan access key that stays in
// the URL fragment and this browser's storage, never in a request to BrainSNN.

const STORE_KEY = 'brainsnn.worlds.v1';
const MAX_REMEMBERED = 12;
export const MIN_PHOTOS = 8;
export const MAX_PHOTOS = 120;
export const MAX_UPLOAD_BYTES = 250 * 1024 * 1024;

export class WorldError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/** The worker decodes MP4/MOV video and JPEG/PNG photos only. */
export function captureKind(file) {
  const name = String(file?.name || '').toLowerCase();
  const type = String(file?.type || '').toLowerCase();
  if (type === 'video/mp4' || name.endsWith('.mp4')) return { kind: 'video', mediaType: 'video/mp4' };
  if (type === 'video/quicktime' || name.endsWith('.mov')) return { kind: 'video', mediaType: 'video/quicktime' };
  if (type === 'image/jpeg' || /\.jpe?g$/.test(name)) return { kind: 'photo', mediaType: 'image/jpeg' };
  if (type === 'image/png' || name.endsWith('.png')) return { kind: 'photo', mediaType: 'image/png' };
  return { kind: 'unsupported', mediaType: type };
}

/** What can be sent for reconstruction, or why not. */
export function reconstructionInput(files) {
  const list = Array.from(files || []);
  const kinds = list.map(captureKind);
  if (list.length === 1 && kinds[0].kind === 'video') return { ok: true, kind: 'video', mediaType: kinds[0].mediaType };
  if (list.some((_, index) => kinds[index].kind === 'video')) return { ok: false, reason: 'Send one MP4 or MOV video at a time.' };
  if (kinds.some((item) => item.kind !== 'photo')) return { ok: false, reason: 'Reconstruction accepts MP4 or MOV video, or JPEG/PNG photos.' };
  if (list.length < MIN_PHOTOS) return { ok: false, reason: `Add at least ${MIN_PHOTOS} overlapping photos, or use a video.` };
  if (list.length > MAX_PHOTOS) return { ok: false, reason: `Use at most ${MAX_PHOTOS} photos.` };
  return { ok: true, kind: 'photos', mediaType: 'application/zip' };
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** An uncompressed ZIP of photos (JPEG/PNG are already compressed) with generated, ordered names. */
export async function zipPhotos(files) {
  const encoder = new TextEncoder(), parts = [], central = [];
  let offset = 0;
  const list = Array.from(files);
  for (let index = 0; index < list.length; index += 1) {
    const data = new Uint8Array(await list[index].arrayBuffer());
    const extension = captureKind(list[index]).mediaType === 'image/png' ? 'png' : 'jpg';
    const name = encoder.encode(`photo_${String(index).padStart(4, '0')}.${extension}`);
    const crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(8, 0, true);
    local.setUint32(14, crc, true); local.setUint32(18, data.length, true); local.setUint32(22, data.length, true);
    local.setUint16(26, name.length, true);
    const entry = new DataView(new ArrayBuffer(46));
    entry.setUint32(0, 0x02014b50, true); entry.setUint16(4, 20, true); entry.setUint16(6, 20, true);
    entry.setUint32(16, crc, true); entry.setUint32(20, data.length, true); entry.setUint32(24, data.length, true);
    entry.setUint16(28, name.length, true); entry.setUint32(42, offset, true);
    parts.push(local, name, data);
    central.push(entry, name);
    offset += 30 + name.length + data.length;
  }
  const size = central.reduce((sum, part) => sum + part.byteLength, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, list.length, true); end.setUint16(10, list.length, true);
  end.setUint32(12, size, true); end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end], { type: 'application/zip' });
}

export async function worldStatus(fetchImpl = fetch) {
  try {
    const response = await fetchImpl('/api/world/status', { cache: 'no-store' });
    return response.ok ? await response.json() : { configured: false, status: 'unavailable' };
  } catch {
    return { configured: false, status: 'unavailable' };
  }
}

export async function requestTicket(fetchImpl = fetch) {
  const response = await fetchImpl('/api/world/ticket', { method: 'POST', cache: 'no-store' });
  if (response.status === 429) throw new WorldError('rate_limited', 'You have started several reconstructions recently. Please wait before trying again.');
  if (!response.ok) throw new WorldError('not_configured', 'Reconstruction is not connected right now.');
  return response.json();
}

async function workerError(body, status) {
  const error = body?.error;
  if (error?.code && error?.message) return new WorldError(error.code, error.message);
  return new WorldError('worker_error', status ? `The reconstruction worker answered ${status}.` : 'The reconstruction worker could not be reached.');
}

/** POST the capture with upload progress (fetch cannot report it). Resolves to {id, accessKey, ...}. */
export function uploadCapture({ workerUrl, ticket, body, mediaType, filename, onProgress, signal }) {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('POST', `${workerUrl}/v1/site-scans`);
    request.setRequestHeader('Authorization', `Ticket ${ticket}`);
    request.setRequestHeader('Content-Type', mediaType);
    request.setRequestHeader('X-Filename', encodeURIComponent(String(filename || 'capture').slice(0, 120).replace(/[/\\]/g, '_')));
    request.responseType = 'json';
    request.upload.onprogress = (event) => { if (event.lengthComputable) onProgress?.(event.loaded / event.total); };
    request.onload = async () => {
      if (request.status === 202 && request.response?.id && request.response?.accessKey) resolve(request.response);
      else reject(await workerError(request.response, request.status));
    };
    request.onerror = () => reject(new WorldError('network', 'The upload could not reach the reconstruction worker. Check your connection and try again.'));
    request.onabort = () => reject(new WorldError('cancelled', 'Upload cancelled.'));
    signal?.addEventListener('abort', () => request.abort(), { once: true });
    request.send(body);
  });
}

export async function scanRequest(workerUrl, id, key, path = '', options = {}) {
  let response;
  try {
    response = await fetch(`${workerUrl}/v1/site-scans/${encodeURIComponent(id)}${path}`, {
      ...options, cache: 'no-store', headers: { Authorization: `Scan ${key}`, ...(options.headers || {}) },
    });
  } catch {
    throw new WorldError('network', 'The reconstruction worker could not be reached.');
  }
  if (response.status === 401 || response.status === 404) {
    throw new WorldError('gone', 'This world is no longer available. Worlds are kept for 24 hours, and the link only works with its private key.');
  }
  if (!response.ok) throw await workerError(await response.json().catch(() => null), response.status);
  return response;
}

/** `#k=<key>` in the world URL. The fragment is never sent to any server. */
export function worldKeyFromHash(hash) {
  const key = new URLSearchParams(String(hash || '').replace(/^#/, '')).get('k') || '';
  return /^[A-Za-z0-9_-]{32,128}$/.test(key) ? key : '';
}

export function worldIdFromPath(pathname) {
  const match = /^\/world\/([a-f0-9]{32})\/?$/.exec(String(pathname || ''));
  return match ? match[1] : '';
}

function storage() {
  try { return window.localStorage; } catch { return null; }
}

export function rememberedWorlds() {
  try {
    const list = JSON.parse(storage()?.getItem(STORE_KEY) || '[]');
    return Array.isArray(list) ? list.filter((item) => item && /^[a-f0-9]{32}$/.test(item.id) && worldKeyFromHash('#k=' + item.key)) : [];
  } catch {
    return [];
  }
}

export function rememberWorld(world) {
  try {
    const list = [world, ...rememberedWorlds().filter((item) => item.id !== world.id)].slice(0, MAX_REMEMBERED);
    storage()?.setItem(STORE_KEY, JSON.stringify(list));
  } catch { /* Private windows can refuse storage; the link still works. */ }
}

export function forgetWorld(id) {
  try {
    storage()?.setItem(STORE_KEY, JSON.stringify(rememberedWorlds().filter((item) => item.id !== id)));
  } catch { /* nothing to forget */ }
}
