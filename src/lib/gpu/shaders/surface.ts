/** Continuous morphology engine: a nonlinear viscous surface, not particles. */
export const surfaceVertexShader = /* glsl */ `
precision highp float;
uniform vec2 uFit;
uniform vec3 uImageTransform;
varying vec2 vUv;
void main() {
  vUv = uv + uImageTransform.yz;
  gl_Position = vec4(position.xy * uFit * uImageTransform.x, 0.0, 1.0);
}
`;

export const surfaceFragmentShader = /* glsl */ `
precision highp float;
uniform sampler2D uImage;
uniform float uTime;
uniform float uIntensity;
uniform float uViscosity;
uniform float uScale;
uniform float uFolding;
uniform float uLow;
uniform float uMid;
uniform float uHigh;
uniform float uFlux;
uniform float uTransient;
uniform float uCentroid;
uniform float uOpacity;
varying vec2 vUv;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

vec2 noise2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(vec2(hash(i), hash(i + 3.1)), vec2(hash(i + vec2(1.0, 0.0)), hash(i + 4.1)), f.x),
    mix(vec2(hash(i + vec2(0.0, 1.0)), hash(i + 3.1 + vec2(0.0, 1.0))),
        vec2(hash(i + vec2(1.0, 1.0)), hash(i + 4.1 + vec2(1.0, 1.0))), f.x),
    f.y
  ) * 2.0 - 1.0;
}

vec3 source(vec2 uv) {
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return vec3(0.0);
  return texture2D(uImage, uv).rgb;
}

void main() {
  vec2 uv = vUv;
  float energy = clamp(uLow * 0.42 + uMid * 0.34 + uHigh * 0.14 + uFlux * 0.35, 0.0, 1.4);
  float activity = clamp(uIntensity * energy, 0.0, 1.0);
  float flowTime = uTime * (0.045 + uLow * 0.11);
  float scale = 1.5 + uScale * 8.0;

  // Two nested fields produce a viscous current rather than one generic warp.
  vec2 broad = noise2(uv * scale * 0.38 + vec2(flowTime, -flowTime * 0.7));
  vec2 local = noise2((uv + broad * 0.07) * scale * 1.8 + vec2(-flowTime * 1.4, flowTime));
  vec2 current = broad * (0.018 + uViscosity * 0.025) * (0.35 + uLow);
  current += local * (0.006 + uViscosity * 0.018) * (0.25 + uMid);
  current *= activity;

  // Adjacent regions converge and separate as a continuous crease.
  float crease = sin((uv.y + broad.x * 0.08) * (3.0 + uScale * 11.0) + flowTime * 2.0);
  float foldMask = smoothstep(0.35, 0.95, abs(crease)) * uFolding * activity;
  vec2 foldDirection = normalize(vec2(0.25 + uCentroid, 1.0));
  current += foldDirection * crease * foldMask * 0.025;

  float elasticity = 1.0 + uTransient * 1.6;
  vec2 displacedUv = uv + current * elasticity;
  vec3 displaced = source(displacedUv);
  vec3 folded = source(uv + current * 1.8 - foldDirection * foldMask * 0.015);
  vec3 colour = mix(displaced, folded, foldMask * 0.72);

  // Luminance boundaries keep the result tied to the photograph.
  float l0 = dot(source(uv), vec3(0.2126, 0.7152, 0.0722));
  float l1 = dot(source(uv + current * 2.2), vec3(0.2126, 0.7152, 0.0722));
  float materialEdge = smoothstep(0.025, 0.18, abs(l1 - l0));
  colour = mix(source(uv), colour, clamp(0.3 + materialEdge * 0.8 * activity, 0.0, 1.0));
  colour *= 1.0 + (uHigh * 0.06 + uTransient * 0.04) * materialEdge;

  gl_FragColor = vec4(colour, uOpacity);
}
`;
