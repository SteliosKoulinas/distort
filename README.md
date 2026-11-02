# distort — a portrait in dust

An image dissolves into 200,000 GPU particles and reassembles. Fine dots on black, slow incompressible drift, a loose spring home, and a two-stop colour grade that keeps portraits coherent on a dark stage.

Phase 1 is a complete, runnable WebGL piece: image decomposition → importance sampling → GPU particle simulation → additive point renderer → Svelte control panel. Audio is deliberately phase 2, but the seam for it already exists.

---

## Run it

```bash
npm install
npm run dev        # http://127.0.0.1:5180
```

Production (static, no server):

```bash
npm run build      # writes build/
npm run preview    # http://127.0.0.1:4180
```

Deploy the `build/` directory to any static host (Netlify, Vercel, Cloudflare Pages, GitHub Pages, S3). `adapter-static` is configured with an `index.html` fallback, so client-side routing will work if routes are added later.

### Docker

The image builds the static site with Node and serves it with nginx on port 80.

```bash
docker compose up -d --build
# http://127.0.0.1:8080
```

Change the host port with `PORT`; for example, to use the same port as the dev server:

```bash
PORT=5180 docker compose up -d --build
```

Or without Compose:

```bash
docker build -t distort-portrait .
docker run --rm -p 127.0.0.1:8080:80 distort-portrait
```

Both the container port and the `/healthz` endpoint are defined in `deploy/nginx.conf`.

Requirements: a browser with WebGL2 and render-to-float support (`EXT_color_buffer_float` or `EXT_color_buffer_half_float`). A recent desktop browser is the target; unsupported devices get a readable error instead of a black canvas.

### Using it

- Drop a JPG/PNG/WebP anywhere on the stage, or click **Replace image**.
- Pick a preset: **Drift**, **Ash**, **Undertow**, **Shatter**, **Still**.
- **Reassemble** (`R`) pulls the cloud home, then releases it.
- **Pulse** (`Space`) fires a radial impulse. **Auto pulse** is a metronome standing in for live audio until phase 2.
- Move the pointer over the stage to attract, repel, or swirl.
- Choose a **Grade** — Auto, Source, Bone, Ember, Ice or Rose — and set amount/chroma. Grading is a live shader uniform; it never resamples.
- Open **Modulation** to run four LFOs. Each route has a target, shape, rate, depth, on/off and a retrigger button (`↻`).
- **Randomize look** samples a new world; the dice button only changes the seed.
- Every slider is live. The two expensive controls — **Count** and **Edge detail** — resample only on release.

Measured on an Apple M2 (ANGLE/Metal, Chromium): **262,144 particles at 100 FPS**, 512² simulation texture, float32, no console errors. That is a local result, not a promise about integrated GPUs; the Count slider and the lower-density presets are the fallback.

---

## Architecture

```
image file
   │  decode + downscale (max 1200px, one canvas read)
   ▼
ImageAnalysis ── luminance · Sobel edge · HSV sat/hue · palette · percentiles
   │  weighted CDF sampling (seedable, stratified)
   ▼
SampledParticles ── origins (x,y,z,mass) · colors · sizes · seeds
   │
   ├── static point attributes ──────────────┐
   │                                          ▼
   └── DataTexture (origins) ──► GPU ping-pong simulation ──► position texture
                                    2 fullscreen passes/frame        │
                                                                     ▼
                                                        additive point renderer
                                                                     │
Svelte panel ── plain SimParams snapshot ──► uniforms ──────────────┘

phase 2: AnalyserNode ── AudioFrame { bass, mid, treble, amp, beat } ──► uniforms
```

The important boundary: **Svelte never touches the animation loop, and the animation loop never reads Svelte state.** The UI owns a reactive `SimParams`; on a control change it hands a plain `$state.snapshot(params)` object to `ParticleField`. The loop reads that ordinary object and writes uniforms. No per-frame framework reactivity, no per-particle JavaScript.

```
src/
  routes/
    +layout.ts            ssr = false, prerender = false
    +page.svelte          UI, upload/drop, presets, HUD, onMount cleanup
  lib/
    core/params.ts        SimParams, presets, randomize, LFO settings
    core/color.ts         sRGB/linear/hex/HSL helpers
    core/palette.ts       auto + curated two-stop grades, percentile levels
    core/rng.ts           mulberry32 + seed helpers
    image/decode.ts       createImageBitmap → downscale → ImageData
    image/analyze.ts      luminance, Sobel, HSV, palette, percentiles
    image/sample.ts       importance CDF sampling, colors, mass, size
    gpu/simulation.ts     two-pass ping-pong simulation, precision detection
    gpu/shaders/simulation.ts   velocity/position/init GLSL + force modules
    gpu/shaders/noise.ts  3D simplex noise, hashes, divergence-free curl
    gpu/shaders/render.ts  point vertex/fragment shaders + palette grade
    gpu/view.ts            Three.js renderer, geometry, letterbox fit, DPR cap
    gpu/field.ts           loop, pointer, beat, LFO runtime, stats
    audio/types.ts         AudioFrame seam for phase 2
    ui/*.svelte            Section, Slider, Toggle
```

