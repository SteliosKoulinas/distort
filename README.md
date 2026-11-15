# distort — a portrait in dust

An image dissolves into 200,000 GPU particles and reassembles. Fine dots on black, slow incompressible drift, a loose spring home, and a two-stop colour grade that keeps portraits coherent on a dark stage.

The WebGL foundation turns an image into a particle field. A continuous, full-pixel photograph now sits below the dots, so the image is readable through its actual detail, not only its silhouette. Audio from a file or live input opens both image-space optical distortion and the particle motion. **Export** records the canvas and selected audio into a video framed for Reel, portrait Post or Square.

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

Checks (Node 24+ for the native TypeScript recorder tests):

```bash
npm run check
npm test
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
- Drop an audio file on the stage, or open **Audio** and click **Choose audio**. The image stays still until you press **Play**; then the spectrum opens the motion and the piece breathes with the track. The file is decoded locally and never uploaded.
- Or point the field at anything already playing: **System audio** captures the machine's output (Spotify, a DAW, a video, another tab) and **Microphone** captures the room. A captured stream is analysed and muted, never replayed through the speakers.
- Set **Motion** to decide how far the image opens while audio plays (0 keeps it near the source). **Spectrum** trims the spectral forces themselves.
- **Image / optics** treats the full photograph as a texture: set **Particles** to 0 for image only, 1 for the old dot-only look. **Break** is the master optical strength. Refraction bends the pixels around source contours; Folds displaces image strips; Blocks fractures and pixelates regions; Chromatic split offsets the RGB channels. At default values the photograph remains recognizable; with Break, effects and Motion at 1 it can lose legibility completely. Silence leaves the photograph intact.
- Open **Form** for Lens, Raster, Slices and Relief. Their offsets follow the source image and the same audio-led Motion envelope.
- Choose **Export → Reel / Post / Square**, choose a take length, then **Record take**. The default is **60 seconds**, with 30/60/120/180-second presets and a custom 1–300-second field. **Track** means the audio file's duration, not an arbitrary fixed limit. A shorter audio file loops to fill a longer take. Keep the tab visible; **Stop and keep** finishes early. A completed take downloads automatically and remains available through **Download**.
- Pick a preset: **Drift**, **Ash**, **Undertow**, **Shatter**, **Still**.
- **Reassemble** (`R`) pulls the cloud home, then releases it.
- **Pulse** (`Space`) fires a radial impulse. **Auto pulse** is a metronome for when no audio is playing; live bass onsets also feed the same `beat` envelope.
- Move the pointer over the stage to attract, repel, or swirl.
- Choose a **Grade** — Auto, Source, Bone, Ember, Ice or Rose — and set amount/chroma. Grading is a live shader uniform; it never resamples.
- Open **Modulation** to run four LFOs. Each route has a target, shape, rate, depth, on/off and a retrigger button (`↻`). Alongside the original particle targets, every numeric **Image / optics** control is a target: Particles mix, Break, Refraction, Folds, Blocks and Chromatic split. A small scope draws the selected shape, the depth-scaled wave and a live playhead.
- **Randomize look** samples a new world; the dice button only changes the seed.
- Switch the **Look** between Light and Dark in the masthead. It inverts only the paper and ink around the stage; the stage itself stays black, and the choice is remembered in `localStorage`.

### Look

The interface is set like a printed index: warm paper, black ink, hairline rules, numbered sections and monospace microtype. **Light** and **Dark** swap the paper/ink tokens and `color-scheme`; the stage and the grade stay black in both, because the artwork lives on black. The choice is written to `localStorage` and applied before first paint, so a reload never flashes the wrong look.
- Every slider is live. The two expensive controls — **Count** and **Edge detail** — resample only on release.

Measured on an Apple M2 (ANGLE/Metal, Chromium): **262,144 particles at 100 FPS**, 512² simulation texture, float32, no console errors. That is a local result, not a promise about integrated GPUs; the Count slider and the lower-density presets are the fallback.

---

## Image / optics — continuous photograph

The decoded ImageData is uploaded once as a full-colour GPU texture, with rows oriented to match the shader's UVs. A fitted image plane renders before the existing `THREE.Points` draw. It is deliberately independent of dot count, the simulation texture and the selected grade: even 1,000 particles do not reduce the photographic detail.

The image shader performs inverse UV sampling from that texture. Its refraction follows baked luminance gradients with a smooth, low-frequency flow field; strips and fragments have stable source-space identities rather than changing cell memberships on each frame. Strong breakup creates black voids where pieces leave the image. A separate RGB offset grows near contours. **Break** and the global **Motion** slider multiply the audio loudness follower. Audio bands and beats accent the respective effects, while silence gives the unwarped source. Particle opacity is independently mixed with the continuous image. This is an additional rendering mechanism; the original dots, four LFOs, pointer/Pulse, presets and Form sliders remain available.

## Form — dots as an image surface

The source analysis is baked once into a small RGBA normal/relief map (512 px on the long edge). Its signed Sobel gradient follows the photograph's contours; luminance supplies depth and edge magnitude supplies local detail. Each point retains its source colour and source coordinates.

| Control | Treatment | Audio emphasis |
| --- | --- | --- |
| Lens | Bounded refraction along the local image gradient | Bass |
| Raster | Fixed source cells drift as small panes; their membership stays stable | Treble |
| Slices | Source-aligned horizontal strips shift sideways | Beat |
| Relief | Luminance lifts bright structure into shallow parallax | Loudness |

All four strengths share **Motion**. Silence retains only the small breathing floor; sound opens the surface. Turning **Image surface** off removes these optical offsets while retaining the existing simulation, pointer, Pulse and LFO controls. Presets include their own Form settings; the global Motion slider is preserved between presets.

## Video export

| Frame | Dimensions | Aspect | Target video bitrate |
| --- | --- | --- | --- |
| Reel | 1080 × 1920 | 9:16 | 17.4 Mbps |
| Post | 1080 × 1350 | 4:5 | 12.2 Mbps |
| Square | 1080 × 1080 | 1:1 | 9.8 Mbps |

These are delivery presets, not promises about Instagram placement: Instagram may present uploaded videos as Reels. The full source image is fitted within the chosen frame, so a source with a different aspect has black margins. The selected frame previews at the actual delivery resolution; only the canvas is exported, without controls, HUD or tick marks.

**Encoding.** WebCodecs targets H.264 High (Main/Baseline fallback), an explicit **30 fps** timeline, fast-start MP4 via `mp4-muxer`, and **AAC 192 kbps stereo** when audio is selected. Frames are captured immediately after the WebGL draw. Missed display frames hold the previous image rather than speeding up the video; sustained rendering/encoding stalls report an error. The bitrate is a quality target, not a fixed file-size guarantee.

If WebCodecs, AAC or audio-track processing is unavailable, the browser's `MediaRecorder` is used. Its actual codec/frame cadence depend on the browser. MP4 is preferred; WebM-only browsers clearly label the result, which needs conversion to H.264 MP4 before uploading to Instagram.

**Audio and takes.** A file take restarts playback from zero. **Track** uses its duration up to **300 seconds**; without a file (or with live input), Track means 60 seconds. The default is **60 seconds**, not Track: the 30-second outcome previously arose when Track followed a 30-second audio file, or when 30 seconds was explicitly selected. Fixed lengths are 30, 60, 120 and 180 seconds, and Custom supports 1–300 seconds. If a file ends before the take ends, it loops to fill the selected duration. File and live audio are tapped before the monitor mute gain, so recording a microphone/system input does not replay it through the speakers. Without an audio source, the export has no audio track. Each recorder owns cloned audio tracks so stopping one take leaves the analyser and the next take intact.

The tab must remain visible; hiding it interrupts the take instead of exporting a frozen visual. Encoding and finalisation happen locally, with the video held in memory until download. On slower hardware, lower the particle count.

**Instagram quality.** Instagram always re-encodes; no export setting can guarantee zero compression loss, especially for moving fine particles. Upload the exported file directly and enable **Upload at highest quality** in Instagram. Exact 1080-wide framing and generous source bitrates avoid an unnecessary resize or low-quality first encode. Approximate target sizes for 30 seconds including AAC are **66 MB / 46 MB / 37 MB**, respectively; actual sizes vary with the image and encoder.

**Verification.** Local Chromium checks decoded Reel/Post/Square MP4s, confirmed 90 video samples for a 3-second take (30 fps), H.264 + audible stereo AAC, and `moov` before `mdat`. Silent recording and two consecutive MediaRecorder/audio takes also decoded successfully. `npm test` covers high-refresh-rate timing, held frames, asynchronous encoder errors and long stalls. Browser availability and performance still vary by platform.

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

phase 2: uploaded audio ─► AnalyserNode ─► AudioFrame { bass, mid, treble, amp, beat } ─► uniforms
```

