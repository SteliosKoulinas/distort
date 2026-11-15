import type { ImageAnalysis } from '#lib/image/analyze';

/**
 * The photograph baked as a surface, so the renderer can treat it as glass.
 *
 * One pass over the image the app already analysed produces a small RGBA map:
 *
 *   R,G  signed luminance gradient (Sobel), scaled so the strongest edge
 *        reaches ±1. Multiply by a strength in the shader and you get a
 *        refraction that follows the picture's own contours.
 *   B    luminance, used to lift bright structure off the page.
 *   A    edge magnitude, used to keep the lens quiet in flat areas.
 *
 * It is intentionally low resolution (512 px on the long edge): the surface is
 * sampled per point with linear filtering, and a sharper map would only make
 * the displacement noisy. Rows are written bottom-up so the texture's v axis
 * matches the image's own y, which is what the particle coordinates use.
 */
export interface NormalField {
	data: Uint8Array;
	width: number;
	height: number;
}

export function buildNormalField(analysis: ImageAnalysis, maxSize = 512): NormalField {
	const srcW = Math.max(1, analysis.width);
	const srcH = Math.max(1, analysis.height);
	const scale = Math.min(1, maxSize / Math.max(srcW, srcH));
	const width = Math.max(2, Math.round(srcW * scale));
	const height = Math.max(2, Math.round(srcH * scale));
	const n = width * height;

	const lum = new Float32Array(n);
	const edge = new Float32Array(n);

	// Area-average into the target grid. Nearest sampling would turn fine
	// stipple into false gradients.
	for (let y = 0; y < height; y++) {
		const y0 = Math.floor((y * srcH) / height);
		const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * srcH) / height));
		for (let x = 0; x < width; x++) {
			const x0 = Math.floor((x * srcW) / width);
			const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * srcW) / width));
			let lSum = 0;
			let eSum = 0;
			let count = 0;
			for (let sy = y0; sy < y1; sy++) {
				const row = sy * srcW;
				for (let sx = x0; sx < x1; sx++) {
					lSum += analysis.lum[row + sx];
					eSum += analysis.edge[row + sx];
					count++;
				}
			}
			const i = y * width + x;
			lum[i] = count > 0 ? lSum / count : 0;
			edge[i] = count > 0 ? eSum / count : 0;
		}
	}

	const gx = new Float32Array(n);
	const gy = new Float32Array(n);
	let maxMag = 0;

	const at = (x: number, y: number): number => {
		const cx = x < 0 ? 0 : x >= width ? width - 1 : x;
		const cy = y < 0 ? 0 : y >= height ? height - 1 : y;
		return lum[cy * width + cx];
	};

	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const i = y * width + x;
			// Sobel. Row index grows downward, v grows upward, hence the sign.
			const sx =
				at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) -
				(at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1));
			const sy =
				at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1) -
				(at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1));
			gx[i] = sx / 8;
			gy[i] = -sy / 8;
			const mag = Math.hypot(gx[i], gy[i]);
			if (mag > maxMag) maxMag = mag;
		}
	}

	const norm = 0.9 / Math.max(0.0005, maxMag);
	const data = new Uint8Array(n * 4);
	for (let j = 0; j < height; j++) {
		const y = height - 1 - j;
		for (let x = 0; x < width; x++) {
			const i = y * width + x;
			const o = (j * width + x) * 4;
			data[o] = encodeSigned(gx[i] * norm);
			data[o + 1] = encodeSigned(gy[i] * norm);
			data[o + 2] = Math.round(Math.max(0, Math.min(1, lum[i])) * 255);
			data[o + 3] = Math.round(Math.max(0, Math.min(1, edge[i])) * 255);
		}
	}

	return { data, width, height };
}

function encodeSigned(value: number): number {
	const clamped = Math.max(-1, Math.min(1, value));
	return Math.round(128 + clamped * 127);
}
