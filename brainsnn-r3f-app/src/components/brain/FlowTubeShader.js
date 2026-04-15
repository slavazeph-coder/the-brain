export const flowTubeVertexShader = /* glsl */ `
varying vec2 vUv;
varying vec3 vPosition;

void main() {
  vUv = uv;
  vPosition = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const flowTubeFragmentShader = /* glsl */ `
uniform float uTime;
uniform float uActivity;
uniform float uWeight;
uniform float uPulseTime;
uniform float uPulseOrigin;
uniform vec3 uBaseColor;
uniform vec3 uPulseColor;

varying vec2 vUv;
varying vec3 vPosition;

void main() {
  // Radial glow: brighter at tube center, fading at edges
  float radialGlow = 1.0 - abs(vUv.y - 0.5) * 2.0;
  radialGlow = smoothstep(0.0, 0.6, radialGlow);

  // Ambient scrolling flow pattern
  float flow1 = sin((vUv.x - uTime * 0.25) * 18.0) * 0.5 + 0.5;
  float flow2 = sin((vUv.x - uTime * 0.4) * 32.0) * 0.3 + 0.5;
  float flow = mix(flow1, flow2, 0.3);
  flow *= smoothstep(0.0, 0.3, radialGlow);

  // Activity-driven brightness
  float activityBrightness = mix(0.06, 0.5, uActivity);
  float brightness = activityBrightness + flow * uActivity * 0.35;

  // Weight influence on base visibility
  brightness *= 0.5 + uWeight * 0.5;

  // Pulse wave animation
  float pulseTarget = mix(uPulseOrigin, 1.0 - uPulseOrigin, uPulseTime);
  float pulseBand = smoothstep(0.18, 0.0, abs(vUv.x - pulseTarget));
  float pulseActive = step(0.0, uPulseTime) * step(uPulseTime, 1.0);
  float pulse = pulseBand * pulseActive;

  // Secondary trailing glow behind pulse
  float trailPos = mix(uPulseOrigin, 1.0 - uPulseOrigin, max(0.0, uPulseTime - 0.15));
  float trail = smoothstep(0.3, 0.0, abs(vUv.x - trailPos)) * pulseActive * 0.3;

  // Combine colors
  vec3 baseCol = uBaseColor * brightness;
  vec3 pulseCol = uPulseColor * (pulse + trail);
  vec3 finalColor = baseCol + pulseCol;

  // Alpha: base tube visibility + pulse
  float alpha = max(brightness * 0.55, (pulse + trail) * 0.9);
  alpha *= radialGlow;

  // Minimum visibility so the web structure is always faintly visible
  alpha = max(alpha, 0.03 * radialGlow);

  gl_FragColor = vec4(finalColor, alpha);
}
`;

export const defaultUniforms = {
  uTime: { value: 0 },
  uActivity: { value: 0 },
  uWeight: { value: 0.3 },
  uPulseTime: { value: -1.0 },
  uPulseOrigin: { value: 0.0 },
  uBaseColor: { value: [0.31, 0.66, 0.70] },
  uPulseColor: { value: [0.77, 0.95, 1.0] }
};
