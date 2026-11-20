/**
 * Audio features shared by independent visual engines.
 *
 * The extractor deliberately returns normalized plain numbers. Engines do
 * not need to know whether the source is a file, microphone or system audio,
 * and they do not retain references to Web Audio nodes.
 */
export interface AudioFeatures {
	/** Root-mean-square energy, normalized to 0..1. */
	rms: number;
	/** Energy in the low, middle and high spectral regions. */
	low: number;
	mid: number;
	high: number;
	/** Positive spectral change, normalized to 0..1. */
	flux: number;
	/** Spectral centroid, normalized to the Nyquist range. */
	centroid: number;
	/** Smoothed long-term energy. */
	slowEnvelope: number;
	/** Short-lived energy change after smoothing. */
	transient: number;
}

export function silentAudioFeatures(): AudioFeatures {
	return {
		rms: 0,
		low: 0,
		mid: 0,
		high: 0,
		flux: 0,
		centroid: 0,
		slowEnvelope: 0,
		transient: 0
	};
}

function clamp01(value: number): number {
	return Math.max(0, Math.min(1, value));
}

function smooth(previous: number, target: number, dt: number, attack: number, release: number): number {
	const coefficient = 1 - Math.exp(-dt * (target > previous ? attack : release));
	return previous + (target - previous) * coefficient;
}

/**
 * Extracts low-cost, content-independent features from analyser bytes.
 *
 * This is intentionally independent from AudioEngine. It can be tested with
 * synthetic spectra and reused by every visual prototype without duplicating
 * analyser logic.
 */
export class AudioFeatureExtractor {
	private readonly sampleRate: number;
	private readonly fftSize: number;
	private previous: Float32Array | null = null;
	private slowEnvelope = 0;
	private transient = 0;

	constructor(sampleRate: number, fftSize: number) {
		this.sampleRate = Math.max(1, sampleRate);
		this.fftSize = Math.max(2, fftSize);
	}

	reset(): void {
		this.previous = null;
		this.slowEnvelope = 0;
		this.transient = 0;
	}

	update(bytes: Uint8Array, dt = 1 / 60): AudioFeatures {
		const bins = bytes.length;
		if (!bins) return silentAudioFeatures();
		const frameDelta = Number.isFinite(dt) ? Math.max(0, Math.min(0.25, dt)) : 1 / 60;
		if (this.previous && this.previous.length !== bins) {
			// Analyser FFT size can change when an input device is replaced.
			// Comparing arrays of different lengths would read undefined and
			// poison flux/transient with NaN.
			this.reset();
		}

		const binHz = this.sampleRate / this.fftSize;
		const nyquist = this.sampleRate / 2;
		const band = (low: number, high: number): number => {
			const from = Math.max(0, Math.ceil(low / binHz));
			const to = Math.min(bins - 1, Math.ceil(high / binHz) - 1);
			if (to < from) return 0;
			let sum = 0;
			for (let i = from; i <= to; i++) {
				const value = bytes[i] / 255;
				sum += value * value;
			}
			return Math.sqrt(sum / (to - from + 1));
		};

		let weightedFrequency = 0;
		let totalEnergy = 0;
		let fluxSum = 0;
		const previous = this.previous;
		for (let i = 0; i < bins; i++) {
			const value = bytes[i] / 255;
			const energy = value * value;
			const frequency = Math.min(nyquist, i * binHz);
			totalEnergy += energy;
			weightedFrequency += frequency * energy;
			if (previous) fluxSum += Math.max(0, value - previous[i]);
		}

		const rms = Math.sqrt(totalEnergy / bins);
		const flux = clamp01((fluxSum / bins) * 4.5);
		const centroid = totalEnergy > 1e-6 ? clamp01(weightedFrequency / totalEnergy / nyquist) : 0;
		const low = band(20, 160);
		const mid = band(160, 2_000);
		const high = band(2_000, 12_000);
		const delta = Math.max(0, rms - this.slowEnvelope);

		this.slowEnvelope = smooth(this.slowEnvelope, rms, frameDelta, 3.2, 0.7);
		this.transient = smooth(this.transient, delta + flux * 0.35, frameDelta, 12, 3.5);
		this.previous = Float32Array.from(bytes, (value) => value / 255);

		return {
			rms,
			low,
			mid,
			high,
			flux,
			centroid,
			slowEnvelope: this.slowEnvelope,
			transient: clamp01(this.transient * 4)
		};
	}
}
