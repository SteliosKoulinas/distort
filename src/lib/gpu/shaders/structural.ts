/** Continuous image engine: the source is deformed along its own structure field. */
export const structuralVertexShader = /* glsl */ `
precision highp float;
uniform vec2 uFit;
uniform vec3 uImageTransform;
varying vec2 vUv;
void main() {
  vUv = uv + uImageTransform.yz;
  gl_Position = vec4(position.xy * uFit * uImageTransform.x, 0.0, 1.0);
}
`;

export const structuralFragmentShader = /* glsl */ `
precision highp float;
uniform sampler2D uImage;
uniform sampler2D uStructure;
uniform float uTime;
uniform float uIntensity;
uniform float uSensitivity;
uniform float uRecovery;
uniform float uScale;
uniform float uLow;
uniform float uMid;
uniform float uHigh;
uniform float uFlux;
uniform float uTransient;
uniform float uOpacity;
varying vec2 vUv;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
    f.y
  ) * 2.0 - 1.0;
}

vec3 sampleImage(vec2 uv) {
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return vec3(0.0);
  return texture2D(uImage, uv).rgb;
}

void main() {
  vec2 uv = vUv;
  vec4 structure = texture2D(uStructure, uv);
  // R/G store the gradient axis in texture coordinates, B coherence, A magnitude.
  vec2 gradientDir = normalize(structure.rg * 2.0 - 1.0);
  vec2 contourDir = vec2(-gradientDir.y, gradientDir.x);
  float coherence = structure.b;
  float gradient = structure.a;

  float material = mix(0.25, 1.0, coherence) * (0.35 + gradient * 0.9);
  float slow = noise(uv * (2.0 + uScale * 3.0) + vec2(uTime * 0.055, -uTime * 0.035));
  float grain = noise(uv * (10.0 + uScale * 12.0) + vec2(-uTime * 0.11, uTime * 0.08));
  float sound = clamp(uLow * 0.55 + uMid * 0.28 + uHigh * 0.12 + uFlux * 0.4 + uTransient * 0.35, 0.0, 1.5);
  // Erosion has a visible material life even in silence. Audio is an
  // accelerator, not an on/off switch, so the contour field never freezes.
  float breath = 0.5 + 0.5 * sin(uTime * (0.32 + uScale * 0.35) + slow * 2.4);
  float activity = clamp(uIntensity * (0.2 + sound * 0.82 + breath * 0.12), 0.0, 1.0);

  // The source's coherent direction determines the long axis of the motion.
  // A second cross-flow is strongest where the structure is less coherent.
  float longitudinal = slow * (0.032 + uScale * 0.018) * (0.4 + uLow * 0.85);
  float lateral = grain * (0.022 + uScale * 0.012) * (1.0 - coherence) * (0.3 + uMid);
  vec2 displacement = contourDir * longitudinal + gradientDir * lateral;
  displacement *= material * activity;

  // Erosion is a selective loss of continuity, not a uniform opacity pulse.
  // Recovery returns detail toward the source instead of leaving a permanent
  // black mask after a transient.
  float wearWave = 0.5 + 0.5 * sin(uTime * (0.7 + uScale * 0.8) + slow * 4.0 + grain * 2.0);
  float wear = smoothstep(0.4, 0.72, slow * 0.62 + grain * 0.2 + wearWave * 0.34 + uTransient * 0.28);
  float selective = wear * gradient * coherence * activity;
  float recovery = clamp(uRecovery + (1.0 - activity) * 0.55, 0.0, 1.0);
  vec3 displaced = sampleImage(uv + displacement);
  vec3 stretched = sampleImage(uv + displacement * 1.8 + contourDir * selective * 0.075);
  vec3 colour = mix(displaced, stretched, selective * (1.0 - recovery * 0.65));

  // Preserve smooth photographic regions and let edges carry the event.
  float edgeHold = smoothstep(0.02, 0.28, gradient * uSensitivity);
  colour = mix(sampleImage(uv), colour, clamp(0.28 + edgeHold * 1.05 * activity, 0.0, 1.0));
  float incision = smoothstep(0.62, 0.94, grain + wearWave * 0.28 + uTransient * 0.22)
    * gradient * coherence * activity;
  colour = mix(colour, vec3(0.0), incision * (1.0 - recovery) * 0.42);
  float veil = smoothstep(0.68, 1.0, selective) * (1.0 - recovery) * 0.38;
  colour *= 1.0 - veil;

  gl_FragColor = vec4(colour, uOpacity);
}
`;
