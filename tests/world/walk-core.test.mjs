import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  FEATURE_TYPES, LIMITS, WALK_SCHEMA, bundleEntries, pinWalk, positionStatement, createTrackMeter, defaultWalkName, fixNear, formatDuration, formatMetres,
  haversine, isFix, makeFeature, mapAccuracy, measureBetween, percentile, placeFeatures, projector, readBundle, readWalkRecord,
  summarizeTrack, toCSV, toGPX, toGeoJSON, walkRecord,
} from '../../brainsnn-r3f-app/public/walk/walk-core.mjs';
import { crc32, safeEntryName, unzip, zipParts } from '../../brainsnn-r3f-app/public/walk/walk-zip.mjs';

const T0 = Date.UTC(2026, 10, 22, 15, 0, 0);
// A straight walk north at 1 m/s: one fix per second, 1 m apart (1 m of latitude ≈ 8.9932e-6° on the mean sphere).
const M = 1 / 111195.08;
const north = (n, { acc = 5, lat0 = 45, lon0 = -75, dt = 1000 } = {}) =>
  Array.from({ length: n }, (_, i) => ({ t: T0 + i * dt, lat: lat0 + i * M, lon: lon0, acc }));

const walk = (extra = {}) => ({ id: 'w-1', name: 'Garden', startedAt: T0, endedAt: T0 + 60000, fixes: north(61), features: [], video: null, ...extra });

test('distances and the local projection agree to a few millimetres per 100 m', () => {
  const a = { lat: 45, lon: -75 }, b = { lat: 45 + 100 * M, lon: -75 };
  assert.ok(Math.abs(haversine(a, b) - 100) < 0.05);
  const p = projector(a)(b);
  assert.ok(Math.abs(p.y - 100) < 0.05 && Math.abs(p.x) < 1e-9);
  const east = projector(a)({ lat: 45, lon: -75 + 0.001 });
  assert.ok(Math.abs(east.x - haversine(a, { lat: 45, lon: -75.001 })) < 0.01);
});

test('only real fixes count; weak fixes stay out of the track but not out of the accuracy figure', () => {
  for (const bad of [null, {}, { t: T0, lat: 91, lon: 0, acc: 5 }, { t: T0, lat: 0, lon: 0, acc: 0 }, { t: T0, lat: 0, lon: 0, acc: Number.NaN }, { t: 'x', lat: 0, lon: 0, acc: 3 }])
    assert.equal(isFix(bad), false);
  const fixes = [...north(30, { acc: 6 }), { t: T0 + 31000, lat: 45.01, lon: -75, acc: 80 }];
  const summary = summarizeTrack(fixes, { startedAt: T0, endedAt: T0 + 31000 });
  assert.equal(summary.fixes, 31);
  assert.equal(summary.weakFixes, 1);
  assert.ok(summary.lengthMetres > 25 && summary.lengthMetres <= 29.5, `length ${summary.lengthMetres}`);
  assert.equal(summary.map.metres, 6, 'one weak fix in 31 is inside the worst 5%: 96.8% of fixes were within 6 m');
  const twoWeak = summarizeTrack([...fixes, { t: T0 + 32000, lat: 45.01, lon: -75, acc: 80 }]);
  assert.equal(twoWeak.map.metres, 80, 'two weak fixes in 32 are more than 5%, so the figure says so');
});

test('standing still does not walk: GPS jitter below the step threshold adds nothing', () => {
  const meter = createTrackMeter();
  const jitter = [0, 1.2, -0.8, 0.5, -1.4, 0.9, 0, -0.3];
  jitter.forEach((metres, i) => meter.add({ t: T0 + i * 1000, lat: 45 + metres * M, lon: -75, acc: 8 }));
  assert.equal(meter.lengthMetres, 0);
  assert.equal(meter.kept, jitter.length);
});

