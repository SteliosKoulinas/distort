import type { AudioFeatures } from './features';
import { silentAudioFeatures } from './features.ts';

export interface AudioFrame {
	bass: number;
	mid: number;
	treble: number;
	amp: number;
	/** 0..1 transient envelope. Integrated with the Kick button by the field. */
	beat: number;
	/** Routed descriptors. Engines never receive raw analyser data. */
	features: AudioFeatures;
}

export function silentAudioFrame(): AudioFrame {
	return {
		bass: 0,
		mid: 0,
		treble: 0,
		amp: 0,
		beat: 0,
		features: silentAudioFeatures()
	};
}
