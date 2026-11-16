/**
 * Keep image-space modulation inside the audio gate. A silent photo retains
 * its chosen mix and optics even while the four LFO clocks continue running
 * for other routes. The base slider remains authoritative: zero stays off.
 */
export function modulatePhotoValue(base: number, factor: number, audioResponse: number): number {
	const response = Math.max(0, Math.min(1, audioResponse));
	return Math.max(0, Math.min(1, base * (1 + (factor - 1) * response)));
}
