// BrainSNN Walk: the pure part of the app. Everything here is plain data in,
// plain data out, so it runs the same in the phone, in exports and in tests.
//
// Honesty rules the rest of the app relies on:
// - Map position is the phone's own GPS estimate. The Geolocation API reports
//   each fix's horizontal accuracy as a 95% confidence radius in metres, so the
//   walk's figure is the 95th percentile of those radii, never a smaller guess.
// - Shape accuracy is not measured by a phone camera walk. It stays "not
//   measured" until a reconstruction with an independent known length exists.
// - Nothing is invented: a feature dropped without a GPS fix has no position.

export const WALK_SCHEMA = 'brainsnn.walk.v1';
export const LIMITS = Object.freeze({
  fixes: 20000,
  features: 500,
  nameChars: 80,
  noteChars: 500,
  labelChars: 60,
  weakFixMetres: 50,
  gapSeconds: 10,
  featureFixSeconds: 10,
  minFixesForFigure: 3,
  photoBytes: 4 * 1024 ** 2,
  videoBytes: 120 * 1024 ** 2,
  bundleBytes: 512 * 1024 ** 2,
  marks: 20,
});

export const FEATURE_TYPES = Object.freeze([
  { id: 'door', label: 'Door', colour: '#7cc4ff' },
  { id: 'obstacle', label: 'Obstacle', colour: '#ff9f6b' },
  { id: 'hazard', label: 'Hazard', colour: '#ff5d6c' },
  { id: 'outlet', label: 'Outlet', colour: '#ffd84d' },
  { id: 'pole', label: 'Pole', colour: '#b7f171' },
  { id: 'sign', label: 'Sign', colour: '#f6a8ff' },
  { id: 'drain', label: 'Drain', colour: '#5be3d0' },
  { id: 'note', label: 'Note', colour: '#e6e6f0' },
].map(Object.freeze));
const TYPE_IDS = new Set(FEATURE_TYPES.map(({ id }) => id));
export const featureType = id => FEATURE_TYPES.find(type => type.id === id) ?? FEATURE_TYPES.at(-1);

const EARTH_RADIUS = 6371008.8;
const rad = degrees => degrees * Math.PI / 180;
const finite = Number.isFinite;
const round = (value, places) => { const f = 10 ** places; return Math.round(value * f) / f; };

export function isFix(fix) {
  return !!fix && finite(fix.t) && finite(fix.lat) && finite(fix.lon) && finite(fix.acc)
    && fix.lat >= -90 && fix.lat <= 90 && fix.lon >= -180 && fix.lon <= 180 && fix.acc > 0 && fix.acc < 100000;
}

/** Great-circle distance in metres between two {lat, lon} points. */
export function haversine(a, b) {
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Local east/north metres around an origin. Good to well under 0.1% for a walk of a few km. */
export function projector(origin) {
  const k = Math.cos(rad(origin.lat));
  return point => ({ x: rad(point.lon - origin.lon) * EARTH_RADIUS * k, y: rad(point.lat - origin.lat) * EARTH_RADIUS });
}

/** Nearest-rank percentile; p in (0, 1]. */
export function percentile(values, p) {
  const sorted = values.filter(finite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))];
}

// GPS wanders while you stand still. A step only counts once it is longer than
// the jitter the two fixes allow, clamped so a poor fix cannot erase a corner.
export const stepThreshold = (a, b) => Math.min(10, Math.max(2, 0.25 * (a.acc + b.acc)));

/** Incremental walk meter, used live on the capture screen and for the final summary. */
export function createTrackMeter({ weakFixMetres = LIMITS.weakFixMetres } = {}) {
  let anchor = null, lengthMetres = 0, kept = 0, weak = 0;
  return {
    add(fix) {
      if (!isFix(fix)) return false;
      if (fix.acc > weakFixMetres) { weak += 1; return false; }
      kept += 1;
      if (!anchor) { anchor = fix; return true; }
      const step = haversine(anchor, fix);
      if (step >= stepThreshold(anchor, fix)) { lengthMetres += step; anchor = fix; }
      return true;
    },
    get lengthMetres() { return lengthMetres; },
    get kept() { return kept; },
    get weak() { return weak; },
  };
}

