import { ArrayBufferTarget, Muxer } from 'mp4-muxer';

/**
 * Records the canvas at delivery resolution.
 *
 * Two backends, in order of quality:
 *
 * 1. **WebCodecs**: rendered frames are sampled at 30 fps and encoded with
 *    `VideoEncoder`, preferring H.264 High at a target bitrate and exact size,
 *    then muxed into a fast-start MP4. Audio is captured from a
 *    `MediaStreamAudioDestinationNode` and encoded as AAC. Nothing is
 *    resampled, cropped or letterboxed on the way out.
 * 2. **MediaRecorder**: `canvas.captureStream` + the best MIME the browser
 *    admits. WebM-only output is labelled as needing conversion for Instagram.
 *
 * The canvas must already be sized to the delivery resolution when recording
 * starts — the caller owns that, so the preview and the file are the same
 * composition.
 */

export interface RecordOptions {
	canvas: HTMLCanvasElement;
	/** Tap of the audio graph. Null records a silent video. */
	audioStream: MediaStream | null;
	width: number;
	height: number;
	fps: number;
	/** Target video bitrate, bits per second. */
	bitrate: number;
	/** Sample rate of the audio context, used to declare the AAC track. */
	sampleRate: number;
	/** Optional exact take limit; also bounds audio samples and final frames. */
	duration?: number;
}

export interface RecordResult {
	blob: Blob;
	extension: 'mp4' | 'webm';
	mimeType: string;
	width: number;
	height: number;
	fps: number;
	bitrate: number;
	duration: number;
	hasAudio: boolean;
	/** Short human label, e.g. `H.264 High · AAC`. */
	encoder: string;
	/** Anything the operator should know before uploading. */
	detail: string;
}

interface Backend {
	label: string;
	detail: string;
	hasAudio: boolean;
	/** Called once per rendered frame. Cheap no-op for MediaRecorder. */
	pushFrame(canvas: HTMLCanvasElement): void;
	abort(): void;
	stop(): Promise<{
		blob: Blob;
		extension: 'mp4' | 'webm';
		mimeType: string;
		duration: number;
	}>;
}

interface TrackProcessorCtor {
	new (init: { track: MediaStreamTrack }): { readable: ReadableStream<AudioData> };
}

const AUDIO_BITRATE = 192_000;
const AUDIO_CHANNELS = 2;

/* ------------------------------------------------------------------ *
 * WebCodecs
 * ------------------------------------------------------------------ */

async function pickVideoConfig(
	width: number,
	height: number,
	fps: number,
	bitrate: number
): Promise<VideoEncoderConfig | null> {
	if (typeof VideoEncoder !== 'function') return null;

	// `avc1.64002A` is H.264 High, level 4.2: 1080 × 1920 at 30 fps and up to
	// 50 Mbps sits comfortably inside it. The lower rungs are only there for
	// machines whose encoder refuses High.
	const bases: Omit<VideoEncoderConfig, 'width' | 'height' | 'bitrate' | 'framerate'>[] = [
		{ codec: 'avc1.64002A', avc: { format: 'avc' }, latencyMode: 'quality' },
		{ codec: 'avc1.64002A', avc: { format: 'avc' } },
		{ codec: 'avc1.4D002A', avc: { format: 'avc' } },
		{ codec: 'avc1.42E02A', avc: { format: 'avc' } }
	];

	for (const base of bases) {
		const config: VideoEncoderConfig = { ...base, width, height, bitrate, framerate: fps };
		try {
			const support = await VideoEncoder.isConfigSupported(config);
			if (support.supported) return config;
		} catch {
			/* try the next rung */
		}
	}
	return null;
}

async function pickAudioConfig(sampleRate: number): Promise<AudioEncoderConfig | null> {
	if (typeof AudioEncoder !== 'function') return null;
	const config: AudioEncoderConfig = {
		codec: 'mp4a.40.2',
		sampleRate,
		numberOfChannels: AUDIO_CHANNELS,
		bitrate: AUDIO_BITRATE
	};
	try {
		const support = await AudioEncoder.isConfigSupported(config);
		return support.supported ? config : null;
	} catch {
		return null;
	}
}

