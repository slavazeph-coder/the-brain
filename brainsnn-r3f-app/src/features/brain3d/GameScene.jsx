// The 3D game board.
//
// This module may import three — see scripts/check-three-imports.mjs, which
// enforces that the allowlist stays short and that every entry is reached only
// through React.lazy. three is ~250 KB gzipped and must never touch first paint.
//
// The scene it renders is the same brain BrainScene.jsx draws, with three
// differences that make it a game rather than a diagram:
//
//   1. Pathways are clickable. drei's <Line> wraps LineSegments2, which does
//      implement raycast(), so a cut is a tap on the axon itself — but the
//      threshold is in world units and hopeless for a fingertip, so each
//      pathway also carries an invisible tube sized per input type.
//   2. Interventions are visible. A lesion darkens and cages its region, a cut
//      severs its axon, a stimulus haloes.
//   3. Packets fly. One InstancedMesh for all of them, positioned from the same
//      curve math the pathways are drawn from.
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame } from '@react-three/fiber';
import { AdaptiveDpr, Html, Line, OrbitControls } from '@react-three/drei';
import {
  BRAIN_REGIONS,
  PATHWAYS,
  REGION_MAP,
  pathwayControlPoint,
} from './brainRegions.js';
import { ROUTES, activePackets, packetSegment } from '../gaugegap/brainGame3d.js';
import { settingsForTier } from './quality.js';

const ROUTE_COLORS = {
  threat: '#fb7185',
  memory: '#a855f7',
  judgment: '#38bdf8',
};

// How wide the invisible hit tube around each axon is. Fingers need a much
// bigger target than a mouse pointer, and the tube is free to be generous
// because nothing else in the scene competes for those pixels.
const HIT_RADIUS = { fine: 0.16, coarse: 0.34 };

const LONG_PRESS_MS = 420;

function useCurves() {
  return useMemo(() => PATHWAYS.map((pathway) => {
    const from = REGION_MAP[pathway.from];
    const to = REGION_MAP[pathway.to];
    const control = pathwayControlPoint(pathway);
    const curve = new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(...from.position),
      new THREE.Vector3(...control),
      new THREE.Vector3(...to.position),
    );
    return { pathway, curve, points: curve.getPoints(24) };
  }), []);
}

/**
 * One axon: the drawn line, plus an invisible tube that is the real hit target.
 * Cut pathways render as a broken, dimmed line so the intervention is legible
 * from across the board.
 */
function Axon({ entry, curve, weight, cut, hovered, dimmed, onHover, onTap, hitRadius, reducedMotion }) {
  const { pathway } = entry;
  const tube = useMemo(() => new THREE.TubeGeometry(curve, 20, hitRadius, 6, false), [curve, hitRadius]);
  useEffect(() => () => tube.dispose(), [tube]);

  const color = cut ? '#64748b' : pathway.inhibitory ? '#fb7185' : hovered ? '#f8fafc' : '#22d3ee';
  const width = cut ? 1.4 : (hovered ? 4.2 : 2 + weight * 2.6);

  return (
    <group>
      <Line
        points={entry.points}
        color={color}
        lineWidth={width}
        transparent
        opacity={dimmed ? 0.3 : cut ? 0.42 : 0.62 + weight * 0.38}
        dashed={cut}
        dashSize={0.18}
        gapSize={0.22}
      />
      <mesh
        geometry={tube}
        visible={false}
        onPointerOver={(event) => { event.stopPropagation(); onHover(pathway.id); }}
        onPointerOut={() => onHover(null)}
        onClick={(event) => { event.stopPropagation(); onTap(pathway.id); }}
      />
      {hovered && !reducedMotion ? (
        <Html center position={curve.getPoint(0.5)} className="gg-g3d-tip-wrap" distanceFactor={9}>
          <div className="gg-g3d-tip">
            <strong>{pathway.label}</strong>
            <span>{cut ? 'Severed' : 'Tap to cut'}</span>
          </div>
        </Html>
      ) : null}
    </group>
  );
}

/**
 * A region. Tap to stimulate, long-press to lesion — the same two verbs the
 * button panel offers, reachable directly on the board.
 */