test('the map figure is the 95th percentile of the phone\'s own 95% radii, or withheld with a reason', () => {
  assert.equal(percentile([5, 1, 3, 2, 4], 0.95), 5);
  assert.equal(percentile([], 0.95), null);
  const values = Array.from({ length: 100 }, (_, i) => i + 1);
  assert.equal(percentile(values, 0.95), 95);
  assert.deepEqual(mapAccuracy([]), { metres: null, fixes: 0, reason: 'No GPS fix. Indoors a phone often has none.' });
  assert.match(mapAccuracy(north(2)).reason, /Only 2 GPS fixes/u);
  assert.equal(mapAccuracy(north(3, { acc: 16.84 })).metres, 16.8);
});

test('tracking gaps include a late first fix and an early last fix', () => {
  const fixes = [...north(5), ...north(5).map(f => ({ ...f, t: f.t + 30000 }))];
  assert.equal(summarizeTrack(fixes).gaps, 1);
  assert.equal(summarizeTrack(fixes, { startedAt: T0 - 20000, endedAt: T0 + 60000 }).gaps, 3);
  assert.equal(summarizeTrack([], { startedAt: T0, endedAt: T0 + 60000 }).gaps, 1, 'a walk with no fix at all is one long gap');
  assert.equal(summarizeTrack([], { startedAt: T0, endedAt: T0 + 60000 }).durationSeconds, 60);
});

test('features never get an invented position', () => {
  const fixes = north(10);
  const now = makeFeature({ id: 'f-1', type: 'pole', t: T0 + 4200, fix: fixNear(fixes, T0 + 4200) });
  assert.equal(now.lat, fixes[4].lat);
  assert.equal(now.fixAgeSeconds, 0.2);
  assert.equal(now.label, 'Pole');
  const blind = makeFeature({ id: 'f-2', type: 'unknown', t: T0 + 60000, heading: -90, photo: 'photos/f-2.jpg' });
  assert.equal(blind.type, 'note');
  assert.equal(blind.lat, null);
  assert.equal(blind.heading, 270);
  assert.equal(makeFeature({ id: 'f-3', type: 'door', t: T0, photo: '../etc/passwd' }).photo, null);
  assert.throws(() => makeFeature({ id: 'F 1', type: 'door', t: T0 }));
  const [late, stillBlind] = placeFeatures([makeFeature({ id: 'f-4', type: 'door', t: T0 + 12000 }), blind], fixes);
  assert.equal(late.lat, fixes[9].lat, 'a fix 3 s earlier places a feature dropped while GPS was catching up');
  assert.equal(late.fixAgeSeconds, 3);
  assert.equal(stillBlind.lat, null, 'nothing within 10 s: stays unplaced');
  assert.equal(makeFeature({ id: 'f-5', type: 'note', t: T0, note: 'x'.repeat(900) }).note.length, LIMITS.noteChars);
});

test('a measurement carries both fixes\' error', () => {
  const [a, b] = [north(1, { acc: 3 })[0], north(21, { acc: 4 })[20]];
  const m = measureBetween({ ...a }, { ...b });
  assert.ok(Math.abs(m.metres - 20) < 0.1);
  assert.equal(m.plusMinus, 5);
  assert.equal(measureBetween(a, { lat: null }), null);
});