class WebCodecsBackend implements Backend {
	readonly label: string;
	readonly detail: string;
	readonly hasAudio: boolean;

	private readonly muxer: Muxer<ArrayBufferTarget>;
	private readonly target: ArrayBufferTarget;
	private readonly video: VideoEncoder;
	private readonly audio: AudioEncoder | null;
	private readonly sampleRate: number;
	private readonly fps: number;
	private readonly startedAt = performance.now();
	private readonly duration: number;
	private readonly audioTrack: MediaStreamTrack | null;
	private readonly failure: { error: Error | null };

	private audioReader: ReadableStreamDefaultReader<AudioData> | null = null;
	private audioPump: Promise<void> = Promise.resolve();
	private firstAudioUs: number | null = null;
	private audioOffsetUs = 0;
	private lastFrame: VideoFrame | null = null;
	private frames = 0;
	private stopped = false;

	constructor(parts: {
		muxer: Muxer<ArrayBufferTarget>;
		target: ArrayBufferTarget;
		video: VideoEncoder;
		audio: AudioEncoder | null;
		audioTrack: MediaStreamTrack | null;
		failure: { error: Error | null };
		profile: string;
		options: RecordOptions;
	}) {
		this.muxer = parts.muxer;
		this.target = parts.target;
		this.video = parts.video;
		this.audio = parts.audio;
		this.sampleRate = parts.options.sampleRate;
		this.fps = parts.options.fps;
		this.duration = parts.options.duration ?? Infinity;
		this.audioTrack = parts.audioTrack;
		this.failure = parts.failure;
		this.hasAudio = parts.audio !== null;
		this.label = `H.264 ${parts.profile}${parts.audio ? ' / AAC' : ''} · WebCodecs`;
		this.detail = `H.264 ${parts.profile}, fast-start MP4, ${this.fps} fps. ${
			parts.audio ? 'AAC 192 kbps.' : 'Silent video — no audio source selected.'
		}`;

		if (parts.audioTrack) this.startAudioPump(parts.audioTrack);
	}

	pushFrame(canvas: HTMLCanvasElement): void {
		if (this.stopped) return;
		if (this.failure.error) throw this.failure.error;
		const elapsed = Math.min(this.duration, (performance.now() - this.startedAt) / 1000);
		const target = Math.min(Math.floor(elapsed * this.fps), Math.ceil(this.duration * this.fps) - 1);
		if (target < this.frames) return;
		// CFR is an explicit timeline, not just a muxer hint. Hold the last
		// rendered image for missed slots without speeding up or drifting audio.
		if (target - this.frames > this.fps * 2 || this.video.encodeQueueSize > this.fps * 2) {
			throw new Error('Encoding fell behind. Try a lower particle count and keep the tab visible.');
		}
		while (this.frames < target && this.lastFrame) this.encodeFrame(this.lastFrame);
		this.lastFrame?.close();
		this.lastFrame = new VideoFrame(canvas, { timestamp: 0 });
		while (this.frames <= target) this.encodeFrame(this.lastFrame);
	}

	private encodeFrame(source: VideoFrame): void {
		const timestamp = Math.round((this.frames * 1_000_000) / this.fps);
		const frame = new VideoFrame(source, {
			timestamp,
			duration: Math.round(((this.frames + 1) * 1_000_000) / this.fps) - timestamp
		});
		try {
			this.video.encode(frame, { keyFrame: this.frames % (this.fps * 2) === 0 });
		} finally {
			frame.close();
		}
		this.frames++;
	}

	async stop(): Promise<{ blob: Blob; extension: 'mp4'; mimeType: string; duration: number }> {
		if (this.stopped) throw new Error('The recorder has already stopped.');
		const elapsed = Math.min(this.duration, (performance.now() - this.startedAt) / 1000);
		this.stopped = true;
		try {
			if (this.failure.error) throw this.failure.error;
			if (!this.lastFrame) throw new Error('No video frames were captured.');
			const total = Math.max(1, Math.ceil(elapsed * this.fps));
			if (total - this.frames > this.fps * 2) throw new Error('Recording was interrupted.');
			while (this.frames < total) this.encodeFrame(this.lastFrame);
			await this.audioReader?.cancel();
			await this.audioPump;
			await this.video.flush();
			await this.audio?.flush();
			if (this.failure.error) throw this.failure.error;
			this.muxer.finalize();
			return {
				blob: new Blob([this.target.buffer], { type: 'video/mp4' }),
				extension: 'mp4',
				mimeType: 'video/mp4',
				duration: this.frames / this.fps
			};
		} finally {
			this.abort();
		}
	}

