/** Length of one take, independent from the length of the audio source. */
export function takeSeconds(
	selected: number,
	custom: number,
	trackDuration: number,
	hasTrack: boolean
): number {
	if (selected === -1) return Math.max(1, Math.min(300, Math.round(Number(custom) || 60)));
	if (selected === 0) {
		return hasTrack && Number.isFinite(trackDuration) && trackDuration > 0.25
			? Math.min(trackDuration, 300)
			: 60;
	}
	return Math.max(1, Math.min(300, selected));
}
