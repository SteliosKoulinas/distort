import * as THREE from 'three';
import type { AudioFrame } from '#lib/audio/types';
import type { ControlSchema, VisualEngine, VisualEngineId, VisualImage, VisualRenderContext } from '../types';
import { photoTexture } from '../resources';
import { LFO_SLOTS, createRandomTable, lfoSignal } from '#lib/core/lfo';
import { neutralModulation, type LfoSettings, type Modulation } from '#lib/core/params';

/** Resource plumbing only. Interpretation and uniforms belong to each engine. */
export abstract class ImageEngine<P> implements VisualEngine<P> {
	abstract readonly id: VisualEngineId;
	abstract readonly controls: ControlSchema;
	abstract readonly silenceBehaviour: string;
	readonly stats = { count: 0, textureSize: 0, precision: 'float32' as const };
	protected context!: VisualRenderContext;
	protected scene = new THREE.Scene();
	protected material!: THREE.ShaderMaterial;
	protected mesh!: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
	protected texture: THREE.DataTexture | null = null;
	protected deliveryTexture: THREE.DataTexture | null = null;
	protected time = 0;
	protected params!: P;
	protected modeModulation: Modulation = neutralModulation();
	private lfoSettings: readonly LfoSettings[] = [];
	private lfos = Array.from({ length: LFO_SLOTS }, (_, index) => ({
		phase: index * 0.19, env: 1, table: createRandomTable(index)
	}));

	abstract init(context: VisualRenderContext): void;
	abstract update(dt: number, audio: AudioFrame): void;

	protected setup(context: VisualRenderContext, vertexShader: string, fragmentShader: string,
		values: Record<string, unknown>): void {
		this.context = context;
		const uniforms: Record<string, THREE.IUniform> = {
			uImage: { value: null }, uFit: { value: context.fit },
			uImageTransform: { value: context.imageTransform },
			uTime: { value: 0 }, uOpacity: { value: 1 }
		};
		for (const [key, value] of Object.entries(values)) uniforms[key] = { value };
		this.material = new THREE.ShaderMaterial({
			uniforms, vertexShader, fragmentShader,
			depthTest: false, depthWrite: false, toneMapped: false
		});
		this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
		this.mesh.frustumCulled = false;
		this.scene.add(this.mesh);
	}

	setParams(params: P): void { this.params = params; }
	setLfos(lfos: LfoSettings[]): void { this.lfoSettings = lfos; }

	getLfoView(index: number) {
		const runtime = this.lfos[index], lfo = this.lfoSettings[index];
		return runtime && lfo ? {
			phase: runtime.phase,
			signal: lfoSignal(lfo.shape, runtime.phase, runtime.table),
			env: runtime.env,
			table: runtime.table
		} : null;
	}

	triggerLfo(index: number): void {
		if (this.lfos[index]) {
			this.lfos[index].phase = 0;
			this.lfos[index].env = 0;
		}
	}

	protected advanceModulation(dt: number): Modulation {
		const modulation = this.modeModulation;
		Object.assign(modulation, neutralModulation());
		for (let i = 0; i < this.lfoSettings.length && i < this.lfos.length; i++) {
			const lfo = this.lfoSettings[i], runtime = this.lfos[i];
			if (!lfo.enabled || lfo.depth <= 0) continue;
			runtime.phase = (runtime.phase + dt * Math.max(0, lfo.rate)) % 1;
			runtime.env = Math.min(1, runtime.env + dt * 2.2);
			modulation[lfo.target] *= Math.max(0,
				1 + lfoSignal(lfo.shape, runtime.phase, runtime.table) * lfo.depth * runtime.env);
		}
		for (const key of ['modeIntensity', 'modeDetail', 'modeDepth', 'modeMotion'] as const) {
			modulation[key] = Math.min(2.5, Math.max(0.25, modulation[key]));
		}
		return modulation;
	}

	setImage(source: VisualImage): void {
		const next = photoTexture(source.image);
		this.texture?.dispose();
		this.texture = next;
		this.setDeliveryImage(source.deliveryImage ?? null);
		this.material.uniforms.uImage.value = next;
		this.reset();
	}

	setDeliveryImage(image: import('#lib/image/decode').DecodedImage | null): void {
		this.deliveryTexture?.dispose();
		this.deliveryTexture = image ? photoTexture(image) : null;
	}

	protected uniforms(values: Record<string, number>): void {
		for (const [key, value] of Object.entries(values)) this.material.uniforms[key].value = value;
	}

	render(target: THREE.WebGLRenderTarget | null): void {
		this.draw(target);
	}

	protected draw(target: THREE.WebGLRenderTarget | null): void {
		const { renderer, camera } = this.context;
		const previous = renderer.getRenderTarget();
		try {
			renderer.setRenderTarget(target);
			renderer.render(this.scene, camera);
		} finally {
			renderer.setRenderTarget(previous);
		}
	}

	renderDelivery(target: THREE.WebGLRenderTarget): void {
		const image = this.material.uniforms.uImage.value;
		if (this.deliveryTexture) this.material.uniforms.uImage.value = this.deliveryTexture;
		try { this.draw(target); }
		finally { this.material.uniforms.uImage.value = image; }
	}

	resize(_width: number, _height: number): void {}
	reset(): void {
		this.time = 0;
		Object.assign(this.modeModulation, neutralModulation());
		for (let i = 0; i < this.lfos.length; i++) {
			this.lfos[i].phase = i * 0.19;
			this.lfos[i].env = 1;
		}
	}
	dispose(): void {
		this.texture?.dispose();
		this.deliveryTexture?.dispose();
		this.mesh.geometry.dispose();
		this.material.dispose();
		this.scene.clear();
	}
}
