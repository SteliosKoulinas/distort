import * as THREE from 'three';
import type { AudioFrame } from '#lib/audio/types';
import type { ParticleParams } from '../params';
import type { ControlSchema, VisualEngine, VisualImage, VisualRenderContext } from '../types';
import { neutralModulation } from '#lib/core/params';
import { LFO_SLOTS, createRandomTable, lfoSignal } from '#lib/core/lfo';
import { sampleParticles } from '#lib/image/sample';
import { resolvePalette, paletteLevels } from '#lib/core/palette';
import { hexToLinearRgb } from '#lib/core/color';
import { buildNormalField } from '#lib/gpu/normals';
import { GpuSimulation } from '#lib/gpu/simulation';
import { modulatePhotoValue } from '#lib/core/photo-modulation';
import { renderFragmentShader, renderVertexShader } from '#lib/gpu/shaders/render';
import { photoFragmentShader, photoVertexShader } from '#lib/gpu/shaders/photo';
import { dataTexture, photoTexture } from '../resources';

export const particleControls: ControlSchema = {
	sliders: [],
	panels: ['source-grade', 'optics', 'form', 'presets', 'particles', 'flow', 'return',
		'pointer', 'pulse', 'wave', 'fracture', 'depth', 'modulation']
};

/** The Original path owns its sampling, simulation, optics and modulation clock. */
export class ParticleEngine implements VisualEngine<ParticleParams> {
	readonly id = 'particles';
	readonly controls = particleControls;
	readonly silenceBehaviour = 'Quiet ambient breath; pointer, pulse and LFO gestures remain available.';
	stats = { count: 0, textureSize: 0, precision: 'float32' as 'float32' | 'float16' };
	private context!: VisualRenderContext;
	private params!: ParticleParams;
	private source: VisualImage | null = null;
	private scene = new THREE.Scene();
	private sim: GpuSimulation | null = null;
	private points: THREE.Points | null = null;
	private material!: THREE.ShaderMaterial;
	private photoMaterial!: THREE.ShaderMaterial;
	private photoMesh!: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
	private photo: THREE.DataTexture | null = null;
	private normal: THREE.DataTexture | null = null;
	private time = 0;
	private beat = 0;
	private manualBeat = 0;
	private audioEnergy = 0;
	private assembly = 0;
	private assemblyHold = 0;
	private autoPulseClock = 0;
	private modulation = neutralModulation();
	private lfos = Array.from({ length: LFO_SLOTS }, (_, index) => ({
		phase: index * 0.19, env: 1, table: createRandomTable(index)
	}));

