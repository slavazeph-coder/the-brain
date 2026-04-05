import React, { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { POSITIONS, REGION_INFO } from '../../data/network';

export default function PulseWave({ regionId, onComplete }) {
  const meshRef = useRef();
  const progressRef = useRef(0);
  const position = POSITIONS[regionId];
  const color = REGION_INFO[regionId]?.color || '#4fa8b3';

  useFrame((_, delta) => {
    if (!meshRef.current) return;

    progressRef.current += delta * 1.4;
    const t = progressRef.current;

    // Expand radius from 0.1 to 1.8
    const radius = 0.1 + t * 1.7;
    meshRef.current.scale.setScalar(radius);

    // Fade opacity from 0.4 to 0.0
    meshRef.current.material.opacity = Math.max(0, 0.4 * (1 - t));

    if (t >= 1.0) {
      onComplete?.();
    }
  });

  return (
    <mesh ref={meshRef} position={position}>
      <sphereGeometry args={[1, 20, 20]} />
      <meshBasicMaterial
        color={color}
        transparent
        opacity={0.4}
        side={THREE.BackSide}
        depthWrite={false}
      />
    </mesh>
  );
}
