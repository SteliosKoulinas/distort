/** Full-screen temporal compositor for bounded photographic residue. */
export const temporalVertexShader = /* glsl */ `
precision highp float;
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export const temporalFragmentShader = /* glsl */ `
precision highp float;
uniform sampler2D uCurrent;
uniform sampler2D uHistory;
uniform float uTime;
uniform float uMemory;
uniform float uDecay;
uniform float uDrift;
uniform float uLow;
uniform float uFlux;
uniform float uTransient;
varying vec2 vUv;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

void main() {
  vec2 direction = vec2(
    sin(uTime * 0.17 + vUv.y * 4.0),
    cos(uTime * 0.13 + vUv.x * 3.0)
  );
  vec2 historyUv = clamp(vUv + direction * uDrift * (0.002 + uLow * 0.009), 0.0, 1.0);
  vec4 current = texture2D(uCurrent, vUv);
  vec4 history = texture2D(uHistory, historyUv);

  // Audio opens memory; decay closes it smoothly instead of cutting the
  // residue when a transient ends. Flux adds a short-lived visual trace.
  float memory = clamp(uMemory * (0.45 + uFlux * 0.35 + uTransient * 0.5), 0.0, 0.92);
  float persistence = clamp(memory * (1.0 - uDecay * 0.62), 0.0, 0.9);
  float veil = mix(0.0, 0.18, persistence);
  vec3 colour = current.rgb * (1.0 - veil) + history.rgb * persistence;
  colour /= max(1.0, 1.0 + persistence * 0.35);
  gl_FragColor = vec4(colour, 1.0);
}
`;

export const temporalCopyFragmentShader = /* glsl */ `
precision highp float;
uniform sampler2D uTexture;
varying vec2 vUv;
void main() {
  gl_FragColor = texture2D(uTexture, vUv);
}
`;
