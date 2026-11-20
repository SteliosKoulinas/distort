import type { AudioFrame } from './types';
import { silentAudioFrame } from './types';
import { RoutedAudioAnalyzer, type AudioRouting } from './routing';

const FFT_SIZE = 2048;


export interface AudioTrack {
	name: string;
	duration: number;
}

/**
 * Which spectral bands reach the field. Values are plain numbers, so the
 * animation loop never learns that audio exists as anything but forces.
 */
export type { AudioRouting } from './routing';

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
	private featureExtractor: RoutedAudioAnalyzer | null = null;
	private featureExtractorSampleRate = 0;
	private lastAnalysisTime = 0;
	private frameSink: ((frame: AudioFrame) => void) | null = null;
	private objectUrl = '';
	private raf = 0;
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

		this.featureExtractor?.reset();
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
		this.featureExtractor?.reset();
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

		this.featureExtractor?.reset();
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
		this.featureExtractor?.reset();
		this.lastAnalysisTime = 0;
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
			this.featureExtractor = new RoutedAudioAnalyzer(context.sampleRate, FFT_SIZE);
			this.featureExtractorSampleRate = context.sampleRate;
		}
		const now = performance.now();
		const dt = this.lastAnalysisTime ? Math.min(0.1, (now - this.lastAnalysisTime) / 1000) : 1 / 60;
		this.lastAnalysisTime = now;
		return this.featureExtractor.update(data, this.routing, dt);
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
