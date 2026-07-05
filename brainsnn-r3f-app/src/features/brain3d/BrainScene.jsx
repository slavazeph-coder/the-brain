// The lazy-loaded WebGL brain. This is the ONLY module that may import
// three / @react-three/fiber / @react-three/drei — everything else stays in
// the main bundle. Ported and adapted from ui/brainsnn-site/src/App.jsx.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Html, Line, OrbitControls, Sparkles, Sphere, Stars } from '@react-three/drei';
import { BRAIN_REGIONS, PATHWAYS, REGION_MAP, REGION_MEANINGS } from './brainRegions.js';

function pathwayCenter(start, end, offset = [0, 0, 0]) {
  return new THREE.Vector3(
    (start[0] + end[0]) / 2 + offset[0],
    (start[1] + end[1]) / 2 + offset[1],
    (start[2] + end[2]) / 2 + offset[2],
  );
}

function getQuadraticPoint(start, control, end, t, out) {
  const u = 1 - t;
  out.set(
    u * u * start.x + 2 * u * t * control.x + t * t * end.x,
    u * u * start.y + 2 * u * t * control.y + t * t * end.y,
    u * u * start.z + 2 * u * t * control.z + t * t * end.z,
  );
  return out;
}

function BrainNode({ region, activity, activityScore, selected, spiking, onSelect, interactive }) {
  const [hovered, setHovered] = useState(false);
  const scale = 0.38 + activity * 0.7 + (selected ? 0.1 : 0);
  const emissiveIntensity = 1.1 + activity * 2.8 + (spiking ? 0.7 : 0);
  const ringScale = 1.35 + activity * 0.35;
  const emissive = useMemo(() => new THREE.Color(region.color), [region.color]);

  return (
    <group position={region.position}>
      <mesh scale={ringScale}>
        <torusGeometry args={[0.52, 0.015, 10, 60]} />
        <meshBasicMaterial color={selected ? '#f1ece5' : region.color} transparent opacity={selected ? 0.92 : 0.46} />
      </mesh>

      {/* Static unit geometry + mesh scale: passing `scale` through args would
          rebuild the geometry every simulation tick. */}
      <Sphere
        args={[1, 32, 32]}
        scale={scale}
        onClick={interactive ? (event) => { event.stopPropagation(); onSelect(region.code); } : undefined}
        onPointerOver={interactive ? () => setHovered(true) : undefined}
        onPointerOut={interactive ? () => setHovered(false) : undefined}
      >
        <meshStandardMaterial
          color={region.color}
          emissive={emissive}
          emissiveIntensity={emissiveIntensity}
          metalness={0.25}
          roughness={0.32}
        />
      </Sphere>

      <Html center position={[0, 0, scale + 0.42]} className="brain3d-node-label" distanceFactor={10} occlude={false}>
        <span>{region.code}</span>
      </Html>

      {(hovered || selected) && (
        <Html center position={[0, scale + 0.7, 0]} className="brain3d-tooltip-wrap" distanceFactor={8}>
          <div className="brain3d-tooltip">
            <strong>{region.name}</strong>
            <span>{REGION_MEANINGS[region.code] ? REGION_MEANINGS[region.code](activityScore) : region.description}</span>
          </div>
        </Html>
      )}
    </group>
  );
}

function BrainEdges({ weights, selectedRegion, edgeColor }) {
  return (
    <group>
      {PATHWAYS.map((pathway) => {
        const from = REGION_MAP[pathway.from];
        const to = REGION_MAP[pathway.to];
        const start = new THREE.Vector3(...from.position);
        const end = new THREE.Vector3(...to.position);
        const control = pathwayCenter(from.position, to.position, pathway.curveOffset);
        const weight = weights[pathway.id] ?? pathway.initialWeight;
        const isSelected = selectedRegion && (selectedRegion === pathway.from || selectedRegion === pathway.to);
        const lineColor = pathway.inhibitory ? '#fb7185' : edgeColor;

        return (
          <Line
            key={pathway.id}
            points={[start, control, end]}
            color={lineColor}
            lineWidth={isSelected ? 2.4 + weight * 1.6 : 1.2 + weight * 1.2}
            transparent
            opacity={isSelected ? 0.95 : 0.28 + weight * 0.45}
          />
        );
      })}
    </group>
  );
}

