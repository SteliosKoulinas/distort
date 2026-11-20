import * as THREE from 'three';
import type { SimParams } from '#lib/core/params';
import type { AudioFrame } from '#lib/audio/types';
import type { VisualImage, VisualRenderContext } from '#lib/visual/types';
import type { DecodedImage } from '#lib/image/decode';
import { engineDefinition, type EngineBinding } from '#lib/visual/registry';

/** Shared stage, camera and delivery sizing. All drawing belongs to the active engine. */
export class ParticleView {
	readonly renderer: THREE.WebGLRenderer;
	readonly fit = new THREE.Vector2(1, 1);
	readonly imageTransform = new THREE.Vector3(1, 0, 0);
	readonly context: VisualRenderContext;
	private binding: EngineBinding | null = null;
	private source: VisualImage | null = null;
	private ready = false;
	private generation = 0;
	private stageWidth = 1;
	private stageHeight = 1;
	private exportSize: { width: number; height: number } | null = null;
	private previewSize: { width: number; height: number } | null = null;
	/** Show the complete source by default; zoom/crop is an explicit control. */
	private framing: 'fit' | 'fill' = 'fit';
	private imageZoom = 1;
	private imagePan = new THREE.Vector2();

	constructor(canvas: HTMLCanvasElement) {
		this.renderer = new THREE.WebGLRenderer({
			canvas, antialias: false, alpha: false, depth: false, stencil: false,
			powerPreference: 'high-performance', preserveDrawingBuffer: false
		});
		this.renderer.outputColorSpace = THREE.SRGBColorSpace;
		this.renderer.setClearColor(0x070706, 1);
		const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
		camera.position.z = 1;
		this.context = {
			renderer: this.renderer, camera, fit: this.fit, imageTransform: this.imageTransform, width: 1, height: 1,
			pixelRatio: 1, pointer: { x: 0, y: 0, active: false }
		};
	}

	get engine() { return this.binding?.engine ?? null; }
	get isReady(): boolean { return this.ready; }

	async setParams(params: SimParams): Promise<void> {
		if (this.binding?.engine.id !== params.visualEngine) {
			this.binding?.engine.dispose();
			this.binding = null;
			this.ready = false;
			this.generation++;
			const next = engineDefinition(params.visualEngine).create();
			try {
				next.engine.init(this.context);
				next.setParams(params);
				this.binding = next;
				if (this.source) await this.prepare(next, this.source);
				else this.ready = true;
			} catch (error) {
				if (this.binding === next) {
					next.engine.dispose();
					this.binding = null;
				} else if (!this.binding) {
					next.engine.dispose();
				}
				throw error;
			}
		} else this.binding.setParams(params);
	}

	async setSource(source: VisualImage): Promise<void> {
		this.source = source;
		this.updateFit();
		if (this.binding) await this.prepare(this.binding, source);
	}

	setDeliveryImage(image: DecodedImage | null): void {
		if (image && (
			image.width > this.renderer.capabilities.maxTextureSize ||
			image.height > this.renderer.capabilities.maxTextureSize
		)) {
			throw new Error(
				`The original upload is ${image.width} × ${image.height}, beyond this GPU's ` +
				`${this.renderer.capabilities.maxTextureSize}px texture limit.`
			);
		}
		if (this.source) this.source.deliveryImage = image ?? undefined;
		this.binding?.engine.setDeliveryImage?.(image);
	}

	private async prepare(binding: EngineBinding, source: VisualImage): Promise<void> {
		const generation = ++this.generation;
		this.ready = false;
		try {
			await binding.engine.setImage(source);
			if (this.binding === binding && this.generation === generation) this.ready = true;
		} catch (error) {
			// A newer image/engine owns readiness; cancelled workers must not stop it.
			if (this.binding === binding && this.generation === generation) throw error;
		}
	}

	update(dt: number, audio: AudioFrame): void { if (this.ready) this.engine?.update(dt, audio); }
	/** True only when a fresh image was actually drawn into the canvas. */
	render(): boolean {
		if (!this.source || !this.ready || !this.engine) return false;
		this.engine.render(null);
		return true;
	}
	reset(): void { this.engine?.reset(); }
	resample(): void {
		if (this.engine?.resample) this.engine.resample();
		else this.engine?.reset();
	}

	resize(width: number, height: number): void {
		this.stageWidth = Math.max(1, Math.floor(width));
		this.stageHeight = Math.max(1, Math.floor(height));
		this.applySize();
	}

	setExportSize(width: number, height: number): void {
		if (!Number.isInteger(width) || !Number.isInteger(height) ||
			width < 1 || height < 1 ||
			width > this.renderer.capabilities.maxTextureSize || height > this.renderer.capabilities.maxTextureSize) {
			throw new Error('This GPU does not support the selected export dimensions.');
		}
		this.exportSize = { width, height };
		this.applySize();
	}

