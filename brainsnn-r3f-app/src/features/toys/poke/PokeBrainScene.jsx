// Poke the Brain — the WebGL scene.
//
// Lazy-loaded, and one of the few modules allowed to import three (see
// scripts/check-three-imports.mjs). It renders the same seven-region connectome
// the rest of the site uses — positions, colours and pathway curves all come
// from brainRegions.js — inside a procedurally generated jelly shell, and turns
// pointer input into the impulses, pulses and cascades that jellyPhysics.js
// computes. No per-vertex simulation runs on the CPU: every frame writes a few
// dozen floats of uniforms and the vertex shader does the wobble.
import React, { memo, useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Line } from '@react-three/drei';
import { BRAIN_REGIONS, PATHWAYS, REGION_MAP, pathwayControlPoint, pointOnPathway } from '../../brain3d/brainRegions.js';
import { buildBrainShell, SHELL, surfacePointToward } from './brainShell.js';
import {
  addImpulse,
  addPulse,
  advanceCascade,
  createJellyState,
  createUniformTarget,
  dragHeldVector,
  fireRegion,
  hopProgress,
  JELLY,
  motionConfig,
  nearestRegion,
  pruneJelly,
  releaseHeld,
  shakeSchedule,
  writeUniforms,
} from './jellyPhysics.js';

const CYAN = '#68eaff';
const VIOLET = '#947cff';
const MINT = '#73efba';
const INHIBIT = '#fb7185';

const HOP_TRAIL = 3;
const MAX_HOP_INSTANCES = 40 * HOP_TRAIL;
const IDLE_ROTATE_AFTER = 2.4; // seconds without input before auto-rotate resumes
const AMBIENT_EVERY = 3.4; // an idle brain still flickers now and then

