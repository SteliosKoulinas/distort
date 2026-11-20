# Visual language review branch

Branch: `experiment/visual-language-review`

This branch combines the five independent prototypes into one reviewable
application. It is intended for A/B comparison and is not a replacement for
the individual experiment branches.

## Available modes

- Original / particles
- Structural erosion
- Surface morphology
- Temporal residue
- Signal dislocation
- Fragmented planes

The selector changes the active renderer without requiring a branch switch.
Each mode now implements the engine lifecycle and owns its GPU resources.
Continuous modes allocate no particle simulation. The host disposes the previous
engine on a switch and initializes the new one; retained UI values are restored.
See [the current foundation status](../visual-language-foundation.md) for the
correctness fixes, tests and remaining roadmap.

## Controls

Each experiment exposes only its small set of meaningful controls:

- Structural Erosion: intensity, sensitivity, recovery, field scale.
- Surface Morphology: intensity, viscosity, field scale, creases.
- Temporal Residue: memory, decay, residue drift.
- Signal Dislocation: intensity, row density, channel separation, recovery.
- Fragmented Planes: intensity, plane count, depth, drift.

Source, Audio and Export/Stage are shared. Original-only optics, grading, presets,
physics and modulation panels are hidden in continuous modes. Reset engine clears
the active mode. All modes receive routed, Motion/Reactive-gated audio.

These are still prototype artistic controls: Structural recovery and Fragmented
luminance regions are not the final irreversible-damage and colour-segmentation
specifications. Temporal currently converges to the source in silence; its final
memory-freeze behaviour comes in the artistic phase.

## Review protocol

Use the same source image, audio excerpt, output size and duration for every
mode. Compare first at low and medium intensity:

1. image recognizability;
2. locality of transformation;
3. temporal coherence and recovery;
4. relationship between sound and visual material;
5. whether the effect retains photographic identity without becoming a
   generic visualizer.

This branch is for evaluation only. No recommendation to merge into `main` is
implied.
