import * as THREE from 'three';
import type { SimParams } from '#lib/core/params';
import type { AudioFrame } from '#lib/audio/types';
import type { VisualImage, VisualRenderContext } from '#lib/visual/types';
import { engineDefinition, type EngineBinding } from '#lib/visual/registry';

/** Shared stage, camera and delivery sizing. All drawing belongs to the active engine. */
export class ParticleView {
	readonly renderer: THREE.WebGLRenderer;
	readonly fit = new THREE.Vector2(1, 1);
	readonly context: VisualRenderContext;
	private binding: EngineBinding | null = null;
	private source: VisualImage | null = null;
	private ready = false;
	private generation = 0;
	private stageWidth = 1;
	private stageHeight = 1;
	private exportSize: { width: number; height: number } | null = null;

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
			renderer: this.renderer, camera, fit: this.fit, width: 1, height: 1,
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
		if (!Number.isFinite(width) || !Number.isFinite(height) ||
			width > this.renderer.capabilities.maxTextureSize || height > this.renderer.capabilities.maxTextureSize) {
			throw new Error('This GPU does not support the selected export dimensions.');
		}
		this.exportSize = { width: Math.max(16, Math.round(width)), height: Math.max(16, Math.round(height)) };
		this.applySize();
	}

	clearExportSize(): void { this.exportSize = null; this.applySize(); }

	private applySize(): void {
		const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
		const width = this.exportSize?.width ?? Math.max(1, Math.round(this.stageWidth * dpr));
		const height = this.exportSize?.height ?? Math.max(1, Math.round(this.stageHeight * dpr));
		this.context.width = width;
		this.context.height = height;
		this.context.pixelRatio = this.exportSize ? height / this.stageHeight : dpr;
		this.renderer.setPixelRatio(1);
		this.renderer.setSize(width, height, false);
		this.updateFit();
		this.engine?.resize(width, height);
	}

	private updateFit(): void {
		const imageAspect = this.source?.analysis.aspect ?? 1;
		const stageAspect = this.context.width / this.context.height;
		this.fit.set(imageAspect >= stageAspect ? 1 : imageAspect / stageAspect,
			imageAspect >= stageAspect ? stageAspect / imageAspect : 1);
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
