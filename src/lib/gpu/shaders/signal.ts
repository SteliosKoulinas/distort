/** Content-aware signal instability without particle decomposition. */
export const signalVertexShader = /* glsl */ `
precision highp float;
uniform vec2 uFit;
uniform vec3 uImageTransform;
varying vec2 vUv;
void main() {
  vUv = uv + uImageTransform.yz;
  gl_Position = vec4(position.xy * uFit * uImageTransform.x, 0.0, 1.0);
}
`;

export const signalFragmentShader = /* glsl */ `
precision highp float;
uniform sampler2D uImage;
uniform float uTime;
uniform float uIntensity;
uniform float uRows;
uniform float uChannel;
uniform float uRecovery;
uniform float uHigh;
uniform float uFlux;
uniform float uTransient;
uniform float uCentroid;
uniform float uOpacity;
varying vec2 vUv;

float hash(float n) {
  return fract(sin(n * 127.1) * 43758.5453123);
}

float noise(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

vec3 source(vec2 uv) {
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return vec3(0.0);
  return texture2D(uImage, uv).rgb;
}

void main() {
  vec2 uv = vUv;
  float spectral = clamp(uFlux * 0.72 + uTransient * 0.86 + uHigh * 0.16, 0.0, 1.5);
  float event = clamp(uIntensity * (0.16 + spectral * 0.9), 0.0, 1.0);
  float rowIndex = floor(uv.y * (10.0 + uRows * 170.0));
  float rowPhase = hash(rowIndex + 17.3);
  float rowPulse = 0.5 + 0.5 * sin(uTime * (1.2 + uRows * 2.8) + rowPhase * 6.2831 + rowIndex * 0.07);
  float rowEvent = smoothstep(0.34, 0.9, rowPulse) * event;
  float slowLine = sin(uv.y * (32.0 + uRows * 120.0) + uTime * (0.9 + uRows * 1.8)) * 0.5 + 0.5;
  float selective = rowEvent * smoothstep(0.22, 0.82, slowLine);

  // Rows shift as signal events, while the source image remains the material.
  float slip = sin(uTime * (1.8 + uCentroid * 2.2) + rowIndex * 1.71 + rowPhase * 4.0);
  float signedShift = (slip * 0.7 + (hash(rowIndex + 8.3) * 2.0 - 1.0) * 0.3) * selective;
  vec2 displacement = vec2(signedShift * (0.018 + uCentroid * 0.028), 0.0);
  vec2 redUv = uv + displacement * (1.0 + uChannel * 1.6);
  vec2 greenUv = uv + displacement * 0.35;
  vec2 blueUv = uv - displacement * (1.0 + uChannel * 1.8);
  vec3 dislocated = vec3(source(redUv).r, source(greenUv).g, source(blueUv).b);

  // A small edge test makes corruption prefer meaningful image boundaries.
  vec3 here = source(uv);
  float luma = dot(here, vec3(0.2126, 0.7152, 0.0722));
  float neighbour = dot(source(uv + vec2(0.004, 0.0)), vec3(0.2126, 0.7152, 0.0722));
  float edge = smoothstep(0.018, 0.22, abs(luma - neighbour));
  float material = clamp(0.2 + edge * 1.2, 0.0, 1.0);
  float disruption = selective * material * (1.0 - uRecovery * 0.35);
  vec3 colour = mix(here, dislocated, disruption);

  // Sparse scanline lift is intentionally restrained and disappears between
  // events instead of becoming a permanent glitch overlay.
  float line = smoothstep(0.78, 0.98, fract(uv.y * (24.0 + uRows * 100.0) + uTime * 0.12));
  colour = mix(colour, colour.bgr, line * (0.12 + selective * 0.16));
  colour *= 1.0 + (slowLine - 0.5) * event * 0.12;
  gl_FragColor = vec4(colour, uOpacity);
}
`;