const VERTEX = /* glsl */ `
  #define MAX_IMP ${JELLY.maxImpulses}
  uniform vec4 uImp[MAX_IMP];
  uniform vec4 uImpDir[MAX_IMP];
  uniform vec4 uSquash;
  uniform vec3 uCenter;
  uniform float uTime;
  uniform float uBreath;
  attribute float aFold;
  varying vec3 vRest;
  varying vec3 vNormalV;
  varying vec3 vViewPos;
  varying float vFold;
  varying float vDent;

  void main() {
    vec3 p = position;
    vec3 n = normal;
    vec3 grad = vec3(0.0);
    float dent = 0.0;
    for (int i = 0; i < MAX_IMP; i++) {
      float r = uImpDir[i].w;
      if (r <= 0.0) continue;
      vec3 d = position - uImp[i].xyz;
      float f = exp(-dot(d, d) / (r * r));
      float a = uImp[i].w * f;
      p += uImpDir[i].xyz * a;
      dent += a;
      // Gradient of the displacement height along the normal, so a dent
      // actually tilts the surface and catches the light.
      grad += (a * dot(uImpDir[i].xyz, n)) * (-2.0 * d / (r * r));
    }
    n = normalize(n - (grad - dot(grad, n) * n));

    // Squash and stretch the whole body about its centre along the poke axis.
    vec3 q = p - uCenter;
    float along = dot(q, uSquash.xyz);
    q += uSquash.xyz * along * uSquash.w - (q - uSquash.xyz * along) * (uSquash.w * 0.5);
    q *= 1.0 + uBreath * sin(uTime * 1.25);
    p = uCenter + q;

    vRest = position;
    vFold = aFold;
    vDent = dent;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vViewPos = -mv.xyz;
    vNormalV = normalize(normalMatrix * n);
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAGMENT = /* glsl */ `
  #define MAX_PULSE ${JELLY.maxPulses}
  uniform vec3 uCyan;
  uniform vec3 uViolet;
  uniform vec4 uPulse[MAX_PULSE];
  uniform float uPulseSpeed;
  uniform float uPulseWidth;
  uniform float uPulseLife;
  uniform float uFront;
  varying vec3 vRest;
  varying vec3 vNormalV;
  varying vec3 vViewPos;
  varying float vFold;
  varying float vDent;

  void main() {
    vec3 n = normalize(vNormalV);
    if (uFront < 0.5) n = -n;
    vec3 v = normalize(vViewPos);
    float ndv = clamp(dot(n, v), 0.0, 1.0);
    float fres = pow(1.0 - ndv, 2.3);

    // Cyan at the frontal pole to violet at the occipital pole — the site's two
    // identity colours, carried across the object instead of painted on it.
    float t = smoothstep(-5.4, 5.4, vRest.x);
    vec3 body = mix(uViolet, uCyan, t);
    float fold = vFold;

    vec3 L = normalize(vec3(0.35, 0.85, 0.55));
    vec3 H = normalize(L + v);
    float diff = max(dot(n, L), 0.0);
    float spec = pow(max(dot(n, H), 0.0), 72.0) * (0.3 + 0.7 * fold);

    // 1 at the bottom of a sulcus, 0 on a gyrus crest.
    float groove = 1.0 - smoothstep(0.0, 0.7, fold);

    vec3 col = body * (0.07 + 0.17 * fold);
    col += body * diff * 0.24 * (0.3 + 0.7 * fold);
    col += body * fres * 1.15 * (0.45 + 0.55 * fold);
    // Sulci read as dark creases, which is most of what makes it a brain.
    col *= 1.0 - groove * 0.6;

    float glow = 0.0;
    for (int i = 0; i < MAX_PULSE; i++) {
      float age = uPulse[i].w;
      if (age < 0.0) continue;
      float d = distance(vRest, uPulse[i].xyz);
      float front = age * uPulseSpeed;
      float ring = exp(-pow((d - front) / uPulseWidth, 2.0));
      float core = exp(-d * d / 0.5) * exp(-age * 6.0);
      float fade = 1.0 - smoothstep(0.0, uPulseLife, age);
      // Pulses ride the gyri: brighter on the crests, faint in the sulci.
      glow += (ring * (0.25 + 1.0 * fold) + core * 0.9) * fade;
    }
    // Saturating, so ten overlapping pulses glow brighter than one without
    // blowing the whole surface out to white.
    glow = 1.0 - exp(-glow * 1.3);
    vec3 glowCol = mix(uCyan, vec3(0.93, 0.99, 1.0), 0.3);
    col += glowCol * glow * 1.25;
    col += vec3(0.85, 0.97, 1.0) * spec;
    col += uCyan * clamp(abs(vDent), 0.0, 1.0) * 0.22;

    float alpha = 0.1 + fres * 0.7 * (0.5 + 0.5 * fold) + glow * 0.5 + spec * 0.55 + groove * 0.16;
    if (uFront < 0.5) alpha *= 0.4;
    gl_FragColor = vec4(col, clamp(alpha, 0.0, 0.95));
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
  gradient.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  gradient.addColorStop(0.6, 'rgba(255,255,255,0.12)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function geometryFromShell(shell) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(shell.positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(shell.normals, 3));
  geometry.setAttribute('aFold', new THREE.BufferAttribute(shell.folds, 1));
  geometry.setIndex(new THREE.BufferAttribute(shell.indices, 1));
  geometry.computeBoundingSphere();
  return geometry;
}

function makeShellMaterial(side, sharedUniforms) {
  return new THREE.ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: { ...sharedUniforms, uFront: { value: side === THREE.BackSide ? 0 : 1 } },
    side,
    transparent: true,
    depthWrite: false,
  });
}

/** Pathway axons, drawn from the same curve helper the rest of the site uses. */
function Axons() {
  const lines = useMemo(() => PATHWAYS.map((pathway) => ({
    id: pathway.id,
    color: pathway.inhibitory ? INHIBIT : CYAN,
    points: [REGION_MAP[pathway.from].position, pathwayControlPoint(pathway), REGION_MAP[pathway.to].position]
      .map((point) => new THREE.Vector3(...point)),
  })), []);
  return (
    <group>
      {lines.map((line) => (
        <Line
          key={line.id}
          points={new THREE.QuadraticBezierCurve3(...line.points).getPoints(24)}
          color={line.color}
          lineWidth={1.4}
          transparent
          opacity={0.26}
          depthWrite={false}
        />
      ))}
    </group>
  );
}