/** The walk's map-position figure, or the plain reason it is withheld. */
export function mapAccuracy(fixes) {
  const valid = (fixes ?? []).filter(isFix);
  if (valid.length < LIMITS.minFixesForFigure) {
    return { metres: null, fixes: valid.length,
      reason: valid.length ? `Only ${valid.length} GPS fix${valid.length === 1 ? '' : 'es'}. Walk outside or give the GPS a minute to settle.` : 'No GPS fix. Indoors a phone often has none.' };
  }
  return { metres: round(percentile(valid.map(({ acc }) => acc), 0.95), 1), fixes: valid.length, reason: null };
}

export function summarizeTrack(fixes, { startedAt = null, endedAt = null, gapSeconds = LIMITS.gapSeconds } = {}) {
  const valid = (fixes ?? []).filter(isFix).slice().sort((a, b) => a.t - b.t);
  const meter = createTrackMeter();
  for (const fix of valid) meter.add(fix);
  let gaps = 0;
  const gapMs = gapSeconds * 1000;
  for (let i = 1; i < valid.length; i += 1) if (valid[i].t - valid[i - 1].t > gapMs) gaps += 1;
  if (finite(startedAt) && valid.length && valid[0].t - startedAt > gapMs) gaps += 1;
  if (finite(endedAt) && valid.length && endedAt - valid.at(-1).t > gapMs) gaps += 1;
  if (finite(startedAt) && finite(endedAt) && !valid.length && endedAt - startedAt > gapMs) gaps += 1;
  const start = finite(startedAt) ? startedAt : valid[0]?.t ?? null;
  const end = finite(endedAt) ? endedAt : valid.at(-1)?.t ?? null;
  return {
    lengthMetres: round(meter.lengthMetres, 1),
    fixes: valid.length,
    weakFixes: meter.weak,
    gaps,
    durationSeconds: start !== null && end !== null ? Math.max(0, Math.round((end - start) / 1000)) : 0,
    map: mapAccuracy(valid),
  };
}

/** The fix closest in time to t, within a window; null when there is none. */
export function fixNear(fixes, t, maxSeconds = LIMITS.featureFixSeconds) {
  let best = null;
  for (const fix of fixes ?? []) {
    if (!isFix(fix)) continue;
    const age = Math.abs(fix.t - t);
    if (age <= maxSeconds * 1000 && (!best || age < Math.abs(best.t - t))) best = fix;
  }
  return best;
}

const cleanText = (value, max) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/gu, ' ').trim().slice(0, max) : '';

export function makeFeature({ id, type, t, fix = null, heading = null, photo = null, videoSeconds = null, label = '', note = '' }) {
  if (typeof id !== 'string' || !/^[a-z0-9-]{1,40}$/u.test(id)) throw new Error('Feature identifiers are short lowercase ids.');
  if (!finite(t)) throw new Error('A feature needs the time it was dropped.');
  const kind = TYPE_IDS.has(type) ? type : 'note';
  const placed = isFix(fix);
  return {
    id, type: kind, t,
    label: cleanText(label, LIMITS.labelChars) || featureType(kind).label,
    note: cleanText(note, LIMITS.noteChars),
    lat: placed ? fix.lat : null, lon: placed ? fix.lon : null, acc: placed ? fix.acc : null,
    fixAgeSeconds: placed ? round(Math.abs(t - fix.t) / 1000, 1) : null,
    heading: finite(heading) ? round(((heading % 360) + 360) % 360, 1) : null,
    photo: typeof photo === 'string' && /^photos\/[a-z0-9-]+\.jpg$/u.test(photo) ? photo : null,
    videoSeconds: finite(videoSeconds) && videoSeconds >= 0 ? round(videoSeconds, 2) : null,
  };
}

/** Give unplaced features the nearest fix in time, once the whole track is known. */
export function placeFeatures(features, fixes) {
  return (features ?? []).map(feature => {
    if (feature.lat !== null && feature.lon !== null) return feature;
    const fix = fixNear(fixes, feature.t);
    return fix ? { ...feature, lat: fix.lat, lon: fix.lon, acc: fix.acc, fixAgeSeconds: round(Math.abs(feature.t - fix.t) / 1000, 1) } : feature;
  });
}

