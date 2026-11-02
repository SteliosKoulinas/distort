import * as THREE from 'three';
import type { SampledParticles } from '#lib/image/sample';
import type { Modulation, SimParams } from '#lib/core/params';
import { renderFragmentShader, renderVertexShader } from './shaders/render';

const MAX_DPR = 1.5;

/**
 * The renderer knows only about points and a position texture. It does not
 * know about images, audio, physics, or Svelte.
 */
export class ParticleView {
	readonly renderer: THREE.WebGLRenderer;
	readonly fit = new THREE.Vector2(1, 1);

	private readonly scene = new THREE.Scene();
	private readonly camera: THREE.OrthographicCamera;
	private readonly material: THREE.ShaderMaterial;
	private points: THREE.Points | null = null;
	private stageWidth = 1;
	private stageHeight = 1;
	private imageAspect = 1;
	private dpr = 1;
	private pointSize = 1.2;
	private opacity = 0.65;

	constructor(canvas: HTMLCanvasElement) {
		this.renderer = new THREE.WebGLRenderer({
			canvas,
			antialias: false,
			alpha: false,
			depth: false,
			stencil: false,
			powerPreference: 'high-performance'
		});
		this.renderer.outputColorSpace = THREE.SRGBColorSpace;
		this.renderer.setClearColor(0x070706, 1);

		this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
		this.camera.position.z = 1;

		this.material = new THREE.ShaderMaterial({
			uniforms: {
				uPosition: { value: null },
				uFit: { value: this.fit },
				uPointSize: { value: 1.55 },
				uPixelRatio: { value: 1 },
				uOpacity: { value: 0.9 },
				uTime: { value: 0 },
				uPaletteDark: { value: new THREE.Vector3(0.005, 0.004, 0.003) },
				uPaletteLight: { value: new THREE.Vector3(0.85, 0.8, 0.7) },
				uPaletteAmount: { value: 0.85 },
				uPaletteChroma: { value: 0.86 },
				uLevelLow: { value: 0.01 },
				uLevelHigh: { value: 0.6 }
			},
			vertexShader: renderVertexShader,
			fragmentShader: renderFragmentShader,
			transparent: true,
			depthTest: false,
			depthWrite: false,
			blending: THREE.AdditiveBlending,
			toneMapped: false
		});
	}

	setSample(sample: SampledParticles, textureSize: number): void {
		this.disposePoints();

		const count = sample.count;
		const positions = new Float32Array(count * 3);
		const refs = new Float32Array(count * 2);
		const colors = new Float32Array(count * 3);
		const sizes = new Float32Array(count);
		const seeds = new Float32Array(count);

		for (let i = 0; i < count; i++) {
			const x = (i % textureSize + 0.5) / textureSize;
			const y = (Math.floor(i / textureSize) + 0.5) / textureSize;
			refs[i * 2] = x;
			refs[i * 2 + 1] = y;

			positions[i * 3] = sample.origins[i * 4];
			positions[i * 3 + 1] = sample.origins[i * 4 + 1];

			colors[i * 3] = sample.colors[i * 3];
			colors[i * 3 + 1] = sample.colors[i * 3 + 1];
			colors[i * 3 + 2] = sample.colors[i * 3 + 2];
			sizes[i] = sample.sizes[i];
			seeds[i] = sample.seeds[i];
		}

		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
		geometry.setAttribute('aRef', new THREE.BufferAttribute(refs, 2));
		geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
		geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
		geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
		geometry.setDrawRange(0, count);

		this.points = new THREE.Points(geometry, this.material);
		this.points.frustumCulled = false;
		this.scene.add(this.points);
	}

	setParams(params: SimParams): void {
		this.pointSize = params.pointSize;
		this.opacity = params.opacity;
		this.material.uniforms.uPointSize.value = params.pointSize;
		this.material.uniforms.uOpacity.value = params.opacity;
	}

	/** Linear-light dark/light stops plus their auto-levels. */
	setPalette(
		dark: [number, number, number],
		light: [number, number, number],
		amount: number,
		chroma: number,
		low: number,
		high: number
	): void {
		const u = this.material.uniforms;
		u.uPaletteDark.value.set(dark[0], dark[1], dark[2]);
		u.uPaletteLight.value.set(light[0], light[1], light[2]);
		u.uPaletteAmount.value = Math.max(0, Math.min(1, amount));
		u.uPaletteChroma.value = Math.max(0, Math.min(1, chroma));
		u.uLevelLow.value = Math.max(0.0005, low);
		u.uLevelHigh.value = Math.max(low + 0.001, high);
	}

	setImageAspect(aspect: number): void {
		this.imageAspect = aspect > 0 ? aspect : 1;
		this.updateFit();
	}

	resize(width: number, height: number): void {
		this.stageWidth = Math.max(1, Math.floor(width));
		this.stageHeight = Math.max(1, Math.floor(height));
		this.dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);

		this.renderer.setPixelRatio(this.dpr);
		this.renderer.setSize(this.stageWidth, this.stageHeight, false);
		this.material.uniforms.uPixelRatio.value = this.dpr;
		this.updateFit();
	}

	render(positionTexture: THREE.Texture | null, time: number, modulation: Modulation): void {
		if (this.points) {
			this.points.visible = positionTexture !== null;
			const u = this.material.uniforms;
			u.uPosition.value = positionTexture;
			u.uTime.value = time;
			u.uPointSize.value = this.pointSize * modulation.size;
			u.uOpacity.value = this.opacity * modulation.opacity;
		}
		this.renderer.render(this.scene, this.camera);
	}

	dispose(): void {
		this.disposePoints();
		this.material.dispose();
		this.renderer.dispose();
	}

	private updateFit(): void {
		const stageAspect = this.stageWidth / this.stageHeight;
		if (this.imageAspect >= stageAspect) {
			this.fit.set(1, stageAspect / this.imageAspect);
		} else {
			this.fit.set(this.imageAspect / stageAspect, 1);
		}
	}

	private disposePoints(): void {
		if (!this.points) return;
		this.scene.remove(this.points);
		this.points.geometry.dispose();
		this.points = null;
	}
}
