# Visual language foundation

## Implemented: correctness and engine boundary

The review branch now has six `VisualEngine` implementations in
`src/lib/visual/engines/`. `ParticleField` owns browser input, a single clock,
audio gating and recording hooks. `ParticleView` owns the renderer, camera,
composition and delivery dimensions. Neither host branches on individual modes.

`visual/registry.ts` selects each engine's own parameters from the retained UI
snapshot. Its control schemas drive the continuous-mode sliders and the visibility
of Original's richer custom panels. Source, audio input/routing and export/stage
controls remain shared. Switching modes preserves control values.

Only the active engine creates GPU resources. Original owns sampling, simulation,
normal maps, palette, photo optics, LFOs and gesture state. Continuous modes never
construct `GpuSimulation`. Deactivation disposes engine resources; activation
starts fresh simulation/history. Each engine exposes `reset`, `dispose` and its
currently implemented `silenceBehaviour`. Original's explicit reset also restores
LFO phases/envelopes; resampling and preset changes preserve those performance
controls through a separate `resample` operation.

The recording hook fires only after an engine actually renders. While a Worker
prepares a new engine/image, the WebCodecs recorder retains its previous valid
frame rather than capturing an undrawn canvas.

Recording now waits for the active engine to become ready before creating the
encoder, and reports a bounded preparation error instead of producing a take
with no first frame. Engine switching is disabled for the duration of a take,
so an active recorder cannot be detached from its render source. Delivery-size
setup errors are surfaced in the UI rather than leaving the recording state
stuck.

### Temporal Residue

- A dedicated, fitted source-photo quad renders the current frame. It does not
  depend on Original's photo mesh, visibility or particle controls.
- `FeedbackBuffer` owns bounded read/write targets with reset, resize and disposal.
- Delivery-size changes copy compatible residue into the new targets rather than
  silently resetting the live trail; explicit reset and source replacement
  still clear it.
- Feedback uses source-byte colour space consistently; no unintended sRGB decode
  darkens the history. A convex mix prevents brightness accumulation.
- Image replacement, manual reset and mode re-entry clear history.
- P0 silence converges to the source. The later artistic target—freezing the last
  exposure—is intentionally still pending.

### Shared audio contract

`AudioEngine` routes FFT bins before descriptor extraction. Frequency intervals
are non-overlapping: bass `[20,160)`, mid `[160,2000)`, treble `[2000,12000)` Hz.
Energy outside these bands does not enter visual descriptors. RMS, flux, centroid,
envelope and transients therefore cannot hear muted bands. Band-routing changes
and source/seek resets clear extractor history. Spectrum gain changes preserve
analysis history, including while gain is zero, so adjusting the slider cannot
invent beats or transients in sustained audio.

Every `AudioFrame` includes descriptors. Spectrum amount scales the routed frame;
Motion and Reactive are applied once by the host before engine update. Engines
receive the same gated contract and never read analyser bytes. Original's manual
Pulse remains a separate gesture, not an audio bypass. Existing simulation
inertia can continue after sound is gated off.

### Still-frame delivery

The Export panel has an independent still target with Story, square, landscape
and validated custom dimensions. Odd positive pixel sizes are retained; video
formats keep their separate H.264 constraints. The selected still aspect and
fit/fill framing are previewed before capture, and PNG/JPEG encoding happens in
`src/lib/export/still.ts`.

The original upload `File` and full-resolution decode are retained alongside the
1200px interactive proxy. A delivery render target swaps in the original-backed
photo texture without stepping the simulation. `ParticleField` increments a
completed-frame ID only after presentation; Save frame copies that frame to an
independent target, reads it once, and encodes asynchronously with one pending
capture. Temporal delivery uses a copy pass, never a second feedback-producing
render. Temporary targets and superseded download URLs are released.

Spectral flux now compares normalized current and previous bins. Its regression
test covers increases between two nonzero spectra, not only silence-to-sound.
If an input changes FFT/bin count, descriptor history is reset before comparison
so a device replacement cannot produce `NaN` flux or transients.

### Structure analysis

`analyzeImage` exposes signed Sobel derivatives. The structure field reuses them,
forms tensor products and applies separable neighbourhood blurs. Its named
`gradientDir` and `contourDir` are perpendicular in image coordinates.

Structure-map packing flips both rows and the direction's Y component for texture
coordinates. The shader explicitly uses `contourDir` for longitudinal flow.
Analysis and packing run in a Worker owned by the structural engine. Input arrays
are copied before transfer so Original can reuse the host analysis. Replacing
images, switching modes and disposal cancel obsolete work; generation checks
prevent late results from becoming active.

Local 1200×1200 measurements:

- optimized synchronous structure calculation: about 97 ms;
- Worker submission/copy: about 4 ms on the main thread;
- Worker completion, including startup and packing: about 133 ms.

These are local observations, not a cross-device performance guarantee. Image
decoding and the preliminary shared analysis still need broader profiling.

## Verification

```sh
npm test
npm run test:gpu
npm run check
npm run build
```

`test:gpu` starts an isolated local Vite server and Chrome/Chromium profile,
awaits real WebGL pixel readbacks via CDP, then closes both. Set `CHROME_PATH`
if the browser is not in a standard location. No npm dependency downloads are
needed. For interactive inspection, run:

```sh
npx --no-install vite --config vite.gpu.config.ts
# Open http://127.0.0.1:5174/tests/visual-engines.html
```

The former Temporal shader-string test is replaced by pixel tests covering:

- nonblank rendering and actual audio response for all six engines;
- repeatable fixed-step, fixed-seed takes;
- Reactive off, Motion zero and each muted routed band for every engine;
- Temporal source convergence, colour, orientation, reset, resize and re-entry;
- target restoration and stable texture counts across repeated mode switches;
- Worker/reference agreement, intact host arrays, cancellation and stale work.
- Original reset reproducibility and LFO preservation during resampling.
- Recording-hook suppression while an engine is waiting for its Worker.

UI verification also checks irrelevant sections are hidden and mode slider
values survive switching.

## Next phases

This establishes the boundary; it does not complete the artistic specifications.
Four continuous engines still use the existing shader prototypes. Erosion's
irreversible damage/debris, Morphology's elastic state, Signal's block buffer,
and Fragmented Planes' colour segmentation/pose state remain to be built.
Temporal still needs exposure scheduling, multiple histories and pixel ages.

Remaining architecture work includes retaining/re-decoding the original upload
for output-quality analysis, separate preview/export budgets, and deterministic
offline recording. The existing recorder still uses the live clock and the
1200px import proxy; passing fixed-step engine tests is not a claim of
deterministic or original-resolution export.

Expanded descriptors, worklet/offline song analysis, per-mode interpreter and
dynamics layers, and the debug overlay follow. Structural Erosion remains the
template mode, followed by Temporal, Surface, Signal and Fragmented Planes.

The one-minute fixed image/audio evaluation and final-resolution export protocol
have not yet been run. Signal's final silence behaviour and Erosion's reset policy
remain artistic decisions.