	abort(): void {
		this.stopped = true;
		void this.audioReader?.cancel().catch(() => undefined);
		this.audioTrack?.stop();
		this.lastFrame?.close();
		this.lastFrame = null;
		if (this.video.state !== 'closed') this.video.close();
		if (this.audio && this.audio.state !== 'closed') this.audio.close();
	}

	private startAudioPump(track: MediaStreamTrack): void {
		const Constructor = (globalThis as { MediaStreamTrackProcessor?: TrackProcessorCtor })
			.MediaStreamTrackProcessor;
		if (!Constructor || !this.audio) return;

		const reader = new Constructor({ track }).readable.getReader();
		this.audioReader = reader;

		this.audioPump = (async () => {
			for (;;) {
				const { value, done } = await reader.read();
				if (done || !value) break;
				try {
					this.encodeAudio(value);
				} finally {
					value.close();
				}
			}
		})().catch((error: Error) => {
			if (!this.stopped) this.failure.error = error;
		});
	}

	private encodeAudio(input: AudioData): void {
		const encoder = this.audio;
		if (!encoder || this.stopped) return;

		const sampleRate = input.sampleRate || this.sampleRate;
		if (this.firstAudioUs === null) {
			this.firstAudioUs = input.timestamp;
			this.audioOffsetUs = Math.max(
				0,
				(performance.now() - this.startedAt) * 1000 - (input.numberOfFrames / sampleRate) * 1_000_000
			);
		}
		const timestamp = Math.round(this.audioOffsetUs + input.timestamp - this.firstAudioUs);
		const frames = Math.min(
			input.numberOfFrames,
			Math.floor((this.duration - timestamp / 1_000_000) * sampleRate)
		);
		const channels = input.numberOfChannels;
		if (frames <= 0) return;

		const planar = new Float32Array(frames * AUDIO_CHANNELS);
		if (channels === 1) {
			input.copyTo(planar.subarray(0, frames), { planeIndex: 0, frameCount: frames, format: 'f32-planar' });
			planar.copyWithin(frames, 0, frames);
		} else {
			input.copyTo(planar.subarray(0, frames), { planeIndex: 0, frameCount: frames, format: 'f32-planar' });
			input.copyTo(planar.subarray(frames, frames * 2), { planeIndex: 1, frameCount: frames, format: 'f32-planar' });
		}

		const data = new AudioData({
			format: 'f32-planar',
			sampleRate,
			numberOfFrames: frames,
			numberOfChannels: AUDIO_CHANNELS,
			timestamp,
			data: planar
		});
		try {
			if (encoder.encodeQueueSize > 100) throw new Error('Audio encoding fell behind.');
			encoder.encode(data);
		} finally {
			data.close();
		}
	}
}

