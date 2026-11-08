import type { AudioFrame } from './types';
import { silentAudioFrame } from './types';

const FFT_SIZE = 2048;

const BASS_LOW = 20;
const BASS_HIGH = 160;
const MID_LOW = 160;
const MID_HIGH = 2_000;
const TREBLE_LOW = 2_000;
const TREBLE_HIGH = 12_000;
const AMP_HIGH = 16_000;

export interface AudioTrack {
	name: string;
	duration: number;
}

/**
 * Which spectral bands reach the field. Values are plain numbers, so the
 * animation loop never learns that audio exists as anything but forces.
 */
export interface AudioRouting {
	/** Master depth, 0..2. */
	amount: number;
	bass: boolean;
	mid: boolean;
	treble: boolean;
}

/**
 * Upload → decoded element → analyser → speakers, plus a small metering
 * clock. It runs only while audio plays. The page hands the resulting
 * AudioFrame to ParticleField.setAudio, which is a plain method.
 */
export class AudioEngine {
	readonly routing: AudioRouting = { amount: 1, bass: true, mid: true, treble: true };

	onTime: ((time: number, duration: number) => void) | null = null;
	onEnded: (() => void) | null = null;

	private readonly element: HTMLAudioElement;
	private context: AudioContext | null = null;
	private analyser: AnalyserNode | null = null;
	private source: MediaElementAudioSourceNode | null = null;
	private spectrumData: Uint8Array<ArrayBuffer> | null = null;
	private frameSink: ((frame: AudioFrame) => void) | null = null;
	private objectUrl = '';
	private raf = 0;
	private beatAverage = 0;
	private playing = false;
	private disposed = false;

	constructor() {
		this.element = new Audio();
		this.element.preload = 'metadata';
		this.element.addEventListener('timeupdate', this.handleTimeUpdate);
		this.element.addEventListener('ended', this.handleEnded);
	}

	get isPlaying(): boolean {
		return this.playing;
	}

	get currentTime(): number {
		return Number.isFinite(this.element.currentTime) ? this.element.currentTime : 0;
	}

	get duration(): number {
		return Number.isFinite(this.element.duration) ? this.element.duration : 0;
	}

	/** Raw analyser bytes, 0..255. The spectrum display reads this directly. */
	get spectrum(): Uint8Array | null {
		return this.spectrumData;
	}

	get sampleRate(): number {
		return this.context?.sampleRate ?? 48_000;
	}

	get binHz(): number {
		return this.sampleRate / FFT_SIZE;
	}

	setFrameSink(sink: ((frame: AudioFrame) => void) | null): void {
		this.frameSink = sink;
	}

	async load(file: File): Promise<AudioTrack> {
		this.pause();
		this.ensureContext();

		if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
		this.objectUrl = URL.createObjectURL(file);
		this.element.src = this.objectUrl;

		await new Promise<void>((resolve, reject) => {
			const cleanup = () => {
				this.element.removeEventListener('loadedmetadata', handleLoaded);
				this.element.removeEventListener('error', handleError);
			};
			const handleLoaded = () => {
				cleanup();
				resolve();
			};
			const handleError = () => {
				cleanup();
				reject(new Error('Could not read that audio file. Try MP3, M4A, WAV or OGG.'));
			};

			this.element.addEventListener('loadedmetadata', handleLoaded);
			this.element.addEventListener('error', handleError);
			this.element.load();
		});

		this.beatAverage = 0;
		return { name: file.name, duration: this.duration };
	}

	async play(): Promise<void> {
		if (this.disposed) return;
		this.ensureContext();
		if (this.context?.state === 'suspended') await this.context.resume();
		if (this.duration > 0 && this.element.currentTime >= this.duration - 0.01) {
			this.element.currentTime = 0;
		}

		await this.element.play();
		this.playing = true;
		this.startMetering();
	}

	pause(): void {
		this.element.pause();
		this.playing = false;
		this.stopMetering();
	}