function Region({ region, activity, spiking, lesioned, stimulated, guarded, onTap, onLongPress, reducedMotion }) {
  const [hovered, setHovered] = useState(false);
  const timerRef = useRef(null);
  const firedRef = useRef(false);

  useEffect(() => () => window.clearTimeout(timerRef.current), []);

  // Kept smaller than the decorative scene's: at full activity the original
  // formula grew the right-hand cluster into one blob and buried the packets.
  const scale = lesioned ? 0.3 : 0.32 + activity * 0.46;
  const emissive = useMemo(() => new THREE.Color(lesioned ? '#1f2937' : region.color), [region.color, lesioned]);

  function startPress(event) {
    event.stopPropagation();
    firedRef.current = false;
    timerRef.current = window.setTimeout(() => {
      firedRef.current = true;
      onLongPress(region.code);
    }, LONG_PRESS_MS);
  }
  function endPress(event) {
    event.stopPropagation();
    window.clearTimeout(timerRef.current);
    // A long press already did its work; don't also fire the tap action.
    if (!firedRef.current) onTap(region.code);
  }

  return (
    <group position={region.position}>
      {/* Halo marks an active stimulus — and, when this region guards a route,
          that the guard is up. */}
      {stimulated ? (
        <mesh scale={(guarded ? 1.9 : 1.6) + (reducedMotion ? 0 : activity * 0.3)}>
          <sphereGeometry args={[0.5, 20, 20]} />
          <meshBasicMaterial color="#a3e635" transparent opacity={0.16} depthWrite={false} />
        </mesh>
      ) : null}

      <mesh scale={1.35 + activity * 0.3}>
        <torusGeometry args={[0.52, 0.015, 10, 48]} />
        <meshBasicMaterial color={lesioned ? '#6b7280' : region.color} transparent opacity={lesioned ? 0.3 : 0.5} />
      </mesh>

      <mesh
        scale={scale}
        onPointerDown={startPress}
        onPointerUp={endPress}
        onPointerOver={() => setHovered(true)}
        onPointerOut={() => { setHovered(false); window.clearTimeout(timerRef.current); }}
      >
        <sphereGeometry args={[1, 24, 24]} />
        <meshStandardMaterial
          color={lesioned ? '#374151' : region.color}
          emissive={emissive}
          emissiveIntensity={lesioned ? 0.1 : 1 + activity * 2.6 + (spiking ? 0.7 : 0)}
          metalness={0.25}
          roughness={0.34}
        />
      </mesh>

      {/* A lesion gets a cage so it reads as deliberately offline rather than
          merely dim. */}
      {lesioned ? (
        <mesh scale={scale * 1.5}>
          <icosahedronGeometry args={[1, 0]} />
          <meshBasicMaterial color="#9ca3af" wireframe transparent opacity={0.5} />
        </mesh>
      ) : null}

      <Html center position={[0, 0, scale + 0.4]} className="gg-g3d-label" distanceFactor={10} occlude={false}>
        <span>{region.code}</span>
      </Html>

      {hovered ? (
        <Html center position={[0, scale + 0.66, 0]} className="gg-g3d-tip-wrap" distanceFactor={8}>
          <div className="gg-g3d-tip">
            <strong>{region.name}</strong>
            <span>{lesioned ? 'Offline' : stimulated ? 'Stimulated' : 'Tap to stimulate · hold to lesion'}</span>
          </div>
        </Html>
      ) : null}
    </group>
  );
}

/**
 * Every packet in one InstancedMesh, with a single useFrame writing all the
 * matrices. The scene this replaces used 20-30 separate meshes each with its own
 * useFrame closure and its own geometry; that does not survive going to ninety.
 */
function PacketField({ packets, tickRef, curveById, reducedMotion, maxPackets }) {
  const meshRef = useRef(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const scratch = useMemo(() => new THREE.Vector3(), []);
  const color = useMemo(() => new THREE.Color(), []);

  // Instance colour has to be initialised once the buffer exists.
  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    for (let i = 0; i < maxPackets; i += 1) {
      color.set(ROUTE_COLORS[packets[i]?.route] || '#22d3ee');
      mesh.setColorAt(i, color);
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [packets, maxPackets, color]);

  useFrame(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const tickFloat = tickRef.current;
    const live = activePackets(packets, tickFloat);
    let index = 0;

    for (const packet of live) {
      if (index >= maxPackets) break;
      const segment = packetSegment(packet, tickFloat);
      const curve = curveById[segment.pathwayId];
      if (!curve) continue;
      curve.getPoint(segment.legProgress, scratch);
      dummy.position.copy(scratch);
      // Packets swell as they close on their target, so an imminent landing
      // reads at a glance.
      const swell = 0.85 + segment.progress * 1.05;
      dummy.scale.setScalar(swell * (0.75 + packet.impact * 0.5));
      dummy.updateMatrix();
      mesh.setMatrixAt(index, dummy.matrix);
      color.set(ROUTE_COLORS[packet.route] || '#22d3ee');
      mesh.setColorAt(index, color);
      index += 1;
    }

    // Park the unused instances out of frustum rather than reallocating.
    for (let i = index; i < maxPackets; i += 1) {
      dummy.position.set(0, -9999, 0);
      dummy.scale.setScalar(0.0001);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }

    mesh.count = maxPackets;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  });

  if (!packets.length) return null;

  return (
    // depthTest off and a high renderOrder: a packet must never be hidden
    // behind a region sphere. The spheres are far larger and every route's first
    // leg runs between two of them, so depth-tested packets spend most of their
    // flight invisible — which is fatal for a game where the packet is the
    // thing you are reacting to.
    <instancedMesh
      ref={meshRef}
      args={[null, null, maxPackets]}
      frustumCulled={false}
      renderOrder={10}
    >
      <sphereGeometry args={[0.22, reducedMotion ? 6 : 12, reducedMotion ? 6 : 12]} />
      <meshBasicMaterial toneMapped={false} transparent opacity={0.96} depthTest={false} depthWrite={false} />
    </instancedMesh>
  );
}

