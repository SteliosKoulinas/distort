/** Continuous image engine: the source is deformed along its own structure field. */
export const structuralVertexShader = /* glsl */ `
precision highp float;
uniform vec2 uFit;
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy * uFit, 0.0, 1.0);
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
  // R/G store the principal direction, B coherence, A gradient magnitude.
  vec2 direction = normalize(structure.rg * 2.0 - 1.0);
  vec2 across = vec2(-direction.y, direction.x);
  float coherence = structure.b;
  float gradient = structure.a;

  float material = mix(0.25, 1.0, coherence) * (0.35 + gradient * 0.9);
  float slow = noise(uv * (2.0 + uScale * 3.0) + vec2(uTime * 0.055, -uTime * 0.035));
  float grain = noise(uv * (10.0 + uScale * 12.0) + vec2(-uTime * 0.11, uTime * 0.08));
  float sound = clamp(uLow * 0.55 + uMid * 0.28 + uHigh * 0.12 + uFlux * 0.4 + uTransient * 0.35, 0.0, 1.5);
  float activity = clamp(uIntensity * sound, 0.0, 1.0);

  // The source's coherent direction determines the long axis of the motion.
  // A second cross-flow is strongest where the structure is less coherent.
  float longitudinal = slow * 0.018 * (0.35 + uLow * 0.85);
  float lateral = grain * 0.012 * (1.0 - coherence) * (0.25 + uMid);
  vec2 displacement = direction * longitudinal + across * lateral;
  displacement *= material * activity;

  // Erosion is a selective loss of continuity, not a uniform opacity pulse.
  // Recovery returns detail toward the source instead of leaving a permanent
  // black mask after a transient.
  float wear = smoothstep(0.45, 0.82, slow + grain * 0.22 + uTransient * 0.22);
  float selective = wear * gradient * coherence * activity;
  float recovery = clamp(uRecovery + (1.0 - activity) * 0.55, 0.0, 1.0);
  vec3 displaced = sampleImage(uv + displacement);
  vec3 stretched = sampleImage(uv + displacement * 1.8 + direction * selective * 0.035);
  vec3 colour = mix(displaced, stretched, selective * (1.0 - recovery * 0.65));

  // Preserve smooth photographic regions and let edges carry the event.
  float edgeHold = smoothstep(0.02, 0.28, gradient * uSensitivity);
  colour = mix(sampleImage(uv), colour, clamp(0.22 + edgeHold * 0.9 * activity, 0.0, 1.0));
  float veil = smoothstep(0.78, 1.0, selective) * (1.0 - recovery) * 0.28;
  colour *= 1.0 - veil;

  gl_FragColor = vec4(colour, uOpacity);
}
`;
