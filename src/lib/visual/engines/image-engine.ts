import * as THREE from 'three';
import type { AudioFrame } from '#lib/audio/types';
import type { ControlSchema, VisualEngine, VisualEngineId, VisualImage, VisualRenderContext } from '../types';
import { photoTexture } from '../resources';

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
	protected time = 0;
	protected params!: P;

	abstract init(context: VisualRenderContext): void;
	abstract update(dt: number, audio: AudioFrame): void;

	protected setup(context: VisualRenderContext, vertexShader: string, fragmentShader: string,
		values: Record<string, unknown>): void {
		this.context = context;
		const uniforms: Record<string, THREE.IUniform> = {
			uImage: { value: null }, uFit: { value: context.fit },
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

	setImage(source: VisualImage): void {
		const next = photoTexture(source.image);
		this.texture?.dispose();
		this.texture = next;
		this.material.uniforms.uImage.value = next;
		this.reset();
	}

	protected uniforms(values: Record<string, number>): void {
		for (const [key, value] of Object.entries(values)) this.material.uniforms[key].value = value;
	}

	render(target: THREE.WebGLRenderTarget | null): void {
		const { renderer, camera } = this.context;
		const previous = renderer.getRenderTarget();
		try {
			renderer.setRenderTarget(target);
			renderer.render(this.scene, camera);
		} finally {
			renderer.setRenderTarget(previous);
		}
	}

	resize(_width: number, _height: number): void {}
	reset(): void { this.time = 0; }
	dispose(): void {
		this.texture?.dispose();
		this.mesh.geometry.dispose();
		this.material.dispose();
		this.scene.clear();
	}
}
