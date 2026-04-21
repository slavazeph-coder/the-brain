import React, { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { POSITIONS, REGION_INFO } from '../../data/network';
import { getOscillationState, sampleModulation } from '../../utils/oscillations';

/**
 * Layer 37 — Cognitive Fragments
 *
 * Obsidian-style dense micro-neuron cloud. Each region owns a cloud of
 * ~36 fragments distributed with gaussian noise around its center.
 * Fragments pulse with region activity; intra-region and sparse cross-
 * region threads tie them together into an organic web.
 *
 * Render strategy:
 *  - Fragments via InstancedMesh (one sphere geo, one material, N matrices)
 *  - Connections via LineSegments (one BufferGeometry, positions updated
 *    in-place each frame for subtle breathing)
 */

const FRAGMENTS_PER_REGION = {
  // Density-tuned per region: cortical regions are denser
  CTX: 48,
  PFC: 40,
  HPC: 32,
  THL: 28,
  AMY: 28,
  BG: 28,
  CBL: 36,
};

// Low-quality fallback — 1/3 density
const LOW_DENSITY_SCALE = 0.33;

function seededRandom(seed) {
  let s = seed | 0 || 1;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s & 0xffff) / 0x10000;
  };
}

function gaussian(rand) {
  // Box-Muller
  const u = Math.max(1e-6, rand());
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * Generate a stable fragment cloud for one region.
 * Returns per-fragment: position (x,y,z), phase, baseScale.
 */
function generateRegionCloud(regionId, count, spread = 0.9, seedOffset = 0) {
  const center = POSITIONS[regionId];
  const rand = seededRandom(regionId.charCodeAt(0) * 7919 + seedOffset);
  const fragments = [];
  for (let i = 0; i < count; i++) {
    fragments.push({
      regionId,
      x: center[0] + gaussian(rand) * spread,
      y: center[1] + gaussian(rand) * spread * 0.8,
      z: center[2] + gaussian(rand) * spread * 0.9,
      phase: rand() * Math.PI * 2,
      baseScale: 0.028 + rand() * 0.02,
    });
  }
  return fragments;
}

/**
 * Build the fragment cloud index — all fragments across all regions.
 */
function buildFragmentIndex(densityScale = 1) {
  const all = [];
  for (const [id, count] of Object.entries(FRAGMENTS_PER_REGION)) {
    const scaled = Math.max(8, Math.round(count * densityScale));
    const cloud = generateRegionCloud(id, scaled, 0.9);
    all.push(...cloud);
  }
  return all;
}

/**
 * Pick nearest-neighbor pairs within each region + a few cross-region
 * threads. Stable order → indices by array position.
 */
function buildFragmentEdges(fragments) {
  const edges = [];
  const byRegion = new Map();
  for (let i = 0; i < fragments.length; i++) {
    const r = fragments[i].regionId;
    if (!byRegion.has(r)) byRegion.set(r, []);
    byRegion.get(r).push(i);
  }

  // Intra-region: for each fragment, connect to 2 nearest siblings
  for (const [, indices] of byRegion) {
    for (const i of indices) {
      const pi = fragments[i];
      const nearest = indices
        .filter((j) => j !== i)
        .map((j) => ({
          j,
          d: (fragments[j].x - pi.x) ** 2 + (fragments[j].y - pi.y) ** 2 + (fragments[j].z - pi.z) ** 2,
        }))
        .sort((a, b) => a.d - b.d)
        .slice(0, 2);
      for (const { j } of nearest) {
        if (i < j) edges.push([i, j]);
      }
    }
  }

  // Cross-region: sparse sprinkle — roughly 1 thread per region pair where
  // centers are closest (stable, not every pair)
  const regions = [...byRegion.keys()];
  for (let a = 0; a < regions.length; a++) {
    for (let b = a + 1; b < regions.length; b++) {
      const ra = POSITIONS[regions[a]];
      const rb = POSITIONS[regions[b]];
      const dist = Math.hypot(ra[0] - rb[0], ra[1] - rb[1], ra[2] - rb[2]);
      if (dist < 3.8) {
        const ia = byRegion.get(regions[a])[0];
        const ib = byRegion.get(regions[b])[0];
        edges.push([ia, ib]);
      }
    }
  }

  return edges;
}

const tmpMatrix = new THREE.Matrix4();
const tmpColor = new THREE.Color();
const tmpPos = new THREE.Vector3();
const tmpScale = new THREE.Vector3();

export default function BrainFragments({ regions, quality }) {
  const visible = quality !== 'low';
  const densityScale = quality === 'ultra' ? 1 : quality === 'high' ? 0.8 : LOW_DENSITY_SCALE;

  const fragments = useMemo(
    () => buildFragmentIndex(densityScale),
    [densityScale]
  );
  const edges = useMemo(() => buildFragmentEdges(fragments), [fragments]);

  const meshRef = useRef();
  const linesRef = useRef();

  // Line geometry: 2 points × edges.length × 3 (xyz) floats
  const lineGeometry = useMemo(() => {
    const positions = new Float32Array(edges.length * 2 * 3);
    for (let i = 0; i < edges.length; i++) {
      const [a, b] = edges[i];
      const pa = fragments[a];
      const pb = fragments[b];
      positions[i * 6 + 0] = pa.x;
      positions[i * 6 + 1] = pa.y;
      positions[i * 6 + 2] = pa.z;
      positions[i * 6 + 3] = pb.x;
      positions[i * 6 + 4] = pb.y;
      positions[i * 6 + 5] = pb.z;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    return geo;
  }, [edges, fragments]);

  useFrame((state) => {
    if (!meshRef.current) return;
    const t = state.clock.elapsedTime;

    // Layer 71 — oscillation modulation (read once per frame)
    const oscState = getOscillationState();
    const oscOffsets = sampleModulation(oscState, t);

    // Update each fragment instance
    for (let i = 0; i < fragments.length; i++) {
      const f = fragments[i];
      const rawActivity = regions[f.regionId] ?? 0.1;
      const activity = Math.max(0, Math.min(1, rawActivity + (oscOffsets[f.regionId] || 0)));
      const pulse = 0.8 + 0.2 * Math.sin(t * 1.4 + f.phase);
      const scale = f.baseScale * (0.6 + activity * 3.4) * pulse;

      tmpPos.set(
        f.x + Math.sin(t * 0.9 + f.phase) * 0.015,
        f.y + Math.cos(t * 0.7 + f.phase * 1.3) * 0.015,
        f.z + Math.sin(t * 0.8 + f.phase * 0.8) * 0.015,
      );
      tmpScale.setScalar(scale);
      tmpMatrix.compose(tmpPos, new THREE.Quaternion(), tmpScale);
      meshRef.current.setMatrixAt(i, tmpMatrix);

      // Per-instance color: region tint modulated by activity
      const base = REGION_INFO[f.regionId]?.color || '#ffffff';
      tmpColor.set(base).multiplyScalar(0.4 + activity * 1.8);
      meshRef.current.setColorAt(i, tmpColor);
    }
    meshRef.current.instanceMatrix.needsUpdate = true;
    if (meshRef.current.instanceColor) meshRef.current.instanceColor.needsUpdate = true;

    // Breathing lines — shift endpoints slightly for organic feel
    const posAttr = lineGeometry.getAttribute('position');
    if (posAttr) {
      for (let i = 0; i < edges.length; i++) {
        const [a, b] = edges[i];
        const pa = fragments[a];
        const pb = fragments[b];
        posAttr.array[i * 6 + 0] = pa.x + Math.sin(t * 0.9 + pa.phase) * 0.015;
        posAttr.array[i * 6 + 1] = pa.y + Math.cos(t * 0.7 + pa.phase * 1.3) * 0.015;
        posAttr.array[i * 6 + 2] = pa.z + Math.sin(t * 0.8 + pa.phase * 0.8) * 0.015;
        posAttr.array[i * 6 + 3] = pb.x + Math.sin(t * 0.9 + pb.phase) * 0.015;
        posAttr.array[i * 6 + 4] = pb.y + Math.cos(t * 0.7 + pb.phase * 1.3) * 0.015;
        posAttr.array[i * 6 + 5] = pb.z + Math.sin(t * 0.8 + pb.phase * 0.8) * 0.015;
      }
      posAttr.needsUpdate = true;
    }

    // Line opacity — global breathing tied to mean firing
    if (linesRef.current?.material) {
      const mean = Object.values(regions).reduce((acc, v) => acc + v, 0) /
        Math.max(1, Object.keys(regions).length);
      linesRef.current.material.opacity = 0.08 + mean * 0.25 +
        0.04 * Math.sin(t * 0.6);
    }
  });

  if (!visible) return null;

  return (
    <group>
      <instancedMesh
        ref={meshRef}
        args={[null, null, fragments.length]}
        frustumCulled={false}
      >
        <sphereGeometry args={[1, 10, 10]} />
        <meshStandardMaterial
          emissive="#ffffff"
          emissiveIntensity={0.2}
          toneMapped={false}
          roughness={0.5}
          metalness={0.15}
          transparent
          opacity={0.95}
          vertexColors
        />
      </instancedMesh>

      <lineSegments ref={linesRef} geometry={lineGeometry} frustumCulled={false}>
        <lineBasicMaterial
          color="#5ad4ff"
          transparent
          opacity={0.15}
          toneMapped={false}
        />
      </lineSegments>
    </group>
  );
}
