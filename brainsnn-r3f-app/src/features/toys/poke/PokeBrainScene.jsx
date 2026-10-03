// Poke the Brain — the WebGL scene.
//
// Lazy-loaded, and one of the few modules allowed to import three (see
// scripts/check-three-imports.mjs). It renders the same seven-region connectome
// the rest of the site uses — positions, colours and pathway curves all come
// from brainRegions.js — inside a procedurally generated jelly shell, and turns
// pointer input into the impulses, pulses and cascades that jellyPhysics.js
// computes. No per-vertex simulation runs on the CPU: every frame writes a few
// dozen floats of uniforms and the vertex shader does the wobble.
//
// Slicing is real: a cut is a plane in the shell's rest space (jellySlice.js).
// The shell is drawn once per piece, clipped against the plane; a cap closes
// each open face with a cross-section of the folded jelly; and both pieces
// fall open about a hinge at the bottom of the cut. Nodes, axons and signals
// ride along with the piece they sit in.
import React, { memo, useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Line } from '@react-three/drei';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { BRAIN_REGIONS, PATHWAYS, REGION_MAP, pathwayControlPoint, pointOnPathway } from '../../brain3d/brainRegions.js';
import { buildBrainShell, SHELL, SHELL_DETAIL, silhouette, surfacePointToward } from './brainShell.js';
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
import { KNIFE, knifeOpacity, knifeY, PINCH, pinchAmount, pinchAxis, paletteById } from './jellyGestures.js';
import {
  chopNormal,
  clampPlaneToShell,
  CUT,
  cutConfig,
  cutSpringStep,
  dropletAt,
  DROPLETS,
  makeCutFrame,
  placeOnCut,
  placeOnHalf,
  planeCutsShell,
  planeThroughEye,
  planeThroughPoint,
  sideOf,
  spawnDroplets,
  STAGE,
} from './jellySlice.js';

const CYAN = '#68eaff';
const VIOLET = '#947cff';
const MINT = '#73efba';
const INHIBIT = '#fb7185';

const HOP_TRAIL = 3;
const MAX_HOP_INSTANCES = 40 * HOP_TRAIL;
const IDLE_ROTATE_AFTER = 2.4; // seconds without input before auto-rotate resumes
const AMBIENT_EVERY = 3.4; // an idle brain still flickers now and then
const AXON_POINTS = 25;
const TRAIL_POINTS = 18;
const TRAIL_LIFE = 0.16; // seconds a slash point lingers behind the pointer
const CAP_SIZE = 6.4; // half-width of the cross-section quad, world units

// --- shaders ------------------------------------------------------------------
// Body deformation, shared by the shell and the cut caps so a cap's rim moves
// exactly with the skin it closes: impulse dents, the whole-body squash and
// pinch, breath, then the piece's rigid pose when the brain is cut.
const DEFORM = /* glsl */ `
  #define MAX_IMP ${JELLY.maxImpulses}
  uniform vec4 uImp[MAX_IMP];
  uniform vec4 uImpDir[MAX_IMP];
  uniform vec4 uSquash;
  uniform vec3 uCenter;
  uniform float uTime;
  uniform float uBreath;
  uniform vec4 uPinch;
  uniform float uCutOn;
  uniform float uHalf;
  uniform vec3 uHinge;
  uniform vec3 uHingeAxis;
  uniform float uTilt;
  uniform vec3 uSlidePos;
  uniform vec3 uSlideNeg;

  vec3 rotateAbout(vec3 v, vec3 a, float angle) {
    float c = cos(angle);
    float s = sin(angle);
    return v * c + cross(a, v) * s + a * dot(a, v) * (1.0 - c);
  }

  vec3 deformBody(vec3 rest, inout vec3 n, out float dent) {
    vec3 p = rest;
    vec3 grad = vec3(0.0);
    dent = 0.0;
    for (int i = 0; i < MAX_IMP; i++) {
      float r = uImpDir[i].w;
      if (r <= 0.0) continue;
      vec3 d = rest - uImp[i].xyz;
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
    // Pinch: the same whole-body math along the two-finger axis — negative
    // squashes (fingers together), positive stretches (fingers apart).
    float palong = dot(q, uPinch.xyz);
    q += uPinch.xyz * palong * uPinch.w - (q - uPinch.xyz * palong) * (uPinch.w * 0.5);
    q *= 1.0 + uBreath * sin(uTime * 1.25);
    return uCenter + q;
  }

  // Mirrors placeOnHalf() in jellySlice.js: tip about the hinge, then slide.
  vec3 placeHalf(vec3 p, inout vec3 n) {
    if (uCutOn < 0.5) return p;
    float angle = uHalf * uTilt;
    n = rotateAbout(n, uHingeAxis, angle);
    return uHinge + rotateAbout(p - uHinge, uHingeAxis, angle) + (uHalf > 0.0 ? uSlidePos : uSlideNeg);
  }
`;

// Surface look shared by the skin and the caps: the studio the jelly reflects
// and the ring pulses that ride across it.
const LOOK = /* glsl */ `
  #define MAX_PULSE ${JELLY.maxPulses}
  uniform vec3 uCyan;
  uniform vec3 uViolet;
  uniform vec3 uCutColor;
  uniform vec4 uPulse[MAX_PULSE];
  uniform float uPulseSpeed;
  uniform float uPulseWidth;
  uniform float uPulseLife;
  uniform float uCutOn;
  uniform float uHalf;
  uniform vec4 uCutPlane;

  // A photo studio around the camera, in view space: a big key softbox up
  // and to the right, a strip light overhead, a cool rim behind on the left
  // and a faint violet bounce. Reflected in the jelly, its hard-edged shapes
  // are most of what makes the surface read wet rather than plastic.
  vec3 studio(vec3 r) {
    vec3 col = mix(vec3(0.012, 0.016, 0.03), vec3(0.06, 0.07, 0.11), smoothstep(-0.5, 0.7, r.y));
    float key = smoothstep(0.935, 0.975, dot(r, normalize(vec3(0.55, 0.5, 0.67))));
    float strip = smoothstep(0.88, 0.95, r.y) * smoothstep(-0.5, 0.1, r.z);
    float rim = smoothstep(0.82, 0.95, dot(r, normalize(vec3(-0.85, 0.25, -0.45))));
    float bounce = smoothstep(0.9, 0.985, dot(r, normalize(vec3(-0.6, -0.2, 0.78))));
    col += vec3(1.0, 0.99, 0.97) * key * 1.35;
    col += vec3(0.85, 0.92, 1.0) * strip * 0.75;
    col += uCyan * rim * 0.8;
    col += uViolet * bounce * 0.45;
    return col;
  }

  float pulseGlow(vec3 rest, float fold) {
    float glow = 0.0;
    for (int i = 0; i < MAX_PULSE; i++) {
      float age = uPulse[i].w;
      if (age < 0.0) continue;
      float d = distance(rest, uPulse[i].xyz);
      float front = age * uPulseSpeed;
      float ring = exp(-pow((d - front) / uPulseWidth, 2.0));
      float core = exp(-d * d / 0.5) * exp(-age * 6.0);
      float fade = 1.0 - smoothstep(0.0, uPulseLife, age);
      // Pulses ride the gyri: brighter on the crests, faint in the sulci.
      glow += (ring * (0.25 + 1.0 * fold) + core * 0.9) * fade;
    }
    // Saturating, so ten overlapping pulses glow brighter than one without
    // blowing the whole surface out to white.
    return 1.0 - exp(-glow * 1.3);
  }
`;