test('exports open in GIS tools and refuse to smuggle formulas', () => {
  const fixes = north(61);
  const features = [
    makeFeature({ id: 'f-1', type: 'drain', t: T0 + 10000, fix: fixes[10], photo: 'photos/f-1.jpg', note: '=HYPERLINK("http://x")' }),
    makeFeature({ id: 'f-2', type: 'note', t: T0 + 90000, label: 'Gate <b>"A"</b> & co' }),
  ];
  const w = walk({ features });
  const geo = toGeoJSON(w);
  assert.equal(geo.type, 'FeatureCollection');
  assert.equal(geo.features[0].geometry.type, 'LineString');
  assert.deepEqual(geo.features[1].geometry.coordinates, [-75, Math.round(fixes[10].lat * 1e7) / 1e7]);
  assert.equal(geo.features[2].geometry, null, 'an unplaced feature keeps no geometry');
  assert.equal(geo.features[0].properties.map_position_m, 5);
  assert.equal(geo.features[0].properties.surveyed_marks, 0);
  const gpx = toGPX(w);
  assert.match(gpx, /<gpx version="1.1"/u);
  assert.equal((gpx.match(/<wpt /gu) || []).length, 1);
  assert.equal((gpx.match(/<trkpt /gu) || []).length, 61);
  assert.ok(!gpx.includes('<b>'));
  const csv = toCSV(w).split('\r\n');
  assert.equal(csv[0], 'id,type,label,note,time_utc,latitude,longitude,accuracy_95_m,heading_deg,photo,surveyed_mark');
  assert.match(csv[1], /,"'=HYPERLINK\(""http:\/\/x""\)",/u);
  assert.match(csv[2], /^f-2,note,"Gate <b>""A""<\/b> & co",/u);
});

test('ZIP bundles round-trip and refuse unsafe or damaged archives', async () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
  for (const bad of ['../x', '/abs', 'a\\b', 'a//b', 'C:x', './x', ''])
    assert.equal(safeEntryName(bad), false, bad);
  const photo = new Uint8Array([0xff, 0xd8, 1, 2, 3, 0xff, 0xd9]);
  const w = walk({ features: [makeFeature({ id: 'f-1', type: 'pole', t: T0 + 5000, fix: north(6)[5], photo: 'photos/f-1.jpg' })], video: { name: 'video.mp4', bytes: 4 } });
  const parts = zipParts(bundleEntries(w, { photos: new Map([['photos/f-1.jpg', photo]]), video: new Uint8Array([0, 0, 0, 1]) }), { now: T0 });
  const bytes = new Uint8Array(await new Blob(parts).arrayBuffer());
  const files = await unzip(bytes);
  assert.deepEqual(files.map(f => f.name), ['walk.json', 'walk.geojson', 'walk.gpx', 'features.csv', 'README.txt', 'photos/f-1.jpg', 'video.mp4']);
  const opened = readBundle(files);
  assert.equal(opened.walk.name, 'Garden');
  assert.deepEqual([...opened.photos.get('photos/f-1.jpg')], [...photo]);
  assert.equal(opened.video.length, 4);
  assert.deepEqual(opened.walk.features[0], w.features[0]);
  const damaged = bytes.slice(); damaged[90] ^= 0xff;
  await assert.rejects(() => unzip(damaged), /damaged|checksum/u);
  await assert.rejects(() => unzip(new Uint8Array(40)), /not a ZIP/u);
  assert.throws(() => zipParts([{ name: '../evil', data: 'x' }]), /Bad or repeated/u);
  assert.throws(() => zipParts([{ name: 'a', data: 'x' }, { name: 'a', data: 'y' }]), /Bad or repeated/u);
});

test('re-zipped (deflated) bundles open too', async t => {
  if (typeof CompressionStream === 'undefined') return t.skip('no CompressionStream');
  const text = 'hello walk '.repeat(200);
  const deflated = new Uint8Array(await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());
  const stored = new Uint8Array(await new Blob(zipParts([{ name: 'a.txt', data: text }])).arrayBuffer());
  // Rebuild the single entry as method 8 with the deflated payload.
  const name = new TextEncoder().encode('a.txt');
  const v = new DataView(stored.buffer);
  const crc = v.getUint32(14, true);
  const local = new DataView(new ArrayBuffer(30)); local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(8, 8, true);
  local.setUint32(14, crc, true); local.setUint32(18, deflated.length, true); local.setUint32(22, text.length, true); local.setUint16(26, name.length, true);
  const central = new DataView(new ArrayBuffer(46)); central.setUint32(0, 0x02014b50, true); central.setUint16(10, 8, true);
  central.setUint32(16, crc, true); central.setUint32(20, deflated.length, true); central.setUint32(24, text.length, true); central.setUint16(28, name.length, true);
  const end = new DataView(new ArrayBuffer(22)); end.setUint32(0, 0x06054b50, true); end.setUint16(8, 1, true); end.setUint16(10, 1, true);
  end.setUint32(12, 46 + name.length, true); end.setUint32(16, 30 + name.length + deflated.length, true);
  const zip = new Uint8Array(await new Blob([local.buffer, name, deflated, central.buffer, name, end.buffer]).arrayBuffer());
  const [file] = await unzip(zip);
  assert.equal(new TextDecoder().decode(file.data), text);
  // A bomb that claims fewer bytes than it inflates to is stopped.
  const lying = zip.slice(); new DataView(lying.buffer).setUint32(30 + name.length + deflated.length + 24, 10, true);
  await assert.rejects(() => unzip(lying), /larger than it claims/u);
});

