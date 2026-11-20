# Motion mode behavior

These modes are continuous image-surface engines rather than particle
simulations. Their source texture remains intact and the shader moves or
re-samples it in source coordinates. Audio is routed into normalized
descriptors (`low`, `mid`, `high`, `flux`, `transient`, and `centroid`), so
the mode should be readable before a loud event and become more active when
the descriptors rise.

## Structural Erosion

### Current intent

The structure analysis builds a four-channel field: principal gradient
direction, coherence, and gradient magnitude. The shader moves pixels along
the contour direction, adds cross-flow in incoherent areas, and applies
selective wear where a strong gradient and coherent structure agree. Low/mid
energy and spectral change are intended to increase deformation and local
erosion; recovery returns the result toward the source after an event.

### Why it was hard to read

The previous `activity` was `intensity * sound`, so silence made every
displacement zero. The displacement was only about 0.01–0.02 UV units and the
wear veil was a small brightness reduction. That produced a nearly static
photograph unless the input supplied a strong transient.

### Updated behavior

The shader now has a low-amplitude contour “breath” independent of audio,
larger coherent contour displacement, a moving wear wave, and selective dark
incisions at structural edges. Audio increases all three cues while recovery
softens the damage. The result reads as material being abraded along the
photograph’s own forms, rather than as generic noise.

## Signal Dislocation

### Current intent

The image is treated as a transmission: stable horizontal rows receive
selective horizontal slips, with RGB channels displaced by different amounts.
Flux and transients open the rows, high-frequency energy adds response, and
local luminance edges keep corruption attached to meaningful image boundaries.

### Why it was hard to read

Rows were only selected by `flux + transient + high`, so a quiet or steady
track produced no event. Row identity also changed in coarse time steps
(`floor(time * 1.5)`), while the displacement was about 0.008 UV units. The
result could look identical between frames and the channel split was too
restrained to establish a signal fault.

### Updated behavior

Rows now have a continuously moving pulse and slip phase. A restrained
baseline scan drift remains in silence, while flux/transient energy broadens
the active rows and increases their horizontal displacement and RGB
separation. A moving scanline lift and small luminance modulation make the
transmission behavior visible without turning the entire image into a
permanent glitch overlay.

## Fragmented Planes

### Current intent

The shader derives soft luminance bands from the photograph. Each band samples
the same source with a different directional offset, creating a 2.5D stack of
planes without arbitrary rectangles or semantic segmentation. Low/mid energy
drives slow parallax; transients add cross-axis separation.

### Why it was hard to read

The bands overlapped broadly, the offsets were roughly 0.01 UV units, and the
whole effect was mixed by a low audio-dependent activity value. In silence,
the plane relationship was therefore almost imperceptible.

### Updated behavior

The planes now breathe continuously, use narrower luminance membership, and
carry larger per-plane parallax with different speeds and phases. Depth and
audio transient energy add separation along a cross-axis, while a subtle seam
at luminance boundaries makes neighboring planes readable without drawing
arbitrary rectangles or destroying the source.

## Shared framing change

The live stage defaults to **Stage** and shows the complete source at an
unzoomed, aspect-locked scale. A different frame may therefore have empty
stage space until the operator adjusts `Zoom`, `Position X`, and `Position Y`.
Those controls map to source-space transforms and are shared by the continuous
image and particle paths, so dots stay attached to the same image content as
the underlying photograph.
