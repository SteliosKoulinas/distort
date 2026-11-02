export interface AudioFrame {
	bass: number;
	mid: number;
	treble: number;
	amp: number;
	/** 0..1 transient envelope. Phase 1 fills this from the Kick button. */
	beat: number;
}

export function silentAudioFrame(): AudioFrame {
	return { bass: 0, mid: 0, treble: 0, amp: 0, beat: 0 };
}
