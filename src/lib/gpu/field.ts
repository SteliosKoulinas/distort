import type { SimParams } from '#lib/core/params';
import { LFO_SLOTS } from '#lib/core/lfo';
import type { AudioFrame } from '#lib/audio/types';
import { silentAudioFrame } from '#lib/audio/types';
import { gateAudioFrame } from '#lib/audio/routing';
import type { ImageAnalysis } from '#lib/image/analyze';
import type { DecodedImage } from '#lib/image/decode';
import type { EngineStats } from '#lib/visual/types';
import { ParticleView } from './view';

export interface FieldStats extends EngineStats { fps: number; }
export interface LfoView { phase: number; signal: number; env: number; table: Float32Array; }
export interface ParticleFieldOptions {
	canvas: HTMLCanvasElement;
	host: HTMLElement;
	params: SimParams;
	onStats?: (stats: FieldStats) => void;
	onError?: (message: string) => void;
}

/** Browser runtime host: input, one clock, gated audio, stage and recording hooks. */
export class ParticleField {
	private readonly canvas: HTMLCanvasElement;
	private readonly host: HTMLElement;
	private readonly view: ParticleView;
	private readonly observer: ResizeObserver;
	private readonly onStats?: ParticleFieldOptions['onStats'];
	private readonly onError?: ParticleFieldOptions['onError'];
	private params: SimParams;
	private audio: AudioFrame = silentAudioFrame();
	private hasSource = false;
	private disposed = false;
	private raf = 0;
	private lastTime = 0;
	private frameCount = 0;
	private statsTime = 0;
	private frameHook: ((canvas: HTMLCanvasElement) => void) | null = null;
	private completedFrameId = 0;

	constructor(options: ParticleFieldOptions) {
		this.canvas = options.canvas;
		this.host = options.host;
		this.params = options.params;
		this.onStats = options.onStats;
		this.onError = options.onError;
		this.view = new ParticleView(this.canvas);
		void this.view.setParams(this.params).catch((error) => this.fail(error));
		this.observer = new ResizeObserver(() => this.resize());
		this.observer.observe(this.host);
		this.resize();
		this.canvas.addEventListener('pointermove', this.handlePointerMove);
		this.canvas.addEventListener('pointerdown', this.handlePointerMove);
		this.canvas.addEventListener('pointerup', this.handlePointerEnd);
		this.canvas.addEventListener('pointercancel', this.handlePointerEnd);
		this.canvas.addEventListener('pointerleave', this.handlePointerEnd);
		document.addEventListener('visibilitychange', this.handleVisibility);
		this.start();
	}

	setParams(params: SimParams): void {
		this.params = params;
		void this.view.setParams(params).then(() => {
			this.start();
		}).catch((error) => this.fail(error));
	}

	async setSource(analysis: ImageAnalysis, image: DecodedImage, deliveryImage?: DecodedImage): Promise<void> {
		await this.view.setSource({ analysis, image, deliveryImage });
		this.hasSource = true;
		this.start();
	}
	setDeliveryImage(image: DecodedImage | null): void { this.view.setDeliveryImage(image); }

	setAudio(frame: AudioFrame): void {
		this.audio = { ...frame, features: { ...frame.features } };
	}
	get isReady(): boolean { return this.view.isReady; }

