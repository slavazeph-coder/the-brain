// GeoPackage (OGC 12-128r19, version 1.4) writer for a walk: one SQLite file that opens directly in
// QGIS, ArcGIS Pro and GDAL, with the track as a LineString layer and the features as a Point layer.
// Each feature row keeps its accuracy, heading, time and its photo (as the photo file name and the
// JPEG bytes), so a single shared .gpkg is enough to review the walk.
import { LIMITS, WALK_SCHEMA, isFix, summarizeTrack, trackFixes } from './walk-core.mjs';

const GPKG_APPLICATION_ID = 0x47504b47; // "GPKG"
const GPKG_USER_VERSION = 10400; // 1.4.0
const WGS84 = 4326;
const WGS84_WKT = 'GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563,AUTHORITY["EPSG","7030"]],AUTHORITY["EPSG","6326"]],PRIMEM["Greenwich",0,AUTHORITY["EPSG","8901"]],UNIT["degree",0.0174532925199433,AUTHORITY["EPSG","9122"]],AUTHORITY["EPSG","4326"]]';

// GeoPackage binary: "GP", version 0, flags (little endian, envelope type), srs_id, envelope, then ISO WKB.
function gpkgGeometry(wkb, envelope) {
  const envelopeBytes = envelope ? 32 : 0;
  const out = new Uint8Array(8 + envelopeBytes + wkb.length);
  const view = new DataView(out.buffer);
  out[0] = 0x47; out[1] = 0x50; out[2] = 0;
  out[3] = 0x01 | ((envelope ? 1 : 0) << 1);
  view.setInt32(4, WGS84, true);
  if (envelope) envelope.forEach((value, i) => view.setFloat64(8 + i * 8, value, true));
  out.set(wkb, 8 + envelopeBytes);
  return out;
}

export function pointGeometry(lon, lat) {
  const wkb = new Uint8Array(21);
  const view = new DataView(wkb.buffer);
  wkb[0] = 1; view.setUint32(1, 1, true);
  view.setFloat64(5, lon, true); view.setFloat64(13, lat, true);
  return gpkgGeometry(wkb, null);
}

export function lineGeometry(points) {
  const wkb = new Uint8Array(9 + points.length * 16);
  const view = new DataView(wkb.buffer);
  wkb[0] = 1; view.setUint32(1, 2, true); view.setUint32(5, points.length, true);
  points.forEach(([lon, lat], i) => { view.setFloat64(9 + i * 16, lon, true); view.setFloat64(17 + i * 16, lat, true); });
  const lons = points.map(p => p[0]), lats = points.map(p => p[1]);
  return gpkgGeometry(wkb, [Math.min(...lons), Math.max(...lons), Math.min(...lats), Math.max(...lats)]);
}

const iso = t => Number.isFinite(t) ? new Date(t).toISOString() : null;
const placed = f => Number.isFinite(f?.lat) && Number.isFinite(f?.lon) && Number.isFinite(f?.acc);

/**
 * Build the .gpkg bytes. `SQL` is an initialised sql.js module; `photos` maps a feature's
 * photo name (photos/f-1.jpg) to its JPEG bytes.
 */