const SHELL_VERTEX = /* glsl */ `
  ${DEFORM}
  attribute float aFold;
  varying vec3 vRest;
  varying vec3 vNormalV;
  varying vec3 vViewPos;
  varying float vFold;
  varying float vDent;

  void main() {
    vec3 n = normal;
    float dent;
    vec3 p = deformBody(position, n, dent);
    p = placeHalf(p, n);
    vRest = position;
    vFold = aFold;
    vDent = dent;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vViewPos = -mv.xyz;
    vNormalV = normalize(normalMatrix * n);
    gl_Position = projectionMatrix * mv;
  }
`;

const SHELL_FRAGMENT = /* glsl */ `
  ${LOOK}
  uniform float uFront;
  varying vec3 vRest;
  varying vec3 vNormalV;
  varying vec3 vViewPos;
  varying float vFold;
  varying float vDent;

  void main() {
    // A cut piece keeps only its own side of the plane.
    float sd = dot(uCutPlane.xyz, vRest) - uCutPlane.w;
    if (uCutOn > 0.5 && uHalf * sd < 0.0) discard;

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
    // 1 at the bottom of a sulcus, 0 on a gyrus crest.
    float groove = 1.0 - smoothstep(0.0, 0.7, fold);

    vec3 L = normalize(vec3(0.35, 0.85, 0.55));
    vec3 H = normalize(L + v);
    float diff = max(dot(n, L), 0.0);
    // A tight sun glint on top of the softbox reflections below.
    float spec = pow(max(dot(n, H), 0.0), 80.0) * (0.3 + 0.8 * fold);

    vec3 col = body * (0.07 + 0.17 * fold);
    col += body * diff * 0.22 * (0.3 + 0.7 * fold);
    col += body * fres * 1.05 * (0.45 + 0.55 * fold);
    // Light passing through the thick middle of the jelly: a soft inner glow.
    col += mix(body, vec3(1.0), 0.3) * pow(ndv, 3.0) * 0.14 * (0.4 + 0.6 * fold);
    // Sulci read as dark creases, which is most of what makes it a brain.
    col *= 1.0 - groove * 0.6;

    // Wet: the studio reflected, strongest at grazing angles, dulled in the
    // creases where the folds shade each other.
    vec3 env = studio(reflect(-v, n));
    float refl = mix(0.07, 0.85, pow(1.0 - ndv, 3.0)) * (0.2 + 0.8 * fold);
    col += env * refl;

    float glow = pulseGlow(vRest, fold);
    vec3 glowCol = mix(uCyan, vec3(0.93, 0.99, 1.0), 0.3);
    col += glowCol * glow * 1.25;
    col += vec3(0.85, 0.97, 1.0) * spec;
    // Dents glow faintly cyan: translucency faking the light scattering
    // through the jelly where it is thinnest.
    col += uCyan * clamp(abs(vDent), 0.0, 1.0) * 0.3;

    // The cut lip: a bright wet edge where the skin meets the cross-section.
    float lip = uCutOn * (1.0 - smoothstep(0.0, 0.14, abs(sd)));
    col = mix(col, uCutColor * 1.2, lip * 0.75);

    float envLum = dot(env * refl, vec3(0.3, 0.59, 0.11));
    float alpha = 0.1 + fres * 0.7 * (0.5 + 0.5 * fold) + glow * 0.5 + spec * 0.55 + groove * 0.16 + envLum * 0.55 + lip * 0.6;
    if (uFront < 0.5) alpha *= 0.4;
    gl_FragColor = vec4(col, clamp(alpha, 0.0, 0.95));
    #include <colorspace_fragment>
  }
`;

const CAP_VERTEX = /* glsl */ `
  ${DEFORM}
  uniform vec4 uCutPlane;
  uniform vec3 uCapOrigin;
  uniform vec3 uCutT1;
  uniform vec3 uCutT2;
  uniform float uCapSize;
  varying vec3 vRest;
  varying vec3 vNormalV;
  varying vec3 vViewPos;
  varying float vDent;

  void main() {
    vec3 rest = uCapOrigin + (uCutT1 * position.x + uCutT2 * position.y) * uCapSize;
    // Each cap faces the other piece.
    vec3 n = -uHalf * uCutPlane.xyz;
    float dent;
    vec3 p = deformBody(rest, n, dent);
    p = placeHalf(p, n);
    vRest = rest;
    vDent = dent;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vViewPos = -mv.xyz;
    vNormalV = normalize(normalMatrix * n);
    gl_Position = projectionMatrix * mv;
  }
`;

// The cross-section. The shell is a radial function of direction (see
// brainShell.js), so whether a point on the cut is inside the brain — and how
// deep — comes straight from the same silhouette and groove fields, ported
// here. Grey matter is a ribbon under the skin that reaches in wherever a
// sulcus folds; white matter fills the middle; regions the plane passes near
// glow through it.
const CAP_FRAGMENT = /* glsl */ `
  ${LOOK}
  #define REGIONS ${BRAIN_REGIONS.length}
  uniform vec3 uCenter;
  uniform vec3 uRadii;
  uniform float uGrooveWidth;
  uniform float uGrooveDepth;
  uniform vec4 uRegions[REGIONS];
  uniform vec3 uRegionColors[REGIONS];
  varying vec3 vRest;
  varying vec3 vNormalV;
  varying vec3 vViewPos;
  varying float vDent;

  float silhouetteAt(vec3 d) {
    float x = d.x;
    float y = d.y;
    float z = d.z;
    float fissure = exp(-(z * z) / 0.008) * smoothstep(-0.2, 0.45, y) * 0.24;
    float sl = y + 0.14 - 0.42 * (x + 0.1);
    float sylvian = exp(-(sl * sl) / 0.0035) * smoothstep(0.3, 0.72, abs(z)) * smoothstep(-0.5, 0.05, x) * (1.0 - smoothstep(0.5, 0.85, x)) * 0.08;
    float cerebellum = exp(-((x + 0.7) * (x + 0.7)) / 0.035 - ((y + 0.5) * (y + 0.5)) / 0.05) * 0.1;
    float temporal = exp(-((y + 0.42) * (y + 0.42)) / 0.05) * exp(-((x - 0.1) * (x - 0.1)) / 0.22) * abs(z) * 0.14;
    float base = y < -0.35 ? (y + 0.35) * 0.28 : 0.0;
    float poles = x > 0.0 ? -0.03 * x * x : -0.05 * x * x * abs(z);
    return 1.0 - fissure - sylvian + temporal + base + poles + cerebellum;
  }

  float grooveAt(vec3 d, float width) {
    float wx = d.x + 0.34 * sin(3.1 * d.y + 1.7) + 0.18 * sin(5.3 * d.z + 0.3);
    float wy = d.y + 0.34 * sin(3.7 * d.z + 0.4) + 0.18 * sin(4.9 * d.x + 1.1);
    float wz = d.z + 0.34 * sin(2.9 * d.x + 2.1) + 0.18 * sin(6.1 * d.y + 2.6);
    float a = sin(7.4 * wx + 2.0 * sin(4.0 * wy));
    float b = sin(7.8 * wy + 2.2 * sin(3.6 * wz));
    float c = sin(7.0 * wz + 2.4 * sin(4.4 * wx));
    float v = (a + b + c) / 3.0;
    return exp(-(v / width) * (v / width));
  }

  void main() {
    vec3 u = (vRest - uCenter) / uRadii;
    float len = max(length(u), 1e-4);
    vec3 d = u / len;
    float g = grooveAt(d, uGrooveWidth);
    vec3 rd = uRadii * d;
    float rlen = length(rd);
    vec3 nEll = normalize(d / uRadii);
    float surface = silhouetteAt(d) - uGrooveDepth * g * dot(nEll, rd / rlen) / rlen;
    // World units under the skin; negative is outside the brain.
    float depth = (surface - len) * rlen;
    if (depth < 0.0) discard;

    float t = smoothstep(-5.4, 5.4, vRest.x);
    vec3 body = mix(uViolet, uCyan, t);
    // Grey matter: a ribbon of folded cortex just under the skin, dipping
    // in where a sulcus folds.
    float ribbon = 0.36 + 0.5 * g;
    float grey = 1.0 - smoothstep(ribbon - 0.06, ribbon + 0.06, depth);
    // Only the deep sulci carry on inward, as thin dark creases.
    float crease = smoothstep(0.8, 0.98, g) * (1.0 - smoothstep(0.15, 0.9, depth));
    vec3 whiteCol = mix(body, uCutColor, 0.5) * 0.6;
    vec3 greyCol = body * 0.8;
    vec3 col = mix(whiteCol, greyCol, grey);
    col *= 1.0 - crease * 0.55;
    // Jelly: deeper in, the cut turns clear and glows softly.
    float core = smoothstep(0.6, 3.2, depth);
    col = mix(col, mix(body, vec3(1.0), 0.35), core * 0.2);

    // Regions the cut passes near glow through the cross-section.
    for (int i = 0; i < REGIONS; i++) {
      float dd = distance(vRest, uRegions[i].xyz);
      col += uRegionColors[i] * exp(-dd * dd / 0.3) * (0.3 + uRegions[i].w);
    }
    float glow = pulseGlow(vRest, 0.55 + 0.45 * grey);
    col += mix(uCyan, vec3(0.93, 0.99, 1.0), 0.3) * glow * 0.9;

    vec3 n = normalize(vNormalV);
    if (!gl_FrontFacing) n = -n;
    vec3 v = normalize(vViewPos);
    float ndv = clamp(dot(n, v), 0.0, 1.0);
    vec3 L = normalize(vec3(0.35, 0.85, 0.55));
    col *= 0.78 + 0.3 * max(dot(n, L), 0.0);
    // A freshly cut face is wet and flat: it mirrors the studio cleanly.
    vec3 env = studio(reflect(-v, n));
    float refl = mix(0.05, 0.75, pow(1.0 - ndv, 4.0));
    col += env * refl;
    col += vec3(0.85, 0.97, 1.0) * pow(max(dot(n, normalize(L + v)), 0.0), 120.0) * 0.8;
    col += uCyan * clamp(abs(vDent), 0.0, 1.0) * 0.25;

    // The wet lip where the cut meets the skin.
    float lip = 1.0 - smoothstep(0.0, 0.08, depth);
    col = mix(col, uCutColor * 1.25, lip * 0.8);
    float alpha = mix(0.72, 0.9, grey) * (1.0 - core * 0.12) * smoothstep(0.0, 0.02, depth) + glow * 0.1;
    gl_FragColor = vec4(col, clamp(alpha, 0.0, 0.97));
    #include <colorspace_fragment>
  }
`;