test('walk.json from someone else is validated, not trusted', () => {
  const good = walkRecord(walk({ features: [makeFeature({ id: 'f-1', type: 'pole', t: T0 + 5000, fix: north(6)[5] })] }));
  assert.equal(good.schema, WALK_SCHEMA);
  assert.equal(readWalkRecord(JSON.parse(JSON.stringify(good))).features[0].lat, good.features[0].lat);
  const broken = [
    { ...good, schema: 'other' },
    { ...good, id: '../x' },
    { ...good, name: '   ' },
    { ...good, endedAt: good.startedAt - 1 },
    { ...good, fixes: [{ t: T0, lat: 200, lon: 0, acc: 3 }] },
    { ...good, features: [good.features[0], good.features[0]] },
    { ...good, features: [{ ...good.features[0], acc: -1 }] },
    { ...good, video: { name: '../video.mp4', bytes: 10 } },
    { ...good, video: { name: 'video.mp4', bytes: LIMITS.videoBytes + 1 } },
    { ...good, fixes: { length: 1 } },
  ];
  for (const value of broken) assert.throws(() => readWalkRecord(value), undefined, JSON.stringify(value).slice(0, 80));
});

test('small formatting rules the screens rely on', () => {
  assert.equal(formatMetres(7.26), '7.3 m');
  assert.equal(formatMetres(116.4), '116 m');
  assert.equal(formatMetres(1520), '1.52 km');
  assert.equal(formatMetres(null), '—');
  assert.equal(formatDuration(65), '01:05');
  assert.equal(formatDuration(3725), '1:02:05');
  assert.equal(defaultWalkName([{ name: 'Walk 1' }]), 'Walk 2');
  assert.equal(defaultWalkName([{ name: 'Walk 2' }]), 'Walk 3');
  assert.equal(new Set(FEATURE_TYPES.map(type => type.id)).size, FEATURE_TYPES.length);
});

test('the walk app ships as an installable, offline shell', async () => {
  const directory = new URL('../../brainsnn-r3f-app/public/walk/', import.meta.url);
  const [page, shell, manifest] = await Promise.all(['index.html', 'sw.js', 'manifest.webmanifest'].map(name => readFile(new URL(name, directory), 'utf8')));
  const app = JSON.parse(manifest);
  assert.equal(app.scope, '/walk/');
  assert.equal(app.display, 'standalone');
  assert.match(page, /<link rel="manifest" href="\.\/manifest\.webmanifest">/u);
  for (const file of ['./walk.mjs', './walk-core.mjs', './walk-zip.mjs', './walk-store.mjs', './walk-map.mjs', './walk-gpkg.mjs', './walk.css',
    './vendor/sql-wasm.js', './vendor/sql-wasm.wasm', '../world/capture-handoff.mjs'])
    assert.ok(shell.includes(`'${file}'`), `${file} is precached`);
  assert.match(shell, /const CACHE = 'brainsnn-walk-v\d+'/u);
});

