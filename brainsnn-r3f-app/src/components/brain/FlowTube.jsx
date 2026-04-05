import React, { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { flowTubeVertexShader, flowTubeFragmentShader } from './FlowTubeShader';
import { buildArcCurve } from './flowGridUtils';

export default function FlowTube({
  from,
  to,
  activity = 0,
  weight = 0.3,
  baseColor = [0.31, 0.66, 0.70],
  pulseColor = [0.77, 0.95, 1.0],
  quality = 'high',
  isSecondary = false,
  pulseActive = false,
  pulseOrigin = 0
}) {
  const matRef = useRef();
  const pulseTimeRef = useRef(-1);

  const tubularSegments = quality === 'ultra' ? 64 : quality === 'high' ? 48 : 16;
  const radialSegments = quality === 'ultra' ? 12 : quality === 'high' ? 8 : 4;
  const radius = isSecondary ? 0.015 : 0.032;

  const geometry = useMemo(() => {
    const fromArr = Array.isArray(from[0]) ? from : from;
    const toArr = Array.isArray(to[0]) ? to : to;
    const curve = buildArcCurve(fromArr, toArr, isSecondary ? 0.15 : 0.35);
    return new THREE.TubeGeometry(curve, tubularSegments, radius, radialSegments, false);
  }, [from, to, tubularSegments, radialSegments, radius, isSecondary]);

  const uniforms = useMemo(() => ({
    uTime: { value: 0 },
    uActivity: { value: 0 },
    uWeight: { value: weight },
    uPulseTime: { value: -1.0 },
    uPulseOrigin: { value: 0.0 },
    uBaseColor: { value: new THREE.Color(...baseColor) },
    uPulseColor: { value: new THREE.Color(...pulseColor) }
  }), []);

  useFrame((state) => {
    if (!matRef.current) return;
    const u = matRef.current.uniforms;

    u.uTime.value = state.clock.elapsedTime;
    u.uActivity.value = activity;
    u.uWeight.value = weight;

    // Pulse lifecycle
    if (pulseActive && pulseTimeRef.current < 0) {
      pulseTimeRef.current = 0;
      u.uPulseOrigin.value = pulseOrigin;
    }

    if (pulseTimeRef.current >= 0) {
      pulseTimeRef.current += 0.018;
      u.uPulseTime.value = pulseTimeRef.current;

      if (pulseTimeRef.current > 1.0) {
        pulseTimeRef.current = -1;
        u.uPulseTime.value = -1.0;
      }
    }
  });

  if (quality === 'low' && isSecondary) return null;

  return (
    <mesh geometry={geometry} frustumCulled>
      <shaderMaterial
        ref={matRef}
        vertexShader={flowTubeVertexShader}
        fragmentShader={flowTubeFragmentShader}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}