const placed = feature => finite(feature?.lat) && finite(feature?.lon) && finite(feature?.acc);

/** Distance between two placed features, with the error both GPS fixes allow. */
export function measureBetween(a, b) {
  if (!placed(a) || !placed(b)) return null;
  return { metres: round(haversine(a, b), 1), plusMinus: round(Math.hypot(a.acc, b.acc), 1) };
}

export function formatMetres(metres) {
  if (!finite(metres)) return '—';
  if (metres >= 1000) return `${round(metres / 1000, 2)} km`;
  if (metres >= 100) return `${Math.round(metres)} m`;
  return `${round(metres, 1)} m`;
}

export function formatDuration(seconds) {
  const s = Math.max(0, Math.round(seconds || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  const two = n => String(n).padStart(2, '0');
  return h ? `${h}:${two(m)}:${two(r)}` : `${two(m)}:${two(r)}`;
}

export function defaultWalkName(existing = []) {
  const used = new Set(existing.map(walk => walk?.name));
  for (let n = existing.length + 1; ; n += 1) if (!used.has(`Walk ${n}`)) return `Walk ${n}`;
}

// ---------- surveyed marks ----------
// A feature dropped on a surveyed mark (monument, PK nail, benchmark) can be given the mark's known
// coordinates. Phone GPS error over a short walk is mostly a shared offset, so the walk is shifted by
// the mean offset of its marks. With two or more marks, each mark is predicted from the others
// (leave-one-out) and the largest miss is the stated figure; one mark moves the walk but cannot
// check itself, so it states no figure.

export function readMark(raw, featureIds) {
  if (!raw || typeof raw.featureId !== 'string' || !featureIds.has(raw.featureId)) throw new Error('A surveyed mark must belong to a feature of this walk.');
  if (!finite(raw.lat) || !finite(raw.lon) || raw.lat < -90 || raw.lat > 90 || raw.lon < -180 || raw.lon > 180) throw new Error('A surveyed mark needs a latitude and longitude in decimal degrees.');
  return { featureId: raw.featureId, lat: raw.lat, lon: raw.lon, name: cleanText(raw.name, LIMITS.labelChars) || 'Surveyed mark' };
}

export function pinWalk(walk) {
  const byId = new Map((walk.features ?? []).map(f => [f.id, f]));
  const marks = (walk.marks ?? []).filter(mark => placed(byId.get(mark.featureId)));
  if (!marks.length) return { walk, pin: null };
  const project = projector(marks[0]);
  const offsets = marks.map(mark => {
    const known = project(mark), seen = project(byId.get(mark.featureId));
    return { featureId: mark.featureId, x: known.x - seen.x, y: known.y - seen.y };
  });
  const mean = list => ({ x: list.reduce((a, o) => a + o.x, 0) / list.length, y: list.reduce((a, o) => a + o.y, 0) / list.length });
  const shift = mean(offsets);
  const residuals = offsets.length < 2 ? [] : offsets.map((o, i) => {
    const others = mean(offsets.filter((_, j) => j !== i));
    return { featureId: o.featureId, metres: round(Math.hypot(o.x - others.x, o.y - others.y), 2) };
  });
  const dLat = shift.y / EARTH_RADIUS * 180 / Math.PI;
  const dLon = shift.x / (EARTH_RADIUS * Math.cos(rad(marks[0].lat))) * 180 / Math.PI;
  const move = point => ({ ...point, lat: point.lat + dLat, lon: point.lon + dLon });
  return {
    walk: { ...walk, fixes: (walk.fixes ?? []).map(f => isFix(f) ? move(f) : f), features: (walk.features ?? []).map(f => placed(f) ? move(f) : f) },
    pin: { marks: marks.length, shiftMetres: round(Math.hypot(shift.x, shift.y), 2), east: round(shift.x, 2), north: round(shift.y, 2), residuals,
      checkMetres: residuals.length ? round(Math.max(...residuals.map(r => r.metres)), 2) : null },
  };
}

/** The one map-position statement every screen and export uses. */
export function positionStatement(walk) {
  const { pin } = pinWalk(walk);
  if (pin) {
    const marks = `${pin.marks} surveyed mark${pin.marks === 1 ? '' : 's'}`;
    return pin.checkMetres === null
      ? { metres: null, basis: 'surveyed-mark', note: `Pinned to ${marks} (moved ${formatMetres(pin.shiftMetres)}). One mark cannot check itself; pin a second for a figure.`, pin }
      : { metres: pin.checkMetres, basis: 'surveyed-mark', note: `Pinned to ${marks} · largest leave-one-out miss`, pin };
  }
  const map = summarizeTrack(walk.fixes, walk).map;
  return { metres: map.metres, basis: 'phone-gps', note: map.metres === null ? map.reason : `Phone GPS · 95% of ${map.fixes} fix${map.fixes === 1 ? '' : 'es'} were within this`, pin: null };
}

// ---------- exports ----------

const iso = t => finite(t) ? new Date(t).toISOString() : '';
const coord = value => round(value, 7);
const xml = value => String(value ?? '').replace(/[&<>"']/gu, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);

export function trackFixes(walk) {
  return (walk?.fixes ?? []).filter(fix => isFix(fix) && fix.acc <= LIMITS.weakFixMetres).sort((a, b) => a.t - b.t);
}

export function toGeoJSON(raw) {
  const statement = positionStatement(raw);
  const walk = pinWalk(raw).walk;
  const summary = summarizeTrack(walk.fixes, walk);
  const line = trackFixes(walk);
  const features = [];
  features.push({
    type: 'Feature',
    geometry: line.length >= 2 ? { type: 'LineString', coordinates: line.map(f => [coord(f.lon), coord(f.lat)]) } : null,
    properties: {
      kind: 'track', name: walk.name, started_at: iso(walk.startedAt), ended_at: iso(walk.endedAt),
      length_m: summary.lengthMetres, gps_fixes: summary.fixes, weak_fixes_left_out: summary.weakFixes, tracking_gaps: summary.gaps,
      map_position_m: statement.metres, map_position_basis: statement.note, surveyed_marks: statement.pin?.marks ?? 0,
      pin_shift_m: statement.pin?.shiftMetres ?? null,
      shape_accuracy: 'not measured by a phone camera walk',
    },
  });
  for (const feature of walk.features ?? []) {
    features.push({
      type: 'Feature', id: feature.id,
      geometry: placed(feature) ? { type: 'Point', coordinates: [coord(feature.lon), coord(feature.lat)] } : null,
      properties: {
        kind: 'feature', type: feature.type, label: feature.label, note: feature.note, time: iso(feature.t),
        accuracy_95_m: feature.acc, fix_age_s: feature.fixAgeSeconds, heading_deg: feature.heading, photo: feature.photo,
      },
    });
  }
  return { type: 'FeatureCollection', name: walk.name, brainsnn: { schema: WALK_SCHEMA, id: walk.id }, features };
}

export function toGPX(raw) {
  const walk = pinWalk(raw).walk;
  const line = trackFixes(walk);
  const points = (walk.features ?? []).filter(placed);
  const rows = ['<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="BrainSNN Walk" xmlns="http://www.topografix.com/GPX/1/1">',
    `<metadata><name>${xml(walk.name)}</name><time>${iso(walk.startedAt)}</time></metadata>`];
  for (const f of points) {
    rows.push(`<wpt lat="${coord(f.lat)}" lon="${coord(f.lon)}"><time>${iso(f.t)}</time><name>${xml(f.label)}</name>`
      + `<desc>${xml([f.note, `GPS ±${f.acc} m (95%)`].filter(Boolean).join(' · '))}</desc><type>${xml(f.type)}</type></wpt>`);
  }
  rows.push(`<trk><name>${xml(walk.name)}</name><trkseg>`);
  for (const f of line) rows.push(`<trkpt lat="${coord(f.lat)}" lon="${coord(f.lon)}">${finite(f.alt) ? `<ele>${round(f.alt, 1)}</ele>` : ''}<time>${iso(f.t)}</time></trkpt>`);
  rows.push('</trkseg></trk>', '</gpx>');
  return rows.join('\n') + '\n';
}

// Spreadsheet apps execute cells that start with = + - @; prefix them so a
// shared walk cannot smuggle a formula into whoever opens the CSV.
const csvCell = value => {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/u.test(text) && typeof value === 'string') text = `'${text}`;
  return /[",\n\r]/u.test(text) ? `"${text.replace(/"/gu, '""')}"` : text;
};

export function toCSV(raw) {
  const walk = pinWalk(raw).walk;
  const marks = new Map((raw.marks ?? []).map(m => [m.featureId, m.name]));
  const header = ['id', 'type', 'label', 'note', 'time_utc', 'latitude', 'longitude', 'accuracy_95_m', 'heading_deg', 'photo', 'surveyed_mark'];
  const rows = (walk.features ?? []).map(f => [f.id, f.type, f.label, f.note, iso(f.t), placed(f) ? coord(f.lat) : '', placed(f) ? coord(f.lon) : '', f.acc ?? '', f.heading ?? '', f.photo ?? '', marks.get(f.id) ?? '']);
  return [header, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

export function readmeText(walk) {
  const summary = summarizeTrack(walk.fixes, walk);
  const statement = positionStatement(walk);
  return [
    `${walk.name} — BrainSNN Walk`,
    '',
    `Walked ${iso(walk.startedAt)} to ${iso(walk.endedAt)}: about ${formatMetres(summary.lengthMetres)}, ${(walk.features ?? []).length} features.`,
    statement.basis === 'surveyed-mark'
      ? `Map position: ${statement.metres === null ? 'unchecked' : `±${statement.metres} m`}. ${statement.note}. Coordinates in the exports are shifted onto the marks; walk.json keeps the raw GPS.`
      : summary.map.metres === null ? `Map position: withheld. ${summary.map.reason}` : `Map position: ±${summary.map.metres} m, phone GPS. 95% of the walk's fixes reported this radius or better.`,
    'Shape accuracy: not measured. A phone camera walk does not measure shapes or distances by itself.',
    '',
    'Files: walk.gpkg (GeoPackage: track and features with their photos) opens in QGIS and ArcGIS Pro.',
    'walk.geojson and walk.gpx open in most map apps. features.csv opens in a spreadsheet.',
    'photos/ holds one photo per feature. walk.json reopens the walk in BrainSNN Walk (brainsnn.com/walk).',
    '',
  ].join('\n');
}

// ---------- the walk file inside a bundle ----------

export function walkRecord(walk) {
  return {
    schema: WALK_SCHEMA, id: walk.id, name: walk.name, startedAt: walk.startedAt, endedAt: walk.endedAt,
    fixes: (walk.fixes ?? []).filter(isFix).map(({ t, lat, lon, acc, alt = null, altAcc = null }) => ({ t, lat, lon, acc, alt: finite(alt) ? alt : null, altAcc: finite(altAcc) ? altAcc : null })),
    features: walk.features ?? [],
    marks: walk.marks ?? [],
    video: walk.video ?? null,
  };
}

const fail = message => { throw new Error(message); };

/** Validate a walk.json from someone else. Anything malformed is refused, not repaired. */
export function readWalkRecord(value) {
  if (!value || typeof value !== 'object' || value.schema !== WALK_SCHEMA) fail('This is not a BrainSNN walk (walk.json with brainsnn.walk.v1).');
  if (typeof value.id !== 'string' || !/^[a-z0-9-]{1,64}$/u.test(value.id)) fail('The walk has no valid id.');
  const name = cleanText(value.name, LIMITS.nameChars);
  if (!name) fail('The walk has no name.');
  if (!finite(value.startedAt) || !finite(value.endedAt) || value.endedAt < value.startedAt) fail('The walk has no valid start and end time.');
  if (!Array.isArray(value.fixes) || value.fixes.length > LIMITS.fixes) fail(`A walk can hold up to ${LIMITS.fixes} GPS fixes.`);
  if (!Array.isArray(value.features) || value.features.length > LIMITS.features) fail(`A walk can hold up to ${LIMITS.features} features.`);
  const fixes = value.fixes.map(fix => { if (!isFix(fix)) fail('The walk contains an invalid GPS fix.'); return { t: fix.t, lat: fix.lat, lon: fix.lon, acc: fix.acc, alt: finite(fix.alt) ? fix.alt : null, altAcc: finite(fix.altAcc) ? fix.altAcc : null }; });
  const ids = new Set();
  const features = value.features.map(raw => {
    const fix = finite(raw?.lat) && finite(raw?.lon) && finite(raw?.acc) ? { t: raw.t - (finite(raw.fixAgeSeconds) ? raw.fixAgeSeconds * 1000 : 0), lat: raw.lat, lon: raw.lon, acc: raw.acc } : null;
    let feature;
    try { feature = makeFeature({ ...raw, fix }); } catch (error) { fail(`The walk contains an invalid feature: ${error.message}`); }
    if (ids.has(feature.id)) fail('The walk repeats a feature id.');
    ids.add(feature.id);
    if (fix && !isFix(fix)) fail('The walk contains a feature with an invalid position.');
    return { ...feature, fixAgeSeconds: finite(raw.fixAgeSeconds) ? raw.fixAgeSeconds : feature.fixAgeSeconds };
  });
  if (value.marks !== undefined && (!Array.isArray(value.marks) || value.marks.length > LIMITS.marks)) fail(`A walk can hold up to ${LIMITS.marks} surveyed marks.`);
  const marks = [];
  for (const raw of value.marks ?? []) {
    let mark;
    try { mark = readMark(raw, ids); } catch (error) { fail(error.message); }
    if (marks.some(m => m.featureId === mark.featureId)) fail('The walk pins one feature to two marks.');
    marks.push(mark);
  }
  let video = null;
  if (value.video) {
    const v = value.video;
    if (typeof v.name !== 'string' || !/^video\.(mp4|webm)$/u.test(v.name) || !finite(v.bytes) || v.bytes <= 0 || v.bytes > LIMITS.videoBytes) fail('The walk names an invalid video.');
    video = { name: v.name, bytes: v.bytes, type: v.name.endsWith('.mp4') ? 'video/mp4' : 'video/webm' };
  }
  return { id: value.id, name, startedAt: value.startedAt, endedAt: value.endedAt, fixes, features, marks, video };
}

/** The files of a walk bundle, in order, as {name, data} where data is a string or a byte array. */
export function bundleEntries(walk, { photos = new Map(), video = null, gpkg = null } = {}) {
  const entries = [
    { name: 'walk.json', data: JSON.stringify(walkRecord(walk), null, 1) },
    ...(gpkg ? [{ name: 'walk.gpkg', data: gpkg }] : []),
    { name: 'walk.geojson', data: JSON.stringify(toGeoJSON(walk)) },
    { name: 'walk.gpx', data: toGPX(walk) },
    { name: 'features.csv', data: toCSV(walk) },
    { name: 'README.txt', data: readmeText(walk) },
  ];
  for (const feature of walk.features ?? []) if (feature.photo && photos.has(feature.photo)) entries.push({ name: feature.photo, data: photos.get(feature.photo) });
  if (video && walk.video) entries.push({ name: walk.video.name, data: video });
  return entries;
}

/** Turn a list of files from a bundle back into a walk plus its media. */
export function readBundle(files) {
  const byName = new Map(files.map(file => [file.name, file.data]));
  const json = byName.get('walk.json');
  if (!json) fail('The bundle has no walk.json. Choose a .zip exported from BrainSNN Walk.');
  let parsed;
  try { parsed = JSON.parse(typeof json === 'string' ? json : new TextDecoder().decode(json)); } catch { fail('walk.json could not be read.'); }
  const walk = readWalkRecord(parsed);
  const photos = new Map();
  for (const feature of walk.features) if (feature.photo && byName.has(feature.photo)) photos.set(feature.photo, byName.get(feature.photo));
  const video = walk.video && byName.get(walk.video.name);
  if (walk.video && !video) walk.video = null;
  return { walk, photos, video: video ?? null };
}
