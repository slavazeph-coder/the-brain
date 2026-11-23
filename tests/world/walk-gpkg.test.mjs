import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { makeFeature } from '../../brainsnn-r3f-app/public/walk/walk-core.mjs';
import { buildGeoPackage, lineGeometry, pointGeometry } from '../../brainsnn-r3f-app/public/walk/walk-gpkg.mjs';

const vendor = new URL('../../brainsnn-r3f-app/public/walk/vendor/', import.meta.url);
// The vendored browser build is CommonJS, but this package is "type": "module"; load a .cjs copy.
const loader = join(mkdtempSync(join(tmpdir(), 'walk-sqljs-')), 'sql-wasm.cjs');
copyFileSync(fileURLToPath(new URL('sql-wasm.js', vendor)), loader);
const initSqlJs = createRequire(import.meta.url)(loader);
const SQL = await initSqlJs({ locateFile: file => fileURLToPath(new URL(file, vendor)) });

const T0 = Date.UTC(2026, 10, 22, 15, 0, 0), M = 1 / 111195.08;
const fixes = Array.from({ length: 31 }, (_, i) => ({ t: T0 + i * 1000, lat: 45 + i * 2 * M, lon: -75, acc: 6 }));
const photo = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);
const walk = {
  id: 'w-1', name: 'Garden', startedAt: T0, endedAt: T0 + 30000, fixes, video: null,
  features: [
    makeFeature({ id: 'f-1', type: 'pole', t: T0 + 5000, fix: fixes[5], heading: 90, photo: 'photos/f-1.jpg', note: 'Leaning' }),
    makeFeature({ id: 'f-2', type: 'note', t: T0 + 60000 }),
  ],
};

const open = bytes => new SQL.Database(bytes);
const rows = (db, sql) => { const [result] = db.exec(sql); return result ? result.values : []; };

test('geometry blobs follow the GeoPackage binary header and ISO WKB', () => {
  const p = pointGeometry(-75.5, 45.25);
  assert.deepEqual([...p.subarray(0, 4)], [0x47, 0x50, 0, 1], 'GP, version 0, little endian, no envelope');
  const v = new DataView(p.buffer);
  assert.equal(v.getInt32(4, true), 4326);
  assert.equal(p[8], 1); assert.equal(v.getUint32(9, true), 1);
  assert.equal(v.getFloat64(13, true), -75.5); assert.equal(v.getFloat64(21, true), 45.25);
  const l = lineGeometry([[-75, 45], [-74.9, 45.1]]);
  const lv = new DataView(l.buffer);
  assert.equal(l[3], 0x03, 'little endian with an xy envelope');
  assert.deepEqual([0, 1, 2, 3].map(i => lv.getFloat64(8 + i * 8, true)), [-75, -74.9, 45, 45.1]);
  assert.equal(lv.getUint32(41, true), 2); assert.equal(lv.getUint32(45, true), 2);
});

test('a walk becomes a valid GeoPackage with a track layer and a feature layer', () => {
  const db = open(buildGeoPackage(SQL, walk, { photos: new Map([['photos/f-1.jpg', photo]]), now: T0 + 40000 }));
  try {
    assert.deepEqual(rows(db, 'PRAGMA application_id'), [[0x47504b47]]);
    assert.deepEqual(rows(db, 'PRAGMA user_version'), [[10400]]);
    assert.deepEqual(rows(db, 'PRAGMA integrity_check'), [['ok']]);
    assert.deepEqual(rows(db, 'SELECT srs_id FROM gpkg_spatial_ref_sys ORDER BY srs_id'), [[-1], [0], [4326]]);
    assert.deepEqual(rows(db, 'SELECT table_name, data_type, srs_id FROM gpkg_contents ORDER BY table_name'), [['features', 'features', 4326], ['track', 'features', 4326]]);
    assert.deepEqual(rows(db, 'SELECT table_name, column_name, geometry_type_name, z, m FROM gpkg_geometry_columns ORDER BY table_name'),
      [['features', 'geom', 'POINT', 0, 0], ['track', 'geom', 'LINESTRING', 0, 0]]);
    const [[length, fixCount, figure, basis]] = rows(db, 'SELECT length_m, gps_fixes, map_position_95_m, map_position_basis FROM track');
    assert.ok(length > 55 && length <= 60.5);
    assert.equal(fixCount, 31); assert.equal(figure, 6); assert.match(basis, /95%/u);
    const features = rows(db, 'SELECT feature_id, type, label, note, accuracy_95_m, heading_deg, photo, photo_jpeg, geom IS NULL FROM features ORDER BY fid');
    assert.equal(features.length, 2);
    assert.deepEqual(features[0].slice(0, 7), ['f-1', 'pole', 'Pole', 'Leaning', 6, 90, 'photos/f-1.jpg']);
    assert.deepEqual([...features[0][7]], [...photo], 'the photo travels inside the GeoPackage');
    assert.equal(features[0][8], 0);
    assert.equal(features[1][8], 1, 'a feature with no GPS fix keeps an empty geometry, never an invented one');
    const [[minX, minY, maxX, maxY]] = rows(db, "SELECT min_x, min_y, max_x, max_y FROM gpkg_contents WHERE table_name='track'");
    assert.equal(minX, -75); assert.equal(maxX, -75); assert.equal(minY, 45); assert.ok(maxY > 45);
  } finally { db.close(); }
});

test('a walk with no GPS still produces a readable GeoPackage', () => {
  const blind = { ...walk, fixes: [], features: [makeFeature({ id: 'f-9', type: 'door', t: T0 })] };
  const db = open(buildGeoPackage(SQL, blind));
  try {
    assert.deepEqual(rows(db, 'SELECT geom IS NULL, map_position_95_m, map_position_basis FROM track'), [[1, null, 'No GPS fix. Indoors a phone often has none.']]);
    assert.deepEqual(rows(db, 'SELECT feature_id, geom IS NULL FROM features'), [['f-9', 1]]);
    assert.deepEqual(rows(db, "SELECT min_x FROM gpkg_contents WHERE table_name='features'"), [[null]]);
  } finally { db.close(); }
});