// The lab floor: a dark bench with a fine grid that fades out before it can
// meet the edge of the canvas, and a pool of light under the tray.
const FLOOR_VERTEX = /* glsl */ `
  varying vec2 vXZ;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vXZ = world.xz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const FLOOR_FRAGMENT = /* glsl */ `
  uniform vec3 uTint;
  uniform vec2 uMiddle;
  varying vec2 vXZ;
  void main() {
    float r = length(vXZ - uMiddle);
    vec2 cell = vXZ / 1.4;
    vec2 grid = abs(fract(cell - 0.5) - 0.5) / fwidth(cell);
    float line = 1.0 - min(min(grid.x, grid.y), 1.0);
    float fade = 1.0 - smoothstep(5.0, 17.0, r);
    vec3 col = mix(vec3(0.028, 0.04, 0.065), vec3(0.075, 0.095, 0.14), 1.0 - smoothstep(0.0, 13.0, r));
    col += uTint * line * 0.16 * fade;
    col += uTint * 0.06 * (1.0 - smoothstep(0.0, 8.5, r));
    gl_FragColor = vec4(col, fade * 0.96);
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

function makeKnifeGeometry() {
  // A chef's knife in profile: straight edge along the bottom, rising to the
  // tip; the heel at -x, where the bolster and handle sit.
  const blade = new THREE.Shape();
  blade.moveTo(-4.4, -0.95);
  blade.lineTo(3.0, -0.95);
  blade.quadraticCurveTo(4.6, -0.85, 5.1, 1.0);
  blade.lineTo(-4.4, 1.12);
  blade.lineTo(-4.4, -0.95);
  const geometry = new THREE.ExtrudeGeometry(blade, {
    depth: 0.05,
    bevelEnabled: true,
    bevelThickness: 0.025,
    bevelSize: 0.03,
    bevelSegments: 2,
    curveSegments: 18,
  });
  geometry.translate(0, 0, -0.025);
  return geometry;
}

/**
 * The room the steel and the droplets reflect: three's built-in studio room,
 * prefiltered once. Nothing is fetched. The jelly shaders carry their own
 * analytic studio (see LOOK), so this only lights the standard materials.
 */
function useStudioEnvironment() {
  const { gl, scene } = useThree();
  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const room = new RoomEnvironment();
    const target = pmrem.fromScene(room, 0.04);
    scene.environment = target.texture;
    scene.environmentIntensity = 0.6;
    return () => {
      scene.environment = null;
      target.dispose();
      room.dispose();
      pmrem.dispose();
    };
  }, [gl, scene]);
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
}) {
  const { camera, gl, size, invalidate } = useThree();
  const cfg = useMemo(() => motionConfig(reducedMotion), [reducedMotion]);
  const cutCfg = useMemo(() => cutConfig(reducedMotion), [reducedMotion]);
  useStudioEnvironment();
  // Read at cut time by handlers bound once, so they never see a stale palette.
  const paletteRef = useRef(palette);
  paletteRef.current = palette;

  const shell = useMemo(() => buildBrainShell(detail), [detail]);
  const proxyShell = useMemo(() => buildBrainShell('proxy'), []);
  const geometry = useMemo(() => geometryFromShell(shell), [shell]);
  const proxyGeometry = useMemo(() => geometryFromShell(proxyShell), [proxyShell]);
  const capGeometry = useMemo(() => {
    const segments = detail === 'high' ? 110 : 64;
    return new THREE.PlaneGeometry(2, 2, segments, segments);
  }, [detail]);
  const knifeGeometry = useMemo(() => makeKnifeGeometry(), []);
  const glowTexture = useMemo(() => makeGlowTexture(), []);

  const uniformTarget = useMemo(() => createUniformTarget(), []);
  const sharedUniforms = useMemo(() => ({
    uImp: { value: uniformTarget.impulses },
    uImpDir: { value: uniformTarget.dirs },
    uSquash: { value: new THREE.Vector4(0, 1, 0, 0) },
    uPinch: { value: new THREE.Vector4(0, 1, 0, 0) },
    uCutColor: { value: new THREE.Color(palette.cut) },
    uCenter: { value: new THREE.Vector3(...SHELL.center) },
    uRadii: { value: new THREE.Vector3(...SHELL.radii) },
    uTime: { value: 0 },
    uBreath: { value: reducedMotion ? 0 : 0.006 },
    uCyan: { value: new THREE.Color(CYAN) },
    uViolet: { value: new THREE.Color(VIOLET) },
    uPulse: { value: uniformTarget.pulses },
    uPulseSpeed: { value: cfg.pulseSpeed },
    uPulseWidth: { value: cfg.pulseWidth },
    uPulseLife: { value: cfg.pulseLife },
    // The cut (see jellySlice.js). Off until the first slice.
    uCutOn: { value: 0 },
    uCutPlane: { value: new THREE.Vector4(1, 0, 0, 0) },
    uHinge: { value: new THREE.Vector3() },
    uHingeAxis: { value: new THREE.Vector3(0, 0, 1) },
    uTilt: { value: 0 },
    uSlidePos: { value: new THREE.Vector3() },
    uSlideNeg: { value: new THREE.Vector3() },
    uCapOrigin: { value: new THREE.Vector3() },
    uCutT1: { value: new THREE.Vector3(0, 0, 1) },
    uCutT2: { value: new THREE.Vector3(0, 1, 0) },
    uCapSize: { value: CAP_SIZE },
    uGrooveWidth: { value: SHELL_DETAIL[detail]?.grooveWidth ?? SHELL_DETAIL.high.grooveWidth },
    uGrooveDepth: { value: SHELL_DETAIL[detail]?.grooveDepth ?? SHELL_DETAIL.high.grooveDepth },
    uRegions: { value: BRAIN_REGIONS.map((region) => new THREE.Vector4(...region.position, 0)) },
    uRegionColors: { value: BRAIN_REGIONS.map((region) => new THREE.Color(region.color)) },
  }), [uniformTarget, cfg, reducedMotion, detail]);

  // One material per piece and side. Every uniform is shared by reference
  // except which piece (uHalf) and which side of the skin (uFront).
  const materials = useMemo(() => {
    const shellMaterial = (half, front) => new THREE.ShaderMaterial({
      vertexShader: SHELL_VERTEX,
      fragmentShader: SHELL_FRAGMENT,
      uniforms: { ...sharedUniforms, uHalf: { value: half }, uFront: { value: front ? 1 : 0 } },
      side: front ? THREE.FrontSide : THREE.BackSide,
      transparent: true,
      depthWrite: false,
    });
    const capMaterial = (half) => new THREE.ShaderMaterial({
      vertexShader: CAP_VERTEX,
      fragmentShader: CAP_FRAGMENT,
      uniforms: { ...sharedUniforms, uHalf: { value: half } },
      side: THREE.DoubleSide,
      transparent: true,
      depthWrite: false,
    });
    return {
      backPos: shellMaterial(1, false),
      frontPos: shellMaterial(1, true),
      backNeg: shellMaterial(-1, false),
      frontNeg: shellMaterial(-1, true),
      capPos: capMaterial(1),
      capNeg: capMaterial(-1),
    };
  }, [sharedUniforms]);
  const floorMaterial = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: FLOOR_VERTEX,
    fragmentShader: FLOOR_FRAGMENT,
    uniforms: {
      uTint: { value: new THREE.Color(CYAN) },
      uMiddle: { value: new THREE.Vector2(SHELL.center[0], SHELL.center[2]) },
    },
    transparent: true,
    depthWrite: false,
  }), []);

  useEffect(() => () => {
    geometry.dispose();
    proxyGeometry.dispose();
    capGeometry.dispose();
    knifeGeometry.dispose();
    glowTexture.dispose();
    floorMaterial.dispose();
    for (const material of Object.values(materials)) material.dispose();
  }, [geometry, proxyGeometry, capGeometry, knifeGeometry, glowTexture, floorMaterial, materials]);

  // A palette change re-tints the live uniforms in place — no geometry or
  // material rebuild, so the jelly never flickers.
  useEffect(() => {
    sharedUniforms.uCyan.value.set(palette.cyan);
    sharedUniforms.uViolet.value.set(palette.violet);
    sharedUniforms.uCutColor.value.set(palette.cut);
    floorMaterial.uniforms.uTint.value.set(palette.cyan);
  }, [palette, sharedUniforms, floorMaterial]);

  const groupRef = useRef();
  const proxyRef = useRef();
  const regionRefs = useRef({});
  const nodeRefs = useRef({});
  const haloRefs = useRef({});
  const axonRefs = useRef([]);
  const hopMeshRef = useRef();
  const pieceRefs = useRef({});
  const shadowRefs = useRef([]);
  const dropletMeshRef = useRef();
  const trailRefs = useRef([]);
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
  // The cut: its frame (null while whole), the spring that opens it, and a
  // queued re-cut waiting for the current one to close.
  const cutRef = useRef({ frame: null, pending: null, target: 0, open: 0, velocity: 0, on: false, count: 0, axonsAt: -1 });
  // Knife mode: drags that start off the brain slash instead of rotating.
  const knifeModeRef = useRef(false);
  // The chop from the Slice button: a blade falls down a plane, and the cut
  // opens once it has bitten.
  const chopRef = useRef({ t: 1, active: false, plane: null, bitten: true, nudge: 0 });
  const knifeGroupRef = useRef();
  const knifeMaterialsRef = useRef([]);
  const trailRef = useRef({ points: [], live: false });
  const dropletsRef = useRef({ list: [], born: -10 });
  const pendingShakeRef = useRef([]);
  const helloRef = useRef(false);
  const ambientRef = useRef({ at: 0.6 - AMBIENT_EVERY, index: 0 });
  const lastFiredRef = useRef(0);
  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  const pointer = useMemo(() => new THREE.Vector2(), []);
  const scratch = useMemo(() => ({
    object: new THREE.Object3D(),
    color: new THREE.Color(),
    tint: new THREE.Color(),
    local: new THREE.Vector3(),
    normal: new THREE.Vector3(),
    world: new THREE.Vector3(),
    delta: new THREE.Vector3(),
    a: new THREE.Vector3(),
    b: new THREE.Vector3(),
    inverse: new THREE.Matrix4(),
    matrix: new THREE.Matrix4(),
    turn: new THREE.Matrix4(),
    rotation: new THREE.Matrix3(),
    ray: new THREE.Ray(),
    quaternion: new THREE.Quaternion(),
  }), []);

  // The axons as fixed sample points on the same curves the rest of the site
  // draws; when the brain is cut each point rides with its own piece.
  const axons = useMemo(() => PATHWAYS.map((pathway) => {
    const curve = new THREE.QuadraticBezierCurve3(
      ...[REGION_MAP[pathway.from].position, pathwayControlPoint(pathway), REGION_MAP[pathway.to].position]
        .map((point) => new THREE.Vector3(...point)),
    );
    const points = curve.getPoints(AXON_POINTS - 1).map((point) => [point.x, point.y, point.z]);
    return { id: pathway.id, inhibitory: pathway.inhibitory, points };
  }), []);
  const trailSeed = useMemo(() => Array.from({ length: TRAIL_POINTS }, () => [0, 0, 0]), []);

  // Frame the brain for the current aspect ratio: a portrait phone needs the
  // camera further back than a landscape laptop to keep the whole thing in.
  useEffect(() => {
    const aspect = size.width / Math.max(1, size.height);
    const halfWidth = 6.6;
    const halfHeight = 4.5; // room below for the tray
    const tan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const distance = Math.max(halfHeight / tan, halfWidth / (tan * aspect));
    camera.position.set(0.4, 2.2, distance);
    camera.lookAt(SHELL.center[0], SHELL.center[1] - 0.55, SHELL.center[2]);
    camera.updateProjectionMatrix();
    invalidate();
  }, [camera, size.width, size.height, invalidate]);

  // --- the cut -----------------------------------------------------------------
  /** Rigid pose of one piece as a matrix, in the brain group's frame. */
  function pieceMatrix(side, target) {
    const cut = cutRef.current;
    target.identity();
    if (!cut.on || !cut.frame) return target;
    const { hinge, axis, tilt } = cut.frame;
    const slide = side > 0 ? cut.frame.slidePos : cut.frame.slideNeg;
    scratch.turn.makeRotationAxis(scratch.a.set(...axis), side * tilt * cut.open);
    target.makeTranslation(-hinge[0], -hinge[1], -hinge[2]);
    target.premultiply(scratch.turn);
    target.premultiply(scratch.matrix.makeTranslation(
      hinge[0] + slide[0] * cut.open,
      hinge[1] + slide[1] * cut.open,
      hinge[2] + slide[2] * cut.open,
    ));
    return target;
  }

  function applyCut(frame, via) {
    const cut = cutRef.current;
    const now = clockRef.current;
    cut.frame = frame;
    cut.on = true;
    cut.target = 1;
    cut.count += 1;
    cut.axonsAt = -1;
    // The jelly reacts: both new faces jolt, a ring runs out from the cut,
    // and the regions it passed through fire.
    let state = jellyRef.current;
    for (const side of [1, -1]) {
      const origin = [
        frame.origin[0] + frame.t2[0] * 1.6,
        frame.origin[1] + frame.t2[1] * 1.6,
        frame.origin[2] + frame.t2[2] * 1.6,
      ];
      const added = addImpulse(state, {
        origin,
        dir: frame.normal.map((value) => value * side),
        amplitude: 0.6,
        radius: cfg.pokeRadius * 1.5,
        at: now,
      }, cfg);
      state = added.state;
    }
    state = addPulse(state, frame.origin, now, cfg);
    const region = nearestRegion(frame.origin);
    state = fireRegion(state, region, now, 0, cfg);
    jellyRef.current = { ...state, fired: state.fired + 1 };
    flashRef.current[region] = 1;
    if (!reducedMotion) {
      // Droplets fly in world space: they leave the brain's spin behind.
      const group = groupRef.current;
      group.getWorldQuaternion(scratch.quaternion);
      dropletsRef.current = {
        born: now,
        list: spawnDroplets(frame, `${seed}-cut-${cut.count}`).map((droplet) => ({
          ...droplet,
          origin: group.localToWorld(scratch.a.set(...droplet.origin)).toArray(),
          velocity: scratch.b.set(...droplet.velocity).applyQuaternion(scratch.quaternion).toArray(),
        })),
      };
      const mesh = dropletMeshRef.current;
      if (mesh) {
        dropletsRef.current.list.forEach((droplet, index) => {
          scratch.color.set(paletteRef.current.violet).lerp(scratch.tint.set(paletteRef.current.cyan), droplet.tint)
            .lerp(scratch.tint.set(paletteRef.current.cut), 0.25);
          mesh.setColorAt(index, scratch.color);
        });
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      }
      // Turn the brain a little so the fresh faces come into view.
      chopRef.current.nudge = via === 'swipe' ? 1.5 : 0.9;
    }
    soundRef?.current?.slice(via === 'swipe' ? 0.9 : 0.7);
    callbacksRef.current.onPoke?.(region);
    callbacksRef.current.onCutChange?.(true, via);
  }

  /** Cut along a rest-space plane. A cut brain closes first, then re-cuts. */
  function requestCut(plane, via) {
    if (!plane) return false;
    const bounded = planeCutsShell(plane) ? plane : clampPlaneToShell(plane);
    const frame = makeCutFrame(bounded);
    const cut = cutRef.current;
    if (cut.on && cut.open > 0.04) {
      cut.pending = { frame, via };
      cut.target = 0;
    } else {
      applyCut(frame, via);
    }
    return true;
  }

  function heal() {
    const cut = cutRef.current;
    chopRef.current = { ...chopRef.current, active: false, bitten: true };
    if (!cut.on) return;
    cut.pending = null;
    cut.target = 0;
    soundRef?.current?.heal();
    callbacksRef.current.onCutChange?.(false, 'heal');
  }

  /** The Slice button: a blade chops down a vertical plane through the middle. */
  function chop() {
    const group = groupRef.current;
    if (!group) return;
    const now = clockRef.current;
    rotationRef.current.lastInput = now;
    rotationRef.current.velocity = 0;
    group.updateMatrixWorld(true);
    const centre = group.localToWorld(scratch.world.set(...SHELL.center)).clone();
    const right = scratch.a.set(1, 0, 0).applyQuaternion(camera.quaternion).toArray();
    const toViewer = scratch.b.copy(camera.position).sub(centre).toArray();
    const normalWorld = chopNormal(right, toViewer);
    // The plane in the brain's own frame, through its centre.
    group.getWorldQuaternion(scratch.quaternion).invert();
    const normalLocal = scratch.a.set(...normalWorld).applyQuaternion(scratch.quaternion).toArray();
    const plane = planeThroughPoint(SHELL.center, normalLocal);
    // The blade lies in the plane: long axis horizontal, edge down, the
    // handle off to the viewer's right.
    const up = new THREE.Vector3(0, 1, 0);
    const along = new THREE.Vector3().crossVectors(up, new THREE.Vector3(...normalWorld)).normalize();
    if (along.dot(new THREE.Vector3(...right)) > 0) along.negate();
    const facing = new THREE.Vector3().crossVectors(along, up);
    const basis = new THREE.Matrix4().makeBasis(along, up, facing);
    const pose = { position: centre, quaternion: new THREE.Quaternion().setFromRotationMatrix(basis) };
    if (reducedMotion) {
      requestCut(plane, 'button');
      return;
    }
    chopRef.current = { t: 0, active: true, plane, bitten: false, pose, nudge: 0 };
  }

  // --- interaction ---------------------------------------------------------
  function setRay(clientX, clientY) {
    const rect = gl.domElement.getBoundingClientRect();
    pointer.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
  }

  /** Is this rest-space point on the cut face, inside the brain? */
  function insideShell(point) {
    const [cx, cy, cz] = SHELL.center;
    const [rx, ry, rz] = SHELL.radii;
    const u = [(point[0] - cx) / rx, (point[1] - cy) / ry, (point[2] - cz) / rz];
    const len = Math.hypot(...u);
    if (len < 1e-6) return true;
    return len < silhouette(u[0] / len, u[1] / len, u[2] / len) * 0.98;
  }

  /**
   * Raycast the pointer against the brain — against both pieces and their cut
   * faces when it is cut. Returns the nearest hit in rest space.
   */
  function raycastBrain(clientX, clientY) {
    const proxy = proxyRef.current;
    const group = groupRef.current;
    if (!proxy || !group) return null;
    setRay(clientX, clientY);
    const cut = cutRef.current;
    if (!cut.on || !cut.frame) {
      proxy.matrix.identity();
      proxy.updateMatrixWorld(true);
      const [hit] = raycaster.intersectObject(proxy, false);
      if (!hit) return null;
      scratch.inverse.copy(proxy.matrixWorld).invert();
      return { point: hit.point.clone(), rest: hit.point.clone().applyMatrix4(scratch.inverse), normal: hit.face.normal.clone(), distance: hit.distance };
    }
    let best = null;
    for (const side of [1, -1]) {
      pieceMatrix(side, proxy.matrix);
      proxy.updateMatrixWorld(true);
      scratch.inverse.copy(proxy.matrixWorld).invert();
      for (const hit of raycaster.intersectObject(proxy, false)) {
        if (best && hit.distance >= best.distance) break;
        const rest = hit.point.clone().applyMatrix4(scratch.inverse);
        if (sideOf(cut.frame, rest.toArray()) !== side) continue;
        best = { point: hit.point.clone(), rest, normal: hit.face.normal.clone(), distance: hit.distance };
        break;
      }
      // The cut face itself: where the ray crosses the plane, entering this
      // piece from the other side, inside the brain's outline.
      const ray = scratch.ray.copy(raycaster.ray).applyMatrix4(scratch.inverse);
      const n = scratch.a.set(...cut.frame.normal);
      const denom = n.dot(ray.direction);
      if (side * denom > 1e-4) {
        const t = (cut.frame.d - n.dot(ray.origin)) / denom;
        if (t > 0) {
          const rest = ray.at(t, new THREE.Vector3());
          if (insideShell(rest.toArray())) {
            const point = rest.clone().applyMatrix4(proxy.matrixWorld);
            const distance = point.distanceTo(raycaster.ray.origin);
            if (!best || distance < best.distance) {
              best = { point, rest, normal: n.clone().multiplyScalar(-side), distance };
            }
          }
        }
      }
    }
    proxy.matrix.identity();
    proxy.updateMatrixWorld(true);
    return best;
  }

  function hitTest(clientX, clientY) {
    const hit = raycastBrain(clientX, clientY);
    if (!hit) return null;
    return {
      origin: [hit.rest.x, hit.rest.y, hit.rest.z],
      inward: [-hit.normal.x, -hit.normal.y, -hit.normal.z],
      // The grabbed point in world space and its NDC depth, so a drag can
      // follow the pointer in the plane the point sits in.
      world: hit.point,
      depth: hit.point.clone().project(camera).z,
    };
  }

  /** World point under the pointer at the depth of the brain's centre. */
  function pointerWorld(clientX, clientY, target) {
    const rect = gl.domElement.getBoundingClientRect();
    const depth = target.set(...SHELL.center).applyMatrix4(groupRef.current.matrixWorld).project(camera).z;
    return target.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
      depth,
    ).unproject(camera);
  }

  /** A slash from screen point a to b: the plane they sweep through the eye. */
  function slash(a, b) {
    if (Math.hypot(b.x - a.x, b.y - a.y) < CUT.minStrokePx) return false;
    const group = groupRef.current;
    group.updateMatrixWorld(true);
    scratch.inverse.copy(group.matrixWorld).invert();
    const eye = camera.position.clone().applyMatrix4(scratch.inverse);
    const towards = (point) => pointerWorld(point.x, point.y, new THREE.Vector3()).applyMatrix4(scratch.inverse).sub(eye);
    const plane = planeThroughEye(eye.toArray(), towards(a).toArray(), towards(b).toArray());
    return requestCut(plane, 'swipe');
  }

  function pushTrail(clientX, clientY) {
    const trail = trailRef.current;
    const world = pointerWorld(clientX, clientY, new THREE.Vector3());
    trail.points.push({ p: world.toArray(), at: clockRef.current });
    if (trail.points.length > TRAIL_POINTS) trail.points.shift();
    trail.live = true;
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
          if (knifeModeRef.current) {
            // Knife mode: a drag from off the brain is a slash.
            trailRef.current.points = [];
            pushTrail(event.clientX, event.clientY);
            dragsRef.current.set(event.pointerId, {
              kind: 'slash', start: { x: event.clientX, y: event.clientY }, last: { x: event.clientX, y: event.clientY }, entered: false, done: false, pointerId: event.pointerId,
            });
          } else {
            dragsRef.current.set(event.pointerId, {
              kind: 'rotate', x: event.clientX, y: event.clientY, lastX: event.clientX, pointerId: event.pointerId,
            });
          }
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
          const over = Boolean(raycastBrain(event.clientX, event.clientY));
          element.style.cursor = over ? 'grab' : (knifeModeRef.current ? 'crosshair' : 'default');
        }
        return;
      }
      rotationRef.current.lastInput = clockRef.current;
      if (drag.kind === 'slash') {
        const moved = Math.hypot(event.clientX - drag.last.x, event.clientY - drag.last.y);
        if (moved < 3) return;
        drag.last = { x: event.clientX, y: event.clientY };
        pushTrail(event.clientX, event.clientY);
        if (drag.done) return;
        // The cut lands the moment the blade comes out the other side.
        if (raycastBrain(event.clientX, event.clientY)) drag.entered = true;
        else if (drag.entered) drag.done = slash(drag.start, drag.last);
        return;
      }
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
      if (drag.kind === 'slash') {
        // Slicing into it and stopping inside still cuts along the stroke.
        if (!drag.done && drag.entered) slash(drag.start, { x: event.clientX, y: event.clientY });
        trailRef.current.live = false;
      }
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
      if (event.pointerType === 'mouse') element.style.cursor = knifeModeRef.current ? 'crosshair' : 'grab';
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
        dragsRef.current.clear();
        pinchRef.current = null;
        for (const code of Object.keys(flashRef.current)) flashRef.current[code] = 0;
        lastFiredRef.current = 0;
        cutRef.current = { ...cutRef.current, frame: null, pending: null, target: 0, open: 0, velocity: 0, on: false, axonsAt: -1 };
        chopRef.current = { t: 1, active: false, plane: null, bitten: true, nudge: 0 };
        dropletsRef.current = { list: [], born: -10 };
        knifeModeRef.current = false;
        gl.domElement.style.cursor = 'grab';
        callbacksRef.current.onFired?.(0);
      },
      pokeAt(clientX, clientY) {
        const hit = hitTest(clientX, clientY);
        if (!hit) return false;
        poke(hit, clockRef.current);
        return true;
      },
      /** Slice button: chop the brain in two down the middle. */
      chop,
      /** Close the cut: the pieces slide back together and the jelly heals. */
      heal,
      /** Knife mode: drags from off the brain slash instead of rotating. */
      setKnife(on) {
        knifeModeRef.current = Boolean(on);
        gl.domElement.style.cursor = on ? 'crosshair' : 'grab';
      },
      /** Slash between two client points, as if swiped. For tests and clips. */
      slashBetween(from, to) {
        return slash(from, to);
      },
      get cut() {
        return cutRef.current.on && cutRef.current.target > 0;
      },
      canvas: gl.domElement,
    };
    return () => { apiRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gl, seed, cfg, palette]);

  // --- per frame ------------------------------------------------------------
  useFrame((_state, delta) => {
    const dt = Math.min(delta, 1 / 20);
    clockRef.current += dt;
    const now = clockRef.current;
    sharedUniforms.uTime.value = now;
    const group = groupRef.current;

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

    // The chop: the blade falls down its plane; the cut opens once it bites,
    // so the knife visibly does the cutting.
    const chopState = chopRef.current;
    if (chopState.active) {
      chopState.t = Math.min(1, chopState.t + dt / KNIFE.chopTime);
      if (!chopState.bitten && chopState.t >= KNIFE.biteAt) {
        chopState.bitten = true;
        requestCut(chopState.plane, 'button');
      }
      if (chopState.t >= 1) chopState.active = false;
    }
    const knifeGroup = knifeGroupRef.current;
    if (knifeGroup) {
      const showing = chopState.active && chopState.pose;
      knifeGroup.visible = Boolean(showing);
      if (showing) {
        knifeGroup.position.copy(chopState.pose.position);
        knifeGroup.position.y += knifeY(chopState.t);
        knifeGroup.quaternion.copy(chopState.pose.quaternion);
        const opacity = knifeOpacity(chopState.t);
        for (const material of knifeMaterialsRef.current) if (material) material.opacity = opacity;
      }
    }

    // The cut spring: open, close, or close-then-re-cut.
    const cut = cutRef.current;
    const sprung = cutSpringStep(cut, cut.target, dt, cutCfg);
    cut.open = sprung.open;
    cut.velocity = sprung.velocity;
    if (cut.pending && cut.open < 0.04) {
      const { frame, via } = cut.pending;
      cut.pending = null;
      applyCut(frame, via);
    }
    if (cut.on && cut.target === 0 && !cut.pending && cut.open < CUT.shutEpsilon) {
      // Healed: one body again, with a satisfying squish as it seals.
      const seam = cut.frame.origin;
      cut.on = false;
      cut.frame = null;
      cut.axonsAt = -1;
      const added = addImpulse(jellyRef.current, { origin: seam, dir: [0, -1, 0], amplitude: 0.45, radius: cfg.pokeRadius * 1.6, at: now }, cfg);
      jellyRef.current = { ...added.state, squash: { axis: [0, 1, 0], amount: Math.min(cfg.squashMax, 0.08), at: now } };
      soundRef?.current?.poke(0.35);
    }
    const frame = cut.on ? cut.frame : null;
    sharedUniforms.uCutOn.value = frame ? 1 : 0;
    if (frame) {
      const open = cut.open;
      sharedUniforms.uCutPlane.value.set(frame.normal[0], frame.normal[1], frame.normal[2], frame.d);
      sharedUniforms.uHinge.value.set(...frame.hinge);
      sharedUniforms.uHingeAxis.value.set(...frame.axis);
      sharedUniforms.uTilt.value = frame.tilt * open;
      sharedUniforms.uSlidePos.value.set(...frame.slidePos).multiplyScalar(open);
      sharedUniforms.uSlideNeg.value.set(...frame.slideNeg).multiplyScalar(open);
      sharedUniforms.uCapOrigin.value.set(...frame.origin);
      sharedUniforms.uCutT1.value.set(...frame.t1);
      sharedUniforms.uCutT2.value.set(...frame.t2);
    }
    const pieces = pieceRefs.current;
    for (const key of ['backNeg', 'frontNeg', 'capPos', 'capNeg']) {
      if (pieces[key]) pieces[key].visible = Boolean(frame);
    }
    const place = (point) => (frame ? placeOnCut(frame, cut.open, point) : point);

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

    // Rotation: drag with inertia, then an idle drift once hands are off. A
    // fresh cut turns the brain a little so its new faces come into view.
    const rotation = rotationRef.current;
    if (chopState.nudge && !chopState.active) {
      rotation.velocity += chopState.nudge;
      rotation.lastInput = now;
      chopState.nudge = 0;
    }
    const rotating = [...dragsRef.current.values()].some((entry) => entry.kind === 'rotate');
    if (!rotating) {
      rotation.yaw += rotation.velocity * dt;
      rotation.velocity *= Math.pow(0.04, dt);
      if (!reducedMotion && now - rotation.lastInput > IDLE_ROTATE_AFTER) rotation.yaw += 0.16 * dt;
    }
    if (group) {
      group.rotation.set(rotation.pitch, rotation.yaw, 0);
    }

    // Nodes: brightness from the live model plus a decaying flash per arrival,
    // riding with whichever piece they sit in.
    const activities = simRef.current?.activities || {};
    BRAIN_REGIONS.forEach((region, index) => {
      const flash = flashRef.current[region.code];
      flashRef.current[region.code] = Math.max(0, flash - dt * 1.6);
      const activity = activities[region.code] ?? region.baseActivity;
      const holder = regionRefs.current[region.code];
      if (holder) holder.position.set(...place(region.position));
      const node = nodeRefs.current[region.code];
      if (node) node.scale.setScalar(0.24 + activity * 0.22 + flash * 0.22);
      const halo = haloRefs.current[region.code];
      if (halo) {
        halo.scale.setScalar(1.3 + activity * 1.6 + flash * 3.2);
        halo.material.opacity = 0.18 + activity * 0.35 + flash * 0.65;
      }
      sharedUniforms.uRegions.value[index].w = activity * 0.35 + flash;
    });

    // Axons follow their pieces; a fibre that crosses the cut stretches over
    // the gap like a strand of jelly. Rewritten only while the cut moves.
    const axonKey = frame ? cut.open + cut.count * 10 : 0;
    if (Math.abs(axonKey - cut.axonsAt) > 1e-4) {
      cut.axonsAt = axonKey;
      axons.forEach((axon, index) => {
        const line = axonRefs.current[index];
        if (line) writeLine(line, axon.points.map(place));
      });
    }

    // Travelling signals: a short comet per in-flight hop, on the real curves.
    const mesh = hopMeshRef.current;
    if (mesh) {
      let index = 0;
      for (const hop of jelly.hops) {
        const progress = hopProgress(hop, now, cfg);
        for (let trail = 0; trail < HOP_TRAIL && index < MAX_HOP_INSTANCES; trail += 1) {
          const point = place(pointOnPathway(hop.pathwayId, progress - trail * 0.05));
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

    // Soft contact shadows on the tray: one under the whole brain, or one
    // under each piece once it is cut.
    if (group) {
      const shadows = shadowRefs.current;
      const pieceCentre = (side) => {
        const [ox, oy, oz] = frame.origin;
        const [nx, ny, nz] = frame.normal;
        return placeOnHalf(frame, side, cut.open, [ox + nx * side * 2.2, oy + ny * side * 2.2, oz + nz * side * 2.2]);
      };
      const spots = frame ? [pieceCentre(1), pieceCentre(-1)] : [SHELL.center];
      shadows.forEach((shadow, index) => {
        if (!shadow) return;
        const spot = spots[index];
        shadow.visible = Boolean(spot);
        if (!spot) return;
        const world = group.localToWorld(scratch.world.set(...spot));
        shadow.position.set(world.x, STAGE.trayTop + 0.015, world.z);
        shadow.rotation.set(-Math.PI / 2, 0, rotation.yaw);
        const s = frame ? 0.62 : 1;
        shadow.scale.set(12.5 * s, 8.2 * s, 1);
      });
    }

    // Droplets: closed-form ballistic flight, then a splat that fades.
    const drops = dropletMeshRef.current;
    if (drops) {
      const { list, born } = dropletsRef.current;
      const age = now - born;
      drops.visible = list.length > 0 && age < DROPLETS.life;
      if (drops.visible) {
        list.forEach((droplet, index) => {
          const { position, splat, size: life } = dropletAt(droplet.origin, droplet.velocity, age);
          const r = droplet.radius * life;
          scratch.object.position.set(position[0], position[1], position[2]);
          if (splat) scratch.object.scale.set(r * DROPLETS.splatSpread, r * DROPLETS.splatFlat, r * DROPLETS.splatSpread);
          else scratch.object.scale.setScalar(r);
          scratch.object.updateMatrix();
          drops.setMatrixAt(index, scratch.object.matrix);
        });
        drops.count = list.length;
        drops.instanceMatrix.needsUpdate = true;
      }
    }

    // The slash trail: a bright streak that shrinks away behind the pointer.
    const trail = trailRef.current;
    trail.points = trail.points.filter((point) => now - point.at < TRAIL_LIFE * (trail.live ? 2.5 : 1));
    const showTrail = trail.points.length >= 2;
    trailRefs.current.forEach((line, layer) => {
      if (!line) return;
      line.visible = showTrail;
      if (!showTrail) return;
      const points = [];
      for (let i = 0; i < TRAIL_POINTS; i += 1) {
        const source = trail.points[Math.min(trail.points.length - 1, Math.floor((i / (TRAIL_POINTS - 1)) * (trail.points.length - 1)))];
        points.push(source.p);
      }
      writeLine(line, points);
      line.material.opacity = layer === 0 ? 0.95 : 0.35;
    });
  });

  return (
    <>
      {/* The lab: lights for the tray, the bench it sits on, and the steel
          specimen tray the jelly rests in. The brain spins; the set does not. */}
      <ambientLight intensity={0.55} />
      <directionalLight position={[6, 12, 8]} intensity={1.1} />
      <directionalLight position={[-7, 5, -6]} intensity={0.35} color="#8fb4ff" />
      <mesh position={[SHELL.center[0], STAGE.benchTop, SHELL.center[2]]} rotation={[-Math.PI / 2, 0, 0]} material={floorMaterial} renderOrder={-2}>
        <circleGeometry args={[18, 72]} />
      </mesh>
      <group position={[SHELL.center[0], 0, SHELL.center[2]]}>
        <mesh position={[0, STAGE.trayTop - 0.25, 0]}>
          <cylinderGeometry args={[6.4, 5.9, 0.5, 64]} />
          <meshStandardMaterial color="#6c7784" roughness={0.32} metalness={0.92} />
        </mesh>
        <mesh position={[0, STAGE.trayTop + 0.002, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[6.05, 64]} />
          <meshStandardMaterial color="#3d4651" roughness={0.38} metalness={0.88} />
        </mesh>
        <mesh position={[0, STAGE.trayTop + 0.18, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <torusGeometry args={[6.3, 0.24, 18, 96]} />
          <meshStandardMaterial color="#d3dbe4" roughness={0.16} metalness={1} envMapIntensity={1.4} />
        </mesh>
      </group>
      {[0, 1].map((index) => (
        <mesh key={index} ref={(mesh) => { shadowRefs.current[index] = mesh; }} renderOrder={1}>
          <planeGeometry args={[1, 1]} />
          <meshBasicMaterial map={glowTexture} color="#000000" transparent opacity={0.6} depthWrite={false} polygonOffset polygonOffsetFactor={-2} />
        </mesh>
      ))}
      <group ref={groupRef}>
        {axons.map((axon, index) => (
          <Line
            key={axon.id}
            ref={(line) => { axonRefs.current[index] = line; }}
            points={axon.points}
            color={axon.inhibitory ? INHIBIT : palette.cyan}
            lineWidth={1.4}
            transparent
            opacity={0.26}
            depthWrite={false}
            frustumCulled={false}
          />
        ))}
        {BRAIN_REGIONS.map((region) => (
          <group key={region.code} ref={(node) => { regionRefs.current[region.code] = node; }} position={region.position}>
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
        {/* Back faces of both pieces, then the cut faces, then the front
            faces: the jelly is see-through, so the order is the look. */}
        <mesh ref={(mesh) => { pieceRefs.current.backPos = mesh; }} geometry={geometry} material={materials.backPos} renderOrder={9} frustumCulled={false} />
        <mesh ref={(mesh) => { pieceRefs.current.backNeg = mesh; }} geometry={geometry} material={materials.backNeg} renderOrder={9} frustumCulled={false} visible={false} />
        <mesh ref={(mesh) => { pieceRefs.current.capPos = mesh; }} geometry={capGeometry} material={materials.capPos} renderOrder={9.5} frustumCulled={false} visible={false} />
        <mesh ref={(mesh) => { pieceRefs.current.capNeg = mesh; }} geometry={capGeometry} material={materials.capNeg} renderOrder={9.5} frustumCulled={false} visible={false} />
        <mesh ref={(mesh) => { pieceRefs.current.frontPos = mesh; }} geometry={geometry} material={materials.frontPos} renderOrder={10} frustumCulled={false} />
        <mesh ref={(mesh) => { pieceRefs.current.frontNeg = mesh; }} geometry={geometry} material={materials.frontNeg} renderOrder={10} frustumCulled={false} visible={false} />
        <mesh ref={proxyRef} geometry={proxyGeometry} visible={false} matrixAutoUpdate={false}>
          <meshBasicMaterial />
        </mesh>
        <sprite position={SHELL.center} scale={[18, 13, 1]} renderOrder={-1}>
          <spriteMaterial map={glowTexture} color={palette.violet} transparent opacity={0.1} depthWrite={false} blending={THREE.AdditiveBlending} />
        </sprite>
        <sprite position={[SHELL.center[0] + 2.5, SHELL.center[1] + 0.5, SHELL.center[2]]} scale={[10, 8, 1]} renderOrder={-1}>
          <spriteMaterial map={glowTexture} color={MINT} transparent opacity={0.05} depthWrite={false} blending={THREE.AdditiveBlending} />
        </sprite>
      </group>
      {/* Droplets thrown by a cut, in world space so they fall straight down
          onto the tray while the brain keeps turning. */}
      <instancedMesh ref={dropletMeshRef} args={[null, null, DROPLETS.count]} frustumCulled={false} visible={false} renderOrder={11}>
        <sphereGeometry args={[1, 14, 12]} />
        <meshStandardMaterial roughness={0.06} metalness={0} transparent opacity={0.9} envMapIntensity={1.8} emissive={palette.cyan} emissiveIntensity={0.28} />
      </instancedMesh>
      {/* The knife: chops down the cut plane when Slice is tapped, then fades. */}
      <group ref={knifeGroupRef} visible={false}>
        <mesh geometry={knifeGeometry} renderOrder={12}>
          <meshStandardMaterial ref={(material) => { knifeMaterialsRef.current[0] = material; }} color="#eef2f7" metalness={1} roughness={0.14} envMapIntensity={1.6} transparent opacity={0} />
        </mesh>
        <mesh position={[-4.55, 0.1, 0]} renderOrder={12}>
          <boxGeometry args={[0.28, 1.25, 0.32]} />
          <meshStandardMaterial ref={(material) => { knifeMaterialsRef.current[1] = material; }} color="#c9d1db" metalness={1} roughness={0.25} transparent opacity={0} />
        </mesh>
        <mesh position={[-6.05, 0.18, 0]} renderOrder={12}>
          <boxGeometry args={[2.8, 0.78, 0.46]} />
          <meshStandardMaterial ref={(material) => { knifeMaterialsRef.current[2] = material; }} color="#20252d" metalness={0.15} roughness={0.55} transparent opacity={0} />
        </mesh>
      </group>
      {/* The slash trail: a glow under a bright core, both in world space. */}
      {[1, 0].map((layer) => (
        <Line
          key={layer}
          ref={(line) => { trailRefs.current[layer] = line; }}
          points={trailSeed}
          color={layer === 0 ? '#ffffff' : palette.cyan}
          lineWidth={layer === 0 ? 3.5 : 12}
          transparent
          opacity={0}
          depthTest={false}
          depthWrite={false}
          frustumCulled={false}
          renderOrder={20}
        />
      ))}
    </>
  );
}

/**
 * Rewrite a drei/three-stdlib Line2's points in place — no new buffers, so it
 * is cheap enough to do every frame. `points` must be as long as the line was
 * created with.
 */
function writeLine(line, points) {
  const start = line.geometry?.attributes?.instanceStart;
  if (!start) return;
  const buffer = start.data;
  const array = buffer.array;
  const segments = Math.min(points.length - 1, array.length / 6);
  for (let i = 0; i < segments; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    const o = i * 6;
    array[o] = a[0]; array[o + 1] = a[1]; array[o + 2] = a[2];
    array[o + 3] = b[0]; array[o + 4] = b[1]; array[o + 5] = b[2];
  }
  buffer.needsUpdate = true;
}

/**
 * Memoised on purpose: the simulation re-renders the page ~8 times a second,
 * and none of that should reach the WebGL tree. Everything live flows in
 * through refs.
 */
function PokeBrainScene({ simRef, apiRef, callbacksRef, detail = 'high', reducedMotion = false, active = true, onReady, seed = 'poke', soundRef = null, palette = null }) {
  const dpr = detail === 'high' ? [1, 1.8] : [1, 1.35];
  const jellyPalette = palette || paletteById('brain');
  return (
    <Canvas
      className="poke-canvas"
      dpr={dpr}
      flat
      frameloop={active ? 'always' : 'never'}
      camera={{ fov: 36, near: 0.1, far: 100, position: [0.4, 2.2, 17] }}
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
      />
    </Canvas>
  );
}

export default memo(PokeBrainScene);
