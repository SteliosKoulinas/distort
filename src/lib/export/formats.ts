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

export type ExportFormatId = 'reel' | 'post' | 'square' | 'portrait' | 'wide' | 'custom';

/** The framebuffer is derived from the stage itself; the others are fixed. */
export type FrameChoice = 'stage' | ExportFormatId;

export interface ExportFormat {
	id: ExportFormatId | 'stage';
	label: string;
	note: string;
	/** Delivery size, in pixels. Always even: H.264 4:2:0 samples pairs. */
	width: number;
	height: number;
	/** CSS aspect-ratio value, used to frame the stage. */
	aspect: string;
	fps: number;
	/** Bits per second. */
	bitrate: number;
}

const FPS = 30;

/** H.264 encoders reject odd dimensions in 4:2:0, so the UI never offers them. */
export const MIN_EXPORT_EDGE = 240;
export const MAX_EXPORT_EDGE = 2160;

/** ~0.28 bits per pixel per frame: generous for dots on black. */
function bitrateFor(width: number, height: number): number {
	const raw = width * height * FPS * 0.28;
	return Math.round(Math.min(45_000_000, Math.max(4_000_000, raw)) / 100_000) * 100_000;
}

/** Clamp to the allowed range and snap to an even number of pixels. */
export function normalizeEdge(value: number): number {
	const rounded = Math.round(Number(value) || 0);
	const even = rounded - (rounded % 2);
	return Math.max(MIN_EXPORT_EDGE, Math.min(MAX_EXPORT_EDGE, even));
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
	},
	{
		id: 'portrait',
		label: 'Portrait',
		note: '3:4 · 1080 × 1440',
		width: 1080,
		height: 1440,
		aspect: '3 / 4',
		fps: FPS,
		bitrate: bitrateFor(1080, 1440)
	},
	{
		id: 'wide',
		label: 'Wide',
		note: '16:9 · 1920 × 1080',
		width: 1920,
		height: 1080,
		aspect: '16 / 9',
		fps: FPS,
		bitrate: bitrateFor(1920, 1080)
	}
];

export function findFormat(id: ExportFormatId): ExportFormat {
	return EXPORT_FORMATS.find((format) => format.id === id) ?? EXPORT_FORMATS[0];
}

/** Any width × height the operator types, snapped to a valid H.264 frame. */
export function customFormat(width: number, height: number): ExportFormat {
	const w = normalizeEdge(width);
	const h = normalizeEdge(height);
	return {
		id: 'custom',
		label: 'Custom',
		note: `${w} × ${h}`,
		width: w,
		height: h,
		aspect: `${w} / ${h}`,
		fps: FPS,
		bitrate: bitrateFor(w, h)
	};
}

/**
 * "Stage" means the composition currently on screen: the canvas aspect with
 * 1080 px on its long edge. This is what the old option claimed to do while
 * silently recording Reel.
 */
export function stageFormat(cssWidth: number, cssHeight: number): ExportFormat {
	const width = Math.max(1, Math.round(cssWidth) || 1);
	const height = Math.max(1, Math.round(cssHeight) || 1);
	const scale = 1080 / Math.max(width, height);
	const w = normalizeEdge(width * scale);
	const h = normalizeEdge(height * scale);
	return {
		id: 'stage',
		label: 'Stage',
		note: `${w} × ${h}`,
		width: w,
		height: h,
		aspect: `${w} / ${h}`,
		fps: FPS,
		bitrate: bitrateFor(w, h)
	};
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
