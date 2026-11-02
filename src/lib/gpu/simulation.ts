import * as THREE from 'three';
import type { SampledParticles } from '#lib/image/sample';
import type { AudioFrame } from '#lib/audio/types';
import type { SimParams, Modulation } from '#lib/core/params';
import {
	initializationFragmentShader,
	positionFragmentShader,
	simulationVertexShader,
	velocityFragmentShader
} from './shaders/simulation';

export type PrecisionLabel = 'float32' | 'float16';

export interface PointerState {
	x: number;
	y: number;
	active: boolean;
}

export interface SimulationPrecision {
	type: THREE.TextureDataType;
	label: PrecisionLabel;
}

function createFloatTexture(data: Float32Array, size: number): THREE.DataTexture {
	const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.FloatType);
	texture.minFilter = THREE.NearestFilter;
	texture.magFilter = THREE.NearestFilter;
	texture.wrapS = THREE.ClampToEdgeWrapping;
	texture.wrapT = THREE.ClampToEdgeWrapping;
	texture.generateMipmaps = false;
	texture.colorSpace = THREE.NoColorSpace;
	texture.needsUpdate = true;
	return texture;
}

export function detectSimulationPrecision(renderer: THREE.WebGLRenderer): SimulationPrecision {
	const float = renderer.extensions.has('EXT_color_buffer_float');
	const half = renderer.extensions.has('EXT_color_buffer_half_float');

	if (float) return { type: THREE.FloatType, label: 'float32' };
	if (half) return { type: THREE.HalfFloatType, label: 'float16' };

	throw new Error(
		'This GPU cannot render to floating-point textures. Try a recent desktop browser or disable hardware acceleration blocks.'
	);
}

function createTarget(size: number, type: THREE.TextureDataType): THREE.WebGLRenderTarget {
	const target = new THREE.WebGLRenderTarget(size, size, {
		type,
		format: THREE.RGBAFormat,
		minFilter: THREE.NearestFilter,
		magFilter: THREE.NearestFilter,
		wrapS: THREE.ClampToEdgeWrapping,
		wrapT: THREE.ClampToEdgeWrapping,
		depthBuffer: false,
		stencilBuffer: false,
		generateMipmaps: false
	});
	target.texture.colorSpace = THREE.NoColorSpace;
	return target;
}

/**
 * Two ping-pong pairs:
 *
 *   origins (static) ──┐
 *   positions[read] ───┼─> velocity pass ─> velocities[write]
 *   velocities[read] ──┘                         │
 *                                                v
 *   positions[read] ───────────────────> position pass ─> positions[write]
 *
 * Then read/write swap. Exactly two full-screen passes per frame, regardless
 * of particle count. No per-particle work ever runs in JavaScript.
 */
export class GpuSimulation {
	readonly count: number;
	readonly textureSize: number;
	readonly precision: SimulationPrecision;

