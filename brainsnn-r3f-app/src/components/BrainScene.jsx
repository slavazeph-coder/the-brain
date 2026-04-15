import React, { useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Environment, Html, Line, OrbitControls, PerformanceMonitor, Stars } from '@react-three/drei';
import { EffectComposer, Outline, Selection, Select, Bloom } from '@react-three/postprocessing';
import * as THREE from 'three';
import { LINKS, POSITIONS, REGION_INFO } from '../data/network';
import { KNOWLEDGE_DOMAINS } from '../data/knowledgeGraph';
import NeuralFlowGrid from './brain/NeuralFlowGrid';

function FocusController({ selected }) {
  const { camera } = useThree();
  const target = useRef(new THREE.Vector3(0, 0, 0));
  const desired = useRef(new THREE.Vector3(0, 1.5, 9));

  useFrame(() => {
    const focus = selected ? POSITIONS[selected] : [0, 0, 0];
    target.current.lerp(new THREE.Vector3(...focus), 0.08);
    desired.current.lerp(
      new THREE.Vector3(focus[0] * 0.55, focus[1] + 1.3, focus[2] + 5.4),
      0.08
    );
    camera.position.lerp(desired.current, 0.08);
    camera.lookAt(target.current);
  });

  return null;
}

function BrainNode({ id, activity, selected, onSelect, quality, knowledgeMode, affectOverride }) {
  const group = useRef();
  const glow = useRef();
  const [hovered, setHovered] = useState(false);
  const baseColor = REGION_INFO[id].color;
  const override = affectOverride?.[id];
  const color = useMemo(() => {
    if (!override) return baseColor;
    return '#' + new THREE.Color(baseColor)
      .lerp(new THREE.Color(override.color), override.strength)
      .getHexString();
  }, [baseColor, override?.color, override?.strength]);
  const emissiveBoost = override ? override.strength * 0.5 : 0;
  const position = POSITIONS[id];

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const s = 0.85 + activity * 0.95 + (selected ? 0.14 : 0) + (hovered ? 0.06 : 0);
    group.current.scale.setScalar(s);
    group.current.position.y = position[1] + Math.sin(t * 1.6 + activity * 5) * 0.05;
    glow.current.material.opacity = 0.12 + activity * 0.28 + (hovered ? 0.08 : 0);
  });

  const glowSeg = quality === 'ultra' ? 24 : quality === 'high' ? 20 : 12;
  const coreSeg = quality === 'ultra' ? 28 : quality === 'high' ? 24 : 14;

  return (
    <Select enabled={selected && quality !== 'low'}>
      <group
        ref={group}
        position={position}
        onClick={(e) => {
          e.stopPropagation();
          onSelect(id);
        }}
        onPointerOver={(e) => {
          e.stopPropagation();
          setHovered(true);
        }}
        onPointerOut={() => setHovered(false)}
      >
        <mesh ref={glow} frustumCulled>
          <sphereGeometry args={[0.48, glowSeg, glowSeg]} />
          <meshBasicMaterial color={color} transparent opacity={0.16} />
        </mesh>

        <mesh frustumCulled>
          <sphereGeometry args={[0.34, coreSeg, coreSeg]} />
          <meshPhysicalMaterial
            color={color}
            emissive={color}
            emissiveIntensity={0.4 + activity * 0.9 + emissiveBoost}
            roughness={0.24}
            metalness={0.08}
            clearcoat={0.8}
            clearcoatRoughness={0.18}
          />
        </mesh>

        {quality !== 'low' && (
          <Html center distanceFactor={9} style={{ pointerEvents: 'none' }}>
            <div
              style={{
                padding: '4px 8px',
                borderRadius: '999px',
                border: '1px solid rgba(255,255,255,.08)',
                background: 'rgba(0,0,0,.32)',
                color: 'white',
                font: '600 12px Satoshi, sans-serif',
                whiteSpace: 'nowrap'
              }}
            >
              {knowledgeMode ? KNOWLEDGE_DOMAINS[id]?.wikiSection?.toUpperCase() || id : id}
            </div>
          </Html>
        )}

        {hovered && quality !== 'low' && (
          <Html position={[0, 0.78, 0]} center distanceFactor={14} style={{ pointerEvents: 'none' }}>
            <div
              style={{
                minWidth: 170,
                padding: '10px 12px',
                borderRadius: 12,
                background: 'rgba(7,7,7,.86)',
                border: '1px solid rgba(255,255,255,.08)',
                color: '#fff',
                font: '500 12px Satoshi, sans-serif'
              }}
            >
              <strong style={{ display: 'block', marginBottom: 4 }}>
                {knowledgeMode ? KNOWLEDGE_DOMAINS[id]?.name : REGION_INFO[id].name}
              </strong>
              <span style={{ color: '#aaa', lineHeight: 1.5 }}>
                {knowledgeMode ? KNOWLEDGE_DOMAINS[id]?.role : REGION_INFO[id].role}
              </span>
            </div>
          </Html>
        )}
      </group>
    </Select>
  );
}