	getLfoView(index: number): LfoView | null { return this.view.engine?.getLfoView?.(index) ?? null; }
	triggerLfo(index: number): void { this.view.engine?.triggerLfo?.(index); }
	triggerAllLfos(): void { for (let i = 0; i < LFO_SLOTS; i++) this.triggerLfo(i); }
	kick(strength = 1): void { this.view.engine?.kick?.(strength); }
	reassemble(): void { this.view.engine?.reassemble?.(); }
	reset(): void { this.view.reset(); }
	resample(params?: SimParams): void { if (params) this.setParams(params); this.view.resample(); }
	setExportSize(width: number, height: number): void { this.view.setExportSize(width, height); }
	clearExportSize(): void { this.view.clearExportSize(); }
	setPreviewSize(width: number, height: number): void { this.view.setPreviewSize(width, height); }
	clearPreviewSize(): void { this.view.clearPreviewSize(); }
	setFraming(mode: 'fit' | 'fill'): void { this.view.setFraming(mode); }
	setImageTransform(zoom: number, panX: number, panY: number): void {
		this.view.setImageTransform(zoom, panX, panY);
	}
	setFrameHook(hook: ((canvas: HTMLCanvasElement) => void) | null): void { this.frameHook = hook; }

	start(): void {
		if (this.raf || this.disposed) return;
		this.lastTime = this.statsTime = performance.now();
		this.frameCount = 0;
		this.raf = requestAnimationFrame(this.tick);
	}
	stop(): void { if (this.raf) cancelAnimationFrame(this.raf); this.raf = 0; }

	private tick = (now: number): void => {
		this.raf = requestAnimationFrame(this.tick);
		const dt = Math.min(0.0333, Math.max(0.0001, (now - this.lastTime) / 1000));
		this.lastTime = now;
		this.audio.beat *= Math.exp(-dt * 4.5);
		const audio = gateAudioFrame(this.audio, this.params.audio.reactive, this.params.audio.motion);
		try {
			this.view.update(dt, audio);
			if (this.hasSource && this.view.render()) {
				this.completedFrameId++;
				this.frameHook?.(this.canvas);
			}
		} catch (error) { this.fail(error); return; }
		this.frameCount++;
		if (now - this.statsTime >= 500) {
			if (this.hasSource && this.view.engine) this.onStats?.({
				...this.view.engine.stats, fps: this.frameCount * 1000 / (now - this.statsTime)
			});
			this.statsTime = now;
			this.frameCount = 0;
		}
	};

	get lastPresentedFrameId(): number { return this.completedFrameId; }
	captureCompletedFrame(width: number, height: number) {
		return { frameId: this.completedFrameId, ...this.view.captureCompletedFrame(width, height) };
	}

	private fail(error: unknown): void {
		if (this.disposed) return;
		this.stop();
		this.onError?.(error instanceof Error ? error.message : 'The WebGL engine stopped.');
	}

	private resize(): void {
		const rect = this.host.getBoundingClientRect();
		if (rect.width >= 2 && rect.height >= 2) this.view.resize(rect.width, rect.height);
	}
	private handlePointerMove = (event: PointerEvent): void => {
		const rect = this.canvas.getBoundingClientRect();
		if (rect.width <= 0 || rect.height <= 0) return;
		Object.assign(this.view.context.pointer, {
			x: ((((event.clientX - rect.left) / rect.width) * 2 - 1) /
				(this.view.fit.x * this.view.imageTransform.x)) + this.view.imageTransform.y * 2,
			y: ((1 - ((event.clientY - rect.top) / rect.height) * 2) /
				(this.view.fit.y * this.view.imageTransform.x)) + this.view.imageTransform.z * 2,
			active: true
		});
	};
	private handlePointerEnd = (): void => { this.view.context.pointer.active = false; };
	private handleVisibility = (): void => { if (document.hidden) this.stop(); else this.start(); };

	dispose(): void {
		this.disposed = true;
		this.stop();
		this.frameHook = null;
		this.observer.disconnect();
		this.canvas.removeEventListener('pointermove', this.handlePointerMove);
		this.canvas.removeEventListener('pointerdown', this.handlePointerMove);
		this.canvas.removeEventListener('pointerup', this.handlePointerEnd);
		this.canvas.removeEventListener('pointercancel', this.handlePointerEnd);
		this.canvas.removeEventListener('pointerleave', this.handlePointerEnd);
		document.removeEventListener('visibilitychange', this.handleVisibility);
		this.view.dispose();
	}
}
