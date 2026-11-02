import type { ImageAnalysis } from './analyze';
import type { DecodedImage } from './decode';
import { mulberry32 } from '#lib/core/rng';
import { srgbToLinear } from '#lib/core/color';

export interface SampledParticles {
	count: number;
	/** x, y, z=0, mass. Packed into a float texture by the GPU layer. */
	origins: Float32Array;
	/** Linear-light RGB, ready for additive blending. */
	colors: Float32Array;
	/** Relative point size, derived from edge/saturation. */
	sizes: Float32Array;
	/** Per-particle random value for twinkle, depth and fracture jitter. */
	seeds: Float32Array;
}

/**
 * Importance sampling, not Poisson-disk.
 *
 * A hard minimum-distance constraint fights the whole point of stippling:
 * detailed/colourful regions must be allowed to get denser than flat ones.
 * At 200k particles over a 1200px image we are also already at roughly one
 * sample per pixel, where a disk radius would be sub-pixel anyway.
 *
 * Instead: build a CDF of per-pixel importance, then walk it with a
 * stratified (jittered) sequence. This gives low-variance density across the
 * image and sub-pixel jitter without clumping the whole cloud on one pixel.
 */
export function sampleParticles(
	analysis: ImageAnalysis,
	image: DecodedImage,
	options: { count: number; seed: number; edgeBoost: number }
): SampledParticles {
	const { width, height } = analysis;
	const px = image.imageData.data;
	const n = width * height;
	const count = Math.max(1, Math.floor(options.count));
	const rand = mulberry32(Math.floor(options.seed));

	const cdf = new Float64Array(n);
	let total = 0;
	for (let i = 0; i < n; i++) {
		const alpha = px[i * 4 + 3] / 255;
		const w =
			alpha *
			(0.04 + analysis.lum[i] * 0.22 + analysis.edge[i] * options.edgeBoost + analysis.sat[i] * 0.3);
		total += w;
		cdf[i] = total;
	}

	if (total <= 0) {
		throw new Error('This image has no visible pixels to sample.');
	}

	const origins = new Float32Array(count * 4);
	const colors = new Float32Array(count * 3);
	const sizes = new Float32Array(count);
	const seeds = new Float32Array(count);

	for (let p = 0; p < count; p++) {
		// One random sample inside each of `count` equal slices of the CDF.
		const target = ((p + rand()) / count) * total;
		let lo = 0;
		let hi = n - 1;
		while (lo < hi) {
			const mid = (lo + hi) >>> 1;
			if (cdf[mid] < target) lo = mid + 1;
			else hi = mid;
		}

		const x = lo % width;
		const y = Math.floor(lo / width);
		const pxIndex = lo * 4;

		// Sub-pixel jitter turns repeated picks of a hot pixel into a soft patch.
		const nx = ((x + 0.5 + (rand() - 0.5)) / width) * 2 - 1;
		const ny = 1 - ((y + 0.5 + (rand() - 0.5)) / height) * 2;

		const o = p * 4;
		origins[o] = nx;
		origins[o + 1] = ny;
		origins[o + 2] = 0;
		// Brighter pixels are slightly heavier, so they answer forces a little slower.
		origins[o + 3] = 0.8 + analysis.lum[lo] * 0.4;

		const c = p * 3;
		colors[c] = srgbToLinear(px[pxIndex] / 255);
		colors[c + 1] = srgbToLinear(px[pxIndex + 1] / 255);
		colors[c + 2] = srgbToLinear(px[pxIndex + 2] / 255);

		sizes[p] = 0.62 + analysis.edge[lo] * 0.85 + analysis.sat[lo] * 0.26;
		seeds[p] = rand();
	}

	return { count, origins, colors, sizes, seeds };
}
