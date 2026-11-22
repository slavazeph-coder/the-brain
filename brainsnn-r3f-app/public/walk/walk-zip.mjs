// A small, strict ZIP writer and reader for walk bundles.
// Writing stores files uncompressed: photos and video are already compressed,
// and a stored archive opens everywhere (Files, Finder, Explorer, QGIS).
// Reading accepts stored entries and, where the browser can inflate, deflated
// ones, so a bundle someone re-zipped on a laptop still opens.

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
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const encoder = new TextEncoder();
const asBytes = data => typeof data === 'string' ? encoder.encode(data)
  : data instanceof Uint8Array ? data
  : data instanceof ArrayBuffer ? new Uint8Array(data)
  : ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  : (() => { throw new Error('ZIP entries must be text or bytes.'); })();

export const safeEntryName = name => typeof name === 'string' && name.length > 0 && name.length <= 200
  && !name.startsWith('/') && !/[\\:\u0000-\u001f]/u.test(name) && !name.split('/').some(part => part === '..' || part === '.' || part === '');

function dosStamp(ms) {
  const d = new Date(ms);
  const year = Math.max(1980, d.getUTCFullYear());
  return {
    time: (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | Math.floor(d.getUTCSeconds() / 2),
    date: ((year - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate(),
  };
}

/** Build a stored ZIP. Returns the parts, ready for new Blob(parts). */
export function zipParts(entries, { now = Date.now() } = {}) {
  if (!Array.isArray(entries) || !entries.length || entries.length > 1000) throw new Error('A bundle holds 1 to 1000 files.');
  const { time, date } = dosStamp(now);
  const parts = [], central = [], names = new Set();
  let offset = 0;
  for (const entry of entries) {
    if (!safeEntryName(entry.name) || names.has(entry.name)) throw new Error(`Bad or repeated file name in bundle: ${entry.name}`);
    names.add(entry.name);
    const name = encoder.encode(entry.name);
    const data = asBytes(entry.data);
    const crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true);
    local.setUint16(8, 0, true); local.setUint16(10, time, true); local.setUint16(12, date, true);
    local.setUint32(14, crc, true); local.setUint32(18, data.length, true); local.setUint32(22, data.length, true);
    local.setUint16(26, name.length, true); local.setUint16(28, 0, true);
    const head = new DataView(new ArrayBuffer(46));
    head.setUint32(0, 0x02014b50, true); head.setUint16(4, 20, true); head.setUint16(6, 20, true); head.setUint16(8, 0x0800, true);
    head.setUint16(10, 0, true); head.setUint16(12, time, true); head.setUint16(14, date, true);
    head.setUint32(16, crc, true); head.setUint32(20, data.length, true); head.setUint32(24, data.length, true);
    head.setUint16(28, name.length, true); head.setUint32(42, offset, true);
    parts.push(new Uint8Array(local.buffer), name, data);
    central.push(new Uint8Array(head.buffer), name);
    offset += 30 + name.length + data.length;
    if (offset > 0xfffffff0) throw new Error('The bundle is too large for a standard ZIP.');
  }
  const centralSize = central.reduce((sum, part) => sum + part.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true);
  end.setUint32(12, centralSize, true); end.setUint32(16, offset, true);
  return [...parts, ...central, new Uint8Array(end.buffer)];
}

async function inflate(bytes, expected) {
  if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot open compressed ZIP files. Export the walk again from BrainSNN Walk.');
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const reader = stream.getReader();
  const out = new Uint8Array(expected);
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (size + value.length > expected) { await reader.cancel(); throw new Error('A file in the bundle is larger than it claims.'); }
    out.set(value, size); size += value.length;
  }
  if (size !== expected) throw new Error('A file in the bundle is shorter than it claims.');
  return out;
}

/** Read a ZIP into [{name, data: Uint8Array}], refusing anything unsafe or inconsistent. */
export async function unzip(input, { maxBytes = 512 * 1024 ** 2, maxEntries = 1000 } = {}) {
  const bytes = asBytes(input);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('This file is not a ZIP bundle.');
  const count = view.getUint16(eocd + 10, true), size = view.getUint32(eocd + 12, true), start = view.getUint32(eocd + 16, true);
  if (count === 0xffff || start === 0xffffffff) throw new Error('ZIP64 bundles are not supported.');
  if (count > maxEntries) throw new Error(`A bundle can hold up to ${maxEntries} files.`);
  if (start + size > eocd) throw new Error('The ZIP directory is damaged.');
  const files = [], seen = new Set();
  let total = 0, at = start;
  for (let n = 0; n < count; n += 1) {
    if (at + 46 > eocd || view.getUint32(at, true) !== 0x02014b50) throw new Error('The ZIP directory is damaged.');
    const flags = view.getUint16(at + 8, true), method = view.getUint16(at + 10, true), crc = view.getUint32(at + 16, true);
    const packed = view.getUint32(at + 20, true), plain = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true), extra = view.getUint16(at + 30, true), comment = view.getUint16(at + 32, true);
    const local = view.getUint32(at + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLength));
    at += 46 + nameLength + extra + comment;
    if (flags & 1) throw new Error('Encrypted bundles are not supported.');
    if (name.endsWith('/')) continue;
    if (name.startsWith('__MACOSX/') || name.split('/').at(-1).startsWith('._')) continue;
    if (!safeEntryName(name)) throw new Error(`The bundle contains an unsafe file name: ${name.slice(0, 60)}`);
    if (seen.has(name)) throw new Error(`The bundle repeats ${name.slice(0, 60)}.`);
    seen.add(name);
    total += plain;
    if (total > maxBytes) throw new Error('The bundle is larger than this app opens.');
    if (local + 30 > bytes.length || view.getUint32(local, true) !== 0x04034b50) throw new Error('The ZIP bundle is damaged.');
    const dataStart = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    if (dataStart + packed > bytes.length) throw new Error('The ZIP bundle is truncated.');
    const raw = bytes.subarray(dataStart, dataStart + packed);
    let data;
    if (method === 0) { if (packed !== plain) throw new Error('The ZIP bundle is damaged.'); data = raw; }
    else if (method === 8) data = await inflate(raw, plain);
    else throw new Error('The bundle uses a compression method this app does not open.');
    if (crc32(data) !== crc) throw new Error(`${name} is damaged (checksum mismatch).`);
    files.push({ name, data });
  }
  return files;
}
