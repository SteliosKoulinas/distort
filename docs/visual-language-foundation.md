# Visual language foundation

This branch adds shared infrastructure only. It does not change the active
particle/photo renderer or expose a new visual mode in the UI.

## Audit result

`ParticleField` currently owns the browser runtime: resize observation, pointer
state, the animation loop, LFO clocks, audio frame copy, GPU simulation and
`ParticleView` rendering. `ParticleView` owns the Three.js scene, orthographic
camera, continuous photo mesh, point material, export framebuffer sizing and
GPU disposal. `+page.svelte` constructs one field and one `AudioEngine`; the
recorder receives the same canvas through `setFrameHook()`.

The current `AudioEngine` creates one analyser and emits plain
`bass/mid/treble/amp/beat` values. File playback, live capture and the audio
recording tap all remain in that class. No experiment should create another
audio context or restart the analyser.

## Shared pieces

- `audio/features.ts`: one reusable, testable feature extractor. It adds RMS,
  low/mid/high energy, spectral flux, centroid, slow envelope and transient
  envelope as normalized numbers. It has no DOM, Web Audio or renderer
  dependency.
- `image/structure.ts`: structure-tensor orientation/coherence derived from
  the existing luminance analysis. It is data, not a visual style.
- `visual/types.ts`: minimal lifecycle contract for independent engines. The
  host owns timing, audio and export; each engine owns its own GPU resources.

## Deliberate non-decisions

- No engine selector has been added yet.
- The existing `ParticleField` does not implement the interface prematurely.
- No multi-engine composition graph exists.
- No new shader effect is included in this foundation branch.

## Prototype rules

Each experiment should derive from this branch, add only its own parameters,
materials and render targets, and remain independently reviewable. A serious
candidate must be tested with the existing export path and at least one real
60-second take before integration is proposed.
