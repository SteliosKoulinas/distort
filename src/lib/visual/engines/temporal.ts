import * as THREE from 'three';
import type { SimParams } from '#lib/core/params';
import type { AudioFrame } from '#lib/audio/types';
import type { ControlSchema, VisualRenderContext } from '../types';
import { ImageEngine } from './image-engine';
import { FeedbackBuffer, renderTarget } from '../resources';
import { photoVertexShader } from '#lib/gpu/shaders/photo';
import { temporalVertexShader, temporalFragmentShader, temporalCopyFragmentShader } from '#lib/gpu/shaders/temporal';

export const temporalControls: ControlSchema = {
	panels: [], sliders: [
		{ key: 'memory', label: 'Memory', min: 0, max: 1, step: 0.01 },
		{ key: 'decay', label: 'Decay', min: 0, max: 1, step: 0.01 },
		{ key: 'drift', label: 'Residue drift', min: 0, max: 1, step: 0.01 }
	]
};

export class TemporalEngine extends ImageEngine<SimParams['temporal']> {
	readonly id = 'temporal-residue';
	readonly controls = temporalControls;
	readonly silenceBehaviour = 'Converges to source (P0). Exposure freeze and pixel ages are planned.';
	private source!: THREE.WebGLRenderTarget;
	private history!: FeedbackBuffer;
	private feedback!: THREE.ShaderMaterial;
	private copy!: THREE.ShaderMaterial;
	private passScene = new THREE.Scene();
	private passMesh!: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;

	init(context: VisualRenderContext): void {
		// Dedicated fitted photo quad: independent of Original's meshes and optics.
		this.setup(context, photoVertexShader, `
			uniform sampler2D uImage;
			varying vec2 vUv;
			void main() { gl_FragColor = texture2D(uImage, vUv); }
		`, {});
		this.source = renderTarget(context.width, context.height);
		this.history = new FeedbackBuffer(context.width, context.height);
		this.feedback = new THREE.ShaderMaterial({
			uniforms: {
				uCurrent: { value: null }, uHistory: { value: null }, uTime: { value: 0 },
				uMemory: { value: 0 }, uDecay: { value: 0 }, uDrift: { value: 0 },
				uLow: { value: 0 }, uFlux: { value: 0 }, uTransient: { value: 0 }
			},
			vertexShader: temporalVertexShader, fragmentShader: temporalFragmentShader,
			depthTest: false, depthWrite: false, toneMapped: false
		});
		this.copy = new THREE.ShaderMaterial({
			uniforms: { uTexture: { value: null } },
			vertexShader: temporalVertexShader, fragmentShader: temporalCopyFragmentShader,
			depthTest: false, depthWrite: false, toneMapped: false
		});
		this.passMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.feedback);
		this.passMesh.frustumCulled = false;
		this.passScene.add(this.passMesh);
	}

	update(dt: number, audio: AudioFrame): void {
		this.time += dt;
		const p = this.params, f = audio.features, u = this.feedback.uniforms;
		u.uTime.value = this.time;
		u.uMemory.value = p.memory * Math.min(1, f.rms * 8);
		u.uDecay.value = p.decay;
		u.uDrift.value = p.drift;
		u.uLow.value = f.low;
		u.uFlux.value = f.flux;
		u.uTransient.value = f.transient;
	}

	render(target: THREE.WebGLRenderTarget | null): void {
		const { renderer, camera } = this.context;
		const previous = renderer.getRenderTarget();
		try {
			if (this.history.dirty) this.history.clear(renderer);
			super.render(this.source);
			this.feedback.uniforms.uCurrent.value = this.source.texture;
			this.feedback.uniforms.uHistory.value = this.history.read.texture;
			this.passMesh.material = this.feedback;
			renderer.setRenderTarget(this.history.write);
			renderer.render(this.passScene, camera);
			this.copy.uniforms.uTexture.value = this.history.write.texture;
			this.passMesh.material = this.copy;
			renderer.setRenderTarget(target);
			renderer.render(this.passScene, camera);
			this.history.swap();
		} finally {
			renderer.setRenderTarget(previous);
		}
	}

	resize(width: number, height: number): void {
		this.source.setSize(width, height);
		this.history.resize(width, height);
	}

	reset(): void { super.reset(); this.history?.reset(); }

	dispose(): void {
		this.source.dispose();
		this.history.dispose();
		this.feedback.dispose();
		this.copy.dispose();
		this.passMesh.geometry.dispose();
		this.passScene.clear();
		super.dispose();
	}
}
