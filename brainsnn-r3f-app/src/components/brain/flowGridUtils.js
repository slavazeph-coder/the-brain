import * as THREE from 'three';
import { LINKS, POSITIONS } from '../../data/network';

/**
 * Build an arced CatmullRomCurve3 between two positions with a bulge outward.
 */
export function buildArcCurve(posA, posB, bulgeFactor = 0.35) {
  const a = new THREE.Vector3(...posA);
  const b = new THREE.Vector3(...posB);
  const mid = new THREE.Vector3().lerpVectors(a, b, 0.5);

  // Push midpoint outward from center of the brain (origin)
  const outward = mid.clone().normalize();
  mid.add(outward.multiplyScalar(bulgeFactor));

  return new THREE.CatmullRomCurve3([a, mid, b]);
}

/**
 * Get the midpoint of an arc curve (for cross-link generation).
 */
export function getArcMidpoint(posA, posB, bulgeFactor = 0.35) {
  const curve = buildArcCurve(posA, posB, bulgeFactor);
  return curve.getPoint(0.5);
}

/**
 * Find cross-links between midpoints of adjacent primary links.
 * Two links are adjacent if they share a node.
 */
export function findCrossLinks() {
  const crossLinks = [];
  const seen = new Set();

  for (let i = 0; i < LINKS.length; i++) {
    for (let j = i + 1; j < LINKS.length; j++) {
      const [a1, b1] = LINKS[i];
      const [a2, b2] = LINKS[j];

      // Check if they share a node
      const shared = a1 === a2 || a1 === b2 || b1 === a2 || b1 === b2;
      if (!shared) continue;

      const midA = getArcMidpoint(POSITIONS[a1], POSITIONS[b1]);
      const midB = getArcMidpoint(POSITIONS[a2], POSITIONS[b2]);

      const dist = midA.distanceTo(midB);
      if (dist > 4.0) continue; // Skip very distant cross-links

      const key = `${i}-${j}`;
      if (seen.has(key)) continue;
      seen.add(key);

      crossLinks.push({
        id: `cross-${key}`,
        from: midA.toArray(),
        to: midB.toArray(),
        parentLinks: [LINKS[i], LINKS[j]],
        parentIndices: [i, j]
      });
    }
  }

  return crossLinks;
}

/**
 * Compute composite activity for an edge from region activities and weight.
 */
export function getEdgeActivity(fromId, toId, regions, weights) {
  const key = `${fromId}\u2192${toId}`;
  const w = weights[key] ?? 0.2;
  const regionActivity = Math.max(regions[fromId] ?? 0, regions[toId] ?? 0);
  return regionActivity * w;
}

/**
 * Compute activity for a cross-link based on its parent links.
 */
export function getCrossLinkActivity(crossLink, regions, weights) {
  const [link1, link2] = crossLink.parentLinks;
  const a1 = getEdgeActivity(link1[0], link1[1], regions, weights);
  const a2 = getEdgeActivity(link2[0], link2[1], regions, weights);
  return (a1 + a2) * 0.5;
}
