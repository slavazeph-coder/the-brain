// Feed the Fly Brain — the WebGL scene.
//
// Lazy-loaded, and on the three-importer allowlist (check-three-imports.mjs).
// Every dot is a real neuron at its real position in the FlyWire fruit-fly
// brain; the glass shell is the published whole-brain outline. Activity comes
// from the Shiu et al. model in flyCircuit.js, stepped here in slow motion so a
// signal can be followed from the taste neurons to MN9 by eye.
import React, { memo, useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { createFlySim, dequantize, KIND, SHIU } from './flyCircuit.js';

// A quarter of real time: fast enough to feel alive, slow enough to see a
// signal travel. The Hz readouts are always in model time.
const SLOW_MOTION = 0.25;
const MAX_STEPS_PER_FRAME = 400;
const FLASH_MS = 14; // how long a spike glows, in model time
const STATS_EVERY = 0.12; // seconds between HUD updates
const BRAIN_WIDTH = 9.6; // world units across the brain's widest axis

const COLORS = {
  [KIND.sugar]: '#ffcf5a',
  [KIND.bitter]: '#fb7185',
  [KIND.mn9]: '#73efba',
  [KIND.sensory]: '#5c7aa8',
  [KIND.ascending]: '#4f6f9a',
  [KIND.descending]: '#7a64c9',
  [KIND.motor]: '#3fa7a0',
  [KIND.central]: '#34466a',
};
const DEFAULT_COLOR = '#34466a';
const FLASH = new THREE.Color('#e9fdff');

const SHELL_VERTEX = /* glsl */ `
  varying vec3 vNormalV;
  varying vec3 vViewPos;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vViewPos = -mv.xyz;
    vNormalV = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * mv;
  }
`;

const SHELL_FRAGMENT = /* glsl */ `
  uniform vec3 uRim;
  uniform vec3 uCore;
  varying vec3 vNormalV;
  varying vec3 vViewPos;
  void main() {
    vec3 n = normalize(vNormalV);
    if (!gl_FrontFacing) n = -n;
    float ndv = clamp(dot(n, normalize(vViewPos)), 0.0, 1.0);
    float rim = pow(1.0 - ndv, 2.4);
    vec3 col = mix(uCore, uRim, rim);
    gl_FragColor = vec4(col, 0.04 + rim * 0.42);
    #include <colorspace_fragment>
  }
`;

function makeGlowTexture() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.3, 'rgba(255,255,255,0.45)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** FlyWire space (micrometres; y down, z into the brain) to a centred, upright world. */
function placer(circuit) {
  const mesh = dequantize(circuit.meshPosition, circuit.bbox);
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < mesh.length; i += 1) {
    const axis = i % 3;
    lo[axis] = Math.min(lo[axis], mesh[i]);
    hi[axis] = Math.max(hi[axis], mesh[i]);
  }
  const centre = lo.map((value, axis) => (value + hi[axis]) / 2);
  const scale = BRAIN_WIDTH / (hi[0] - lo[0]);
  const place = (values) => {
    const out = new Float32Array(values.length);
    for (let i = 0; i < values.length; i += 3) {
      out[i] = (values[i] - centre[0]) * scale;
      out[i + 1] = -(values[i + 1] - centre[1]) * scale;
      out[i + 2] = -(values[i + 2] - centre[2]) * scale;
    }
    return out;
  };
  return { mesh: place(mesh), neurons: place(dequantize(circuit.position, circuit.bbox)) };
}

/** Keep the whole brain in frame at any aspect: a phone needs the camera further back. */
function Framing() {
  const { camera, size } = useThree();
  useEffect(() => {
    const aspect = size.width / Math.max(1, size.height);
    const tan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const halfWidth = BRAIN_WIDTH * 0.56;
    const halfHeight = BRAIN_WIDTH * 0.36;
    const distance = Math.max(halfHeight / tan, halfWidth / (tan * aspect));
    camera.position.set(0, distance * 0.045, distance);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
  }, [camera, size.width, size.height]);
  return null;
}