/** Advances the render-time tick clock. Cosmetic only — scoring never reads it. */
function TickClock({ tickRef, getTick }) {
  useFrame(() => { tickRef.current = getTick(); });
  return null;
}

/** Nudges the camera on a breach. Purely felt, never scored. */
function Shake({ activeRef, reducedMotion }) {
  const base = useRef(null);
  useFrame(({ camera }) => {
    if (reducedMotion) return;
    const strength = activeRef.current;
    if (!strength) {
      base.current = null;
      return;
    }
    if (base.current === null) base.current = camera.position.clone();
    camera.position.x += (Math.random() - 0.5) * strength * 0.12;
    camera.position.y += (Math.random() - 0.5) * strength * 0.12;
  });
  return null;
}

export default function GameScene({
  activities = {},
  spikes = {},
  weights = {},
  interventions = { lesions: [], cuts: [], stimuli: {} },
  packets = [],
  getTick,
  onRegionTap,
  onRegionLesion,
  onPathwayTap,
  shakeRef,
  quality = 'high',
  reducedMotion = false,
  coarsePointer = false,
  active = true,
}) {
  const entries = useCurves();
  const [hoveredPathway, setHoveredPathway] = useState(null);
  const tickRef = useRef(0);

  const curveById = useMemo(
    () => Object.fromEntries(entries.map((entry) => [entry.pathway.id, entry.curve])),
    [entries],
  );

  // Tier settings live in quality.js so the lab and the scene cannot disagree
  // about what "low" means.
  const settings = settingsForTier(quality);
  const { maxPackets, dpr, antialias, adaptiveDpr } = settings;

  // Which pathways are on a live packet's route — used to fade the rest so the
  // board reads under pressure instead of becoming a tangle.
  const liveRoutes = useMemo(() => {
    const set = new Set();
    for (const packet of packets) for (const id of packet.path) set.add(id);
    return set;
  }, [packets]);

  return (
    <Canvas
      camera={{ position: [6.2, 3.9, 7.4], fov: 46 }}
      dpr={dpr}
      frameloop={reducedMotion ? 'demand' : active ? 'always' : 'never'}
      gl={{ antialias, alpha: true, powerPreference: 'high-performance' }}
    >
      <ambientLight intensity={0.95} />
      <pointLight position={[4, 6, 4]} intensity={44} color="#22d3ee" />
      <pointLight position={[-4, -3, 6]} intensity={18} color="#a855f7" />

      <TickClock tickRef={tickRef} getTick={getTick} />
      {shakeRef ? <Shake activeRef={shakeRef} reducedMotion={reducedMotion} /> : null}

      {entries.map((entry) => (
        <Axon
          key={entry.pathway.id}
          entry={entry}
          curve={entry.curve}
          weight={weights[entry.pathway.id] ?? entry.pathway.initialWeight}
          cut={(interventions.cuts || []).includes(entry.pathway.id)}
          hovered={hoveredPathway === entry.pathway.id}
          dimmed={liveRoutes.size > 0 && !liveRoutes.has(entry.pathway.id)}
          onHover={setHoveredPathway}
          onTap={onPathwayTap}
          hitRadius={coarsePointer ? HIT_RADIUS.coarse : HIT_RADIUS.fine}
          reducedMotion={reducedMotion}
        />
      ))}

      <PacketField
        packets={packets}
        tickRef={tickRef}
        curveById={curveById}
        reducedMotion={reducedMotion}
        maxPackets={maxPackets}
      />

      {BRAIN_REGIONS.map((region) => (
        <Region
          key={region.code}
          region={region}
          activity={activities[region.code] ?? 0.2}
          spiking={Boolean(spikes[region.code])}
          lesioned={(interventions.lesions || []).includes(region.code)}
          stimulated={Boolean((interventions.stimuli || {})[region.code])}
          guarded={Object.values(ROUTES).some((route) => route.guard === region.code)}
          onTap={onRegionTap}
          onLongPress={onRegionLesion}
          reducedMotion={reducedMotion}
        />
      ))}

      <OrbitControls
        enablePan={false}
        enableZoom
        maxDistance={16}
        minDistance={4.5}
        target={[0.5, 0.1, 0]}
        autoRotate={false}
        makeDefault
      />
      {adaptiveDpr ? <AdaptiveDpr pixelated /> : null}
    </Canvas>
  );
}