function Particle({ pathway, activities, selectedRegion, speed, color, opacity }) {
  const meshRef = useRef();
  const travel = useRef(Math.random());
  const scratch = useMemo(() => new THREE.Vector3(), []);

  const vectors = useMemo(() => {
    const start = new THREE.Vector3(...REGION_MAP[pathway.from].position);
    const end = new THREE.Vector3(...REGION_MAP[pathway.to].position);
    const control = pathwayCenter(REGION_MAP[pathway.from].position, REGION_MAP[pathway.to].position, pathway.curveOffset);
    return { start, control, end };
  }, [pathway]);

  useFrame(() => {
    const sourceActivity = activities?.[pathway.from] ?? 0.2;
    travel.current += (0.004 + sourceActivity * 0.018) * speed;
    if (travel.current > 1) travel.current = 0;
    const point = getQuadraticPoint(vectors.start, vectors.control, vectors.end, travel.current, scratch);
    if (meshRef.current) meshRef.current.position.copy(point);
  });

  const active = !selectedRegion || selectedRegion === pathway.from || selectedRegion === pathway.to;

  return (
    <mesh ref={meshRef} visible={active}>
      <sphereGeometry args={[0.06, 12, 12]} />
      <meshBasicMaterial color={pathway.inhibitory ? '#fb7185' : color} transparent opacity={opacity} />
    </mesh>
  );
}

function SignalParticles({ activities, selectedRegion, params, palette }) {
  const copies = Array.from({ length: params.count }, (_, index) => index);
  return (
    <group>
      {PATHWAYS.flatMap((pathway) => copies.map((index) => (
        <Particle
          key={`${pathway.id}-${index}`}
          pathway={pathway}
          activities={activities}
          selectedRegion={selectedRegion}
          speed={params.speed * (1 + index * 0.18)}
          color={palette.particle}
          opacity={params.opacity}
        />
      )))}
    </group>
  );
}

// A bright flash at a pathway midpoint, timed by the soliton collision
// schedule, looping over the field's settling window.
function CollisionSparks({ schedule, glowColor }) {
  const meshRef = useRef();
  const startRef = useRef(null);

  const points = useMemo(() => {
    const eligible = PATHWAYS.filter((pathway) => !pathway.inhibitory);
    return schedule.map((entry, index) => {
      const pathway = eligible[index % eligible.length];
      return {
        ...entry,
        position: pathwayCenter(REGION_MAP[pathway.from].position, REGION_MAP[pathway.to].position, pathway.curveOffset),
      };
    });
  }, [schedule]);

  useFrame(() => {
    if (!meshRef.current || !points.length) return;
    if (startRef.current == null) startRef.current = performance.now();
    const loopMs = points[0].loopMs || 600;
    // Slow the 600ms physics window down ~6x so sparks read as deliberate events.
    const t = ((performance.now() - startRef.current) / 6) % loopMs;
    let visible = false;
    for (const point of points) {
      const distance = Math.abs(t - point.atMs);
      if (distance < 40) {
        const strength = (1 - distance / 40) * (0.5 + point.intensity * 0.8);
        meshRef.current.position.copy(point.position);
        meshRef.current.scale.setScalar(0.12 + strength * 0.5);
        meshRef.current.material.opacity = Math.min(1, strength);
        visible = true;
        break;
      }
    }
    meshRef.current.visible = visible;
  });

  if (!points.length) return null;
  return (
    <mesh ref={meshRef} visible={false}>
      <sphereGeometry args={[1, 16, 16]} />
      <meshBasicMaterial color={glowColor} transparent opacity={0} />
    </mesh>
  );
}