	private readonly renderer: THREE.WebGLRenderer;
	private readonly origins: THREE.DataTexture;
	private readonly positions: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget];
	private readonly velocities: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget];
	private readonly scene: THREE.Scene;
	private readonly camera: THREE.OrthographicCamera;
	private readonly quad: THREE.Mesh;
	private readonly velocityMaterial: THREE.ShaderMaterial;
	private readonly positionMaterial: THREE.ShaderMaterial;
	private readonly initMaterial: THREE.ShaderMaterial;
	private readonly uniforms: Record<string, THREE.IUniform>;
	private read = 0;
	private write = 1;

	constructor(
		renderer: THREE.WebGLRenderer,
		sample: SampledParticles,
		textureSize: number
	) {
		this.renderer = renderer;
		this.count = sample.count;
		this.textureSize = textureSize;
		this.precision = detectSimulationPrecision(renderer);

		const texelCount = textureSize * textureSize;
		const packedOrigins = new Float32Array(texelCount * 4);
		packedOrigins.set(sample.origins.subarray(0, Math.min(sample.origins.length, packedOrigins.length)));
		this.origins = createFloatTexture(packedOrigins, textureSize);

		this.positions = [createTarget(textureSize, this.precision.type), createTarget(textureSize, this.precision.type)];
		this.velocities = [createTarget(textureSize, this.precision.type), createTarget(textureSize, this.precision.type)];

		this.uniforms = {
			uOrigins: { value: this.origins },
			uPositions: { value: null },
			uVelocities: { value: null },
			uTime: { value: 0 },
			uDt: { value: 1 / 60 },
			uSeed: { value: 0 },
			uCurlStrength: { value: 0 },
			uCurlScale: { value: 1 },
			uCurlSpeed: { value: 0.1 },
			uSpring: { value: 0 },
			uDamping: { value: 0.93 },
			uMaxSpeed: { value: 3 },
			uPointer: { value: new THREE.Vector2() },
			uPointerStrength: { value: 0 },
			uPointerRadius: { value: 0.3 },
			uPointerSwirl: { value: 0 },
			uPointerActive: { value: 0 },
			uPulse: { value: 0 },
			uPulseStrength: { value: 0 },
			uPulseRadius: { value: 0.5 },
			uWaveStrength: { value: 0 },
			uWaveFrequency: { value: 9 },
			uWaveSpeed: { value: 2 },
			uFractureStrength: { value: 0 },
			uFractureScale: { value: 6 },
			uFractureSpread: { value: 0.5 },
			uDepthStrength: { value: 0 },
			uAssembly: { value: 0 }
		};

		this.velocityMaterial = new THREE.ShaderMaterial({
			uniforms: this.uniforms,
			vertexShader: simulationVertexShader,
			fragmentShader: velocityFragmentShader,
			depthTest: false,
			depthWrite: false,
			toneMapped: false
		});

		this.positionMaterial = new THREE.ShaderMaterial({
			uniforms: this.uniforms,
			vertexShader: simulationVertexShader,
			fragmentShader: positionFragmentShader,
			depthTest: false,
			depthWrite: false,
			toneMapped: false
		});

		this.initMaterial = new THREE.ShaderMaterial({
			uniforms: {
				uOrigins: { value: this.origins },
				uMode: { value: 0 }
			},
			vertexShader: simulationVertexShader,
			fragmentShader: initializationFragmentShader,
			depthTest: false,
			depthWrite: false,
			toneMapped: false
		});

		this.scene = new THREE.Scene();
		this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -1, 1);
		this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.initMaterial);
		this.quad.frustumCulled = false;
		this.scene.add(this.quad);

		this.initializeTextures();
	}

	private initializeTextures(): void {
		this.quad.material = this.initMaterial;
		this.initMaterial.uniforms.uMode.value = 0;
		for (const target of this.positions) {
			this.renderer.setRenderTarget(target);
			this.renderer.render(this.scene, this.camera);
		}

		this.initMaterial.uniforms.uMode.value = 1;
		for (const target of this.velocities) {
			this.renderer.setRenderTarget(target);
			this.renderer.render(this.scene, this.camera);
		}

		this.renderer.setRenderTarget(null);
	}

	step(
		dt: number,
		time: number,
		params: SimParams,
		modulation: Modulation,
		pointer: PointerState,
		audio: AudioFrame,
		assembly: number
	): void {
		const u = this.uniforms;

		u.uTime.value = time;
		u.uDt.value = dt;
		u.uSeed.value = Math.floor(params.seed) % 100_000;

		u.uCurlStrength.value = params.curlEnabled ? params.curlStrength * modulation.curl : 0;
		u.uCurlScale.value = Math.max(0.1, params.curlScale * modulation.scale);
		u.uCurlSpeed.value = params.curlSpeed;

		u.uSpring.value = params.springEnabled ? params.spring * modulation.spring : 0;
		u.uDamping.value = params.damping;
		u.uMaxSpeed.value = Math.max(0.2, params.maxSpeed);

		u.uPointer.value.set(pointer.x, pointer.y);
		u.uPointerActive.value = pointer.active && params.pointerEnabled ? 1 : 0;
		u.uPointerStrength.value = params.pointerStrength * modulation.pointer;
		u.uPointerRadius.value = Math.max(0.01, params.pointerRadius);
		u.uPointerSwirl.value = params.pointerSwirl;

		u.uPulse.value = params.pulseEnabled ? audio.beat : 0;
		u.uPulseStrength.value = params.pulseStrength * modulation.pulse;
		u.uPulseRadius.value = Math.max(0.01, params.pulseRadius);

		u.uWaveStrength.value = params.waveEnabled ? params.waveStrength * modulation.wave : 0;
		u.uWaveFrequency.value = params.waveFrequency;
		u.uWaveSpeed.value = params.waveSpeed;

		u.uFractureStrength.value = params.fractureEnabled
			? params.fractureStrength * modulation.fracture
			: 0;
		u.uFractureScale.value = Math.max(0.5, params.fractureScale);
		u.uFractureSpread.value = params.fractureSpread;

		u.uDepthStrength.value = params.depthEnabled ? params.depthStrength * modulation.depth : 0;
		u.uAssembly.value = assembly;

		u.uPositions.value = this.positions[this.read].texture;
		u.uVelocities.value = this.velocities[this.read].texture;

		this.quad.material = this.velocityMaterial;
		this.renderer.setRenderTarget(this.velocities[this.write]);
		this.renderer.render(this.scene, this.camera);

		u.uPositions.value = this.positions[this.read].texture;
		u.uVelocities.value = this.velocities[this.write].texture;

		this.quad.material = this.positionMaterial;
		this.renderer.setRenderTarget(this.positions[this.write]);
		this.renderer.render(this.scene, this.camera);

		const nextRead = this.write;
		this.write = this.read;
		this.read = nextRead;
		this.renderer.setRenderTarget(null);
	}

	get positionTexture(): THREE.Texture {
		return this.positions[this.read].texture;
	}

	dispose(): void {
		this.origins.dispose();
		for (const target of this.positions) target.dispose();
		for (const target of this.velocities) target.dispose();
		this.velocityMaterial.dispose();
		this.positionMaterial.dispose();
		this.initMaterial.dispose();
		this.quad.geometry.dispose();
	}
}
