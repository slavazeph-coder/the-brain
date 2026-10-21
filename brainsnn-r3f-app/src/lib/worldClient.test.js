import assert from 'node:assert/strict';
import { crc32 as zlibCrc32 } from 'node:zlib';
import { it } from '../test/tinyVitest.js';
import {
  captureKind, crc32, forgetWorld, reconstructionInput, rememberWorld, rememberedWorlds,
  worldIdFromPath, worldKeyFromHash, zipPhotos,
} from './worldClient.js';

const file = (name, type = '', bytes = [1, 2, 3]) => new File([new Uint8Array(bytes)], name, { type });
const KEY = 'k'.repeat(43);

it('world capture accepts one MP4/MOV video or 8-120 JPEG/PNG photos', () => {
  assert.deepEqual(captureKind(file('walk.MOV')), { kind: 'video', mediaType: 'video/quicktime' });
  assert.deepEqual(captureKind(file('clip', 'video/mp4')), { kind: 'video', mediaType: 'video/mp4' });
  assert.equal(captureKind(file('clip.webm', 'video/webm')).kind, 'unsupported');
  assert.equal(reconstructionInput([file('a.mp4')]).ok, true);
  assert.equal(reconstructionInput([file('a.mp4'), file('b.mp4')]).ok, false);
  assert.equal(reconstructionInput([file('a.webm')]).ok, false);
  const photos = (count, name = 'p.jpg') => Array.from({ length: count }, () => file(name));
  assert.match(reconstructionInput(photos(7)).reason, /at least 8/);
  assert.deepEqual(reconstructionInput(photos(8)), { ok: true, kind: 'photos', mediaType: 'application/zip' });
  assert.equal(reconstructionInput(photos(121)).ok, false);
  assert.equal(reconstructionInput([...photos(8), file('x.webp', 'image/webp')]).ok, false);
});

it('world photo ZIP is a valid stored archive with checksums and generated names', async () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
  const sample = new Uint8Array(1000).map((_, index) => (index * 31) % 251);
  assert.equal(crc32(sample), zlibCrc32(sample));
  const blob = await zipPhotos([file('../evil.jpg', 'image/jpeg', [9, 8, 7]), file('two.PNG', '', [1, 2])]);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(bytes.buffer);
  assert.equal(blob.type, 'application/zip');
  assert.equal(view.getUint32(0, true), 0x04034b50);
  assert.equal(new TextDecoder().decode(bytes.slice(30, 44)), 'photo_0000.jpg');
  assert.equal(view.getUint32(14, true), crc32(new Uint8Array([9, 8, 7])));
  const end = bytes.length - 22;
  assert.equal(view.getUint32(end, true), 0x06054b50);
  assert.equal(view.getUint16(end + 10, true), 2);
  const centralOffset = view.getUint32(end + 16, true);
  assert.equal(view.getUint32(centralOffset, true), 0x02014b50);
  assert.match(new TextDecoder().decode(bytes), /photo_0001\.png/);
  assert.doesNotMatch(new TextDecoder().decode(bytes), /evil/);
});

it('world links carry the scan key only in the fragment', () => {
  assert.equal(worldKeyFromHash('#k=' + KEY), KEY);
  assert.equal(worldKeyFromHash('#k=short'), '');
  assert.equal(worldKeyFromHash('#k=' + KEY + '<script>'), '');
  assert.equal(worldIdFromPath('/world/' + 'a'.repeat(32)), 'a'.repeat(32));
  assert.equal(worldIdFromPath('/world/' + 'a'.repeat(32) + '/'), 'a'.repeat(32));
  assert.equal(worldIdFromPath('/world/../etc'), '');
});

it('world list remembers recent worlds per browser and drops malformed entries', () => {
  window.localStorage.clear();
  rememberWorld({ id: 'a'.repeat(32), key: KEY, name: 'Kitchen', createdAt: 1 });
  rememberWorld({ id: 'b'.repeat(32), key: KEY, name: 'Hall', createdAt: 2 });
  rememberWorld({ id: 'a'.repeat(32), key: KEY, name: 'Kitchen again', createdAt: 3 });
  assert.deepEqual(rememberedWorlds().map((item) => item.name), ['Kitchen again', 'Hall']);
  window.localStorage.setItem('brainsnn.worlds.v1', JSON.stringify([{ id: 'nope', key: KEY }, { id: 'c'.repeat(32), key: KEY }]));
  assert.deepEqual(rememberedWorlds().map((item) => item.id), ['c'.repeat(32)]);
  forgetWorld('c'.repeat(32));
  assert.deepEqual(rememberedWorlds(), []);
  window.localStorage.setItem('brainsnn.worlds.v1', '{not json');
  assert.deepEqual(rememberedWorlds(), []);
});