function BrainEdges({ weights, quality }) {
  return LINKS.map(([a, b]) => {
    const key = `${a}\u2192${b}`;
    const w = weights[key] ?? 0.2;
    const color = key === 'BG\u2192THL' ? '#dd6974' : '#4fa8b3';

    return (
      <Line
        key={key}
        points={[POSITIONS[a], POSITIONS[b]]}
        color={color}
        lineWidth={(quality === 'low' ? 0.8 : 1) + w * 1.8}
        transparent
        opacity={0.16 + w * 0.35}
      />
    );
  });
}

function SignalParticles({ regions, quality }) {
  const ref = useRef();
  const tempStart = useMemo(() => new THREE.Vector3(), []);
  const tempEnd = useMemo(() => new THREE.Vector3(), []);
  const density = quality === 'ultra' ? 4 : quality === 'high' ? 3 : 2;

  const particles = useMemo(() => {
    const arr = [];
    LINKS.forEach(([a, b], i) => {
      for (let j = 0; j < density; j++) {
        arr.push({
          a,
          b,
          offset: Math.random(),
          speed: 0.14 + Math.random() * 0.18,
          i: `${i}-${j}`
        });
      }
    });
    return arr;
  }, [density]);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const children = ref.current.children;

    for (let idx = 0; idx < children.length; idx++) {
      const child = children[idx];
      const p = particles[idx];
      tempStart.fromArray(POSITIONS[p.a]);
      tempEnd.fromArray(POSITIONS[p.b]);

      const alpha = (t * p.speed + p.offset + regions[p.a] * 0.35) % 1;
      child.position.lerpVectors(tempStart, tempEnd, alpha);

      const s = 0.03 + regions[p.a] * 0.04;
      child.scale.setScalar(s);
    }
  });

  const segments = quality === 'low' ? 6 : 8;

  return (
    <group ref={ref}>
      {particles.map((p) => (
        <mesh key={p.i} frustumCulled>
          <sphereGeometry args={[0.05, segments, segments]} />
          <meshBasicMaterial color="#c5f3ff" transparent opacity={0.78} />
        </mesh>
      ))}
    </group>
  );
}

export default function BrainScene({ regions, weights, selected, onSelect, quality, onQualityChange, knowledgeMode, affectOverride }) {
  const dpr = quality === 'ultra' ? [1, 2] : quality === 'high' ? [1, 1.5] : 1;

  return (
    <Canvas
      camera={{ position: [0, 1.5, 9], fov: 50 }}
      onPointerMissed={() => onSelect(null)}
      dpr={dpr}
      gl={{ antialias: quality !== 'low', powerPreference: 'high-performance' }}
    >
      <PerformanceMonitor
        onDecline={() => onQualityChange((q) => (q === 'ultra' ? 'high' : 'low'))}
        onIncline={() => onQualityChange((q) => (q === 'low' ? 'high' : q))}
      />

      <color attach="background" args={['#050607']} />
      <fog attach="fog" args={['#050607', 10, 22]} />
      <ambientLight intensity={0.8} />
      <directionalLight position={[4, 6, 5]} intensity={quality === 'low' ? 1 : 1.2} />
      <pointLight position={[-5, 3, 4]} intensity={quality === 'low' ? 0.7 : 0.9} color="#4fa8b3" />

      {quality !== 'low' && (
        <Stars
          radius={22}
          depth={18}
          count={quality === 'ultra' ? 1500 : 1000}
          factor={2.2}
          saturation={0}
          fade
          speed={0.6}
        />
      )}

      <FocusController selected={selected} />

      <Selection>
        {quality !== 'low' && (
          <EffectComposer multisampling={quality === 'ultra' ? 8 : 4} autoClear={false}>
            <Outline
              blur
              visibleEdgeColor="#c5f3ff"
              edgeStrength={quality === 'ultra' ? 4 : 3}
              width={quality === 'ultra' ? 700 : 500}
            />
            {quality === 'ultra' && (
              <Bloom
                luminanceThreshold={0.6}
                luminanceSmoothing={0.4}
                intensity={0.8}
                mipmapBlur
              />
            )}
          </EffectComposer>
        )}

        {quality === 'low' && <BrainEdges weights={weights} quality={quality} />}

        <NeuralFlowGrid regions={regions} weights={weights} quality={quality} />

        <SignalParticles regions={regions} quality={quality} />

        {Object.keys(POSITIONS).map((name) => (
          <BrainNode
            key={name}
            id={name}
            activity={regions[name]}
            selected={selected === name}
            onSelect={onSelect}
            quality={quality}
            knowledgeMode={knowledgeMode}
            affectOverride={affectOverride}
          />
        ))}
      </Selection>

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -3.1, 0]} frustumCulled>
        <circleGeometry args={[5.2, quality === 'low' ? 24 : 40]} />
        <meshBasicMaterial color="#113036" transparent opacity={0.12} />
      </mesh>

      <OrbitControls enableDamping minDistance={4.5} maxDistance={16} />
      <Environment preset="night" />
    </Canvas>
  );
}
