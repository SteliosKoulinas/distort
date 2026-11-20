# Temporal Residue prototype

Branch: `experiment/temporal-residue`

## Mechanism

The source photograph is rendered into one bounded source target. A second
pass combines that frame with a previous result, using two ping-pong history
targets. A final copy pass presents the result on screen. There is no frame
array and no unbounded accumulation.

History is opened by the shared audio response and weighted by spectral flux
and transient energy. A small, slow history-coordinate drift prevents the
residue from becoming a static double exposure. `Decay` controls how much of
the previous state survives each pass; when audio recedes, the memory term
falls continuously toward the current photograph.

## Resource policy

- One source target plus two history targets.
- Targets are recreated when the framebuffer size changes.
- Source replacement calls `resetTemporal()`.
- Resize and export-size changes reset history through target recreation.
- All targets, materials, meshes and cameras are disposed by `ParticleView`.
- The particle simulation is not stepped or rendered in this mode.

## What this is not

This is not a full-frame ghosting overlay and it does not reproduce a slit-scan
algorithm. It is a bounded feedback compositor for previous states generated
by distort itself.

## Validation

- Type check: passed.
- Tests: passed, including the bounded current/history shader contract.
- Production build: passed.
- Headless GPU preview: temporal layer visible, points hidden, four shader
  programs runnable, render targets matched the active 256 × 256 framebuffer.

Visual judgment still requires real photographic sources and the same audio
material used for the other experiments.
