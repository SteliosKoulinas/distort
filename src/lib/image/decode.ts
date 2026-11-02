export interface DecodedImage {
	imageData: ImageData;
	width: number;
	height: number;
	aspect: number;
}

async function fileToBitmap(file: File): Promise<ImageBitmap> {
	if (typeof createImageBitmap === 'function') {
		try {
			return await createImageBitmap(file, { imageOrientation: 'from-image' });
		} catch {
			// Safari/older browsers can reject the options object; try the fallback.
		}
	}

	const url = URL.createObjectURL(file);
	try {
		const img = new Image();
		img.decoding = 'async';
		img.src = url;
		await img.decode();
		return await createImageBitmap(img);
	} finally {
		URL.revokeObjectURL(url);
	}
}

/**
 * Decode + downscale once. 1200px on the long edge is enough detail for
 * 262k samples, and keeps the analysis pass comfortably interactive.
 */
export async function decodeImageFile(file: File, maxDimension = 1200): Promise<DecodedImage> {
	if (!file.type.startsWith('image/')) {
		throw new Error('That file is not an image.');
	}

	const bitmap = await fileToBitmap(file);
	const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
	const width = Math.max(1, Math.round(bitmap.width * scale));
	const height = Math.max(1, Math.round(bitmap.height * scale));

	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	const ctx = canvas.getContext('2d', { willReadFrequently: true });
	if (!ctx) {
		bitmap.close();
		throw new Error('The browser could not create a 2D canvas.');
	}

	ctx.imageSmoothingEnabled = true;
	ctx.imageSmoothingQuality = 'high';
	ctx.drawImage(bitmap, 0, 0, width, height);
	bitmap.close();

	return {
		imageData: ctx.getImageData(0, 0, width, height),
		width,
		height,
		aspect: width / height
	};
}
