export const renderVertexShader = /* glsl */ `
precision highp float;

uniform sampler2D uPosition;
uniform vec2  uFit;
uniform float uPointSize;
uniform float uPixelRatio;
uniform float uOpacity;
uniform float uTime;

uniform vec3  uPaletteDark;
uniform vec3  uPaletteLight;
uniform float uPaletteAmount;
uniform float uPaletteChroma;
uniform float uLevelLow;
uniform float uLevelHigh;

attribute vec2  aRef;
attribute vec3  aColor;
attribute float aSize;
attribute float aSeed;

varying vec3  vColor;
varying float vAlpha;

void main() {
  vec4 sim = texture2D(uPosition, aRef);
  vec3 p = sim.xyz;

  // Positions live in image space [-1,1]. uFit letterboxes them into the
  // stage without touching the simulation coordinates.
  vec2 xy = p.xy * uFit;

  // The z channel is a 2.5D cue. A small screen-space offset reads as
  // parallax, and it is much cheaper than a perspective camera or sorting.
  xy += p.z * 0.03;

  gl_Position = projectionMatrix * modelViewMatrix * vec4(xy, 0.0, 1.0);

  // z is a 2.5D cue: points get slightly larger and brighter as they come
  // toward the viewer. We do not need a perspective camera or sorting.
  float depth = clamp(p.z, -2.5, 2.5);
  float depthScale = clamp(1.0 + depth * 0.18, 0.35, 2.0);
  float twinkle = 0.92 + 0.08 * sin(uTime * 1.7 + aSeed * 40.0);

  gl_PointSize = clamp(uPointSize * uPixelRatio * aSize * depthScale * twinkle, 1.0, 24.0);

  // Two-stop grade in linear light. The source luminance chooses the stop,
  // so the image structure survives while its colour is unified. uLevelLow/
  // High come from the 15th/85th luminance percentiles: a few specular pixels
  // cannot flatten the whole grade.
  float srcLum = dot(aColor, vec3(0.2126, 0.7152, 0.0722));
  float span = max(uLevelHigh - uLevelLow, 0.001);
  float t = smoothstep(uLevelLow, uLevelLow + span, srcLum);
  vec3 graded = mix(uPaletteDark, uPaletteLight, t);

  float gradeLum = dot(graded, vec3(0.2126, 0.7152, 0.0722));
  graded = mix(vec3(gradeLum), graded, uPaletteChroma);

  vColor = mix(aColor, graded, uPaletteAmount);
  vAlpha = uOpacity * (0.55 + 0.45 * exp(-abs(depth) * 0.7)) * twinkle;
}
`;

export const renderFragmentShader = /* glsl */ `
precision highp float;

varying vec3  vColor;
varying float vAlpha;

void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d2 = dot(c, c);
  if (d2 > 0.25) discard;

  // Soft circular falloff. A 2px dot should not look like a square.
  float alpha = 1.0 - smoothstep(0.04, 0.25, d2);

  // Linear RGB -> sRGB. Doing it explicitly keeps the shader independent of
  // Three's built-in material chunks, which custom ShaderMaterials skip.
  vec3 lin = max(vColor, 0.0);
  vec3 lo = lin * 12.92;
  vec3 hi = 1.055 * pow(lin, vec3(1.0 / 2.4)) - 0.055;
  vec3 srgb = mix(hi, lo, step(lin, vec3(0.0031308)));

  gl_FragColor = vec4(srgb, vAlpha * alpha);
}
`;
