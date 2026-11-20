/** Full-image optical treatment, independent of the particle geometry. */
export const photoVertexShader = /* glsl */ `
precision highp float;
uniform vec2 uFit;
uniform vec3 uImageTransform;
varying vec2 vUv;
void main() {
  vUv = uv + uImageTransform.yz;
  gl_Position = vec4(position.xy * uFit * uImageTransform.x, 0.0, 1.0);
}
`;

export const photoFragmentShader = /* glsl */ `
precision highp float;
uniform sampler2D uImage;
uniform sampler2D uNormals;
uniform float uTime;
uniform float uStrength;
uniform float uRefraction;
uniform float uFolds;
uniform float uBlocks;
uniform float uChroma;
uniform float uBass;
uniform float uTreble;
uniform float uBeat;
uniform float uOpacity;
uniform vec2 uImageSize;
varying vec2 vUv;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

vec2 noise2(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(vec2(hash(i), hash(i + 3.1)), vec2(hash(i + vec2(1., 0.)), hash(i + vec2(4.1, 0.))), f.x),
    mix(vec2(hash(i + vec2(0., 1.)), hash(i + vec2(3.1, 1.))), vec2(hash(i + 1.), hash(i + 4.1)), f.x),
    f.y
  ) * 2.0 - 1.0;
}

void main() {
  vec2 uv = vUv;
  vec4 surface = texture2D(uNormals, uv);
  vec2 gradient = (surface.rg * 255.0 - 128.0) / 127.0;
  float strength = clamp(uStrength, 0.0, 1.0);

  // A liquid lens follows actual luminance contours, with a second slow
  // displacement field. Low values keep local features attached to the face.
  float lens = uRefraction * strength;
  if (lens > 0.0001) {
    vec2 flow = noise2(uv * 4.5 + vec2(uTime * 0.24, -uTime * 0.19));
    uv += (gradient * (0.014 + surface.a * 0.04) + flow * 0.018)
      * lens * (0.5 + uBass * 0.8);
  }

  // Fixed bands in image coordinates. Their offset changes continuously with
  // the beat, but the membership never jumps between frames.
  float fold = uFolds * strength;
  if (fold > 0.0001) {
    float row = floor(vUv.y * 22.0);
    float phase = hash(vec2(row, 2.7)) * 6.2831853;
    uv.x += fold * (0.02 + 0.35 * fold) * sin(phase + uTime * 0.8)
      * (0.4 + uBeat * 0.9);
    uv.y += fold * fold * 0.08 * cos(phase * 1.7 + uTime * 0.4);
  }

  // Source-locked square fragments: at maximum they relocate up to half an
  // image and become broad pixel cells. We never shuffle random identities
  // from one frame to the next; the image tears instead of flickering.
  float blocks = min(1.0, uBlocks * strength * (0.75 + uTreble * 0.45));
  if (blocks > 0.0001) {
    float cells = mix(90.0, 12.0, smoothstep(0.0, 1.0, blocks));
    vec2 cell = floor(vUv * cells);
    vec2 drift = noise2(cell * 0.57 + uTime * 0.08);
    float gate = smoothstep(0.18, 0.65, hash(cell * 0.73 + 3.7));
    uv += drift * gate * blocks * blocks * 0.48;
    // Pixelation emerges late in the range; below 0.5 the photograph still
    // reads as a photograph, not as a coarse thumbnail.
    vec2 pixel = (floor(uv * uImageSize / mix(1.0, 36.0, blocks * blocks))
      + 0.5) * mix(1.0, 36.0, blocks * blocks) / uImageSize;
    uv = mix(uv, pixel, smoothstep(0.45, 0.95, blocks));
  }

  // Outside the photograph, dislocated pieces leave black voids rather than
  // smearing edge pixels across the whole canvas.
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
    gl_FragColor = vec4(0.0, 0.0, 0.0, uOpacity);
    return;
  }
  vec4 image = texture2D(uImage, uv);
  float split = uChroma * strength * strength * (0.003 + 0.085 * uTreble);
  if (split > 0.0001) {
    vec2 axis = normalize(gradient + vec2(0.15, 0.23));
    image.r = texture2D(uImage, clamp(uv + axis * split, 0.0, 1.0)).r;
    image.b = texture2D(uImage, clamp(uv - axis * split, 0.0, 1.0)).b;
  }
  gl_FragColor = vec4(image.rgb, image.a * uOpacity);
}
`;
