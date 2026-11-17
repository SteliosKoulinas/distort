import * as THREE from 'three';
import type { SampledParticles } from '#lib/image/sample';
import type { FormSettings, Modulation, PhotoSettings, SimParams } from '#lib/core/params';
import type { AudioFrame } from '#lib/audio/types';
import type { DecodedImage } from '#lib/image/decode';
import type { NormalField } from './normals';
import { modulatePhotoValue } from '#lib/core/photo-modulation';
import { renderFragmentShader, renderVertexShader } from './shaders/render';
import { photoFragmentShader, photoVertexShader } from './shaders/photo';
import { surfaceFragmentShader, surfaceVertexShader } from './shaders/surface';

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
	private readonly photoMaterial: THREE.ShaderMaterial;
	private readonly photoMesh: THREE.Mesh;
	private readonly surfaceMaterial: THREE.ShaderMaterial;
	private readonly surfaceMesh: THREE.Mesh;
	private photoTexture: THREE.DataTexture | null = null;
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
	private photo: PhotoSettings = {
		enabled: true, particles: 0.12, amount: 0.32,
		refraction: 0.65, folds: 0.4, blocks: 0.28, chroma: 0.3
	};
	private visualEngine: SimParams['visualEngine'] = 'particles';
	private surface: SimParams['surface'] = {
		intensity: 0.72,
		viscosity: 0.55,
		scale: 0.4,
		folding: 0.35
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

		this.photoMaterial = new THREE.ShaderMaterial({
			uniforms: {
				uImage: { value: null },
				uNormals: { value: this.normalTexture },
				uFit: { value: this.fit },
				uTime: { value: 0 },
				uStrength: { value: 0 },
				uRefraction: { value: 0 },
				uFolds: { value: 0 },
				uBlocks: { value: 0 },
				uChroma: { value: 0 },
				uBass: { value: 0 },
				uTreble: { value: 0 },
				uBeat: { value: 0 },
				uOpacity: { value: 1 },
				uImageSize: { value: new THREE.Vector2(1, 1) }
			},
			vertexShader: photoVertexShader,
			fragmentShader: photoFragmentShader,
			transparent: true,
			depthTest: false,
			depthWrite: false,
			toneMapped: false
		});
		this.photoMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.photoMaterial);
		this.photoMesh.visible = false;
		this.photoMesh.renderOrder = -1;
		this.photoMesh.frustumCulled = false;
		this.scene.add(this.photoMesh);

		this.surfaceMaterial = new THREE.ShaderMaterial({
			uniforms: {
				uImage: { value: null },
				uFit: { value: this.fit },
				uTime: { value: 0 },
				uIntensity: { value: 0.72 },
				uViscosity: { value: 0.55 },
				uScale: { value: 0.4 },
				uFolding: { value: 0.35 },
				uLow: { value: 0 },
				uMid: { value: 0 },
				uHigh: { value: 0 },
				uFlux: { value: 0 },
				uTransient: { value: 0 },
				uCentroid: { value: 0 },
				uOpacity: { value: 1 }
			},
			vertexShader: surfaceVertexShader,
			fragmentShader: surfaceFragmentShader,
			transparent: true,
			depthTest: false,
			depthWrite: false,
			toneMapped: false
		});
		this.surfaceMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.surfaceMaterial);
		this.surfaceMesh.visible = false;
		this.surfaceMesh.renderOrder = -3;
		this.surfaceMesh.frustumCulled = false;
		this.scene.add(this.surfaceMesh);

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
		this.points.renderOrder = 1;
		this.points.frustumCulled = false;
		this.scene.add(this.points);
	}

	/** Upload the decoded source once, preserving every pixel for image-space effects. */
	setPhoto(image: DecodedImage): void {
		const { width, height, imageData } = image;
		const rowBytes = width * 4;
		const pixels = new Uint8Array(imageData.data.length);
		// DataTexture's first byte row is the bottom row in WebGL. ImageData's
		// first byte row is the top, so invert on upload (not in the shader).
		for (let y = 0; y < height; y++) {
			pixels.set(imageData.data.subarray(y * rowBytes, (y + 1) * rowBytes), (height - y - 1) * rowBytes);
		}
		const texture = new THREE.DataTexture(pixels, width, height, THREE.RGBAFormat, THREE.UnsignedByteType);
		texture.minFilter = THREE.LinearFilter;
		texture.magFilter = THREE.LinearFilter;
		texture.generateMipmaps = false;
		texture.wrapS = THREE.ClampToEdgeWrapping;
		texture.wrapT = THREE.ClampToEdgeWrapping;
		texture.colorSpace = THREE.NoColorSpace; // shader outputs source sRGB bytes directly
		texture.needsUpdate = true;
		this.photoTexture?.dispose();
		this.photoTexture = texture;
		this.photoMaterial.uniforms.uImage.value = texture;
		this.surfaceMaterial.uniforms.uImage.value = texture;
		this.photoMaterial.uniforms.uImageSize.value.set(width, height);
		this.photoMesh.visible = this.photo.enabled;
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
		this.photoMaterial.uniforms.uNormals.value = texture;
		previous.dispose();
	}

	setParams(params: SimParams): void {
		this.visualEngine = params.visualEngine;
		this.pointSize = params.pointSize;
		this.opacity = params.opacity;
		this.form = { ...params.form };
		this.photo = { ...params.photo };
		this.surface = { ...params.surface };
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
		motion: number,
		audioResponse: number
	): void {
		const photo = this.photo;
		const surface = this.visualEngine === 'surface-morphology' && !!this.photoTexture;
		const showPhoto = !!this.photoTexture && photo.enabled && !surface;
		const photoParticles = showPhoto
			? modulatePhotoValue(photo.particles, modulation.photoParticles, audioResponse)
			: 1;
		this.photoMesh.visible = showPhoto;
		this.surfaceMesh.visible = surface;
		if (surface) {
			const u = this.surfaceMaterial.uniforms;
			const features = audio.features;
			u.uTime.value = time;
			u.uIntensity.value = clamp01(this.surface.intensity) * clamp01(audioResponse);
			u.uViscosity.value = clamp01(this.surface.viscosity);
			u.uScale.value = clamp01(this.surface.scale);
			u.uFolding.value = clamp01(this.surface.folding);
			u.uLow.value = clamp01(features?.low ?? audio.bass);
			u.uMid.value = clamp01(features?.mid ?? audio.mid);
			u.uHigh.value = clamp01(features?.high ?? audio.treble);
			u.uFlux.value = clamp01(features?.flux ?? audio.beat);
			u.uTransient.value = clamp01(features?.transient ?? audio.beat);
			u.uCentroid.value = clamp01(features?.centroid ?? 0.5);
			u.uOpacity.value = 1;
		}
		if (showPhoto) {
			const u = this.photoMaterial.uniforms;
			u.uTime.value = time;
			u.uStrength.value = modulatePhotoValue(photo.amount, modulation.photoBreak, audioResponse)
				* clamp01(audioResponse);
			u.uRefraction.value = modulatePhotoValue(photo.refraction, modulation.photoRefraction, audioResponse);
			u.uFolds.value = modulatePhotoValue(photo.folds, modulation.photoFolds, audioResponse);
			u.uBlocks.value = modulatePhotoValue(photo.blocks, modulation.photoBlocks, audioResponse);
			u.uChroma.value = modulatePhotoValue(photo.chroma, modulation.photoChroma, audioResponse);
			u.uBass.value = clamp01(audio.bass);
			u.uTreble.value = clamp01(audio.treble);
			u.uBeat.value = clamp01(audio.beat);
			u.uOpacity.value = 1 - photoParticles;
		}
		if (this.points) {
			this.points.visible = positionTexture !== null && !surface;
			const u = this.material.uniforms;
			// Point size and opacity only swell when the piece is actually
			// moving, so a silent image keeps its printed grain.
			const amp = clamp01(audio.amp) * motion;
			u.uPosition.value = positionTexture;
			u.uTime.value = time;
			u.uPointSize.value = this.pointSize * modulation.size * (1 + amp * 0.32);
			u.uOpacity.value = Math.min(1.15, this.opacity * modulation.opacity * (1 + amp * 0.16))
				* photoParticles;

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
		this.photoTexture?.dispose();
		this.photoMesh.geometry.dispose();
		this.photoMaterial.dispose();
		this.surfaceMesh.geometry.dispose();
		this.surfaceMaterial.dispose();
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
