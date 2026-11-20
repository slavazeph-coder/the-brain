// TEST ONLY. This intentionally volatile adapter must never be imported by production code.
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';

export function createMemoryProjectObjectStore({ objects = new Map() } = {}) {
  const calls = [];
  const hash = bytes => createHash('sha256').update(bytes).digest('hex');
  const failure = (code, status = 503) => Object.assign(new Error(`Test object store: ${code}`), { code, status });
  return {
    objects, calls,
    async put(key, bytes, { sha256, signal } = {}) {
      if (signal?.aborted) throw failure('object-storage-unavailable');
      const value = Buffer.from(bytes), digest = hash(value);
      if (!value.length || value.length > 4 * 1024 * 1024) throw failure('object-too-large', 413);
      if (sha256 !== undefined && sha256 !== digest) throw failure('object-hash-mismatch', 422);
      const previous = objects.get(key);
      if (previous && !previous.equals(value)) throw failure('object-integrity-failed');
      calls.push({ operation: 'put', key, bytes: value.length });
      objects.set(key, value);
      return { bytes: value.length, sha256: digest, created: !previous };
    },
    async get(key, { signal } = {}) {
      if (signal?.aborted) throw failure('object-storage-unavailable');
      const value = objects.get(key);
      if (!value) throw failure('object-not-found', 404);
      calls.push({ operation: 'get', key });
      return { body: Readable.from([Buffer.from(value)]), bytes: value.length };
    },
    async delete(key, { signal } = {}) {
      if (signal?.aborted) throw failure('object-storage-unavailable');
      calls.push({ operation: 'delete', key });
      objects.delete(key);
    },
    close() {},
  };
}