async function openWebCodecs(options: RecordOptions): Promise<Backend | null> {
	const videoConfig = await pickVideoConfig(
		options.width,
		options.height,
		options.fps,
		options.bitrate
	);
	if (!videoConfig) return null;

	const sourceTrack = options.audioStream?.getAudioTracks().find((track) => track.readyState === 'live');
	const Processor = (globalThis as { MediaStreamTrackProcessor?: TrackProcessorCtor })
		.MediaStreamTrackProcessor;
	const audioConfig = sourceTrack && Processor ? await pickAudioConfig(options.sampleRate) : null;
	// Prefer a recorder that can include the requested sound over silently
	// discarding it when AAC or audio track processing is unavailable.
	if (sourceTrack && !audioConfig) return null;
	const audioTrack = sourceTrack?.clone() ?? null;

	const target = new ArrayBufferTarget();
	const muxer = new Muxer({
		target,
		video: {
			codec: 'avc',
			width: options.width,
			height: options.height,
			frameRate: options.fps
		},
		audio: audioConfig
			? { codec: 'aac', numberOfChannels: AUDIO_CHANNELS, sampleRate: options.sampleRate }
			: undefined,
		fastStart: 'in-memory',
		firstTimestampBehavior: 'cross-track-offset'
	});

	const failure: { error: Error | null } = { error: null };
	const video = new VideoEncoder({
		output: (chunk, meta) => {
			try {
				muxer.addVideoChunk(chunk, meta);
			} catch (error) {
				failure.error = error as Error;
			}
		},
		error: (error) => {
			failure.error = error;
		}
	});
	let audio: AudioEncoder | null = null;
	try {
		video.configure(videoConfig);
		if (audioConfig) {
			audio = new AudioEncoder({
				output: (chunk, meta) => {
					try {
						muxer.addAudioChunk(chunk, meta);
					} catch (error) {
						failure.error = error as Error;
					}
				},
				error: (error) => {
					failure.error = error;
				}
			});
			audio.configure(audioConfig);
		}
		return new WebCodecsBackend({
			muxer,
			target,
			video,
			audio,
			audioTrack,
			options,
			failure,
			profile: videoConfig.codec.startsWith('avc1.64')
				? 'High'
				: videoConfig.codec.startsWith('avc1.4D') ? 'Main' : 'Baseline'
		});
	} catch {
		if (video.state !== 'closed') video.close();
		if (audio && audio.state !== 'closed') audio.close();
		audioTrack?.stop();
		return null;
	}
}

/* ------------------------------------------------------------------ *
 * MediaRecorder
 * ------------------------------------------------------------------ */

const MIME_CANDIDATES = [
	'video/mp4;codecs="avc1.64002A,mp4a.40.2"',
	'video/mp4;codecs="avc1.42E01E,mp4a.40.2"',
	'video/mp4;codecs="avc1,mp4a.40.2"',
	'video/mp4',
	'video/webm;codecs=vp9,opus',
	'video/webm;codecs=vp8,opus',
	'video/webm'
];

function pickMime(): string | null {
	if (typeof MediaRecorder === 'undefined') return null;
	for (const candidate of MIME_CANDIDATES) {
		try {
			if (MediaRecorder.isTypeSupported(candidate)) return candidate;
		} catch {
			/* keep looking */
		}
	}
	return null;
}

class MediaRecorderBackend implements Backend {
	readonly label: string;
	readonly detail: string;
	readonly hasAudio: boolean;

	private readonly recorder: MediaRecorder;
	private readonly capture: MediaStream;
	private readonly chunks: Blob[] = [];
	private readonly startedAt = performance.now();
	private stopped = false;
	private failure: Error | null = null;
	private nextFrameAt = 0;
	private readonly fps: number;

	constructor(
		recorder: MediaRecorder,
		capture: MediaStream,
		mime: string,
		hasAudio: boolean,
		fps: number
	) {
		this.recorder = recorder;
		this.capture = capture;
		this.hasAudio = hasAudio;
		this.fps = fps;
		this.label = mime.startsWith('video/mp4') ? 'MP4 · MediaRecorder' : 'WebM · MediaRecorder';
		recorder.addEventListener('error', () => {
			this.failure = new Error('The browser recorder failed. Try a shorter take.');
		});
		this.detail = mime.startsWith('video/mp4')
			? 'MP4 from the browser recorder. Bitrate is honoured approximately; check the file before uploading.'
			: 'WebM only — Instagram will not accept this container. Convert to H.264 MP4 before uploading, or use Chrome for a direct MP4.';
	}

	pushFrame(): void {
		if (this.failure) throw this.failure;
		const now = performance.now();
		if (now < this.nextFrameAt) return;
		this.nextFrameAt =
			this.startedAt + (Math.floor((now - this.startedAt) * this.fps / 1000) + 1) * 1000 / this.fps;
		// Request immediately after the WebGL draw, before the buffer clears.
		const track = this.capture.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack;
		track?.requestFrame?.();
	}

