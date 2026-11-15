/**
 * Delivery formats, not render sizes.
 *
 * Instagram re-encodes supported uploads. What survives that
 * second pass is decided by the source: an exact platform size, H.264 High at
 * a bitrate high enough that the first generation carries the fine dot
 * structure, a fixed 30 fps, and a fast-start MP4. Anything larger only gets
 * downscaled, anything smaller gets upscaled and softened.
 *
 * 30 fps is deliberate: Reels allow 60, but twice the frames at the same
 * bitrate means half the bits per frame, and this piece is high-frequency
 * detail on black — exactly what a greedy encoder turns to mush.
 */

export type ExportFormatId = 'reel' | 'post' | 'square';

export interface ExportFormat {
	id: ExportFormatId;
	label: string;
	note: string;
	/** Delivery size, in pixels. */
	width: number;
	height: number;
	/** CSS aspect-ratio value, used to frame the stage. */
	aspect: string;
	fps: number;
	/** Bits per second. */
	bitrate: number;
}

const FPS = 30;

/** ~0.28 bits per pixel per frame: generous for dots on black. */
function bitrateFor(width: number, height: number): number {
	const raw = width * height * FPS * 0.28;
	return Math.round(raw / 100_000) * 100_000;
}

export const EXPORT_FORMATS: ExportFormat[] = [
	{
		id: 'reel',
		label: 'Reel',
		note: '9:16 · 1080 × 1920',
		width: 1080,
		height: 1920,
		aspect: '9 / 16',
		fps: FPS,
		bitrate: bitrateFor(1080, 1920)
	},
	{
		id: 'post',
		label: 'Post',
		note: '4:5 · 1080 × 1350',
		width: 1080,
		height: 1350,
		aspect: '4 / 5',
		fps: FPS,
		bitrate: bitrateFor(1080, 1350)
	},
	{
		id: 'square',
		label: 'Square',
		note: '1:1 · 1080 × 1080',
		width: 1080,
		height: 1080,
		aspect: '1 / 1',
		fps: FPS,
		bitrate: bitrateFor(1080, 1080)
	}
];

export function findFormat(id: ExportFormatId): ExportFormat {
	return EXPORT_FORMATS.find((format) => format.id === id) ?? EXPORT_FORMATS[0];
}

export function formatMbps(bitrate: number): string {
	return `${(bitrate / 1_000_000).toFixed(1)} Mbps`;
}

export function formatBytes(bytes: number): string {
	if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
	if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`;
	return `${Math.round(bytes / 1024)} KB`;
}

/** Target-size estimate; variable bitrate and container overhead vary. */
export function estimateBytes(format: ExportFormat, seconds: number): number {
	const bits = (format.bitrate + 192_000) * Math.max(1, seconds);
	return Math.round(bits / 8);
}
