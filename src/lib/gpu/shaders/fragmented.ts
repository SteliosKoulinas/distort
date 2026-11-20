/** Region-based continuous planes with source-derived luminance segmentation. */
export const fragmentedVertexShader = /* glsl */ `
precision highp float;
uniform vec2 uFit;
uniform vec3 uImageTransform;
varying vec2 vUv;
void main() {
  vUv = uv + uImageTransform.yz;
  gl_Position = vec4(position.xy * uFit * uImageTransform.x, 0.0, 1.0);
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

float sourceLuma(vec3 colour) {
  return dot(colour, vec3(0.2126, 0.7152, 0.0722));
}

void main() {
  vec2 uv = vUv;
  vec3 base = source(uv);
  float levels = 3.0 + uPlanes * 5.0;
  float material = sourceLuma(base);
  float breath = 0.5 + 0.5 * sin(uTime * 0.28 + material * 8.0);
  float activity = clamp(uIntensity * (0.24 + breath * 0.1 + uLow * 0.65 + uMid * 0.38 + uTransient * 0.6), 0.0, 1.0);
  vec2 axis = normalize(vec2(0.35 + uCentroid, 1.0));
  vec3 colour = vec3(0.0);
  float total = 0.0;

  // Soft luminance bands act as meaningful planes. Each band samples the
  // original photograph at a different parallax, rather than becoming a
  // collection of arbitrary rectangles.
  for (int i = 0; i < 8; i++) {
    float index = float(i);
    float centre = (index + 0.5) / levels;
    float weight = 1.0 - smoothstep(0.07, 0.28, abs(material - centre));
    float phase = hash(vec2(index, 4.7)) * 6.2831;
    float planeSpeed = 0.16 + index * 0.035 + uLow * 0.14;
    vec2 planeOffset = axis * sin(uTime * planeSpeed + phase) * uDrift * (0.022 + activity * 0.018);
    planeOffset += axis * (centre - 0.5) * uDepth * (0.035 + activity * 0.075);
    planeOffset += vec2(-axis.y, axis.x)
      * sin(phase + uTime * (0.32 + uMid * 0.5)) * uDrift * (0.008 + uTransient * 0.022);
    colour += source(uv + planeOffset) * weight;
    total += weight;
  }

  colour /= max(total, 0.001);
  float boundary = smoothstep(0.04, 0.3, abs(fract(material * levels) - 0.5));
  float separation = clamp(activity * (0.44 + boundary * 0.9), 0.0, 1.0);
  colour = mix(base, colour, separation);
  // A narrow dark seam makes adjacent planes readable without turning the
  // image into arbitrary rectangles or a permanent black mask.
  float seam = 1.0 - smoothstep(0.08, 0.22, abs(fract(material * levels) - 0.5));
  colour *= 1.0 - seam * activity * 0.16;
  gl_FragColor = vec4(colour, uOpacity);
}
`;
