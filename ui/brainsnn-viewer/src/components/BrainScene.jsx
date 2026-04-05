import React, { useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Environment, Html, Line, OrbitControls, Stars } from '@react-three/drei';
import * as THREE from 'three';
import { LINKS, POSITIONS, REGION_INFO } from '../data/network';

function BrainNode({ id, activity, selected, onSelect }) {
  const group = useRef();
  const glow = useRef();
  const color = REGION_INFO[id].color;
  const position = POSITIONS[id];

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const s = 0.85 + activity * 0.95 + (selected ? 0.14 : 0);
    group.current.scale.setScalar(s);
    group.current.position.y = position[1] + Math.sin(t * 1.6 + activity * 5) * 0.05;
    glow.current.material.opacity = 0.12 + activity * 0.28;
  });

  return (
    <group ref={group} position={position} onClick={(e) => { e.stopPropagation(); onSelect(id); }}>
      <mesh ref={glow}>
        <sphereGeometry args={[0.48, 28, 28]} />
        <meshBasicMaterial color={color} transparent opacity={0.16} />
      </mesh>
      <mesh>
        <sphereGeometry args={[0.34, 32, 32]} />
        <meshPhysicalMaterial color={color} emissive={color} emissiveIntensity={0.4 + activity * 0.9} roughness={0.24} metalness={0.08} clearcoat={0.8} clearcoatRoughness={0.18} />
      </mesh>
      <Html center distanceFactor={9} style={{ pointerEvents: 'none' }}>
        <div style={{ padding: '4px 8px', borderRadius: '999px', border: '1px solid rgba(255,255,255,.08)', background: 'rgba(0,0,0,.32)', color: 'white', font: '600 12px Satoshi, sans-serif', whiteSpace: 'nowrap' }}>{id}</div>
      </Html>
    </group>
  );
}

function BrainEdges({ weights }) {
  return LINKS.map(([a, b]) => {
    const key = `${a}→${b}`;
    const w = weights[key] ?? 0.2;
    const color = key === 'BG→THL' ? '#dd6974' : '#4f98a3';
    return <Line key={key} points={[POSITIONS[a], POSITIONS[b]]} color={color} lineWidth={1.2 + w * 2.4} transparent opacity={0.2 + w * 0.45} />;
  });
}

function SignalParticles({ regions }) {
  const ref = useRef();
  const particles = useMemo(() => {
    const arr = [];
    LINKS.forEach(([a, b], i) => {
      for (let j = 0; j < 4; j++) arr.push({ a, b, offset: Math.random(), speed: 0.15 + Math.random() * 0.25, i: `${i}-${j}` });
    });
    return arr;
  }, []);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    ref.current.children.forEach((child, idx) => {
      const p = particles[idx];
      const start = new THREE.Vector3(...POSITIONS[p.a]);
      const end = new THREE.Vector3(...POSITIONS[p.b]);
      const alpha = (t * p.speed + p.offset + regions[p.a] * 0.4) % 1;
      child.position.lerpVectors(start, end, alpha);
      const s = 0.04 + regions[p.a] * 0.05;
      child.scale.setScalar(s);
    });
  });

  return <group ref={ref}>{particles.map((p) => <mesh key={p.i}><sphereGeometry args={[0.055, 10, 10]} /><meshBasicMaterial color="#c5f3ff" transparent opacity={0.82} /></mesh>)}</group>;
}

export default function BrainScene({ regions, weights, selected, onSelect }) {
  return (
    <Canvas camera={{ position: [0, 1.5, 9], fov: 50 }} onPointerMissed={() => onSelect(null)}>
      <color attach="background" args={['#050607']} />
      <fog attach="fog" args={['#050607', 10, 22]} />
      <ambientLight intensity={0.8} />
      <directionalLight position={[4, 6, 5]} intensity={1.4} />
      <pointLight position={[-5, 3, 4]} intensity={1.1} color="#4f98a3" />
      <Stars radius={22} depth={18} count={1600} factor={2.8} saturation={0} fade speed={0.8} />
      <BrainEdges weights={weights} />
      <SignalParticles regions={regions} />
      {Object.keys(POSITIONS).map((name) => (
        <BrainNode key={name} id={name} activity={regions[name]} selected={selected === name} onSelect={onSelect} />
      ))}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -3.1, 0]}>
        <circleGeometry args={[5.2, 64]} />
        <meshBasicMaterial color="#113036" transparent opacity={0.14} />
      </mesh>
      <OrbitControls enableDamping minDistance={5} maxDistance={16} />
      <Environment preset="night" />
    </Canvas>
  );
}