Browser cleanup is returned from `onMount` (`removeEventListener`, `dispose()`), not `onDestroy`. There is no `onDestroy` in the project.

---

## Image → dots

**Decode.** The file is decoded once with `createImageBitmap` (falling back to an `<img>` + object URL), drawn to a 2D canvas at a maximum long edge of 1200 px, and read back as `ImageData`. 1200 px is enough detail for 200k–262k samples and keeps the analysis pass interactive.

**Per-pixel features.**

- Luminance: `L = 0.2126 r + 0.7152 g + 0.0722 b` (Rec.709, 0..1).
- Edges: 3×3 Sobel gradients `gx`, `gy`; magnitude `E = min(1, 0.5 · √(gx² + gy²))`. The 0.5 keeps photographic detail mostly inside 0..1.
- Saturation and hue: standard HSV from `max`/`min`; hue is metadata for the palette strip and is ready for hue-based forces later.
- Palette: 12 hue bins weighted by saturation and luminance, six strongest shown as UI swatches. A circular mean of saturated pixels gives the dominant hue used by the Auto grade; the mean saturation decides whether the source is effectively black-and-white.
- Percentiles: a 256-bin luminance histogram gives p15/p85, used as the grade's linear-light endpoints so a few specular pixels cannot flatten the highlights.

**Sampling.** Each pixel gets an importance weight

```
w = α · (0.04 + 0.22·L + edgeBoost·E + 0.3·S)
```

where `α` is the source alpha, `L` luminance, `E` Sobel edge, `S` saturation. The `0.04` floor guarantees a thin uniform veil even in shadows, so the silhouette never disappears. The weights become a prefix-sum CDF over all pixels.

For particle `p` of `N`:

```
target = ((p + ξ) / N) · total,  ξ ∈ [0,1)
pixel  = lower_bound(CDF, target)
```

This is **stratified importance sampling**: one jittered sample per equal slice of the CDF. It has lower variance than `N` independent draws, preserves the weighting, and avoids clumping an entire slice on one hot pixel. The chosen pixel is then jittered inside its own square for sub-pixel softness.

**Why not Poisson-disk?** A hard minimum-distance constraint fights importance sampling: detail and color are supposed to be denser than flat regions. It would also impose a disk radius at 200k samples over a 1200 px image, where the spacing is already sub-pixel. CDF sampling gives the right *density*; jitter gives the organic look.

**Per-particle payload.**

- `origin.xy` in image space `[-1,1]`, `origin.z = 0`.
- `mass = 0.8 + 0.4·L` (brighter is slightly heavier, so it answers forces a little slower). The shader clamps mass to `[0.35, 2]`.
- Color converted from sRGB to linear light once on the CPU, so additive accumulation happens in linear space.
- Size `0.62 + 0.85·E + 0.26·S`, so edges and colour read as slightly larger grains without turning contours into white outlines.
- A per-particle random seed drives twinkle, depth jitter, and fracture jitter.

The point attributes are static. The GPU simulation only needs the origins texture and each particle's texel coordinate (`aRef`), so changing a force never rebuilds geometry.

---

## GPU simulation

Two ping-pong pairs, two fullscreen passes per frame, independent of particle count:

```
origins (static) ──┐
positions[read] ───┼──► velocity pass ──► velocities[write]
velocities[read] ──┘                            │
                                                ▼
positions[read] ───────────────────────► position pass ──► positions[write]
```

Then read/write swap. The velocity shader samples `origins`, `positions`, `velocities`; the position shader does the final integration. The renderer reads `positions[read]` in its vertex shader. There is no CPU readback.

**Why explicit passes instead of `GPUComputationRenderer`?** The data flow above is the whole story, visible in one file. It also avoids a second dependency and a layer of implicit ping-pong behavior, and it makes it obvious that exactly two passes run per frame.

**Precision.** If `EXT_color_buffer_float` exists, render targets are `FloatType`; otherwise half-float is used and the UI reports `float16`. Data textures are `NearestFilter`, `ClampToEdge`, no mipmaps, `NoColorSpace` — simulation data must never be filtered or color-managed.

