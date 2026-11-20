import type { StillFormat } from './formats';

export type StillMime = 'image/png' | 'image/jpeg';

export interface StillEncodeOptions {
	canvas: HTMLCanvasElement;
	format: StillFormat;
	mime: StillMime;
	quality?: number;
	frameId: string;
}

export interface StillResult {
	blob: Blob;
	extension: 'png' | 'jpg';
	frameId: string;
	width: number;
	height: number;
}

function blobFromCanvas(canvas: HTMLCanvasElement, mime: StillMime, quality?: number): Promise<Blob> {
	return new Promise((resolve, reject) => {
		canvas.toBlob((blob) => {
			if (blob) resolve(blob);
			else reject(new Error('The browser could not encode this still frame.'));
		}, mime, quality);
	});
}

/**
 * Snapshot the artwork canvas exactly once. The caller must keep the canvas
 * framed to the selected still aspect before invoking this function; no
 * renderer call, simulation step or feedback pass happens here.
 */
export async function encodeStill(options: StillEncodeOptions): Promise<StillResult> {
	const { canvas, format, mime, frameId } = options;
	if (canvas.width !== format.width || canvas.height !== format.height) {
		throw new Error(
			`Still capture is not ready at ${format.width} × ${format.height}. ` +
			'Choose the size before saving the frame.'
		);
	}
	const blob = await blobFromCanvas(canvas, mime, mime === 'image/jpeg'
		? Math.min(1, Math.max(0, options.quality ?? 0.94))
		: undefined);
	return {
		blob,
		extension: mime === 'image/png' ? 'png' : 'jpg',
		frameId,
		width: format.width,
		height: format.height
	};
}

export function stillMime(format: 'jpeg' | 'png'): StillMime {
	return format === 'png' ? 'image/png' : 'image/jpeg';
}
