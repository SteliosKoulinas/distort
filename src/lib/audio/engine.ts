import type { AudioFrame } from './types';
import { silentAudioFrame } from './types';
import { AudioFeatureExtractor } from './features';

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
 * Two kinds of source feed the same analyser:
 *
 * 1. an uploaded file, through an `HTMLAudioElement` (played to the speakers),
 * 2. a live `MediaStream` — system audio or a microphone. A captured stream
 *    is analysed but *muted* to the output, so the field can follow whatever
 *    is playing (Spotify, a DAW, a room) without echoing it back.
 *
 * Either way the result is a plain `AudioFrame` handed to
 * `ParticleField.setAudio`. The animation loop never learns where sound came
 * from.
 */
export class AudioEngine {
	readonly routing: AudioRouting = { amount: 1, bass: true, mid: true, treble: true };

	onTime: ((time: number, duration: number) => void) | null = null;
	onEnded: (() => void) | null = null;
	/** Fired when a live capture ends on its own (the user stops sharing). */
	onStreamEnded: (() => void) | null = null;

	private readonly element: HTMLAudioElement;
	private context: AudioContext | null = null;
	private analyser: AnalyserNode | null = null;
	private outputGain: GainNode | null = null;
	private recordDest: MediaStreamAudioDestinationNode | null = null;
	private elementSource: MediaElementAudioSourceNode | null = null;
	private streamSource: MediaStreamAudioSourceNode | null = null;
	private stream: MediaStream | null = null;
	private spectrumData: Uint8Array<ArrayBuffer> | null = null;
	private featureExtractor: AudioFeatureExtractor | null = null;
	private featureExtractorSampleRate = 0;
	private frameSink: ((frame: AudioFrame) => void) | null = null;
	private objectUrl = '';
	private raf = 0;
	private beatAverage = 0;
	private playing = false;
	private live = false;
	private liveLabel = '';
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

	/** True while analysing a captured stream instead of a file. */
	get isLive(): boolean {
		return this.live;
	}

	get liveName(): string {
		return this.liveLabel;
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

	/** Tap the selected file or live input before the monitor mute gain. */
	getRecordStream(): MediaStream | null {
		if (!this.context || !this.analyser || (!this.live && !this.objectUrl)) return null;
		if (!this.recordDest) {
			this.recordDest = this.context.createMediaStreamDestination();
			this.analyser.connect(this.recordDest);
		}
		return this.recordDest.stream;
	}

	async load(file: File): Promise<AudioTrack> {
		this.detachStream();
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

	/** Resume the audio context synchronously inside the Record button gesture. */
	activate(): void {
		if (this.disposed) return;
		this.ensureContext();
		if (this.context?.state === 'suspended') void this.context.resume();
	}

	async play(signal?: AbortSignal): Promise<void> {
		if (this.disposed || this.live) return;
		this.ensureContext();
		if (this.context?.state === 'suspended') await this.context.resume();
		if (signal?.aborted) throw new Error('Audio playback was cancelled.');
		if (this.duration > 0 && this.element.currentTime >= this.duration - 0.01) {
			this.element.currentTime = 0;
		}

		this.connectElement(true);
		await this.element.play();
		if (signal?.aborted) {
			this.element.pause();
			throw new Error('Audio playback was cancelled.');
		}
		this.playing = true;
		this.startMetering();
	}

	pause(): void {
		this.element.pause();
		this.playing = false;
		this.stopMetering();
	}

	seek(seconds: number): void {
		if (this.live || this.duration <= 0) return;
		this.element.currentTime = Math.max(0, Math.min(this.duration, seconds));
		this.onTime?.(this.currentTime, this.duration);
	}

	/**
	 * Analyse a captured stream. The stream is routed to the analyser and then
	 * to a silent gain, so the captured audio is never replayed. The caller
	 * owns the permission prompt (`getDisplayMedia` / `getUserMedia`).
	 */
	attachStream(stream: MediaStream, label: string): void {
		if (this.disposed) {
			for (const track of stream.getTracks()) track.stop();
			return;
		}

		this.pause();
		this.ensureContext();
		if (!this.context || !this.analyser) {
			for (const track of stream.getTracks()) track.stop();
			return;
		}

		void this.context.resume();
		this.detachStream();

		const audioTracks = stream.getAudioTracks();
		if (audioTracks.length === 0) {
			for (const track of stream.getTracks()) track.stop();
			return;
		}

		this.stream = stream;
		this.liveLabel = label;
		this.streamSource = this.context.createMediaStreamSource(stream);
		this.streamSource.connect(this.analyser);
		if (this.outputGain) this.outputGain.gain.value = 0;

		this.beatAverage = 0;
		this.live = true;
		this.playing = true;

		// A live capture can end from the browser's own affordance.
		for (const track of audioTracks) track.addEventListener('ended', this.handleStreamTrackEnded);

		this.startMetering();
	}

	detachStream(): void {
		if (this.stream) {
			for (const track of this.stream.getTracks()) {
				track.removeEventListener('ended', this.handleStreamTrackEnded);
				track.stop();
			}
		}
		if (this.streamSource) {
			try {
				this.streamSource.disconnect();
			} catch {
				/* already disconnected */
			}
		}
		this.streamSource = null;
		this.stream = null;
		this.live = false;
		this.liveLabel = '';

		if (this.outputGain) this.outputGain.gain.value = 1;
		if (!this.disposed) this.stopMetering();
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.detachStream();
		this.stopMetering();
		this.playing = false;
		this.element.pause();
		this.element.removeEventListener('timeupdate', this.handleTimeUpdate);
		this.element.removeEventListener('ended', this.handleEnded);
		this.element.removeAttribute('src');
		this.element.load();
		this.elementSource?.disconnect();
		this.analyser?.disconnect();
		this.recordDest?.disconnect();
		this.recordDest?.stream.getTracks().forEach((track) => track.stop());
		void this.context?.close();
		this.elementSource = null;
		this.analyser = null;
		this.outputGain = null;
		this.recordDest = null;
		this.context = null;
		this.spectrumData = null;
		this.frameSink = null;
		this.onTime = null;
		this.onEnded = null;
		this.onStreamEnded = null;
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

		// The analyser is always pulled through a gain node. File playback is
		// audible (gain 1); a captured stream is silent (gain 0).
		const outputGain = context.createGain();
		outputGain.gain.value = 1;
		analyser.connect(outputGain);
		outputGain.connect(context.destination);

		this.context = context;
		this.analyser = analyser;
		this.outputGain = outputGain;
		this.spectrumData = new Uint8Array(analyser.frequencyBinCount);
	}

	private connectElement(audible: boolean): void {
		if (!this.context || !this.analyser) return;
		if (!this.elementSource) this.elementSource = this.context.createMediaElementSource(this.element);
		this.streamSource?.disconnect();
		this.elementSource.connect(this.analyser);
		if (this.outputGain) this.outputGain.gain.value = audible ? 1 : 0;
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
		if (!this.featureExtractor || this.featureExtractorSampleRate !== context.sampleRate) {
			this.featureExtractor = new AudioFeatureExtractor(context.sampleRate, FFT_SIZE);
			this.featureExtractorSampleRate = context.sampleRate;
		}
		const features = this.featureExtractor.update(data);

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
			beat: routing.bass ? beat * Math.min(1, amount) : 0,
			features
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

	private handleStreamTrackEnded = (): void => {
		this.detachStream();
		this.playing = false;
		this.onStreamEnded?.();
	};
}