**Integration.** Semi-implicit Euler, once per frame:

```
a  = sum(forces) / mass
v  = (v + a·dt) · damping^(60·dt)
|v| = min(|v|, maxSpeed)
x  = x + v·dt
```

`dt` is clamped to 1/30 s. The damping exponent makes the decay framerate-independent. Semi-implicit Euler is stable for the spring stiffness used here; positions are clamped to a sane range (`|x,y| ≤ 12`, `|z| ≤ 4`) as a NaN/runaway guard.

---

## Force math

All strengths are UI numbers converted to scene units with small gains in the shader (`CURL_GAIN = 0.16`, `POINTER_GAIN = 0.40`, etc.). `assembly` is the 0..1 reassembly envelope; forces other than the spring are multiplied by `(1 − assembly)` so the cloud can actually settle.

### 1. Curl noise

A scalar potential `ψ(p, t)` is 3D simplex noise sampled at `p·scale + (0,0,t·speed)`. The force is

```
curl(ψ, ψ, ψ) = (∂ψ/∂y − ∂ψ/∂z,  ∂ψ/∂z − ∂ψ/∂x,  ∂ψ/∂x − ∂ψ/∂y)
```

with central differences (`ε = 0.12`), six noise samples per particle. This field is **divergence-free** because mixed partials cancel: `∇·(∇×A) = 0`. Visually it swirls like an incompressible fluid — no sources, no sinks, no slow drift of the whole cloud off-screen. A per-particle gain `0.65 + 0.7·seed` breaks up the regularity.

### 2. Spring back to the origin

Hooke's law: `a += (origin − x) · k`. The default `k` is the UI stiffness; during reassembly `k = stiffness + 10`, and it works even if the normal spring toggle is off. Combined with damping this is a damped harmonic oscillator; brighter/heavier particles accelerate a little less because acceleration is divided by mass.

### 3. Pointer attract / repel

```
d = pointer − x
falloff = r² / (|d|² + r²)
a += (d̂ · strength + perp(d̂) · swirl) · falloff · 0.40 · (1 − assembly)
```

`falloff` is 1 at the cursor and 1/2 at radius `r`, with a smooth long tail. Positive strength attracts, negative repels; `perp(d̂)` adds a tangential swirl. A small seed-based z jitter keeps it from looking like a flat 2D magnet. The pointer is converted from NDC back into image space by dividing by the letterbox fit, so the force lands under the cursor even when the image is pillarboxed.

### 4. Beat pulse

`beat` is a 0..1 envelope. Each frame it decays as `b ← b·e^(−4.5·dt)`; pressing Space or clicking Pulse sets `b = max(b, 1)`. The force is radial:

```
a += x̂ · b · strength · r²/(|x|² + r²) · 0.75 · (1 − assembly)
```

with an extra seed-based z kick. The falloff makes the impulse strongest at the centre and gentle at the edges. In phase 2, `beat` will be driven by an onset detector instead of the button/metronome, without changing this shader.

### 5. Traveling ring

```
φ = k·|x| − ω·t
a += x̂ · sin(φ) · e^(−1.6|x|) · strength · 0.35
a.z += cos(φ) · e^(−1.6|x|) · strength · 0.12
```

This is an outgoing radial wave with wavenumber `k` and angular phase speed `ω`; the exponential envelope keeps the scene edges quiet. Alternating sign bands push particles outward and inward as the ring passes.

### 6. Fracture (approximate Voronoi)

This is **not** exact polygon clipping; it is a jittered-grid cell force.

```
p = x · cellScale
cell = floor(p)
for 3×3 neighbours g:
    site = cell + g + hash22(cell + g + seed)
    d = |site − p|²
keep nearest vector `best`, second distance `d2`

centre = (cell + hash22(cell + seed)) / cellScale
drift  = (2·hash22(cell + 31.7 + seed) − 1) · spread
a += (centre + drift − x) · strength · (1 − assembly)
a −= best̂ · e^(−8(√d2 − √d1)) · strength · 0.12
```

Particles inside a cell are pulled toward that cell's moving center; the second-distance term adds a small push away from the border, sharpening the gaps. Nine neighbor probes are enough for a convincing shard look at 200k particles; exact Voronoi clipping would be far more expensive for a difference nobody can see at this density. `spread` makes each cell drift in its own direction.

### 7. Depth scatter

```
n = simplex3D(x·1.7, t·0.12 + seed·5)
a.z += n · strength · 0.40
```