	init(context: VisualRenderContext): void {
		this.context = context;
		this.material = new THREE.ShaderMaterial({
			uniforms: {
				uPosition: { value: null }, uNormals: { value: null }, uFit: { value: context.fit },
				uPointSize: { value: 1.2 }, uPixelRatio: { value: context.pixelRatio },
				uOpacity: { value: 0.68 }, uTime: { value: 0 },
				uPaletteDark: { value: new THREE.Vector3() }, uPaletteLight: { value: new THREE.Vector3() },
				uPaletteAmount: { value: 0 }, uPaletteChroma: { value: 0 },
				uLevelLow: { value: 0.01 }, uLevelHigh: { value: 0.6 },
				uLens: { value: 0 }, uRaster: { value: 0 }, uSlice: { value: 0 }, uRelief: { value: 0 }
			},
			vertexShader: renderVertexShader, fragmentShader: renderFragmentShader,
			transparent: true, depthTest: false, depthWrite: false,
			blending: THREE.AdditiveBlending, toneMapped: false
		});
		this.photoMaterial = new THREE.ShaderMaterial({
			uniforms: {
				uImage: { value: null }, uNormals: { value: null }, uFit: { value: context.fit },
				uTime: { value: 0 }, uStrength: { value: 0 }, uRefraction: { value: 0 },
				uFolds: { value: 0 }, uBlocks: { value: 0 }, uChroma: { value: 0 },
				uBass: { value: 0 }, uTreble: { value: 0 }, uBeat: { value: 0 },
				uOpacity: { value: 1 }, uImageSize: { value: new THREE.Vector2(1, 1) }
			},
			vertexShader: photoVertexShader, fragmentShader: photoFragmentShader,
			transparent: true, depthTest: false, depthWrite: false, toneMapped: false
		});
		this.photoMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.photoMaterial);
		this.photoMesh.renderOrder = -1;
		this.photoMesh.frustumCulled = false;
		this.scene.add(this.photoMesh);
	}

	setParams(params: ParticleParams): void {
		this.params = params;
		this.applyPalette();
	}

	setImage(source: VisualImage): void {
		const normal = buildNormalField(source.analysis);
		const nextNormal = dataTexture(normal.data, normal.width, normal.height);
		const nextPhoto = photoTexture(source.image);
		this.normal?.dispose();
		this.photo?.dispose();
		this.normal = nextNormal;
		this.photo = nextPhoto;
		this.source = source;
		this.photoMaterial.uniforms.uImage.value = nextPhoto;
		this.photoMaterial.uniforms.uImageSize.value.set(source.image.width, source.image.height);
		this.photoMaterial.uniforms.uNormals.value = nextNormal;
		this.material.uniforms.uNormals.value = nextNormal;
		this.reset();
		this.applyPalette();
	}

	reset(): void {
		this.resample();
		for (let i = 0; i < this.lfos.length; i++) {
			this.lfos[i].phase = i * 0.19;
			this.lfos[i].env = 1;
		}
		Object.assign(this.modulation, neutralModulation());
	}

	resample(): void {
		if (!this.source) return;
		const p = this.params;
		const count = Math.max(1000, Math.min(512 * 512, Math.floor(p.particleCount)));
		const sample = sampleParticles(this.source.analysis, this.source.image, {
			count, seed: p.seed, edgeBoost: p.edgeBoost
		});
		const size = Math.ceil(Math.sqrt(count));
		const next = new GpuSimulation(this.context.renderer, sample, size);
		const geometry = new THREE.BufferGeometry();
		const positions = new Float32Array(count * 3);
		const refs = new Float32Array(count * 2);
		const origins = new Float32Array(count * 2);
		for (let i = 0; i < count; i++) {
			refs[i * 2] = (i % size + 0.5) / size;
			refs[i * 2 + 1] = (Math.floor(i / size) + 0.5) / size;
			positions[i * 3] = origins[i * 2] = sample.origins[i * 4];
			positions[i * 3 + 1] = origins[i * 2 + 1] = sample.origins[i * 4 + 1];
		}
		geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
		geometry.setAttribute('aRef', new THREE.BufferAttribute(refs, 2));
		geometry.setAttribute('aOrigin', new THREE.BufferAttribute(origins, 2));
		geometry.setAttribute('aColor', new THREE.BufferAttribute(sample.colors, 3));
		geometry.setAttribute('aSize', new THREE.BufferAttribute(sample.sizes, 1));
		geometry.setAttribute('aSeed', new THREE.BufferAttribute(sample.seeds, 1));
		geometry.setDrawRange(0, count);
		this.sim?.dispose();
		if (this.points) {
			this.scene.remove(this.points);
			this.points.geometry.dispose();
		}
		this.sim = next;
		this.points = new THREE.Points(geometry, this.material);
		this.points.renderOrder = 1;
		this.points.frustumCulled = false;
		this.scene.add(this.points);
		this.time = this.beat = this.manualBeat = this.audioEnergy = 0;
		this.assembly = this.assemblyHold = this.autoPulseClock = 0;
		this.stats = { count, textureSize: size, precision: next.precision.label };
	}

	private applyPalette(): void {
		if (!this.source || !this.material) return;
		const analysis = this.source.analysis, p = this.params.palette;
		const pair = resolvePalette(p.mode, analysis), levels = paletteLevels(analysis);
		const u = this.material.uniforms;
		u.uPaletteDark.value.set(...hexToLinearRgb(pair.dark));
		u.uPaletteLight.value.set(...hexToLinearRgb(pair.light));
		u.uPaletteAmount.value = p.mode === 'source' ? 0 : p.amount;
		u.uPaletteChroma.value = p.chroma;
		u.uLevelLow.value = Math.max(0.0005, levels.low);
		u.uLevelHigh.value = Math.max(levels.low + 0.001, levels.high);
	}

	getLfoView(index: number) {
		const runtime = this.lfos[index], lfo = this.params.lfos[index];
		return runtime && lfo ? {
			phase: runtime.phase, signal: lfoSignal(lfo.shape, runtime.phase, runtime.table),
			env: runtime.env, table: runtime.table
		} : null;
	}

	triggerLfo(index: number): void {
		if (this.lfos[index]) { this.lfos[index].phase = 0; this.lfos[index].env = 0; }
	}
	kick(strength: number): void { this.manualBeat = Math.max(this.manualBeat, strength); }
	reassemble(): void { this.assemblyHold = 2; }

	update(dt: number, frame: AudioFrame): void {
		this.time += dt;
		const p = this.params, mod = this.modulation;
		Object.assign(mod, neutralModulation());
		for (let i = 0; i < p.lfos.length && i < this.lfos.length; i++) {
			const lfo = p.lfos[i], runtime = this.lfos[i];
			if (!lfo.enabled || lfo.depth <= 0) continue;
			runtime.phase = (runtime.phase + dt * Math.max(0, lfo.rate)) % 1;
			runtime.env = Math.min(1, runtime.env + dt * 2.2);
			mod[lfo.target] *= Math.max(0, 1 +
				lfoSignal(lfo.shape, runtime.phase, runtime.table) * lfo.depth * runtime.env);
		}
		mod.scale = Math.min(2.5, Math.max(0.35, mod.scale));
		mod.size = Math.min(2.2, Math.max(0.3, mod.size));
		mod.opacity = Math.min(1.5, Math.max(0.25, mod.opacity));
		if (!this.sim) return;

		// Only the shared gated frame can drive audio forces. Manual gestures are separate.
		this.manualBeat *= Math.exp(-dt * 4.5);
		this.beat = frame.beat;
		if (p.autoPulse && p.pulseEnabled) {
			this.autoPulseClock += dt;
			if (this.autoPulseClock > 1.7) { this.autoPulseClock = 0; this.kick(1); }
		} else this.autoPulseClock = 0;
		const audio = { ...frame, beat: Math.max(this.beat, this.manualBeat) };
		const follow = 1 - Math.exp(-dt * (audio.amp > this.audioEnergy ? 3.2 : 0.7));
		this.audioEnergy += (audio.amp - this.audioEnergy) * follow;
		const motion = 0.03 + 0.97 * this.audioEnergy;
		const response = Math.max(0, Math.min(1, (this.audioEnergy - 0.015) * 8));
		if (this.assemblyHold > 0) {
			this.assembly = Math.min(1, this.assembly + dt * 1.8);
			this.assemblyHold -= dt;
		} else this.assembly = Math.max(0, this.assembly - dt * 0.9);
		this.sim.step(dt, this.time, p, mod, this.context.pointer, audio, motion, this.assembly);

		const photo = p.photo, showPhoto = !!this.photo && photo.enabled;
		this.photoMesh.visible = showPhoto;
		const photoParticles = showPhoto ? modulatePhotoValue(photo.particles, mod.photoParticles, response) : 1;
		const u = this.photoMaterial.uniforms;
		u.uTime.value = this.time;
		u.uStrength.value = modulatePhotoValue(photo.amount, mod.photoBreak, response) * response;
		u.uRefraction.value = modulatePhotoValue(photo.refraction, mod.photoRefraction, response);
		u.uFolds.value = modulatePhotoValue(photo.folds, mod.photoFolds, response);
		u.uBlocks.value = modulatePhotoValue(photo.blocks, mod.photoBlocks, response);
		u.uChroma.value = modulatePhotoValue(photo.chroma, mod.photoChroma, response);
		u.uBass.value = audio.bass;
		u.uTreble.value = audio.treble;
		u.uBeat.value = audio.beat;
		u.uOpacity.value = 1 - photoParticles;

		const v = this.material.uniforms, amp = audio.amp * motion, form = p.form;
		v.uPosition.value = this.sim.positionTexture;
		v.uTime.value = this.time;
		v.uPixelRatio.value = this.context.pixelRatio;
		v.uPointSize.value = p.pointSize * mod.size * (1 + amp * 0.32);
		v.uOpacity.value = Math.min(1.15, p.opacity * mod.opacity * (1 + amp * 0.16)) * photoParticles;
		const gate = form.enabled ? motion : 0;
		v.uLens.value = form.lens * gate * (0.22 + audio.bass * 0.9);
		v.uRaster.value = form.raster * gate * (0.2 + audio.treble * 0.85);
		v.uSlice.value = form.slice * gate * (0.18 + audio.beat * 0.7 + amp * 0.35);
		v.uRelief.value = form.relief * gate * (0.3 + amp * 0.8);
	}

	render(target: THREE.WebGLRenderTarget | null): void {
		const { renderer, camera } = this.context;
		const previous = renderer.getRenderTarget();
		try {
			renderer.setRenderTarget(target);
			renderer.render(this.scene, camera);
		} finally { renderer.setRenderTarget(previous); }
	}
	resize(_width: number, _height: number): void {}
	dispose(): void {
		this.sim?.dispose();
		this.points?.geometry.dispose();
		this.photo?.dispose();
		this.normal?.dispose();
		this.photoMesh.geometry.dispose();
		this.photoMaterial.dispose();
		this.material.dispose();
		this.scene.clear();
	}
}