test('surveyed marks shift the walk onto known points and check themselves leave-one-out', () => {
  // Truth: three features 20 m apart going north. The phone saw everything 3 m east and 4 m north (a 5 m bias).
  const E = 1 / (111195.08 * Math.cos(45 * Math.PI / 180));
  const truth = [0, 20, 40].map(n => ({ lat: 45 + n * M, lon: -75 }));
  const biased = p => ({ lat: p.lat + 4 * M, lon: p.lon + 3 * E });
  const fixes = Array.from({ length: 41 }, (_, i) => ({ t: T0 + i * 1000, ...biased({ lat: 45 + i * M, lon: -75 }), acc: 8 }));
  const features = truth.map((p, i) => makeFeature({ id: `f-${i + 1}`, type: 'pole', t: T0 + i * 20000, fix: { t: T0 + i * 20000, ...biased(p), acc: 8 } }));
  const base = walk({ fixes, features, endedAt: T0 + 40000 });
  assert.equal(positionStatement(base).basis, 'phone-gps');
  assert.equal(positionStatement(base).metres, 8);

  const one = { ...base, marks: [{ featureId: 'f-1', ...truth[0], name: 'PK nail 1' }] };
  const single = positionStatement(one);
  assert.equal(single.metres, null, 'one mark moves the walk but states no figure');
  assert.match(single.note, /Pinned to 1 surveyed mark \(moved 5 m\)/u);
  const moved = pinWalk(one).walk;
  assert.ok(haversine(moved.features[2], truth[2]) < 0.01, 'the whole walk moves, not just the pinned feature');
  assert.ok(haversine(moved.fixes[0], { lat: 45, lon: -75 }) < 0.01);

  const three = { ...base, marks: truth.map((p, i) => ({ featureId: `f-${i + 1}`, ...p, name: `Mark ${i + 1}` })) };
  const pinned = positionStatement(three);
  assert.equal(pinned.pin.marks, 3);
  assert.ok(Math.abs(pinned.pin.shiftMetres - 5) < 0.01);
  assert.ok(pinned.metres < 0.01, 'a pure offset is removed exactly');
  // One mark surveyed 1.5 m off: its leave-one-out miss shows it.
  const noisy = { ...three, marks: three.marks.map((m, i) => i === 1 ? { ...m, lat: m.lat + 1.5 * M } : m) };
  const check = positionStatement(noisy);
  // The other two agree, so they predict the bad mark 1.5 m from where it was surveyed.
  assert.equal(check.metres, 1.5);
  assert.deepEqual(check.pin.residuals.map(r => r.metres), [0.75, 1.5, 0.75]);
  assert.equal(check.note, 'Pinned to 3 surveyed marks · largest leave-one-out miss');
  // Exports carry the shifted coordinates and the statement; walk.json keeps the raw GPS.
  const geo = toGeoJSON(three);
  assert.ok(Math.abs(geo.features[1].geometry.coordinates[1] - truth[0].lat) < 1e-7);
  assert.equal(geo.features[0].properties.surveyed_marks, 3);
  assert.match(toCSV(three).split('\r\n')[1], /,Mark 1$/u);
  assert.equal(walkRecord(three).features[0].lat, features[0].lat);
  assert.deepEqual(readWalkRecord(JSON.parse(JSON.stringify(walkRecord(three)))).marks, three.marks);
});

test('surveyed marks from someone else are validated', () => {
  const good = walkRecord(walk({ features: [makeFeature({ id: 'f-1', type: 'pole', t: T0 + 5000, fix: north(6)[5] })] }));
  for (const marks of [
    [{ featureId: 'f-9', lat: 45, lon: -75 }],
    [{ featureId: 'f-1', lat: 95, lon: -75 }],
    [{ featureId: 'f-1', lat: 45, lon: -75 }, { featureId: 'f-1', lat: 45, lon: -75 }],
    'x',
  ]) assert.throws(() => readWalkRecord({ ...good, marks }), undefined, JSON.stringify(marks));
  assert.equal(readWalkRecord({ ...good, marks: [{ featureId: 'f-1', lat: 45, lon: -75, name: '' }] }).marks[0].name, 'Surveyed mark');
});
