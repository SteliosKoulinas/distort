import * as THREE from 'three';
import type { SampledParticles } from '#lib/image/sample';
import type { FormSettings, Modulation, SimParams } from '#lib/core/params';
import type { AudioFrame } from '#lib/audio/types';
import type { NormalField } from './normals';
import { renderFragmentShader, renderVertexShader } from './shaders/render';

const MAX_DPR = 1.5;

function clamp01(value: number): number {
	return Math.max(0, Math.min(1, value));
}

/**
 * The renderer knows only about points and a position texture. It does not
 * know about images, audio, physics, or Svelte. The one exception is the
 * baked normal field: it is a property of the source image, not of the loop.
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
	private renderWidth = 1;
	private renderHeight = 1;
	private imageAspect = 1;
	private dpr = 1;
	private pointSize = 1.2;
	private opacity = 0.65;
	private form: FormSettings = {
		enabled: true,
		lens: 0.5,
		raster: 0.18,
		slice: 0.12,
		relief: 0.35
	};
	/** Delivery size override. While set, the canvas renders at exactly this. */
	private exportSize: { width: number; height: number } | null = null;
	private normalTexture: THREE.DataTexture;

	constructor(canvas: HTMLCanvasElement) {
		this.renderer = new THREE.WebGLRenderer({
			canvas,
			antialias: false,
			alpha: false,
			depth: false,
			stencil: false,
			powerPreference: 'high-performance',
			preserveDrawingBuffer: false
		});
		this.renderer.outputColorSpace = THREE.SRGBColorSpace;
		this.renderer.setClearColor(0x070706, 1);

		this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
		this.camera.position.z = 1;

		// A neutral 1×1 surface until a photograph arrives: no bend, mid
		// luminance, no detail.
		this.normalTexture = new THREE.DataTexture(
			new Uint8Array([128, 128, 128, 0]),
			1,
			1,
			THREE.RGBAFormat,
			THREE.UnsignedByteType
		);
		this.normalTexture.minFilter = THREE.LinearFilter;
		this.normalTexture.magFilter = THREE.LinearFilter;
		this.normalTexture.wrapS = THREE.ClampToEdgeWrapping;
		this.normalTexture.wrapT = THREE.ClampToEdgeWrapping;
		this.normalTexture.colorSpace = THREE.NoColorSpace;
		this.normalTexture.needsUpdate = true;

		this.material = new THREE.ShaderMaterial({
			uniforms: {
				uPosition: { value: null },
				uNormals: { value: this.normalTexture },
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
				uLevelHigh: { value: 0.6 },
				uLens: { value: 0 },
				uRaster: { value: 0 },
				uSlice: { value: 0 },
				uRelief: { value: 0 }
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
		const origins = new Float32Array(count * 2);
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
			origins[i * 2] = sample.origins[i * 4];
			origins[i * 2 + 1] = sample.origins[i * 4 + 1];

			colors[i * 3] = sample.colors[i * 3];
			colors[i * 3 + 1] = sample.colors[i * 3 + 1];
			colors[i * 3 + 2] = sample.colors[i * 3 + 2];
			sizes[i] = sample.sizes[i];
			seeds[i] = sample.seeds[i];
		}

		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
		geometry.setAttribute('aRef', new THREE.BufferAttribute(refs, 2));
		geometry.setAttribute('aOrigin', new THREE.BufferAttribute(origins, 2));
		geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
		geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
		geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
		geometry.setDrawRange(0, count);

		this.points = new THREE.Points(geometry, this.material);
		this.points.frustumCulled = false;
		this.scene.add(this.points);
	}

	/** The source's own relief. Rebuilt only when a new image is loaded. */
	setNormals(field: NormalField): void {
		const texture = new THREE.DataTexture(
			field.data,
			field.width,
			field.height,
			THREE.RGBAFormat,
			THREE.UnsignedByteType
		);
		texture.minFilter = THREE.LinearFilter;
		texture.magFilter = THREE.LinearFilter;
		texture.wrapS = THREE.ClampToEdgeWrapping;
		texture.wrapT = THREE.ClampToEdgeWrapping;
		texture.generateMipmaps = false;
		texture.colorSpace = THREE.NoColorSpace;
		texture.needsUpdate = true;

		const previous = this.normalTexture;
		this.normalTexture = texture;
		this.material.uniforms.uNormals.value = texture;
		previous.dispose();
	}

	setParams(params: SimParams): void {
		this.pointSize = params.pointSize;
		this.opacity = params.opacity;
		this.form = { ...params.form };
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

	/**
	 * Render at the delivery size while the stage keeps its CSS size. The
	 * preview is the file: same framing, same aspect, more pixels.
	 */
	setExportSize(width: number, height: number): void {
		this.exportSize = {
			width: Math.max(16, Math.round(width)),
			height: Math.max(16, Math.round(height))
		};
		this.applySize();
	}

	clearExportSize(): void {
		this.exportSize = null;
		this.applySize();
	}

	resize(width: number, height: number): void {
		this.stageWidth = Math.max(1, Math.floor(width));
		this.stageHeight = Math.max(1, Math.floor(height));
		this.dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
		this.applySize();
	}

	render(
		positionTexture: THREE.Texture | null,
		time: number,
		modulation: Modulation,
		audio: AudioFrame,
		motion: number
	): void {
		if (this.points) {
			this.points.visible = positionTexture !== null;
			const u = this.material.uniforms;
			// Point size and opacity only swell when the piece is actually
			// moving, so a silent image keeps its printed grain.
			const amp = clamp01(audio.amp) * motion;
			u.uPosition.value = positionTexture;
			u.uTime.value = time;
			u.uPointSize.value = this.pointSize * modulation.size * (1 + amp * 0.32);
			u.uOpacity.value = Math.min(1.15, this.opacity * modulation.opacity * (1 + amp * 0.16));

			// The image surface opens only while sound is present. The gate is
			// the same `motion` value the simulation uses, so optics and
			// physics cannot disagree about how far the photograph has opened.
			const form = this.form;
			const gate = form.enabled ? motion : 0;
			const bass = clamp01(audio.bass);
			const treble = clamp01(audio.treble);
			const beat = clamp01(audio.beat);
			u.uLens.value = form.lens * gate * (0.22 + bass * 0.9);
			u.uRaster.value = form.raster * gate * (0.2 + treble * 0.85);
			u.uSlice.value = form.slice * gate * (0.18 + beat * 0.7 + amp * 0.35);
			u.uRelief.value = form.relief * gate * (0.3 + amp * 0.8);
		}
		this.renderer.render(this.scene, this.camera);
	}

	dispose(): void {
		this.disposePoints();
		this.normalTexture.dispose();
		this.material.dispose();
		this.renderer.dispose();
	}

	private applySize(): void {
		if (this.exportSize) {
			this.renderWidth = this.exportSize.width;
			this.renderHeight = this.exportSize.height;
			this.renderer.setPixelRatio(1);
			this.renderer.setSize(this.renderWidth, this.renderHeight, false);
			// A point must cover the same fraction of the frame at any
			// resolution, so the size is scaled by the framebuffer/stage ratio.
			this.material.uniforms.uPixelRatio.value = this.renderHeight / this.stageHeight;
		} else {
			this.renderWidth = Math.max(1, Math.round(this.stageWidth * this.dpr));
			this.renderHeight = Math.max(1, Math.round(this.stageHeight * this.dpr));
			this.renderer.setPixelRatio(1);
			this.renderer.setSize(this.renderWidth, this.renderHeight, false);
			this.material.uniforms.uPixelRatio.value = this.dpr;
		}
		this.updateFit();
	}

	private updateFit(): void {
		const stageAspect = this.renderWidth / this.renderHeight;
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