	clearExportSize(): void { this.exportSize = null; this.applySize(); }

	setPreviewSize(width: number, height: number): void {
		this.validateSize(width, height);
		this.previewSize = { width, height };
		if (!this.exportSize) this.applySize();
	}

	clearPreviewSize(): void {
		this.previewSize = null;
		if (!this.exportSize) this.applySize();
	}

	setFraming(mode: 'fit' | 'fill'): void {
		this.framing = mode;
		this.updateFit();
	}

	setImageTransform(zoom: number, panX: number, panY: number): void {
		this.imageZoom = Math.max(1, Math.min(4, Number.isFinite(zoom) ? zoom : 1));
		this.imagePan.set(
			Number.isFinite(panX) ? Math.max(-1, Math.min(1, panX)) : 0,
			Number.isFinite(panY) ? Math.max(-1, Math.min(1, panY)) : 0
		);
		this.updateImageTransform();
	}

	private applySize(): void {
		const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
		const size = this.exportSize ?? this.previewSize;
		const width = size?.width ?? Math.max(1, Math.round(this.stageWidth * dpr));
		const height = size?.height ?? Math.max(1, Math.round(this.stageHeight * dpr));
		this.context.width = width;
		this.context.height = height;
		this.context.pixelRatio = size ? height / this.stageHeight : dpr;
		this.renderer.setPixelRatio(1);
		this.renderer.setSize(width, height, false);
		this.updateFit();
		this.engine?.resize(width, height);
	}

	private validateSize(width: number, height: number): void {
		if (!Number.isInteger(width) || !Number.isInteger(height) ||
			width < 1 || height < 1 ||
			width > this.renderer.capabilities.maxTextureSize ||
			height > this.renderer.capabilities.maxTextureSize) {
			throw new Error('This GPU does not support the selected frame dimensions.');
		}
	}

	captureCompletedFrame(width: number, height: number): { pixels: Uint8Array; width: number; height: number } {
		this.validateSize(width, height);
		if (!this.ready || !this.source || !this.engine) {
			throw new Error('The visual engine has not presented a frame yet.');
		}
		const target = new THREE.WebGLRenderTarget(width, height, {
			minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
			depthBuffer: false, stencilBuffer: false, generateMipmaps: false
		});
		const oldWidth = this.context.width;
		const oldHeight = this.context.height;
		const oldPixelRatio = this.context.pixelRatio;
		const oldFit = this.fit.clone();
		const oldImageTransform = this.imageTransform.clone();
		try {
			this.context.width = width;
			this.context.height = height;
			this.context.pixelRatio = 1;
			this.updateFit();
			if (this.engine.renderDelivery) this.engine.renderDelivery(target);
			else this.engine.render(target);
			const pixels = new Uint8Array(width * height * 4);
			this.renderer.readRenderTargetPixels(target, 0, 0, width, height, pixels);
			return { pixels, width, height };
		} finally {
			this.context.width = oldWidth;
			this.context.height = oldHeight;
			this.context.pixelRatio = oldPixelRatio;
			this.fit.copy(oldFit);
			this.imageTransform.copy(oldImageTransform);
			target.dispose();
		}
	}

	private updateFit(): void {
		const imageAspect = this.source?.analysis.aspect ?? 1;
		const stageAspect = this.context.width / this.context.height;
		const contains = imageAspect >= stageAspect
			? [1, stageAspect / imageAspect]
			: [imageAspect / stageAspect, 1];
		const covers = imageAspect >= stageAspect
			? [imageAspect / stageAspect, 1]
			: [1, stageAspect / imageAspect];
		const size = this.framing === 'fill' ? covers : contains;
		this.fit.set(size[0], size[1]);
		this.updateImageTransform();
	}

	private updateImageTransform(): void {
		// The image quad itself grows with zoom. Panning is only available once
		// that quad has more source content than the frame can show, so zoom 1
		// never invents a crop or an offset.
		const visibleWidth = Math.min(1, 1 / Math.max(this.fit.x * this.imageZoom, 1));
		const visibleHeight = Math.min(1, 1 / Math.max(this.fit.y * this.imageZoom, 1));
		const maxOffsetX = Math.max(0, (1 - visibleWidth) * 0.5);
		const maxOffsetY = Math.max(0, (1 - visibleHeight) * 0.5);
		this.imageTransform.set(
			this.imageZoom,
			this.imagePan.x * maxOffsetX,
			this.imagePan.y * maxOffsetY
		);
	}

	dispose(): void {
		this.generation++;
		this.ready = false;
		this.binding?.engine.dispose();
		this.binding = null;
		this.source = null;
		this.renderer.dispose();
	}
}
