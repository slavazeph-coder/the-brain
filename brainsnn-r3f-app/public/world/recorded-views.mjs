/** Floor coordinates are X/Z metres. Heading is degrees from +Z toward +X. */
function angleGap(a, b) {
  return Math.abs(((a - b + 540) % 360 + 360) % 360 - 180);
}
function hasObject(frame, objectId) {
  return !objectId || frame.observations.some(observation => observation.objectId === objectId);
}

/** Retrieve a retained observation. A query outside coverage returns no image. */
export function nearestRecordedView(frames, {camera, heading, objectId, radius = 1.5, maxAngle = 45}) {
  if (!Array.isArray(camera) || camera.length !== 2 || !camera.every(Number.isFinite)
      || !(radius > 0) || !(maxAngle > 0) || (heading != null && !Number.isFinite(heading))) return null;
  let best = null;
  for (const [index, frame] of frames.entries()) {
    if (!frame.camera || !hasObject(frame, objectId)) continue;
    const distance = Math.hypot(frame.camera[0] - camera[0], frame.camera[1] - camera[1]);
    if (distance > radius) continue;
    let angle = null;
    if (heading != null) {
      if (!Number.isFinite(frame.heading)) continue;
      angle = angleGap(frame.heading, heading);
      if (angle > maxAngle) continue;
    }
    const cost = (distance / radius) ** 2 + (angle === null ? 0 : (angle / maxAngle) ** 2);
    if (!best || cost < best.cost) best = {index, distance, angle, cost};
  }
  return best;
}

/** Find another observed side of the selected footprint. No angle is inferred from image time. */
export function anotherObjectView(frames, current, object) {
  const camera = frames[current]?.camera;
  if (!camera || !object?.polygon?.length) return null;
  const center = [0, 0];
  for (const [x, z] of object.polygon) {
    center[0] += x / object.polygon.length;
    center[1] += z / object.polygon.length;
  }
  const bearing = ([x, z]) => Math.atan2(x - center[0], z - center[1]) * 180 / Math.PI;
  let best = null;
  for (const [index, frame] of frames.entries()) {
    if (index === current || !frame.camera || !hasObject(frame, object.id)) continue;
    const distance = Math.hypot(frame.camera[0] - camera[0], frame.camera[1] - camera[1]);
    if (distance < .05) continue;
    const angle = angleGap(bearing(camera), bearing(frame.camera));
    if (!best || angle > best.angle || (angle === best.angle && distance > best.distance)) {
      best = {index, distance, angle};
    }
  }
  return best;
}