function FocusController({ controlsRef, selectedRegion }) {
  const { camera } = useThree();
  const defaults = useMemo(() => ({
    position: new THREE.Vector3(6.8, 4.4, 8.2),
    target: new THREE.Vector3(0.5, 0.1, 0),
  }), []);
  const desiredPosition = useMemo(() => new THREE.Vector3(), []);
  const desiredTarget = useMemo(() => new THREE.Vector3(), []);

  useFrame(() => {
    const selected = selectedRegion ? REGION_MAP[selectedRegion] : null;
    if (selected) {
      desiredTarget.set(...selected.position);
      desiredPosition.set(selected.position[0] + 2.2, selected.position[1] + 1.8, selected.position[2] + 2.8);
    } else {
      desiredTarget.copy(defaults.target);
      desiredPosition.copy(defaults.position);
    }
    camera.position.lerp(desiredPosition, 0.06);
    if (controlsRef.current) {
      controlsRef.current.target.lerp(desiredTarget, 0.08);
      controlsRef.current.update();
    }
  });

  return null;
}

// Renders one frame then halts — used for prefers-reduced-motion.
function StaticFrame() {
  const { invalidate } = useThree();
  useEffect(() => {
    invalidate();
  }, [invalidate]);
  return null;
}

export default function BrainScene({
  simulation,
  controls,
  activityScores,
  palette,
  particles,
  sparks,
  mode,
  active,
  reducedMotion,
}) {
  const controlsRef = useRef();
  const frameloop = reducedMotion ? 'demand' : active ? 'always' : 'never';

  return (
    <Canvas
      camera={{ position: [6.8, 4.4, 8.2], fov: 42 }}
      dpr={[1, 1.75]}
      frameloop={frameloop}
      gl={{ antialias: true, alpha: true, powerPreference: 'low-power' }}
    >
      <ambientLight intensity={0.9} />
      <pointLight position={[4, 6, 4]} intensity={48} color={palette.edge} />
      <pointLight position={[-4, -3, 6]} intensity={20} color={palette.glow} />

      <group onClick={mode === 'result' ? controls.clearSelection : undefined}>
        <BrainEdges weights={simulation.weights} selectedRegion={simulation.selectedRegion} edgeColor={palette.edge} />
        {!reducedMotion ? (
          <SignalParticles
            activities={simulation.activities}
            selectedRegion={simulation.selectedRegion}
            params={particles}
            palette={palette}
          />
        ) : null}
        {!reducedMotion && sparks.length ? <CollisionSparks schedule={sparks} glowColor={palette.glow} /> : null}
        {BRAIN_REGIONS.map((region) => (
          <BrainNode
            key={region.code}
            region={region}
            activity={simulation.activities[region.code]}
            activityScore={activityScores[region.code] ?? Math.round((simulation.activities[region.code] || 0) * 100)}
            spiking={simulation.spikes[region.code]}
            selected={simulation.selectedRegion === region.code}
            onSelect={controls.selectRegion}
            interactive={mode === 'result'}
          />
        ))}
      </group>

      {mode === 'demo' && !reducedMotion ? (
        <>
          <Sparkles count={28} scale={[11, 7, 11]} size={2.2} speed={0.35} color={palette.particle} />
          <Stars radius={50} depth={30} count={900} factor={4} fade />
        </>
      ) : null}

      <OrbitControls
        ref={controlsRef}
        enablePan={false}
        enableZoom={mode === 'result'}
        maxDistance={14}
        minDistance={5}
        target={[0.5, 0.1, 0]}
        autoRotate={!reducedMotion && !simulation.selectedRegion}
        autoRotateSpeed={0.55}
      />
      {!reducedMotion ? <FocusController controlsRef={controlsRef} selectedRegion={simulation.selectedRegion} /> : <StaticFrame />}
    </Canvas>
  );
}