The important boundary: **Svelte never touches the animation loop, and the animation loop never reads Svelte state.** The UI owns a reactive `SimParams`; on a control change it hands a plain `$state.snapshot(params)` object to `ParticleField`. The loop reads that ordinary object and writes uniforms. No per-frame framework reactivity, no per-particle JavaScript.

```
src/
  routes/
    +layout.ts            ssr = false, prerender = false
    +page.svelte          UI, upload/drop, presets, HUD, onMount cleanup
  lib/
    core/params.ts        SimParams, presets, randomize, LFO settings
    core/lfo.ts           LFO shapes, signal function, seeded random tables
    core/photo-modulation.ts   audio-gated 0..1 image-optics LFO multipliers
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
    gpu/shaders/photo.ts   full-image refraction, folds, fragments, RGB split
    gpu/normals.ts         baked source gradient, luminance and edge texture
    gpu/view.ts            Three.js renderer, geometry, letterbox fit, DPR cap
    gpu/field.ts           loop, pointer, beat, audio, LFO runtime, stats
    audio/types.ts         AudioFrame { bass, mid, treble, amp, beat }
    audio/engine.ts        file element + live MediaStream → AnalyserNode, bands, onset beat
    export/formats.ts      Reel/Post/Square sizes, bitrates and size estimates
    export/duration.ts     fixed/Track/custom take resolution (up to 300s)
    export/recorder.ts     WebCodecs H.264/AAC + MP4 muxer, MediaRecorder fallback
    ui/*.svelte            Section, Slider, Toggle, LfoScope, AudioScope
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

with an extra seed-based z kick. The falloff makes the impulse strongest at the centre and gentle at the edges. Pressing Space, clicking Pulse and a detected bass onset all raise the same envelope; the tick loop owns its decay.

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

### 8. Spectral forces

Audio enters the same acceleration buffer as every other force. Every ambient and spectral force is scaled by the motion gate (§ Audio reactive) — `0.03 + 0.97 · Motion · envelope` — so a silent field stays on the photograph. The four band uniforms are plain numbers in 0..2:

```
bass    radial bloom + z scatter near the centre
mid     curl strength × (1 + 1.15·mid), wave strength × (1 + 0.9·mid)
treble  fast xy jitter + z chatter
amp     slow curl turbulence; also raises point size and opacity
beat    the existing radial pulse envelope
```

Bass is weighted by `1/(1 + 1.6|x|)`, so the bloom reads as a breath from the middle rather than a uniform push. Mid does not add a force of its own; it multiplies the curl and ring forces that already exist, which keeps the image's structure instead of smearing it. Treble is the only band that injects per-particle randomness. Amp is deliberately slow: it is the mix level, not a transient. If a band is switched off or Amount is 0, its uniform is exactly 0 and the shader branch is skipped.

### 9. Rendering

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

## Audio reactive

Two kinds of source feed one `AnalyserNode`, so the field never learns where sound came from:

- an uploaded **file**, through an `HTMLAudioElement` → `MediaElementAudioSourceNode` (audible), and
- a live **`MediaStream`** from `getDisplayMedia` (system audio) or `getUserMedia` (microphone), captured and **muted** — analysed, never replayed.

The analyser uses FFT 2048, smoothing 0.72, and −90/−10 dB limits. A metering `requestAnimationFrame` runs only while sound is arriving; on pause, end, replace, a stopped capture or dispose it stops and sends one silent frame so the field settles immediately.

```
bass    RMS 20–160 Hz
mid     RMS 160–2 000 Hz
treble  RMS 2 000–12 000 Hz
amp     RMS 20–16 000 Hz
beat    bass − running average, thresholded and normalised
```

Band values are RMS of the analyser bins, so a narrow tone does not look as loud as wide noise. The running average (`α = 0.06`) turns bass into a transient detector: a positive delta above 0.1 while bass is above 0.16 becomes a `beat` peak. That peak merges with the manual Space/Pulse kick; the simulation owns the decay.

### Live input and DRM

**System audio** is the answer to "can it follow Spotify?". The Spotify *API* cannot give a visualiser any audio: the Web Playback SDK streams through Widevine DRM, so its Frames never reach Web Audio, and since 27 Nov 2024 Spotify also closed `Audio Features` / `Audio Analysis` to new apps. **Tab** capture of the Spotify web player is likewise DRM-blocked. Capturing the **system** output sidesteps all of it: the operating system mixes the audio, so the browser can analyse whatever is playing, with no API key, no OAuth and no Premium requirement.

`getDisplayMedia` requires a user gesture and a picker choice; on macOS/Windows pick the **entire screen** and enable **Share system audio**. A video track is requested because display capture usually needs one, and it is ignored. If the user stops sharing, `MediaStreamTrack`'s `ended` event clears the live state.

### Motion is the gate

The image is meant to read as a photograph first. **Motion** (0..1, default 0.65) decides how far it is allowed to open while audio plays; with no track the field sits at a floor of 3% and only breathes. The loop turns the instantaneous mix level into a slow envelope (≈0.3 s attack, ≈1.4 s release) and multiplies the ambient forces — curl, wave, fracture, depth — and the four band uniforms by `0.03 + 0.97 · Motion · envelope`. So:

- silence → effective forces of ~0.01–0.03: essentially the source image;
- a loud passage → forces follow the loudness and the image is pulled apart;
- a quiet passage → it settles back toward the photograph;
- **Motion 0** → the gate is closed; **Motion 1** → the full preset expression.

Pointer and Pulse are deliberately **not** gated: they are manual gestures, so the piece still responds to the hand when nothing is playing. `Spectrum` (0..2) trims only the spectral band forces on top of the gate.

**Routing is plain state.** The section's _Audio reactive_, _Motion_, _Spectrum_ and the three band switches live in `SimParams.audio`. _Audio reactive_ and the band switches are copied into `AudioEngine.routing` by a Svelte effect; the metering loop reads that object, multiplies the bands, and hands a plain `AudioFrame` to `ParticleField.setAudio()`. Motion is read by the animation loop from the same plain snapshot it already holds. The page never receives per-frame updates; only the transport clock (4 Hz `timeupdate`) and the small spectrum canvas have their own clocks.

`src/lib/ui/AudioScope.svelte` draws log-spaced bars from `engine.spectrum` with hairline dividers at 160 Hz and 2 kHz, labelled **Bass / Mid / Treble** below. It re-reads `--ink`/`--line` when the look changes, like the rest of the instrument.

Uploads stay local: the track is decoded from an object URL, never sent anywhere, and the URL is revoked when the track is replaced or the page unmounts. File and live sources share the same `AudioFrame` seam and recording tap.

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

Shapes are sine, triangle, ramp and a periodic smooth random: 16 seeded values per route, interpolated with `smoothstep` and wrapped, so it wanders rather than stepping like white noise. Retrigger sets `phase = 0`, `env = 0`; the route then swells back in. The original targets multiply curl strength, noise scale, spring stiffness, pointer strength, pulse strength, wave strength, fracture pull, depth amount, point size or opacity. Six additional targets multiply the numeric **Image / optics** sliders: Particles, Break, Refraction, Folds, Blocks and Chromatic split. Several routes may share a target; the factors compose multiplicatively. All image values are clamped to 0..1, and their LFO factor is faded in by the same audio-response envelope as the full-image shader. Thus a silent photograph does not pulse from a Particles LFO, and a slider at 0 remains off rather than being awakened by modulation. The **Continuous image** switch remains an explicit on/off control.

LFOs are preserved across presets and randomization, along with the palette, seed and particle count.

### Waveform scope

Each route draws its own scope (`src/lib/ui/LfoScope.svelte`). The faint full-scale curve shows the shape; the solid curve is scaled by the current depth; the dot is the live signal after the retrigger envelope, and the vertical hairline is the phase. The scope runs on its own `requestAnimationFrame` and reads `ParticleField.getLfoView(index)`, which returns plain numbers. The Svelte UI is never written per frame. The field clock starts when the page mounts, so the scopes animate even before an image is loaded; stats stay empty until a simulation exists. Changing the look re-reads the `--ink`/`--line` variables through a `MutationObserver`.

---

## Presets

| Preset   | Idea |
| -------- | ---- |
| Drift    | Fine dust, a slow incompressible drift. The default. |
| Ash      | A wide, gentle haze; soft edges breathe outward but stay home. |
| Undertow | A slow vortex with a traveling ring; a firm pull returns the image. |
| Shatter  | A few fine shards drift apart, each held close to its own cell. |
| Still    | Closest to the source; the particles only breathe. |

Presets reset the look but keep the user's **seed**, **particle count**, **palette**, **LFOs** and **audio** settings so A/B comparisons, quality choices and the motion gate remain honest. Count and edge detail resample on pointer release only; all other sliders are uniform updates.

---

## Performance notes

- Simulation cost is two fullscreen passes over a 448²–512² texture (≈ 200k–262k fragments each), regardless of point count. The expensive per-fragment work is the 6-sample curl and the 9-cell fracture search; both are branch-skipped when their strength is zero.
- The per-frame JavaScript reads `dt`, decays the beat envelope, advances assembly/auto-pulse and four LFO phases, resets and multiplies 16 scalar factors, then updates the simulation and image/point uniforms. The image is one additional draw in the same scene; no source pixels or particle arrays are traversed per frame. The LFO random tables are built once.
- While audio plays, one extra `requestAnimationFrame` reads the analyser (`getByteFrequencyData`, 1024 bins), averages four bands, and writes five numbers into the field. It allocates nothing per frame; when the track pauses it stops and sends one silent frame. The spectrum canvas also runs on its own rAF, reading the same byte array.
- Resampling (CDF + geometry rebuild) is the one main-thread spike and happens only on image change, preset change, seed change, or release of Count/Edge detail. Measured here: ≈ 63 ms at 200k and ≈ 92 ms at 262k for the sampling + geometry work (image analysis is a separate one-time pass on upload). The UI paints a loading state before that work starts.
- Geometry memory at 200k: positions 2.4 MB, refs 1.6 MB, colors 2.4 MB, sizes/seeds 1.6 MB, plus ~25 MB of float render targets. 512² adds ~13 MB. Fine for a desktop tab.
- On lower-end GPUs, drop Count to 65k–98k and/or close other GPU tabs. The visual language survives at lower counts; only the finest grain is lost.

---

## Phase plan

**Phase 1 — done.** GPU foundation, image decomposition, CDF sampling, renderer, UI, presets, pointer, beat placeholder, performance instrumentation. `npm run check` is clean; `npm run build` produces a static site.

**Phase 1.5 — modulation + audio.** Animated LFO waveform scopes, and an audio path that analyses a file with a Web Audio `AnalyserNode` and gates the whole field with a loudness envelope, so the piece reads as the photograph until sound arrives.

**Phase 2 — live input.** Microphone and system-audio capture through the same analyser, analysed and muted. Still open: gain trim, per-band influence, a spectral-flux onset detector, and a small on-screen note about the browser's screen-sharing indicator. Streaming *services* cannot be tapped directly (DRM) — system capture is the route, and it already works.

**Phase 3 — image optics + video export.** Continuous image-space distortion in addition to image-anchored dot Form; delivery-framed previews, 60-second default and up-to-300-second H.264/AAC MP4 recording, plus browser fallback. Further polish: URL-encoded presets and seeds, PNG still capture, keyboard-focusable canvas controls and reduced-motion behavior. Optional: image sequences or short video as the source.

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

- **The piece is audio-led.** Motion and every ambient force are gated by a slow loudness envelope, so the image reads as the photograph until you press play, and relaxes toward it in quiet passages. If you want the old always-moving wall of dust, set **Motion** to 1 and **Spectrum** to 2, or use **Auto pulse** as a metronome.
- **Ash and Shatter are deliberately gentle now.** They were re-tuned so the source image stays legible; the shards are small and spring-held, and Ash is a haze rather than a dispersal. Push **Motion** to 1 to see their full range.
- **Audio comes from a file or a live capture, not from Spotify's API.** The Spotify Web Playback SDK streams through Widevine DRM, so its audio never reaches Web Audio, and Spotify closed `Audio Features`/`Audio Analysis` to new apps on 27 Nov 2024. To follow Spotify, capture **system audio** (see above) — zero cost, no API key, no Premium. A hosted build cannot capture without a user gesture and a picker choice, and mobile browsers do not implement `getDisplayMedia({ audio: true })`, so live capture is a desktop feature. Tab capture of DRM content is blocked by the browser; only whole-system audio works.
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
