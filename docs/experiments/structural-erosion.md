# Structural Erosion prototype

Branch: `experiment/structural-erosion`

## Mechanism

The photograph remains a continuous texture. A structure tensor is derived
from the existing luminance analysis and uploaded as four channels:

- R/G: principal direction
- B: directional coherence
- A: gradient magnitude

The shader advects the image along that direction, adds a weaker cross-flow in
less coherent regions, and applies selective wear where gradient and coherence
agree. Broad noise evolves slowly, while audio low/mid energy and spectral
change control the amount of deformation and local erosion.

This is intentionally not edge-strength multiplied by generic noise. Smooth
regions are held close to the source, while coherent structures carry the
longer deformation axis.

## Particle independence

When this mode is selected, `ParticleField` does not step or render the GPU
particle simulation. `ParticleView` displays only the structural continuous
image mesh. Switching back to Original / particles resumes the existing
particle path without deleting its reusable simulation.

## Validation

- Type check: passed.
- Existing and new tests: passed.
- Production build: passed.
- Headless GPU preview: structural layer visible, photo/points hidden, shader
  programs runnable, audio uniforms updated.

The current source is synthetic in the browser verification; aesthetic
evaluation still needs portrait, landscape and textured photographic material.
