# Visual language review branch

Branch: `experiment/visual-language-review`

This branch combines the three independent prototypes into one reviewable
application. It is intended for A/B comparison and is not a replacement for
the individual experiment branches.

## Available modes

- Original / particles
- Structural erosion
- Surface morphology
- Temporal residue

The selector changes the active renderer without requiring a branch switch.
The continuous modes hide and bypass the particle render path; the original
mode keeps the existing particle renderer.

## Controls

Each experiment exposes only its small set of meaningful controls:

- Structural Erosion: intensity, sensitivity, recovery, field scale.
- Surface Morphology: intensity, viscosity, field scale, creases.
- Temporal Residue: memory, decay, residue drift.

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