The z channel is a 2.5D cue, not a physical camera:

- render position: `xy += z · 0.03` (screen-space parallax),
- point size: `× clamp(1 + 0.18·z, 0.35, 2)`,
- alpha: `× (0.55 + 0.45·e^(−0.7·|z|))`.

Depth therefore reads as a shimmer of slightly shifting, growing, brightening grains. A perspective camera and depth sorting would cost far more and would fight additive blending.

### 8. Rendering

One `THREE.Points` draw, additive blending, no depth test/write. The vertex shader samples the position texture at `aRef` (the particle's texel center), applies the letterbox fit, and sets `gl_PointSize` with size, DPR, depth, and a slow twinkle. The fragment shader discards outside a circle and uses `smoothstep` for a soft edge, then converts linear RGB to sRGB explicitly. Output color space is sRGB; DPR is capped at 1.5 to keep fill rate sane on Retina displays.

---

## Colour grade

Each particle still carries its exact sampled sRGB colour, converted to linear light. The render vertex shader then treats that colour as a luminance source and re-colours it:

```
l      = dot(src, vec3(0.2126, 0.7152, 0.0722))
t      = smoothstep(lo, hi, l)
graded = mix(dark, light, t)
graded = mix(vec3(luminance(graded)), graded, chroma)
colour = mix(src, graded, amount)
```

`lo`/`hi` are the linearised 15th/85th luminance percentiles. `amount` is 0 in **Source** mode; otherwise the user controls it. The presets are **Bone** (warm ivory), **Ember** (burnt orange), **Ice** (pale cyan) and **Rose** (pink), plus **Auto**. Auto takes the dominant saturated hue, builds a near-black tinted shadow `hsl(h, 0.62, 0.055)` and a desaturated highlight `hsl(h + 0.025, 0.24, 0.88)`, and nudges green hues toward teal. If mean saturation is below 0.07 the source is treated as black-and-white and Auto falls back to Bone. The source palette swatches remain metadata for the UI; the grade is per particle.

Why not leave the source alone? Additive blending on black accumulates quickly: a multicolour image turns into clashing neon, and a pure white grade loses the midtones that carry a face. A dark→light duotone keeps the luminance structure but puts every particle in one coherent colour family. Because the operation lives in the point vertex shader, mode/amount/chroma are live uniforms and never trigger a resample.

---

## Modulation (four LFOs)

Four routes live in `SimParams` as `{ enabled, target, shape, rate, depth }`. Their runtime — phase and trigger envelope — lives in `ParticleField`, not in the Svelte snapshot. That is deliberate: changing a preset or control must not reset the modulation.

Per frame:

```
phase  = fract(phase + rate·dt)
env    = min(1, env + 2.2·dt)
signal = shape(phase) · depth · env
factor[target] *= max(0, 1 + signal)
```

Shapes are sine, triangle, ramp and a periodic smooth random: 16 seeded values per route, interpolated with `smoothstep` and wrapped, so it wanders rather than stepping like white noise. Retrigger sets `phase = 0`, `env = 0`; the route then swells back in. Targets multiply curl strength, noise scale, spring stiffness, pointer strength, pulse strength, wave strength, fracture pull, depth amount, point size or opacity. Several routes may share a target; the factors compose multiplicatively. Scale, size and opacity are clamped so a deep LFO cannot collapse the field.

LFOs are preserved across presets and randomization, along with the palette, seed and particle count.

---

## Presets

| Preset   | Idea |
| -------- | ---- |
| Drift   | Fine dust, slow incompressible drift, loose return. The default. |
| Ash      | Small, wide drift, more depth scatter, almost no pull home. |
| Undertow | Strong slow vortex, traveling ring, late return. |
| Shatter  | Jittered Voronoi cells pull the image into drifting shards. |
| Still    | Close to the source; the particles only breathe. |

Presets reset the look but keep the user's **seed**, **particle count**, **palette** and **LFOs** so A/B comparisons, quality choices and ongoing modulation remain honest. Count and edge detail resample on pointer release only; all other sliders are uniform updates.

---

## Performance notes

- Simulation cost is two fullscreen passes over a 448²–512² texture (≈ 200k–262k fragments each), regardless of point count. The expensive per-fragment work is the 6-sample curl and the 9-cell fracture search; both are branch-skipped when their strength is zero.
- The only per-frame JavaScript is: read `dt`, decay the beat envelope, advance assembly/auto-pulse, advance four LFO phases and multiply ten factors, set ~40 uniforms, call two `renderer.render` calls plus the point draw. Our loop walks no arrays and allocates nothing; the LFO random tables are built once and Three.js keeps its own internal state.
- Resampling (CDF + geometry rebuild) is the one main-thread spike and happens only on image change, preset change, seed change, or release of Count/Edge detail. Measured here: ≈ 63 ms at 200k and ≈ 92 ms at 262k for the sampling + geometry work (image analysis is a separate one-time pass on upload). The UI paints a loading state before that work starts.
- Geometry memory at 200k: positions 2.4 MB, refs 1.6 MB, colors 2.4 MB, sizes/seeds 1.6 MB, plus ~25 MB of float render targets. 512² adds ~13 MB. Fine for a desktop tab.
- On lower-end GPUs, drop Count to 65k–98k and/or close other GPU tabs. The visual language survives at lower counts; only the finest grain is lost.

---

## Phase plan

**Phase 1 — done (this repo).** GPU foundation, image decomposition, CDF sampling, renderer, UI, presets, pointer, beat placeholder, performance instrumentation. `npm run check` is clean; `npm run build` produces a static site.

**Phase 2 — audio.** Add a Web Audio graph (`AudioContext` → `AnalyserNode`, FFT 2048) for microphone and uploaded audio. Map log-spaced bands to `bass`/`mid`/`treble`/`amp` with smoothing and noise floors. Detect onsets with spectral flux plus an adaptive median threshold, then feed a decaying `beat` envelope. Route bands into forces as plain numbers: bass → pulse/fracture, mid → curl strength, treble → point size/twinkle, amp → global gain. Add input selection, gain, and three per-band influence sliders. The GLSL does not change: it already receives an `AudioFrame`; phase 1 fills it with silence plus the button/metronome beat.

**Phase 3 — polish and editioning.** URL-encoded presets and seeds, PNG/WebM export, still-frame capture at 2× DPR, keyboard-focusable canvas controls, reduced-motion behavior, and a mobile-specific layout pass. Optional: image sequences or short video as the source.

**Phase 4 — research, only if it earns its cost.** True Voronoi/SPH neighbors on the GPU, depth of field in the point shader, audio fingerprint-driven presets, or a compute-shader path via WebGPU with the WebGL2 renderer as fallback.

---

## Relation to the v1 CPU prototype

**The runtime was replaced, not built upon.** The v1 prototype ran a per-particle JavaScript loop and could not reach 200k at 60 fps; keeping it would have meant optimizing a dead end. What carried over is conceptual, not code:

- luminance + Sobel weighted sampling (reimplemented as a single-pass analysis and a CDF),
- seedable noise (`mulberry32`, simplex),
- the Three.js + Svelte shell and the upload flow,
- the mic-analyser idea, now a typed `AudioFrame` seam.

The new runtime keeps all particle state in float textures, runs exactly two fragment passes per frame, and never reads particles back to the CPU. That is the difference between "a few thousand dots at 30 fps" and "262k dots at 100 fps" on the same machine.

---

## Known limits and honest notes

- **No live audio yet.** The beat button/metronome is a stand-in; the seam and typing exist for phase 2. Do not describe phase 1 as audio-reactive.
- **Approximate Voronoi.** A 3×3 jittered-grid force, not exact cell clipping. Cheap and convincing at this density; not mathematically exact.
- **Additive highlights can still clip** on very bright images. Defaults (size 1.2, opacity 0.65, Grade amount 0.85) were tuned against a bright 900×1200 test portrait; the sliders and the pre-highlight endpoint of the grade let you recover detail or lean into glow.
- **The grade is a treatment, not a reconstruction.** Auto follows the dominant hue; a heavily mixed image will be unified to one family, which is the point. Switch to Source if you want the literal photograph.
- **LFO depth is a multiplier, not an absolute value.** `1 + signal × depth` means depth 1 can double or zero a force at the extremes; a shared target composes. The clamps on scale, size and opacity are the safety net.
- **float16 fallback is untested on real hardware here.** It is selected automatically when float32 render targets are unavailable; positions are clamped to keep half-float precision usable.
- **Windows/older GPUs vary.** The 100 fps figure is an M2/Chromium measurement. Treat it as a ceiling, not a floor.
- **The mobile layout is functional, not finished.** Below 860 px the stage sits above a scrolling panel; a dedicated compact control surface is phase 3 work.
- The test portrait used for calibration is not bundled. Bring your own image.

---

## Credits

- 3D simplex noise: Ashima Arts / Stefan Gustavson (MIT), included with attribution in `src/lib/gpu/shaders/noise.ts`.
- Built with SvelteKit 3, Svelte 5, Three.js r187, and Vite 8.
