// Symmetric planar policy: learn how quickly to approach a waypoint from simulated demonstrations.
export function radialFeatures(radius, knots) {
  const features = Array(knots.length).fill(0);
  const last = knots.length - 1;
  if (radius >= knots[last]) {
    features[last] = 1;
    return features;
  }
  const high = knots.findIndex(distance => distance > radius);
  const low = high - 1;
  const blend = (radius - knots[low]) / (knots[high] - knots[low]);
  features[low] = 1 - blend;
  features[high] = blend;
  return features;
}

export function imitationVelocity(driver, observation) {
  const dx = observation.target[0] - observation.position[0];
  const dz = observation.target[1] - observation.position[1];
  const radius = Math.hypot(dx, dz);
  if (!radius) return [0, 0];
  const features = radialFeatures(radius, driver.knots);
  const speed = features.reduce((sum, feature, index) => sum + feature * driver.weights[index], 0);
  return [dx / radius * speed, dz / radius * speed];
}
