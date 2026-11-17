# Surface Morphology prototype

Branch: `experiment/surface-morphology`

## Mechanism

This branch deliberately does not reuse the Structural Erosion shader. It
builds a continuous nonlinear surface from two nested flow fields:

1. a broad, slow current;
2. a local field sampled at the already displaced coordinate.

The fields produce viscous advection rather than point decomposition. A
continuous sinusoidal crease creates folding and overlap, and luminance
boundaries decide where the deformed sample is allowed to dominate the source.
Low energy drives the broad current; mid/high energy, spectral flux and
transients alter the local elasticity.

## Particle independence

This mode renders the photograph mesh only. The particle simulation is not
stepped or drawn, so the behavior remains meaningful at zero particle count.

## Validation

- Type check: passed.
- Existing and new tests: passed.
- Production build: passed.
- Headless GPU preview: surface layer visible, points/photo layer hidden,
  shader programs runnable and audio uniforms updated.

This is a technical preview, not a claim that the visual language is finished.
The next decision should be based on actual exports with several photographic
categories and slow/ambient audio.
