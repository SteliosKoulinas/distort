/** Region-based continuous planes with source-derived luminance segmentation. */
export const fragmentedVertexShader = /* glsl */ `
precision highp float;
uniform vec2 uFit;
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy * uFit, 0.0, 1.0);
}
`;

export const fragmentedFragmentShader = /* glsl */ `
precision highp float;
uniform sampler2D uImage;
uniform float uTime;
uniform float uIntensity;
uniform float uPlanes;
uniform float uDepth;
uniform float uDrift;
uniform float uLow;
uniform float uMid;
uniform float uTransient;
uniform float uCentroid;
uniform float uOpacity;
varying vec2 vUv;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

vec3 source(vec2 uv) {
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return vec3(0.0);
  return texture2D(uImage, uv).rgb;
}

float luminance(vec3 colour) {
  return dot(colour, vec3(0.2126, 0.7152, 0.0722));
}

void main() {
  vec2 uv = vUv;
  vec3 base = source(uv);
  float levels = 3.0 + uPlanes * 5.0;
  float material = luminance(base);
  float activity = clamp(uIntensity * (0.35 + uLow * 0.55 + uMid * 0.25 + uTransient * 0.45), 0.0, 1.0);
  vec2 axis = normalize(vec2(0.35 + uCentroid, 1.0));
  vec3 colour = vec3(0.0);
  float total = 0.0;

  // Soft luminance bands act as meaningful planes. Each band samples the
  // original photograph at a different parallax, rather than becoming a
  // collection of arbitrary rectangles.
  for (int i = 0; i < 8; i++) {
    float index = float(i);
    float centre = (index + 0.5) / levels;
    float weight = 1.0 - smoothstep(0.10, 0.34, abs(material - centre));
    float phase = hash(vec2(index, 4.7)) * 6.2831;
    vec2 planeOffset = axis * sin(uTime * (0.035 + uLow * 0.05) + phase) * uDrift * 0.012;
    planeOffset += axis * (centre - 0.5) * uDepth * activity * 0.045;
    planeOffset += vec2(-axis.y, axis.x) * uTransient * sin(phase + uTime * 0.4) * 0.008;
    colour += source(uv + planeOffset) * weight;
    total += weight;
  }

  colour /= max(total, 0.001);
  float boundary = smoothstep(0.04, 0.3, abs(fract(material * levels) - 0.5));
  colour = mix(base, colour, clamp(activity * (0.32 + boundary * 0.82), 0.0, 1.0));
  gl_FragColor = vec4(colour, uOpacity);
}
`;
