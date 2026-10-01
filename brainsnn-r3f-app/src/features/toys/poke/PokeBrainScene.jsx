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
import { KNIFE, knifeOpacity, knifeY, PINCH, pinchAmount, pinchAxis, paletteById, sliceStep, sliceTargetFor, SLICE } from './jellyGestures.js';

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
  uniform vec4 uPinch;
  uniform float uSlice;
  attribute float aFold;
  varying vec3 vRest;
  varying vec3 vNormalV;
  varying vec3 vViewPos;
  varying float vFold;
  varying float vDent;
  varying float vCut;

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

    // Slice: a knife cut — each hemisphere slides apart along z (the brain's
    // left/right axis) as a rigid slab. Only a thin band at the midline
    // stretches, so the cut reads as a clean split, never a hinge or a turn.
    float sliceMask = smoothstep(0.02, 0.5, abs(position.z));
    p.z += sign(position.z) * uSlice * sliceMask;
    vCut = (1.0 - smoothstep(0.0, 1.2, abs(position.z))) * step(0.001, uSlice);

    // Squash and stretch the whole body about its centre along the poke axis.
    vec3 q = p - uCenter;
    float along = dot(q, uSquash.xyz);
    q += uSquash.xyz * along * uSquash.w - (q - uSquash.xyz * along) * (uSquash.w * 0.5);
    // Pinch: the same whole-body math along the two-finger axis — negative
    // squashes (fingers together), positive stretches (fingers apart).
    float palong = dot(q, uPinch.xyz);
    q += uPinch.xyz * palong * uPinch.w - (q - uPinch.xyz * palong) * (uPinch.w * 0.5);
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
  uniform vec3 uCutColor;
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
  varying float vCut;

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
    // Broad, juicy specular: the wet highlight that sells the jelly. It rides
    // the dent-tilted normals above, so highlights stretch as you poke.
    float spec = pow(max(dot(n, H), 0.0), 56.0) * (0.4 + 0.95 * fold);

    // 1 at the bottom of a sulcus, 0 on a gyrus crest.
    float groove = 1.0 - smoothstep(0.0, 0.7, fold);

    vec3 col = body * (0.07 + 0.17 * fold);
    col += body * diff * 0.24 * (0.3 + 0.7 * fold);
    col += body * fres * 1.15 * (0.45 + 0.55 * fold);
    // Sulci read as dark creases, which is most of what makes it a brain.
    col *= 1.0 - groove * 0.6;
    // A fresh slice glows like cut jelly.
    col = mix(col, uCutColor * (0.55 + 0.45 * fold), vCut * 0.85);

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
    // Dents glow faintly cyan: translucency faking the light scattering
    // through the jelly where it is thinnest.
    col += uCyan * clamp(abs(vDent), 0.0, 1.0) * 0.3;

    float alpha = 0.1 + fres * 0.7 * (0.5 + 0.5 * fold) + glow * 0.5 + spec * 0.55 + groove * 0.16 + vCut * 0.35;
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
function Axons({ color }) {
  const lines = useMemo(() => PATHWAYS.map((pathway) => ({
    id: pathway.id,
    color: pathway.inhibitory ? INHIBIT : color,
    points: [REGION_MAP[pathway.from].position, pathwayControlPoint(pathway), REGION_MAP[pathway.to].position]
      .map((point) => new THREE.Vector3(...point)),
  })), [color]);
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
  soundRef,
  palette,
  sliced,
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
    uPinch: { value: new THREE.Vector4(0, 1, 0, 0) },
    uSlice: { value: 0 },
    uCutColor: { value: new THREE.Color(palette.cut) },
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

  // A palette change re-tints the live uniforms in place — no geometry or
  // material rebuild, so the jelly never flickers.
  useEffect(() => {
    sharedUniforms.uCyan.value.set(palette.cyan);
    sharedUniforms.uViolet.value.set(palette.violet);
    sharedUniforms.uCutColor.value.set(palette.cut);
  }, [palette, sharedUniforms]);

  const groupRef = useRef();
  const proxyRef = useRef();
  const nodeRefs = useRef({});
  const haloRefs = useRef({});
  const hopMeshRef = useRef();
  const jellyRef = useRef(createJellyState());
  const clockRef = useRef(0);
  const flashRef = useRef(Object.fromEntries(BRAIN_REGIONS.map((region) => [region.code, 0])));
  const rotationRef = useRef({ yaw: -0.5, pitch: 0.12, velocity: 0, lastInput: -10 });
  // Multi-touch: every active pointer gets its own drag. The first pointer
  // decides the gesture — a second finger only joins as a grab, and only on
  // the brain. Two grabs make a pinch: fingers together squash the whole
  // body along the axis between the handfuls, apart stretch it.
  const dragsRef = useRef(new Map());
  const pinchRef = useRef(null); // { startDist, axis, amount } while pinching
  const pinchEaseRef = useRef({ axis: [0, 1, 0], amount: 0 });
  const sliceRef = useRef(0); // eased 0..SLICE.maxGap
  const sliceInitRef = useRef(false);
  // Authoritative slice flag for the frame loop. Updated synchronously via
  // the imperative API (and synced from the prop), so the knife + separation
  // never depend on the useFrame closure seeing a fresh React prop.
  const slicedRef = useRef(sliced);
  // The knife: a chop swing 0..1 down the midline when Slice is tapped.
  const knifeRef = useRef({ t: 1, active: false });
  const knifeGroupRef = useRef();
  const knifeBladeRef = useRef();
  const knifeHandleRef = useRef();
  const pendingShakeRef = useRef([]);
  const helloRef = useRef(false);
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
    const halfHeight = 4.7; // room below for the tray and the lab bench
    const tan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const distance = Math.max(halfHeight / tan, halfWidth / (tan * aspect));
    camera.position.set(0.4, 1.4, distance);
    camera.lookAt(SHELL.center[0], SHELL.center[1] - 0.45, SHELL.center[2]);
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
      soundRef?.current?.poke(Math.min(1, (amplitude ?? cfg.pokeAmplitude) / cfg.pokeAmplitude));
    } else {
      // A grab starts with a soft bloop; the drag then stretches audibly.
      soundRef?.current?.poke(0.25);
      soundRef?.current?.stretchStart();
    }
    jellyRef.current = state;
    flashRef.current[region] = 1;
    callbacksRef.current.onPoke?.(region);
    return added.id;
  }

  useEffect(() => {
    const element = gl.domElement;

    function grabAt(clientX, clientY, pointerId) {
      const now = clockRef.current;
      const hit = hitTest(clientX, clientY);
      if (!hit) return null;
      const id = poke(hit, now, { held: true });
      const drag = {
        kind: 'poke',
        id,
        x: clientX,
        y: clientY,
        world: hit.world,
        depth: hit.depth,
        origin: hit.origin,
        pointerId,
      };
      dragsRef.current.set(pointerId, drag);
      return drag;
    }

    function onPointerDown(event) {
      if (event.button !== undefined && event.button !== 0) return;
      if (dragsRef.current.has(event.pointerId)) return;
      const now = clockRef.current;
      rotationRef.current.lastInput = now;
      // Browsers only allow audio after a user gesture: this is that gesture.
      soundRef?.current?.unlock();
      if (dragsRef.current.size === 0) {
        // The first pointer decides the gesture.
        const drag = grabAt(event.clientX, event.clientY, event.pointerId);
        if (!drag) {
          dragsRef.current.set(event.pointerId, {
            kind: 'rotate', x: event.clientX, y: event.clientY, lastX: event.clientX, pointerId: event.pointerId,
          });
        }
        return;
      }
      // A second finger only joins as a grab, and only on the brain — a
      // rotate gesture stays single-finger and is never hijacked.
      const first = dragsRef.current.values().next().value;
      if (first.kind !== 'poke') return;
      const grabs = [...dragsRef.current.values()].filter((entry) => entry.kind === 'poke');
      if (grabs.length >= 2) return; // two handfuls are plenty
      const before = grabs[0];
      const drag = grabAt(event.clientX, event.clientY, event.pointerId);
      if (!drag) return;
      // Two grabs: the pinch begins, along the line between the handfuls.
      const startDist = Math.hypot(before.x - drag.x, before.y - drag.y);
      if (startDist >= PINCH.minStartDist) {
        const axis = pinchAxis(before.origin, drag.origin);
        pinchRef.current = { startDist, axis, amount: 0 };
        pinchEaseRef.current.axis = axis;
      }
    }

    function onPointerMove(event) {
      const drag = dragsRef.current.get(event.pointerId);
      if (!drag) {
        // Cheap hover feedback against the coarse proxy only.
        if (dragsRef.current.size === 0 && event.pointerType === 'mouse' && event.target === element) {
          element.style.cursor = raycastProxy(event.clientX, event.clientY) ? 'grab' : 'default';
        }
        return;
      }
      rotationRef.current.lastInput = clockRef.current;
      if (drag.kind === 'poke') {
        // Where the pointer is now, at the depth of the grabbed point: the
        // handful follows it in the screen plane. Convert that world-space
        // pull into the brain's own (rotated) space for the shader.
        drag.x = event.clientX;
        drag.y = event.clientY;
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
        // The stretch loop must be running while any handful is held — a
        // finger that lifted earlier may have stopped it.
        soundRef?.current?.stretchStart();
        // The stretch hisses louder the faster the handful moves.
        soundRef?.current?.stretchMove(Math.min(1, scratch.delta.length() * 6));
        // Two handfuls: the pinch ratio drives the whole-body squash.
        const pinch = pinchRef.current;
        if (pinch) {
          const grabs = [...dragsRef.current.values()].filter((entry) => entry.kind === 'poke');
          if (grabs.length >= 2) {
            pinch.amount = pinchAmount(pinch.startDist, Math.hypot(grabs[0].x - grabs[1].x, grabs[0].y - grabs[1].y));
          } else {
            pinchRef.current = null;
          }
        }
        element.style.cursor = 'grabbing';
      } else {
        const dx = event.clientX - drag.lastX;
        drag.lastX = event.clientX;
        rotationRef.current.yaw += dx * 0.006;
        rotationRef.current.velocity = dx * 0.006 * 60;
      }
    }

    function onPointerUp(event) {
      const drag = dragsRef.current.get(event.pointerId);
      if (!drag) return;
      if (drag.kind === 'poke') {
        // The release wobble's pitch follows how far the surface was pulled.
        const held = jellyRef.current.impulses.find((impulse) => impulse.id === drag.id);
        const strength = Math.min(1, Math.abs(held?.amplitude ?? 0) / cfg.maxPull + 0.3);
        soundRef?.current?.release(strength);
        jellyRef.current = releaseHeld(jellyRef.current, drag.id, clockRef.current, cfg);
        if (pinchRef.current) {
          const grabs = [...dragsRef.current.values()].filter((entry) => entry.kind === 'poke');
          if (grabs.length < 2) pinchRef.current = null;
        }
      }
      dragsRef.current.delete(event.pointerId);
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

  // Slicing: a knife chops down the midline, then the halves slide apart as
  // clean slabs. Structural, not a poke — it doesn't fire signals or count.
  // The frame loop reads slicedRef (kept in sync here and via the imperative
  // API), so the animation can't go stale if a React prop update is delayed.
  useEffect(() => {
    slicedRef.current = sliced;
    if (!sliceInitRef.current) {
      sliceInitRef.current = true;
      return;
    }
    if (sliced) knifeRef.current = { t: 0, active: true };
    const now = clockRef.current;
    const [cx, cy] = SHELL.center;
    for (const side of [1, -1]) {
      const origin = [cx, cy + 1.2, side * 1.2];
      const added = addImpulse(jellyRef.current, {
        origin,
        dir: [0, 0.25, sliced ? side : -side * 0.6],
        amplitude: sliced ? 0.55 : 0.4,
        radius: cfg.pokeRadius * 1.2,
        at: now,
      }, cfg);
      jellyRef.current = addPulse(added.state, origin, now, cfg);
    }
    soundRef?.current?.unlock();
    soundRef?.current?.poke(sliced ? 0.65 : 0.45);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sliced]);

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
        dragsRef.current.clear();
        pinchRef.current = null;
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
      setSliced(next) {
        // Imperative slice toggle: updates the frame-loop flag synchronously
        // and (re)triggers the knife chop, bypassing React prop timing.
        slicedRef.current = next;
        if (next) knifeRef.current = { t: 0, active: true };
        else knifeRef.current = { t: 1, active: false };
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

    // The invitation: one gentle jiggle shortly after load, before anyone has
    // touched it, so the first thing a visitor learns is that it squishes.
    // Silent (no gesture has happened yet, so audio is locked anyway) and not
    // counted — only real pokes fire signals.
    if (!reducedMotion && !helloRef.current && now > 1.1 && rotationRef.current.lastInput < 0) {
      helloRef.current = true;
      const dx = 0.12;
      const dy = 0.42;
      const dz = 1;
      const [rx, ry, rz] = SHELL.radii;
      const k = 1 / Math.hypot(dx / rx, dy / ry, dz / rz);
      const origin = [SHELL.center[0] + dx * k, SHELL.center[1] + dy * k, SHELL.center[2] + dz * k];
      const added = addImpulse(jellyRef.current, {
        origin,
        dir: [-dx / (rx * rx), -dy / (ry * ry), -dz / (rz * rz)],
        amplitude: 0.55,
        radius: cfg.pokeRadius,
        at: now,
      }, cfg);
      const impulse = added.state.impulses.find((entry) => entry.id === added.id);
      jellyRef.current = {
        ...added.state,
        squash: { axis: impulse.dir, amount: Math.min(cfg.squashMax, 0.55 * cfg.squashGain), at: now },
      };
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

    // Pinch: ease the whole-body squash toward the live two-finger amount,
    // then relax back to nothing once the fingers lift.
    const pinchTarget = pinchRef.current ? pinchRef.current.amount : 0;
    const ease = pinchEaseRef.current;
    ease.amount += (pinchTarget - ease.amount) * Math.min(1, dt * 10);
    if (Math.abs(ease.amount) > 0.0005) {
      sharedUniforms.uPinch.value.set(ease.axis[0], ease.axis[1], ease.axis[2], ease.amount);
    } else {
      sharedUniforms.uPinch.value.set(0, 1, 0, 0);
    }

    // Slice: the knife chops down the midline first; the hemispheres slide
    // apart only once the blade has bitten, so the cut is visibly done by
    // the knife. Unslicing just slides them shut — no second chop.
    // Reads slicedRef (not the prop) so a stale useFrame closure can't wedge
    // the slice shut.
    const slicedNow = slicedRef.current;
    const knife = knifeRef.current;
    if (knife.active) {
      knife.t = Math.min(1, knife.t + dt / KNIFE.chopTime);
      if (knife.t >= 1) knife.active = false;
    }
    const knifeT = slicedNow ? knife.t : 1;
    if (knifeGroupRef.current) {
      knifeGroupRef.current.position.y = knifeY(knifeT);
      knifeGroupRef.current.visible = slicedNow && knifeOpacity(knifeT) > 0.01;
    }
    const bladeOpacity = slicedNow ? knifeOpacity(knifeT) : 0;
    if (knifeBladeRef.current) knifeBladeRef.current.opacity = bladeOpacity;
    if (knifeHandleRef.current) knifeHandleRef.current.opacity = bladeOpacity;
    sliceRef.current = sliceStep(sliceRef.current, sliceTargetFor(slicedNow, knifeT), dt);
    sharedUniforms.uSlice.value = sliceRef.current;

    // Rotation: drag with inertia, then an idle drift once hands are off.
    const rotation = rotationRef.current;
    const rotating = [...dragsRef.current.values()].some((entry) => entry.kind === 'rotate');
    if (!rotating) {
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
    <>
      {/* The lab: lights for the bench and tray, then the static bench the
          brain's specimen tray sits on. The brain spins inside its tray. */}
      <ambientLight intensity={0.75} />
      <directionalLight position={[6, 12, 8]} intensity={1.1} />
      <directionalLight position={[-7, 5, -6]} intensity={0.35} color="#8fb4ff" />
      <group position={[SHELL.center[0], 0, SHELL.center[2]]}>
        <mesh position={[0, -5.15, 0]}>
          <boxGeometry args={[34, 0.9, 22]} />
          <meshStandardMaterial color="#1c2531" roughness={0.9} metalness={0.1} />
        </mesh>
        <gridHelper args={[34, 34, '#3b4b63', '#2a3547']} position={[0, -4.68, 0]} />
        {/* steel specimen tray: the jelly rests in the dish */}
        <mesh position={[0, -4.45, 0]}>
          <cylinderGeometry args={[6.4, 5.9, 0.5, 48]} />
          <meshStandardMaterial color="#9aa7b4" roughness={0.35} metalness={0.9} />
        </mesh>
        <mesh position={[0, -3.85, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <torusGeometry args={[6.4, 0.28, 16, 72]} />
          <meshStandardMaterial color="#c7d0db" roughness={0.28} metalness={0.95} />
        </mesh>
      </group>
      <group ref={groupRef}>
      <Axons color={palette.cyan} />
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
        <spriteMaterial map={glowTexture} color={palette.violet} transparent opacity={0.1} depthWrite={false} blending={THREE.AdditiveBlending} />
      </sprite>
      <sprite position={[SHELL.center[0] + 2.5, SHELL.center[1] + 0.5, SHELL.center[2]]} scale={[10, 8, 1]} renderOrder={-1}>
        <spriteMaterial map={glowTexture} color={MINT} transparent opacity={0.05} depthWrite={false} blending={THREE.AdditiveBlending} />
      </sprite>
      {/* The knife: lives in the brain's frame so it always meets the
          midline, chops down when Slice is tapped, then fades away. */}
      <group ref={knifeGroupRef} position={[SHELL.center[0], 9, SHELL.center[2]]} visible={false}>
        <mesh>
          <boxGeometry args={[3.6, 3.4, 0.14]} />
          <meshStandardMaterial ref={knifeBladeRef} color="#dfe6ef" metalness={0.95} roughness={0.25} transparent opacity={0} />
        </mesh>
        <mesh position={[0, 2.5, 0]}>
          <boxGeometry args={[0.55, 1.7, 0.55]} />
          <meshStandardMaterial ref={knifeHandleRef} color="#4a3226" metalness={0.1} roughness={0.8} transparent opacity={0} />
        </mesh>
      </group>
      </group>
    </>
  );
}

/**
 * Memoised on purpose: the simulation re-renders the page ~8 times a second,
 * and none of that should reach the WebGL tree. Everything live flows in
 * through refs.
 */
function PokeBrainScene({ simRef, apiRef, callbacksRef, detail = 'high', reducedMotion = false, active = true, onReady, seed = 'poke', soundRef = null, palette = null, sliced = false }) {
  const dpr = detail === 'high' ? [1, 1.8] : [1, 1.35];
  const jellyPalette = palette || paletteById('brain');
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
        soundRef={soundRef}
        palette={jellyPalette}
        sliced={sliced}
      />
    </Canvas>
  );
}

export default memo(PokeBrainScene);