	seek(seconds: number): void {
		if (this.duration <= 0) return;
		this.element.currentTime = Math.max(0, Math.min(this.duration, seconds));
		this.onTime?.(this.currentTime, this.duration);
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.stopMetering();
		this.playing = false;
		this.element.pause();
		this.element.removeEventListener('timeupdate', this.handleTimeUpdate);
		this.element.removeEventListener('ended', this.handleEnded);
		this.element.removeAttribute('src');
		this.element.load();
		this.source?.disconnect();
		this.analyser?.disconnect();
		void this.context?.close();
		this.source = null;
		this.analyser = null;
		this.context = null;
		this.spectrumData = null;
		this.frameSink = null;
		this.onTime = null;
		this.onEnded = null;
		if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
		this.objectUrl = '';
	}

	private ensureContext(): void {
		if (this.context) {
			if (this.context.state === 'suspended') void this.context.resume();
			return;
		}

		const Constructor =
			window.AudioContext ??
			(window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
		if (!Constructor) return;

		const context = new Constructor();
		const analyser = context.createAnalyser();
		analyser.fftSize = FFT_SIZE;
		analyser.smoothingTimeConstant = 0.72;
		analyser.minDecibels = -90;
		analyser.maxDecibels = -10;

		const source = context.createMediaElementSource(this.element);
		source.connect(analyser);
		analyser.connect(context.destination);

		this.context = context;
		this.analyser = analyser;
		this.source = source;
		this.spectrumData = new Uint8Array(analyser.frequencyBinCount);
	}

	private startMetering(): void {
		if (this.raf || !this.analyser) return;
		this.raf = requestAnimationFrame(this.tick);
	}

	private stopMetering(): void {
		if (this.raf) cancelAnimationFrame(this.raf);
		this.raf = 0;
		this.frameSink?.(silentAudioFrame());
	}

	private tick = (): void => {
		this.raf = requestAnimationFrame(this.tick);
		if (!this.analyser || !this.spectrumData) return;
		this.frameSink?.(this.analyze());
	};

	private analyze(): AudioFrame {
		const data = this.spectrumData;
		const context = this.context;
		if (!data || !context) return silentAudioFrame();

		this.analyser?.getByteFrequencyData(data);

		const binHz = context.sampleRate / FFT_SIZE;
		const binCount = data.length;

		const band = (low: number, high: number): number => {
			const from = Math.max(0, Math.floor(low / binHz));
			const to = Math.min(binCount - 1, Math.ceil(high / binHz));
			if (to < from) return 0;
			let sum = 0;
			for (let i = from; i <= to; i++) {
				const value = data[i] / 255;
				sum += value * value;
			}
			return Math.sqrt(sum / (to - from + 1));
		};

		const bass = band(BASS_LOW, BASS_HIGH);
		const mid = band(MID_LOW, MID_HIGH);
		const treble = band(TREBLE_LOW, TREBLE_HIGH);
		const amp = band(BASS_LOW, AMP_HIGH);

		// A slow running average turns the bass band into a transient
		// detector. The field owns the decay, so a peak is enough here.
		this.beatAverage += (bass - this.beatAverage) * 0.06;
		const delta = bass - this.beatAverage;
		const beat = delta > 0.1 && bass > 0.16 ? Math.min(1, delta * 3.4) : 0;

		const routing = this.routing;
		const amount = Math.max(0, Math.min(2, routing.amount));

		return {
			bass: routing.bass ? Math.min(1, bass * amount) : 0,
			mid: routing.mid ? Math.min(1, mid * amount) : 0,
			treble: routing.treble ? Math.min(1, treble * amount) : 0,
			amp: Math.min(1, amp * amount),
			beat: routing.bass ? beat * Math.min(1, amount) : 0
		};
	}

	private handleTimeUpdate = (): void => {
		this.onTime?.(this.currentTime, this.duration);
	};

	private handleEnded = (): void => {
		this.playing = false;
		this.stopMetering();
		this.onEnded?.();
	};
}
