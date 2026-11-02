import { noiseGLSL } from './noise';

export const simulationVertexShader = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export const initializationFragmentShader = /* glsl */ `
precision highp float;
uniform sampler2D uOrigins;
uniform float uMode;
varying vec2 vUv;

void main() {
  vec4 origin = texture2D(uOrigins, vUv);
  gl_FragColor = uMode < 0.5 ? vec4(origin.xyz, 0.0) : vec4(0.0);
}
`;

export const velocityFragmentShader = /* glsl */ `
precision highp float;

uniform sampler2D uOrigins;
uniform sampler2D uPositions;
uniform sampler2D uVelocities;

uniform float uTime;
uniform float uDt;
uniform float uSeed;

uniform float uCurlStrength;
uniform float uCurlScale;
uniform float uCurlSpeed;

uniform float uSpring;
uniform float uDamping;
uniform float uMaxSpeed;

uniform vec2  uPointer;
uniform float uPointerStrength;
uniform float uPointerRadius;
uniform float uPointerSwirl;
uniform float uPointerActive;

uniform float uPulse;
uniform float uPulseStrength;
uniform float uPulseRadius;

uniform float uWaveStrength;
uniform float uWaveFrequency;
uniform float uWaveSpeed;

uniform float uFractureStrength;
uniform float uFractureScale;
uniform float uFractureSpread;

uniform float uDepthStrength;

uniform float uAssembly;

varying vec2 vUv;

${noiseGLSL}

// UI values are "human" strengths; these gains put them into scene units.
const float CURL_GAIN = 0.16;
const float POINTER_GAIN = 0.40;
const float PULSE_GAIN = 0.75;
const float WAVE_GAIN = 0.35;
const float DEPTH_GAIN = 0.40;

void main() {
  vec4 O = texture2D(uOrigins, vUv);
  vec4 P = texture2D(uPositions, vUv);
  vec4 V = texture2D(uVelocities, vUv);

  vec3 origin = O.xyz;
  vec3 pos = P.xyz;
  vec3 vel = V.xyz;
  float seed = hash12(vUv * 1024.0 + vec2(uSeed * 0.137, uSeed * 0.311));
  float mass = clamp(O.w, 0.35, 2.0);

  vec3 acc = vec3(0.0);
  // uAssembly is the one-frame "pull the image back together" envelope.
  float free = 1.0 - uAssembly;

  if (uCurlStrength > 0.0001) {
    vec3 q = pos * uCurlScale + vec3(0.0, 0.0, uTime * uCurlSpeed);
    vec3 flow = curlNoise(q);
    acc += flow * (uCurlStrength * CURL_GAIN * free) * (0.65 + seed * 0.7);
  }

  // Hooke's law. Assembly adds a temporary stiff spring, and still works
  // even when the user has switched the normal spring off.
  float springK = uSpring + uAssembly * 10.0;
  if (springK > 0.0001) {
    acc += (origin - pos) * springK;
  }

  if (uPointerActive > 0.5 && abs(uPointerStrength) > 0.0001) {
    vec2 d = uPointer - pos.xy;
    float dist2 = dot(d, d);
    float rr = uPointerRadius * uPointerRadius;
    float falloff = rr / (dist2 + rr);
    vec2 dir = d * inversesqrt(dist2 + 0.0001);
    vec2 perp = vec2(-dir.y, dir.x);
    acc.xy += (dir * uPointerStrength + perp * uPointerSwirl) * (falloff * POINTER_GAIN * free);
    acc.z += (seed - 0.5) * abs(uPointerStrength) * falloff * 0.12 * free;
  }

  // Radial beat impulse. The envelope uPulse is decayed on the CPU.
  if (uPulse > 0.0001) {
    vec2 d = pos.xy;
    float dist = length(d) + 0.0001;
    vec2 dir = d / dist;
    float rr = uPulseRadius * uPulseRadius;
    float falloff = rr / (dist * dist + rr);
    acc.xy += dir * uPulse * uPulseStrength * falloff * PULSE_GAIN * free;
    acc.z += (seed - 0.5) * uPulse * uPulseStrength * 0.25 * free;
  }

  // Traveling ring: sin(k*d - omega*t) with an exponential envelope.
  if (uWaveStrength > 0.0001) {
    vec2 d = pos.xy;
    float dist = length(d) + 0.0001;
    vec2 dir = d / dist;
    float env = exp(-dist * 1.6);
    float phase = dist * uWaveFrequency - uTime * uWaveSpeed;
    acc.xy += dir * sin(phase) * env * uWaveStrength * WAVE_GAIN * free;
    acc.z += cos(phase) * env * uWaveStrength * 0.12 * free;
  }

  // Jittered-grid Voronoi. Each cell's particles are pulled toward a moving
  // cell centre, which approximates a set of drifting glass shards.
  if (uFractureStrength > 0.0001) {
    vec2 p = pos.xy * uFractureScale;
    vec2 base = floor(p);
    vec2 f = fract(p);
    float d1 = 8.0;
    float d2 = 8.0;
    vec2 best = vec2(0.0);
    vec2 bestCell = vec2(0.0);

    for (int j = -1; j <= 1; j++) {
      for (int i = -1; i <= 1; i++) {
        vec2 g = vec2(float(i), float(j));
        vec2 h = hash22(base + g + uSeed * 0.017);
        vec2 r = g + h - f;
        float d = dot(r, r);
        if (d < d1) {
          d2 = d1;
          d1 = d;
          best = r;
          bestCell = base + g;
        } else if (d < d2) {
          d2 = d;
        }
      }
    }

    vec2 centre = (bestCell + hash22(bestCell + 7.13 + uSeed * 0.011)) / uFractureScale;
    vec2 drift = (hash22(bestCell + 31.7 + uSeed * 0.013) * 2.0 - 1.0) * uFractureSpread;
    acc.xy += (centre + drift - pos.xy) * uFractureStrength * free;

    // A little push away from the cell border sharpens the gaps.
    float border = sqrt(d2) - sqrt(d1);
    acc.xy -= (best / (length(best) + 0.0001)) * exp(-border * 8.0) * uFractureStrength * 0.12 * free;
  }

  if (uDepthStrength > 0.0001) {
    float n = snoise(vec3(pos.xy * 1.7, uTime * 0.12 + seed * 5.0));
    acc.z += n * uDepthStrength * DEPTH_GAIN * free;
  }

  acc /= mass;

  // Semi-implicit Euler: velocity first, then position in the next pass.
  vel += acc * uDt;
  vel *= pow(clamp(uDamping, 0.5, 0.999), uDt * 60.0);

  float speed = length(vel);
  if (speed > uMaxSpeed) {
    vel *= uMaxSpeed / speed;
  }

  gl_FragColor = vec4(vel, V.w);
}
`;

export const positionFragmentShader = /* glsl */ `
precision highp float;

uniform sampler2D uPositions;
uniform sampler2D uVelocities;
uniform float uDt;
varying vec2 vUv;

void main() {
  vec4 P = texture2D(uPositions, vUv);
  vec3 velocity = texture2D(uVelocities, vUv).xyz;
  P.xyz += velocity * uDt;

  // Keep runaway particles inside a sane floating-point range.
  P.xy = clamp(P.xy, vec2(-12.0), vec2(12.0));
  P.z = clamp(P.z, -4.0, 4.0);

  gl_FragColor = P;
}
`;