function Controller({
  simRef,
  apiRef,
  callbacksRef,
  detail,
  reducedMotion,
  seed,
}) {
  const { camera, gl, size, invalidate } = useThree();
  const cfg = useMemo(() => motionConfig(reducedMotion), [reducedMotion]);

  const shell = useMemo(() => buildBrainShell(detail), [detail]);
  const proxyShell = useMemo(() => buildBrainShell('proxy'), []);
  const geometry = useMemo(() => geometryFromShell(shell), [shell]);
  const proxyGeometry = useMemo(() => geometryFromShell(proxyShell), [proxyShell]);
  const glowTexture = useMemo(() => makeGlowTexture(), []);

  const uniformTarget = useMemo(() => createUniformTarget(), []);
  const sharedUniforms = useMemo(() => ({
    uImp: { value: uniformTarget.impulses },
    uImpDir: { value: uniformTarget.dirs },
    uSquash: { value: new THREE.Vector4(0, 1, 0, 0) },
    uCenter: { value: new THREE.Vector3(...SHELL.center) },
    uTime: { value: 0 },
    uBreath: { value: reducedMotion ? 0 : 0.006 },
    uCyan: { value: new THREE.Color(CYAN) },
    uViolet: { value: new THREE.Color(VIOLET) },
    uPulse: { value: uniformTarget.pulses },
    uPulseSpeed: { value: cfg.pulseSpeed },
    uPulseWidth: { value: cfg.pulseWidth },
    uPulseLife: { value: cfg.pulseLife },
  }), [uniformTarget, cfg, reducedMotion]);
  const backMaterial = useMemo(() => makeShellMaterial(THREE.BackSide, sharedUniforms), [sharedUniforms]);
  const frontMaterial = useMemo(() => makeShellMaterial(THREE.FrontSide, sharedUniforms), [sharedUniforms]);

  useEffect(() => () => {
    geometry.dispose();
    proxyGeometry.dispose();
    glowTexture.dispose();
    backMaterial.dispose();
    frontMaterial.dispose();
  }, [geometry, proxyGeometry, glowTexture, backMaterial, frontMaterial]);

  const groupRef = useRef();
  const proxyRef = useRef();
  const nodeRefs = useRef({});
  const haloRefs = useRef({});
  const hopMeshRef = useRef();
  const jellyRef = useRef(createJellyState());
  const clockRef = useRef(0);
  const flashRef = useRef(Object.fromEntries(BRAIN_REGIONS.map((region) => [region.code, 0])));
  const rotationRef = useRef({ yaw: -0.5, pitch: 0.12, velocity: 0, lastInput: -10 });
  const dragRef = useRef(null);
  const pendingShakeRef = useRef([]);
  const ambientRef = useRef({ at: 0.6 - AMBIENT_EVERY, index: 0 });
  const lastFiredRef = useRef(0);
  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  const pointer = useMemo(() => new THREE.Vector2(), []);
  const scratch = useMemo(() => ({
    object: new THREE.Object3D(),
    color: new THREE.Color(),
    local: new THREE.Vector3(),
    normal: new THREE.Vector3(),
    world: new THREE.Vector3(),
    delta: new THREE.Vector3(),
    inverse: new THREE.Matrix4(),
    rotation: new THREE.Matrix3(),
  }), []);

  // Frame the brain for the current aspect ratio: a portrait phone needs the
  // camera further back than a landscape laptop to keep the whole thing in.
  useEffect(() => {
    const aspect = size.width / Math.max(1, size.height);
    const halfWidth = 5.9;
    const halfHeight = 4.2;
    const tan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const distance = Math.max(halfHeight / tan, halfWidth / (tan * aspect));
    camera.position.set(0.4, 1.4, distance);
    camera.lookAt(SHELL.center[0], SHELL.center[1] - 0.1, SHELL.center[2]);
    camera.updateProjectionMatrix();
    invalidate();
  }, [camera, size.width, size.height, invalidate]);

  // --- interaction ---------------------------------------------------------
  function raycastProxy(clientX, clientY) {
    const rect = gl.domElement.getBoundingClientRect();
    pointer.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const proxy = proxyRef.current;
    if (!proxy) return null;
    const [hit] = raycaster.intersectObject(proxy, false);
    return hit || null;
  }

  function hitTest(clientX, clientY) {
    const hit = raycastProxy(clientX, clientY);
    if (!hit) return null;
    const proxy = proxyRef.current;
    scratch.local.copy(hit.point);
    proxy.worldToLocal(scratch.local);
    scratch.normal.copy(hit.face.normal).normalize();
    return {
      origin: [scratch.local.x, scratch.local.y, scratch.local.z],
      inward: [-scratch.normal.x, -scratch.normal.y, -scratch.normal.z],
      // The grabbed point in world space and its NDC depth, so a drag can
      // follow the pointer in the plane the point sits in.
      world: hit.point.clone(),
      depth: hit.point.clone().project(camera).z,
    };
  }

  function poke(hit, now, { held = false, amplitude } = {}) {
    let state = jellyRef.current;
    const added = addImpulse(state, {
      origin: hit.origin,
      dir: hit.inward,
      amplitude: held ? 0 : (amplitude ?? cfg.pokeAmplitude),
      radius: held ? cfg.grabRadius : cfg.pokeRadius,
      at: now,
      held,
    }, cfg);
    state = addPulse(added.state, hit.origin, now, cfg);
    const region = nearestRegion(hit.origin);
    state = fireRegion(state, region, now, 0, cfg);
    // The poke itself is a signal too.
    state = { ...state, fired: state.fired + 1 };
    if (!held) {
      state = { ...state, squash: { axis: hit.inward, amount: Math.min(cfg.squashMax, (amplitude ?? cfg.pokeAmplitude) * cfg.squashGain), at: now } };
    }
    jellyRef.current = state;
    flashRef.current[region] = 1;
    callbacksRef.current.onPoke?.(region);
    return added.id;
  }

  useEffect(() => {
    const element = gl.domElement;

    function onPointerDown(event) {
      if (event.button !== undefined && event.button !== 0) return;
      const now = clockRef.current;
      rotationRef.current.lastInput = now;
      const hit = hitTest(event.clientX, event.clientY);
      if (hit) {
        const id = poke(hit, now, { held: true });
        dragRef.current = { kind: 'poke', id, x: event.clientX, y: event.clientY, world: hit.world, depth: hit.depth, pointerId: event.pointerId };
      } else {
        dragRef.current = { kind: 'rotate', x: event.clientX, y: event.clientY, lastX: event.clientX, pointerId: event.pointerId };
      }
    }

    function onPointerMove(event) {
      const drag = dragRef.current;
      if (!drag) {
        // Cheap hover feedback against the coarse proxy only.
        if (event.pointerType === 'mouse' && event.target === element) {
          element.style.cursor = raycastProxy(event.clientX, event.clientY) ? 'grab' : 'default';
        }
        return;
      }
      if (drag.pointerId !== event.pointerId) return;
      rotationRef.current.lastInput = clockRef.current;
      if (drag.kind === 'poke') {
        // Where the pointer is now, at the depth of the grabbed point: the
        // handful follows it in the screen plane. Convert that world-space
        // pull into the brain's own (rotated) space for the shader.
        const rect = element.getBoundingClientRect();
        scratch.world.set(
          ((event.clientX - rect.left) / rect.width) * 2 - 1,
          -((event.clientY - rect.top) / rect.height) * 2 + 1,
          drag.depth,
        ).unproject(camera);
        scratch.delta.copy(scratch.world).sub(drag.world);
        scratch.inverse.copy(groupRef.current.matrixWorld).invert();
        scratch.rotation.setFromMatrix4(scratch.inverse);
        scratch.delta.applyMatrix3(scratch.rotation);
        jellyRef.current = dragHeldVector(jellyRef.current, drag.id, [scratch.delta.x, scratch.delta.y, scratch.delta.z], cfg);
        element.style.cursor = 'grabbing';
      } else {
        const dx = event.clientX - drag.lastX;
        drag.lastX = event.clientX;
        rotationRef.current.yaw += dx * 0.006;
        rotationRef.current.velocity = dx * 0.006 * 60;
      }
    }

    function onPointerUp(event) {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      if (drag.kind === 'poke') {
        jellyRef.current = releaseHeld(jellyRef.current, drag.id, clockRef.current, cfg);
      }
      dragRef.current = null;
      if (event.pointerType === 'mouse') element.style.cursor = 'grab';
    }

    element.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    return () => {
      element.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
    };
    // hitTest/poke read refs only; re-binding on every render is unnecessary.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gl, camera, cfg]);

  // --- imperative API for the HUD ------------------------------------------
  useEffect(() => {
    apiRef.current = {
      shake() {
        const now = clockRef.current;
        rotationRef.current.lastInput = now;
        pendingShakeRef.current = shakeSchedule(`${seed}-${Math.floor(now * 10)}`, 6).map((entry) => ({ ...entry, due: now + entry.delay }));
      },
      reset() {
        jellyRef.current = createJellyState();
        pendingShakeRef.current = [];
        for (const code of Object.keys(flashRef.current)) flashRef.current[code] = 0;
        lastFiredRef.current = 0;
        callbacksRef.current.onFired?.(0);
      },
      pokeAt(clientX, clientY) {
        const hit = hitTest(clientX, clientY);
        if (!hit) return false;
        poke(hit, clockRef.current);
        return true;
      },
      canvas: gl.domElement,
    };
    return () => { apiRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gl, seed, cfg]);

  // --- per frame ------------------------------------------------------------
  useFrame((_state, delta) => {
    const dt = Math.min(delta, 1 / 20);
    clockRef.current += dt;
    const now = clockRef.current;
    sharedUniforms.uTime.value = now;

    // Scheduled shake pokes land on the surface along their directions.
    if (pendingShakeRef.current.length) {
      const due = pendingShakeRef.current.filter((entry) => entry.due <= now);
      if (due.length) {
        pendingShakeRef.current = pendingShakeRef.current.filter((entry) => entry.due > now);
        for (const entry of due) {
          const [dx, dy, dz] = entry.direction;
          const [rx, ry, rz] = SHELL.radii;
          const k = 1 / Math.hypot(dx / rx, dy / ry, dz / rz);
          const origin = [SHELL.center[0] + dx * k, SHELL.center[1] + dy * k, SHELL.center[2] + dz * k];
          const inward = [-dx / (rx * rx), -dy / (ry * ry), -dz / (rz * rz)];
          poke({ origin, inward }, now, { amplitude: entry.amplitude });
        }
      }
    }

    // An idle brain is not a dead one: now and then a faint ring rises from
    // a region. It is not counted as a fired signal — only pokes are.
    if (!reducedMotion && now - rotationRef.current.lastInput > IDLE_ROTATE_AFTER && now - ambientRef.current.at > AMBIENT_EVERY) {
      const region = BRAIN_REGIONS[ambientRef.current.index % BRAIN_REGIONS.length];
      ambientRef.current = { at: now, index: ambientRef.current.index + 3 };
      jellyRef.current = addPulse(jellyRef.current, surfacePointToward(region.position), now, cfg);
      flashRef.current[region.code] = Math.max(flashRef.current[region.code], 0.45);
    }

    // Signals: advance the cascade and fire the model at every arrival.
    const cascade = advanceCascade(jellyRef.current, now, cfg);
    jellyRef.current = pruneJelly(cascade.state, now, cfg);
    for (const arrival of cascade.arrivals) {
      flashRef.current[arrival.to] = Math.min(1, flashRef.current[arrival.to] + (arrival.inhibitory ? 0.2 : 0.7));
      callbacksRef.current.onArrive?.(arrival.to, arrival.depth, arrival.inhibitory);
    }
    const jelly = jellyRef.current;
    if (jelly.fired !== lastFiredRef.current) {
      lastFiredRef.current = jelly.fired;
      callbacksRef.current.onFired?.(jelly.fired);
    }

    // Uniforms, written in place by the same tested function the unit suite covers.
    writeUniforms(jelly, now, uniformTarget, cfg);
    const [sx, sy, sz, sw] = uniformTarget.squash;
    sharedUniforms.uSquash.value.set(sx, sy, sz, sw);

    // Rotation: drag with inertia, then an idle drift once hands are off.
    const rotation = rotationRef.current;
    if (!dragRef.current || dragRef.current.kind !== 'rotate') {
      rotation.yaw += rotation.velocity * dt;
      rotation.velocity *= Math.pow(0.04, dt);
      if (!reducedMotion && now - rotation.lastInput > IDLE_ROTATE_AFTER) rotation.yaw += 0.16 * dt;
    }
    if (groupRef.current) {
      groupRef.current.rotation.set(rotation.pitch, rotation.yaw, 0);
    }

    // Nodes: brightness from the live model plus a decaying flash per arrival.
    const activities = simRef.current?.activities || {};
    for (const region of BRAIN_REGIONS) {
      const flash = flashRef.current[region.code];
      flashRef.current[region.code] = Math.max(0, flash - dt * 1.6);
      const activity = activities[region.code] ?? region.baseActivity;
      const node = nodeRefs.current[region.code];
      if (node) node.scale.setScalar(0.24 + activity * 0.22 + flash * 0.22);
      const halo = haloRefs.current[region.code];
      if (halo) {
        halo.scale.setScalar(1.3 + activity * 1.6 + flash * 3.2);
        halo.material.opacity = 0.18 + activity * 0.35 + flash * 0.65;
      }
    }

    // Travelling signals: a short comet per in-flight hop, on the real curves.
    const mesh = hopMeshRef.current;
    if (mesh) {
      let index = 0;
      for (const hop of jelly.hops) {
        const progress = hopProgress(hop, now, cfg);
        for (let trail = 0; trail < HOP_TRAIL && index < MAX_HOP_INSTANCES; trail += 1) {
          const point = pointOnPathway(hop.pathwayId, progress - trail * 0.05);
          scratch.object.position.set(point[0], point[1], point[2]);
          scratch.object.scale.setScalar((0.2 - trail * 0.05) * (hop.depth === 0 ? 1.2 : 1));
          scratch.object.updateMatrix();
          mesh.setMatrixAt(index, scratch.object.matrix);
          scratch.color.set(hop.inhibitory ? INHIBIT : (hop.depth === 0 ? '#ffffff' : CYAN));
          mesh.setColorAt(index, scratch.color);
          index += 1;
        }
      }
      mesh.count = index;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  });

  return (
    <group ref={groupRef}>
      <Axons />
      {BRAIN_REGIONS.map((region) => (
        <group key={region.code} position={region.position}>
          <mesh ref={(node) => { nodeRefs.current[region.code] = node; }}>
            <sphereGeometry args={[1, 24, 24]} />
            <meshBasicMaterial color={region.color} toneMapped={false} />
          </mesh>
          <sprite ref={(sprite) => { haloRefs.current[region.code] = sprite; }}>
            <spriteMaterial map={glowTexture} color={region.color} transparent depthWrite={false} blending={THREE.AdditiveBlending} opacity={0.3} />
          </sprite>
        </group>
      ))}
      <instancedMesh ref={hopMeshRef} args={[null, null, MAX_HOP_INSTANCES]} frustumCulled={false}>
        <sphereGeometry args={[1, 10, 10]} />
        <meshBasicMaterial toneMapped={false} transparent opacity={0.95} blending={THREE.AdditiveBlending} depthWrite={false} />
      </instancedMesh>
      <mesh geometry={geometry} material={backMaterial} renderOrder={9} />
      <mesh geometry={geometry} material={frontMaterial} renderOrder={10} />
      <mesh ref={proxyRef} geometry={proxyGeometry} visible={false}>
        <meshBasicMaterial />
      </mesh>
      <sprite position={SHELL.center} scale={[18, 13, 1]} renderOrder={-1}>
        <spriteMaterial map={glowTexture} color={VIOLET} transparent opacity={0.1} depthWrite={false} blending={THREE.AdditiveBlending} />
      </sprite>
      <sprite position={[SHELL.center[0] + 2.5, SHELL.center[1] + 0.5, SHELL.center[2]]} scale={[10, 8, 1]} renderOrder={-1}>
        <spriteMaterial map={glowTexture} color={MINT} transparent opacity={0.05} depthWrite={false} blending={THREE.AdditiveBlending} />
      </sprite>
    </group>
  );
}

/**
 * Memoised on purpose: the simulation re-renders the page ~8 times a second,
 * and none of that should reach the WebGL tree. Everything live flows in
 * through refs.
 */
function PokeBrainScene({ simRef, apiRef, callbacksRef, detail = 'high', reducedMotion = false, active = true, onReady, seed = 'poke' }) {
  const dpr = detail === 'high' ? [1, 1.8] : [1, 1.35];
  return (
    <Canvas
      className="poke-canvas"
      dpr={dpr}
      flat
      frameloop={active ? 'always' : 'never'}
      camera={{ fov: 36, near: 0.1, far: 100, position: [0.4, 1.4, 17] }}
      gl={{ antialias: true, alpha: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' }}
      onCreated={() => onReady?.()}
    >
      <Controller
        simRef={simRef}
        apiRef={apiRef}
        callbacksRef={callbacksRef}
        detail={detail}
        reducedMotion={reducedMotion}
        seed={seed}
      />
    </Canvas>
  );
}

export default memo(PokeBrainScene);