function Fly({ circuit, apiRef, onStats, reducedMotion }) {
  const sim = useMemo(() => createFlySim(circuit, { seed: 13 }), [circuit]);
  const placed = useMemo(() => placer(circuit), [circuit]);
  const glowTexture = useMemo(() => makeGlowTexture(), []);
  const shellGeometry = useMemo(() => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(placed.mesh, 3));
    geometry.setIndex(new THREE.BufferAttribute(new Uint16Array(circuit.meshIndex), 1));
    geometry.computeVertexNormals();
    return geometry;
  }, [placed, circuit]);
  const shellMaterial = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: SHELL_VERTEX,
    fragmentShader: SHELL_FRAGMENT,
    uniforms: { uRim: { value: new THREE.Color('#68eaff') }, uCore: { value: new THREE.Color('#947cff') } },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  }), []);
  const baseColors = useMemo(() => {
    const colors = new Float32Array(circuit.n * 3);
    const color = new THREE.Color();
    for (let i = 0; i < circuit.n; i += 1) {
      color.set(COLORS[circuit.kind[i]] || DEFAULT_COLOR);
      colors.set([color.r, color.g, color.b], i * 3);
    }
    return colors;
  }, [circuit]);
  const neuronsRef = useRef();
  const mn9GlowRef = useRef();
  const statsClock = useRef(0);

  useEffect(() => () => {
    shellGeometry.dispose();
    shellMaterial.dispose();
    glowTexture.dispose();
  }, [shellGeometry, shellMaterial, glowTexture]);

  // Place every neuron once; taste and readout neurons are drawn larger.
  useEffect(() => {
    const mesh = neuronsRef.current;
    if (!mesh) return;
    const object = new THREE.Object3D();
    for (let i = 0; i < circuit.n; i += 1) {
      const kind = circuit.kind[i];
      object.position.set(placed.neurons[i * 3], placed.neurons[i * 3 + 1], placed.neurons[i * 3 + 2]);
      object.scale.setScalar(kind === KIND.mn9 ? 0.2 : kind === KIND.sugar || kind === KIND.bitter ? 0.1 : 0.045);
      object.updateMatrix();
      mesh.setMatrixAt(i, object.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor = new THREE.InstancedBufferAttribute(baseColors.slice(), 3);
    if (mn9GlowRef.current && circuit.mn9 >= 0) {
      mn9GlowRef.current.position.set(placed.neurons[circuit.mn9 * 3], placed.neurons[circuit.mn9 * 3 + 1], placed.neurons[circuit.mn9 * 3 + 2]);
    }
  }, [circuit, placed, baseColors]);

  useEffect(() => {
    apiRef.current = {
      feed(taste, rateHz) { sim.setTaste(taste, rateHz); },
      stop() { sim.setTaste(null); },
      reset() { sim.reset(); },
    };
    return () => { apiRef.current = null; };
  }, [apiRef, sim]);

  useFrame((_state, delta) => {
    const steps = Math.min(MAX_STEPS_PER_FRAME, Math.round((Math.min(delta, 0.1) * 1000 * SLOW_MOTION) / SHIU.dt));
    sim.step(steps);
    const now = sim.timeMs;

    // Each neuron glows for a moment after it fires.
    const mesh = neuronsRef.current;
    if (mesh?.instanceColor) {
      const colors = mesh.instanceColor.array;
      const { lastSpike } = sim;
      for (let i = 0; i < circuit.n; i += 1) {
        const glow = Math.exp(-(now - lastSpike[i]) / FLASH_MS);
        const o = i * 3;
        colors[o] = baseColors[o] + (FLASH.r * 1.6 - baseColors[o]) * glow;
        colors[o + 1] = baseColors[o + 1] + (FLASH.g * 1.6 - baseColors[o + 1]) * glow;
        colors[o + 2] = baseColors[o + 2] + (FLASH.b * 1.6 - baseColors[o + 2]) * glow;
      }
      mesh.instanceColor.needsUpdate = true;
    }

    const mn9Hz = sim.mn9Rate(500);
    const halo = mn9GlowRef.current;
    if (halo) {
      const level = Math.min(1, mn9Hz / 120);
      halo.scale.setScalar(0.6 + level * 2.6);
      halo.material.opacity = 0.15 + level * 0.8;
    }

    statsClock.current += delta;
    if (statsClock.current >= STATS_EVERY) {
      statsClock.current = 0;
      onStats?.({ mn9Hz, active: sim.activeCount, timeMs: now });
    }
  });

  return (
    <>
      <OrbitControls
        enablePan={false}
        enableZoom={false}
        autoRotate={!reducedMotion}
        autoRotateSpeed={0.55}
        rotateSpeed={0.6}
        minPolarAngle={Math.PI * 0.2}
        maxPolarAngle={Math.PI * 0.8}
      />
      <mesh geometry={shellGeometry} material={shellMaterial} renderOrder={2} />
      <instancedMesh ref={neuronsRef} args={[null, null, circuit.n]} frustumCulled={false}>
        <icosahedronGeometry args={[1, 1]} />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>
      <sprite ref={mn9GlowRef} renderOrder={3}>
        <spriteMaterial map={glowTexture} color="#73efba" transparent opacity={0.15} depthWrite={false} blending={THREE.AdditiveBlending} />
      </sprite>
    </>
  );
}

function FlyBrainScene({ circuit, apiRef, onStats, reducedMotion = false, onReady }) {
  return (
    <Canvas
      className="fly-canvas"
      dpr={[1, 1.6]}
      flat
      camera={{ fov: 38, near: 0.1, far: 100, position: [0, 0.6, 13.5] }}
      gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
      onCreated={() => onReady?.()}
    >
      <Framing />
      <Fly circuit={circuit} apiRef={apiRef} onStats={onStats} reducedMotion={reducedMotion} />
    </Canvas>
  );
}

export default memo(FlyBrainScene);
