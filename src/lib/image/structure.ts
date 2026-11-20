import type { ImageAnalysis } from './analyze';

export interface StructureField {
	width: number;
	height: number;
	/** Gradient axis in radians; image coordinates, Y down. */
	orientation: Float32Array;
	coherence: Float32Array;
	gradient: Float32Array;
	gradientDir: { x: Float32Array; y: Float32Array };
	contourDir: { x: Float32Array; y: Float32Array };
}

/** Separable 3×3 box blur of one tensor component, with clamped borders. */
function blur(values: Float32Array, width: number, height: number): Float32Array {
	const horizontal = new Float32Array(values.length);
	const output = new Float32Array(values.length);
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const i = y * width + x;
			horizontal[i] = (values[y * width + Math.max(0, x - 1)] + values[i] +
				values[y * width + Math.min(width - 1, x + 1)]) / 3;
		}
	}
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const i = y * width + x;
			output[i] = (horizontal[Math.max(0, y - 1) * width + x] + horizontal[i] +
				horizontal[Math.min(height - 1, y + 1) * width + x]) / 3;
		}
	}
	return output;
}

export type StructureInput = Pick<ImageAnalysis, 'width' | 'height' | 'sobelX' | 'sobelY' | 'edge'>;

export function buildStructureField(analysis: StructureInput): StructureField {
	const { width, height, sobelX, sobelY, edge } = analysis;
	const size = width * height;
	const xx = new Float32Array(size);
	const xy = new Float32Array(size);
	const yy = new Float32Array(size);
	for (let i = 0; i < size; i++) {
		xx[i] = sobelX[i] ** 2;
		xy[i] = sobelX[i] * sobelY[i];
		yy[i] = sobelY[i] ** 2;
	}
	const jxx = blur(xx, width, height);
	const jxy = blur(xy, width, height);
	const jyy = blur(yy, width, height);
	const orientation = new Float32Array(size);
	const coherence = new Float32Array(size);
	const gradientDir = { x: new Float32Array(size), y: new Float32Array(size) };
	const contourDir = { x: new Float32Array(size), y: new Float32Array(size) };
	for (let i = 0; i < size; i++) {
		const angle = 0.5 * Math.atan2(2 * jxy[i], jxx[i] - jyy[i]);
		const trace = jxx[i] + jyy[i];
		orientation[i] = angle;
		coherence[i] = trace > 1e-6
			? Math.min(1, Math.hypot(jxx[i] - jyy[i], 2 * jxy[i]) / trace) : 0;
		gradientDir.x[i] = Math.cos(angle);
		gradientDir.y[i] = Math.sin(angle);
		contourDir.x[i] = -Math.sin(angle);
		contourDir.y[i] = Math.cos(angle);
	}
	return { width, height, orientation, coherence, gradient: edge, gradientDir, contourDir };
}

/** Gradient axis in texture coordinates, coherence and magnitude. */
export function packStructureField(field: StructureField): Uint8Array {
	const pixels = new Uint8Array(field.width * field.height * 4);
	for (let y = 0; y < field.height; y++) {
		for (let x = 0; x < field.width; x++) {
			const i = y * field.width + x;
			const o = ((field.height - y - 1) * field.width + x) * 4;
			pixels[o] = Math.round((field.gradientDir.x[i] * 0.5 + 0.5) * 255);
			pixels[o + 1] = Math.round((-field.gradientDir.y[i] * 0.5 + 0.5) * 255);
			pixels[o + 2] = Math.round(field.coherence[i] * 255);
			pixels[o + 3] = Math.round(field.gradient[i] * 255);
		}
	}
	return pixels;
}
