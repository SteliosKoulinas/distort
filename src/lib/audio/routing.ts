import { AudioFeatureExtractor } from './features.ts';
import type { AudioFrame } from './types';
import { silentAudioFrame } from './types.ts';

export interface AudioRouting {
	amount: number;
	bass: boolean;
	mid: boolean;
	treble: boolean;
}

const clamp = (value: number, max = 1) => Math.max(0, Math.min(max, value));

/** Route bins before analysis so broadband descriptors cannot hear muted bands. */
export class RoutedAudioAnalyzer {
	private readonly extractor: AudioFeatureExtractor;
	private routed: Uint8Array;
	private signature = '';
	private beatAverage = 0;
	private readonly sampleRate: number;
	private readonly fftSize: number;

	constructor(sampleRate: number, fftSize: number) {
		this.sampleRate = sampleRate;
		this.fftSize = fftSize;
		this.extractor = new AudioFeatureExtractor(sampleRate, fftSize);
		this.routed = new Uint8Array(fftSize / 2);
	}

	reset(): void {
		this.extractor.reset();
		this.beatAverage = 0;
	}

	update(bytes: Uint8Array, routing: AudioRouting, dt = 1 / 60): AudioFrame {
		// Gain is applied after analysis; changing it must not reset onset history.
		const signature = `${routing.bass}/${routing.mid}/${routing.treble}`;
		if (signature !== this.signature) {
			this.reset();
			this.signature = signature;
		}
		if (this.routed.length !== bytes.length) this.routed = new Uint8Array(bytes.length);
		const amount = clamp(routing.amount, 2);
		if (!(routing.bass || routing.mid || routing.treble)) {
			this.reset();
			return silentAudioFrame();
		}
		for (let i = 0; i < bytes.length; i++) {
			const hz = i * this.sampleRate / this.fftSize;
			const enabled = hz >= 20 && hz < 12_000 &&
				(hz < 160 ? routing.bass : hz < 2_000 ? routing.mid : routing.treble);
			this.routed[i] = enabled ? bytes[i] : 0;
		}
		const raw = this.extractor.update(this.routed, dt);
		const features = { ...raw };
		for (const key of Object.keys(features) as (keyof typeof features)[]) {
			features[key] = clamp(features[key] * amount);
		}
		this.beatAverage += (raw.low - this.beatAverage) * (1 - Math.exp(-dt * 3.71));
		const delta = raw.low - this.beatAverage;
		return {
			bass: features.low, mid: features.mid, treble: features.high,
			amp: features.rms,
			beat: routing.bass && delta > 0.1 && raw.low > 0.16
				? clamp(delta * 3.4) * Math.min(1, amount) : 0,
			features
		};
	}
}

/** Apply once, immediately before handing the shared frame to an engine. */
export function gateAudioFrame(frame: AudioFrame, reactive: boolean, motion: number): AudioFrame {
	const gate = reactive ? clamp(motion) : 0;
	const result = silentAudioFrame();
	for (const key of ['bass', 'mid', 'treble', 'amp', 'beat'] as const) {
		result[key] = clamp(frame[key]) * gate;
	}
	for (const key of Object.keys(result.features) as (keyof typeof result.features)[]) {
		result.features[key] = clamp(frame.features[key]) * gate;
	}
	return result;
}
