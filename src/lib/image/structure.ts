import type { ImageAnalysis } from './analyze';

export interface StructureField {
	width: number;
	height: number;
	/** Principal structure orientation in radians, -π/2..π/2. */
	orientation: Float32Array;
	/** Directional coherence, 0 for isotropic/noisy regions and 1 for aligned structure. */
	coherence: Float32Array;
	/** Normalized gradient magnitude, copied from the source analysis. */
	gradient: Float32Array;
	/** Principal direction vector. */
	directionX: Float32Array;
	directionY: Float32Array;
}

/**
 * Builds a compact structure tensor field from the existing luminance
 * analysis. This is shared image data, not an aesthetic effect: engines can
 * decide whether to advect along, across or around the detected structure.
 */
export function buildStructureField(analysis: ImageAnalysis): StructureField {
	const { width, height, lum, edge } = analysis;
	const size = width * height;
	const orientation = new Float32Array(size);
	const coherence = new Float32Array(size);
	const directionX = new Float32Array(size);
	const directionY = new Float32Array(size);
	const gradient = new Float32Array(edge);

	const luminance = (x: number, y: number): number => {
		const cx = Math.max(0, Math.min(width - 1, x));
		const cy = Math.max(0, Math.min(height - 1, y));
		return lum[cy * width + cx];
	};

	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			let jxx = 0;
			let jxy = 0;
			let jyy = 0;

			// Average a small tensor neighborhood so direction is stable and
			// not just the orientation of one noisy Sobel sample.
			for (let oy = -1; oy <= 1; oy++) {
				for (let ox = -1; ox <= 1; ox++) {
					const sx = x + ox;
					const sy = y + oy;
					const gx =
						luminance(sx + 1, sy - 1) + 2 * luminance(sx + 1, sy) + luminance(sx + 1, sy + 1) -
						luminance(sx - 1, sy - 1) - 2 * luminance(sx - 1, sy) - luminance(sx - 1, sy + 1);
					const gy =
						luminance(sx - 1, sy + 1) + 2 * luminance(sx, sy + 1) + luminance(sx + 1, sy + 1) -
						luminance(sx - 1, sy - 1) - 2 * luminance(sx, sy - 1) - luminance(sx + 1, sy - 1);
					jxx += gx * gx;
					jxy += gx * gy;
					jyy += gy * gy;
				}
			}

			const i = y * width + x;
			const angle = 0.5 * Math.atan2(2 * jxy, jxx - jyy);
			const trace = jxx + jyy;
			const anisotropy = Math.sqrt((jxx - jyy) ** 2 + 4 * jxy * jxy);
			orientation[i] = angle;
			coherence[i] = trace > 1e-6 ? Math.max(0, Math.min(1, anisotropy / trace)) : 0;
			directionX[i] = Math.cos(angle);
			directionY[i] = Math.sin(angle);
		}
	}

	return { width, height, orientation, coherence, gradient, directionX, directionY };
}
