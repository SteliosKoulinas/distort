import type { DecodedImage } from './decode';

export interface PaletteEntry {
	hex: string;
	/** sRGB bytes, for swatches and palette derivation. */
	rgb: [number, number, number];
	share: number;
}

export interface ImageAnalysis {
	width: number;
	height: number;
	aspect: number;
	/** Rec.709 relative luminance, 0..1. */
	lum: Float32Array;
	/** Normalized Sobel gradient magnitude, 0..1. */
	edge: Float32Array;
	/** HSV saturation, 0..1. */
	sat: Float32Array;
	/** HSV hue, 0..1. */
	hue: Float32Array;
	/** Dominant saturated hue clusters, for the UI (not used by physics). */
	palette: PaletteEntry[];
	meanLum: number;
	/** Mean HSV saturation across the source. */
	meanSat: number;
	/** Saturation-weighted circular mean hue, or null for a grey source. */
	dominantHue: number | null;
	/** Luminance at the 15th and 85th percentiles, for palette auto-levels. */
	lumP15: number;
	lumP85: number;
}

function toHex(r: number, g: number, b: number): string {
	const h = (n: number) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0');
	return `#${h(r)}${h(g)}${h(b)}`;
}

/**
 * One pass over the source pixels produces every per-pixel feature we need:
 * luminance, HSV saturation/hue, and a Sobel edge magnitude. These arrays are
 * reused by the sampler until a new image is loaded.
 */
export function analyzeImage(image: DecodedImage): ImageAnalysis {
	const { width, height, imageData } = image;
	const px = imageData.data;
	const n = width * height;
	const lum = new Float32Array(n);
	const sat = new Float32Array(n);
	const hue = new Float32Array(n);
	const edge = new Float32Array(n);
	const histogram = new Uint32Array(256);

	let meanLum = 0;
	let meanSat = 0;
	let hueX = 0;
	let hueY = 0;
	let hueWeight = 0;

	for (let i = 0; i < n; i++) {
		const o = i * 4;
		const r = px[o] / 255;
		const g = px[o + 1] / 255;
		const b = px[o + 2] / 255;

		const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
		lum[i] = l;
		meanLum += l;
		histogram[Math.min(255, Math.max(0, Math.floor(l * 255)))]++;

		const max = Math.max(r, g, b);
		const min = Math.min(r, g, b);
		const d = max - min;
		const s = max > 1e-5 ? d / max : 0;
		sat[i] = s;
		meanSat += s;

		if (d > 1e-5) {
			let h: number;
			if (max === r) h = ((g - b) / d) % 6;
			else if (max === g) h = (b - r) / d + 2;
			else h = (r - g) / d + 4;
			h /= 6;
			if (h < 0) h += 1;
			hue[i] = h;

			// Circular mean: red at both ends of the hue wheel must not cancel.
			const w = s * s * (0.2 + l);
			hueX += Math.cos(h * Math.PI * 2) * w;
			hueY += Math.sin(h * Math.PI * 2) * w;
			hueWeight += w;
		}
	}

	// 3x3 Sobel. The 0.5 scale keeps typical photographic detail in 0..1.
	for (let y = 1; y < height - 1; y++) {
		const row = y * width;
		for (let x = 1; x < width - 1; x++) {
			const i = row + x;
			const tl = lum[i - width - 1];
			const tc = lum[i - width];
			const tr = lum[i - width + 1];
			const ml = lum[i - 1];
			const mr = lum[i + 1];
			const bl = lum[i + width - 1];
			const bc = lum[i + width];
			const br = lum[i + width + 1];

			const gx = -tl + tr - 2 * ml + 2 * mr - bl + br;
			const gy = -tl - 2 * tc - tr + bl + 2 * bc + br;
			edge[i] = Math.min(1, Math.sqrt(gx * gx + gy * gy) * 0.5);
		}
	}

	const meanSaturation = meanSat / n;
	const dominantHue =
		meanSaturation > 0.055 && hueWeight > 0.002
			? (Math.atan2(hueY, hueX) / (Math.PI * 2) + 1) % 1
			: null;

	return {
		width,
		height,
		aspect: width / height,
		lum,
		edge,
		sat,
		hue,
		palette: extractPalette(px, hue, sat, lum, n),
		meanLum: meanLum / n,
		meanSat: meanSaturation,
		dominantHue,
		lumP15: percentile(histogram, n, 0.15),
		lumP85: percentile(histogram, n, 0.85)
	};
}

function percentile(histogram: Uint32Array, count: number, fraction: number): number {
	const target = Math.max(0, Math.min(1, fraction)) * count;
	let seen = 0;
	for (let i = 0; i < histogram.length; i++) {
		seen += histogram[i];
		if (seen >= target) return (i + 0.5) / histogram.length;
	}
	return 1;
}

/**
 * A small hue histogram (12 bins), weighted by saturation and luminance.
 * This is metadata for the UI: the particles themselves keep their exact
 * sampled colour, so we never posterize the source image.
 */
function extractPalette(
	px: Uint8ClampedArray,
	hue: Float32Array,
	sat: Float32Array,
	lum: Float32Array,
	count: number
): PaletteEntry[] {
	const bins = 12;
	const weights = new Float64Array(bins);
	const rSum = new Float64Array(bins);
	const gSum = new Float64Array(bins);
	const bSum = new Float64Array(bins);
	let total = 0;

	for (let i = 0; i < count; i++) {
		const alpha = px[i * 4 + 3] / 255;
		const w = alpha * sat[i] * (0.15 + lum[i]);
		if (w <= 0.00001) continue;
		const bin = Math.min(bins - 1, Math.floor(hue[i] * bins));
		weights[bin] += w;
		rSum[bin] += px[i * 4] * w;
		gSum[bin] += px[i * 4 + 1] * w;
		bSum[bin] += px[i * 4 + 2] * w;
		total += w;
	}

	if (total <= 0) return [];

	return Array.from({ length: bins }, (_, bin) => bin)
		.sort((a, b) => weights[b] - weights[a])
		.slice(0, 6)
		.filter((bin) => weights[bin] > 0)
		.map((bin) => {
			const r = rSum[bin] / weights[bin];
			const g = gSum[bin] / weights[bin];
			const b = bSum[bin] / weights[bin];
			return {
				hex: toHex(r, g, b),
				rgb: [Math.round(r), Math.round(g), Math.round(b)] as [number, number, number],
				share: weights[bin] / total
			};
		});
}
