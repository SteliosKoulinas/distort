export const renderVertexShader = /* glsl */ `
precision highp float;

uniform sampler2D uPosition;
uniform sampler2D uNormals;
uniform vec2  uFit;
uniform vec3  uImageTransform;
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

// The photograph as an optical surface, 0..1 each.
uniform float uLens;    // bend along the local gradient (refraction)
uniform float uRaster;  // cut into the image's own cells
uniform float uSlice;   // horizontal bands sliding sideways
uniform float uRelief;  // lift the bright structure off the paper

attribute vec2  aRef;
attribute vec2  aOrigin;
attribute vec3  aColor;
attribute float aSize;
attribute float aSeed;

varying vec3  vColor;
varying float vAlpha;

float hash11(float n) {
  return fract(sin(n * 12.9898) * 43758.5453);
}

vec2 hash21(float n) {
  return fract(sin(vec2(n, n + 37.7) * vec2(12.9898, 78.233)) * 43758.5453) * 2.0 - 1.0;
}

void main() {
  vec4 sim = texture2D(uPosition, aRef);
  vec3 p = sim.xyz;

  // Positions live in image space [-1,1]. uFit frames them into the stage
  // without touching the simulation coordinates.
  // Match the continuous image's crop/zoom transform so dots remain attached
  // to the same source pixels as the photograph below them.
  float imageZoom = uImageTransform.x;
  vec2 imageOffset = uImageTransform.yz;
  vec2 xy = (p.xy - imageOffset * 2.0) * imageZoom * uFit;

  // ---- Image-anchored optics -------------------------------------------
  // Every offset below is read from the photograph itself and expressed in
  // its own coordinates. The dots keep their colour and their place in the
  // picture; what moves is the surface they describe. With no audio the
  // strengths fall to ~0, so the image is simply itself.
  vec2 uv = aOrigin * 0.5 + 0.5;
  vec4 surface = texture2D(uNormals, uv);
  vec2 nrm = (surface.xy * 255.0 - 128.0) / 127.0;
  float relief = surface.z;
  float detail = surface.w;

  // 1. Lens. Displacement along the local luminance gradient: flat areas stay
  //    put, contours slide along their own normal. This is the whole trick —
  //    the image is not rearranged, it is viewed through a moving surface.
  vec2 bend = nrm * uLens * (0.45 + detail * 1.4) * 0.09;
  xy += bend * imageZoom * uFit;

  // 2. Raster. The image is cut into its own cells; each cell drifts as a
  //    pane and opens from its centre. Cell identity comes from the source
  //    uv, so the cut can never shuffle the picture.
  if (uRaster > 0.0005) {
    float cells = 40.0;
    vec2 cell = floor(uv * cells);
    vec2 centre = (cell + 0.5) / cells;
    vec2 jitter = hash21(cell.x * 17.0 + cell.y * 131.0);
    vec2 drift = vec2(
      sin(uTime * 0.61 + jitter.x * 6.2831),
      cos(uTime * 0.47 + jitter.y * 6.2831)
    );
    vec2 offset = (jitter * 0.55 + drift * 0.45) * uRaster * 0.045;
    vec2 open = (uv - centre) * uRaster * 0.14;
    xy += (offset + open) * 2.0 * imageZoom * uFit;
  }

  // 3. Slice. Horizontal bands of the source slide sideways and stop. The
  //    band index is the image row, so the seam reads as a lifted strip, not
  //    as noise.
  if (uSlice > 0.0005) {
    float bands = 22.0;
    float band = floor(uv.y * bands);
    float dir = hash11(band * 3.17 + 5.0) * 2.0 - 1.0;
    xy.x += dir * uSlice * 0.085 * imageZoom * uFit.x;
  }

  // 4. Relief. The bright structure lifts toward the viewer; the shadows stay
  //    on the paper. This is what keeps a face readable when it opens.
  float z = p.z + (relief - 0.5) * uRelief * 0.9;

  // The z channel is a 2.5D cue. A small screen-space offset reads as
  // parallax, and it is much cheaper than a perspective camera or sorting.
  xy += z * 0.03;

  gl_Position = projectionMatrix * modelViewMatrix * vec4(xy, 0.0, 1.0);

  // z is a 2.5D cue: points get slightly larger and brighter as they come
  // toward the viewer. We do not need a perspective camera or sorting.
  float depth = clamp(z, -2.5, 2.5);
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