export function buildGeoPackage(SQL, walk, { photos = new Map(), now = Date.now() } = {}) {
  const db = new SQL.Database();
  try {
    db.run(`PRAGMA application_id = ${GPKG_APPLICATION_ID}; PRAGMA user_version = ${GPKG_USER_VERSION};`);
    db.run(`CREATE TABLE gpkg_spatial_ref_sys (srs_name TEXT NOT NULL, srs_id INTEGER NOT NULL PRIMARY KEY, organization TEXT NOT NULL,
      organization_coordsys_id INTEGER NOT NULL, definition TEXT NOT NULL, description TEXT);
    CREATE TABLE gpkg_contents (table_name TEXT NOT NULL PRIMARY KEY, data_type TEXT NOT NULL, identifier TEXT UNIQUE, description TEXT DEFAULT '',
      last_change DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), min_x DOUBLE, min_y DOUBLE, max_x DOUBLE, max_y DOUBLE,
      srs_id INTEGER, CONSTRAINT fk_gc_r_srs_id FOREIGN KEY (srs_id) REFERENCES gpkg_spatial_ref_sys(srs_id));
    CREATE TABLE gpkg_geometry_columns (table_name TEXT NOT NULL, column_name TEXT NOT NULL, geometry_type_name TEXT NOT NULL, srs_id INTEGER NOT NULL,
      z TINYINT NOT NULL, m TINYINT NOT NULL, CONSTRAINT pk_geom_cols PRIMARY KEY (table_name, column_name),
      CONSTRAINT uk_gc_table_name UNIQUE (table_name), CONSTRAINT fk_gc_tn FOREIGN KEY (table_name) REFERENCES gpkg_contents(table_name),
      CONSTRAINT fk_gc_srs FOREIGN KEY (srs_id) REFERENCES gpkg_spatial_ref_sys (srs_id));`);
    const srs = db.prepare('INSERT INTO gpkg_spatial_ref_sys VALUES (?,?,?,?,?,?)');
    srs.run(['Undefined cartesian SRS', -1, 'NONE', -1, 'undefined', 'undefined cartesian coordinate reference system']);
    srs.run(['Undefined geographic SRS', 0, 'NONE', 0, 'undefined', 'undefined geographic coordinate reference system']);
    srs.run(['WGS 84 geodetic', WGS84, 'EPSG', WGS84, WGS84_WKT, 'longitude/latitude coordinates in decimal degrees on the WGS 84 spheroid']);
    srs.free();

    const stamp = iso(now);
    const summary = summarizeTrack(walk.fixes, walk);
    const line = trackFixes(walk).map(f => [f.lon, f.lat]);
    const points = (walk.features ?? []).filter(placed);
    const bbox = coords => coords.length ? [Math.min(...coords.map(c => c[0])), Math.min(...coords.map(c => c[1])), Math.max(...coords.map(c => c[0])), Math.max(...coords.map(c => c[1]))] : [null, null, null, null];

    db.run(`CREATE TABLE track (fid INTEGER PRIMARY KEY AUTOINCREMENT, geom LINESTRING, name TEXT, started_at TEXT, ended_at TEXT,
      length_m REAL, gps_fixes INTEGER, weak_fixes_left_out INTEGER, tracking_gaps INTEGER, map_position_95_m REAL, map_position_basis TEXT,
      shape_accuracy TEXT, walk_id TEXT, schema TEXT)`);
    db.run('INSERT INTO gpkg_contents (table_name,data_type,identifier,description,last_change,min_x,min_y,max_x,max_y,srs_id) VALUES (?,?,?,?,?,?,?,?,?,?)',
      ['track', 'features', `${walk.name} track`, 'Phone GPS track; fixes worse than 50 m are left off the line', stamp, ...bbox(line), WGS84]);
    db.run("INSERT INTO gpkg_geometry_columns VALUES ('track','geom','LINESTRING',?,0,0)", [WGS84]);
    db.run('INSERT INTO track (geom,name,started_at,ended_at,length_m,gps_fixes,weak_fixes_left_out,tracking_gaps,map_position_95_m,map_position_basis,shape_accuracy,walk_id,schema) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)', [
      line.length >= 2 ? lineGeometry(line) : null, walk.name, iso(walk.startedAt), iso(walk.endedAt), summary.lengthMetres, summary.fixes,
      summary.weakFixes, summary.gaps, summary.map.metres, summary.map.metres === null ? summary.map.reason : 'phone GPS, 95% of fixes within this radius',
      'not measured by a phone camera walk', walk.id, WALK_SCHEMA]);

    db.run(`CREATE TABLE features (fid INTEGER PRIMARY KEY AUTOINCREMENT, geom POINT, feature_id TEXT, type TEXT, label TEXT, note TEXT, time_utc TEXT,
      accuracy_95_m REAL, fix_age_s REAL, heading_deg REAL, video_s REAL, photo TEXT, photo_jpeg BLOB)`);
    const pointCoords = points.map(f => [f.lon, f.lat]);
    db.run('INSERT INTO gpkg_contents (table_name,data_type,identifier,description,last_change,min_x,min_y,max_x,max_y,srs_id) VALUES (?,?,?,?,?,?,?,?,?,?)',
      ['features', 'features', `${walk.name} features`, 'Features tapped during the walk, at the nearest GPS fix within 10 s', stamp, ...bbox(pointCoords), WGS84]);
    db.run("INSERT INTO gpkg_geometry_columns VALUES ('features','geom','POINT',?,0,0)", [WGS84]);
    const insert = db.prepare('INSERT INTO features (geom,feature_id,type,label,note,time_utc,accuracy_95_m,fix_age_s,heading_deg,video_s,photo,photo_jpeg) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)');
    for (const f of walk.features ?? []) {
      const jpeg = f.photo && photos.get(f.photo);
      insert.run([placed(f) ? pointGeometry(f.lon, f.lat) : null, f.id, f.type, f.label, f.note || null, iso(f.t),
        placed(f) ? f.acc : null, f.fixAgeSeconds, f.heading, f.videoSeconds, f.photo, jpeg && jpeg.length <= LIMITS.photoBytes ? jpeg : null]);
    }
    insert.free();
    return db.export();
  } finally {
    db.close();
  }
}

// ---------- browser loader ----------

let loading = null;
/** Load sql.js from ./vendor once, on first export; it stays cached for offline use. */
export function loadSqlJs(base = new URL('./vendor/', import.meta.url)) {
  loading ??= new Promise((resolve, reject) => {
    if (globalThis.initSqlJs) { resolve(globalThis.initSqlJs); return; }
    const script = document.createElement('script');
    script.src = new URL('sql-wasm.js', base).href;
    script.onload = () => globalThis.initSqlJs ? resolve(globalThis.initSqlJs) : reject(new Error('The GeoPackage writer did not load.'));
    script.onerror = () => reject(new Error('The GeoPackage writer could not load. Open the app once online so it can be kept for offline use.'));
    document.head.append(script);
  }).then(init => init({ locateFile: file => new URL(file, base).href }))
    .catch(error => { loading = null; throw error; });
  return loading;
}

export const hasGeometry = walk => (walk.fixes ?? []).some(isFix) || (walk.features ?? []).some(placed);