	abort(): void {
		this.stopped = true;
		if (this.recorder.state !== 'inactive') this.recorder.stop();
		for (const track of this.capture.getTracks()) track.stop();
	}

	addChunk(chunk: Blob): void {
		if (chunk.size > 0) this.chunks.push(chunk);
	}

	stop(): Promise<{ blob: Blob; extension: 'mp4' | 'webm'; mimeType: string; duration: number }> {
		const finish = (): {
			blob: Blob;
			extension: 'mp4' | 'webm';
			mimeType: string;
			duration: number;
		} => {
			for (const track of this.capture.getTracks()) track.stop();
			const mimeType = this.recorder.mimeType || 'video/webm';
			return {
				blob: new Blob(this.chunks, { type: mimeType }),
				extension: mimeType.startsWith('video/mp4') ? 'mp4' : 'webm',
				mimeType,
				duration: (performance.now() - this.startedAt) / 1000
			};
		};

		if (this.stopped) return Promise.resolve(finish());
		this.stopped = true;

		return new Promise((resolve, reject) => {
			this.recorder.addEventListener('stop', () => {
				const result = finish();
				if (this.failure) reject(this.failure);
				else resolve(result);
			}, { once: true });
			if (this.recorder.state !== 'inactive') this.recorder.stop();
			else {
				const result = finish();
				if (this.failure) reject(this.failure);
				else resolve(result);
			}
		});
	}
}

function openMediaRecorder(options: RecordOptions): Backend | null {
	if (typeof MediaRecorder === 'undefined') return null;
	const mime = pickMime();
	if (!mime) return null;

	const capture = options.canvas.captureStream(
		typeof CanvasCaptureMediaStreamTrack !== 'undefined' &&
		'requestFrame' in CanvasCaptureMediaStreamTrack.prototype
			? 0
			: options.fps
	);
	const audioTracks = (options.audioStream?.getAudioTracks() ?? []).map((track) => track.clone());
	for (const track of audioTracks) capture.addTrack(track);

	try {
		const recorder = new MediaRecorder(capture, {
			mimeType: mime,
			videoBitsPerSecond: options.bitrate,
			audioBitsPerSecond: AUDIO_BITRATE
		});
		const backend = new MediaRecorderBackend(
			recorder,
			capture,
			mime,
			audioTracks.length > 0,
			options.fps
		);
		recorder.addEventListener('dataavailable', (event) => {
			if (event.data?.size) backend.addChunk(event.data);
		});
		recorder.start(500);
		return backend;
	} catch {
		for (const track of capture.getTracks()) track.stop();
		return null;
	}
}

/* ------------------------------------------------------------------ *
 * Facade
 * ------------------------------------------------------------------ */

export class FrameRecorder {
	static async create(options: RecordOptions): Promise<FrameRecorder> {
		const backend = (await openWebCodecs(options)) ?? openMediaRecorder(options);
		if (!backend) {
			throw new Error(
				'This browser cannot record video. Use desktop Chrome (WebCodecs) or Safari (MediaRecorder).'
			);
		}
		return new FrameRecorder(options, backend);
	}

	readonly encoder: string;
	readonly detail: string;
	readonly hasAudio: boolean;

	private readonly options: RecordOptions;
	private readonly backend: Backend;
	private stopped = false;

	private constructor(options: RecordOptions, backend: Backend) {
		this.options = options;
		this.backend = backend;
		this.encoder = backend.label;
		this.detail = backend.detail;
		this.hasAudio = backend.hasAudio;
	}

	pushFrame(canvas: HTMLCanvasElement): void {
		if (this.stopped) return;
		this.backend.pushFrame(canvas);
	}

	abort(): void {
		this.stopped = true;
		this.backend.abort();
	}

	async stop(): Promise<RecordResult> {
		if (this.stopped) throw new Error('The recorder has already stopped.');
		this.stopped = true;
		const result = await this.backend.stop();
		return {
			...result,
			width: this.options.width,
			height: this.options.height,
			fps: this.options.fps,
			bitrate: this.options.bitrate,
			hasAudio: this.backend.hasAudio,
			encoder: this.backend.label,
			detail: this.backend.detail
		};
	}
}
