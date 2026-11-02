import type { SimParams, LfoShape, Modulation } from '#lib/core/params';
import { neutralModulation } from '#lib/core/params';
import type { AudioFrame } from '#lib/audio/types';
import { silentAudioFrame } from '#lib/audio/types';
import type { ImageAnalysis } from '#lib/image/analyze';
import type { DecodedImage } from '#lib/image/decode';
import { sampleParticles, type SampledParticles } from '#lib/image/sample';
import { resolvePalette, paletteLevels } from '#lib/core/palette';
import { hexToLinearRgb } from '#lib/core/color';
import { mulberry32 } from '#lib/core/rng';
import { GpuSimulation, type PointerState } from './simulation';
import { ParticleView } from './view';

export interface FieldStats {
	fps: number;
	count: number;
	textureSize: number;
	precision: 'float32' | 'float16';
}

export interface ParticleFieldOptions {
	canvas: HTMLCanvasElement;
	host: HTMLElement;
	params: SimParams;
	onStats?: (stats: FieldStats) => void;
	onError?: (message: string) => void;
}

type Source = { analysis: ImageAnalysis; image: DecodedImage };

const MAX_COUNT = 512 * 512;
const LFO_SLOTS = 4;
const RANDOM_STEPS = 16;

interface LfoRuntime {
	phase: number;
	/** Trigger envelope: 0 at retrigger, ramps to 1. */
	env: number;
	/** Periodic smooth-random values for the `random` shape. */
	table: Float32Array;
}

/**
 * LFO signal in -1..1 for a phase in 0..1. Random is a periodic
 * sample-and-hold with smoothstep interpolation, so it wanders instead of
 * stepping like white noise.
 */
function lfoSignal(shape: LfoShape, phase: number, table: Float32Array): number {
	switch (shape) {
		case 'triangle':
			return 1 - 4 * Math.abs(phase - 0.5);
		case 'ramp':
			return phase * 2 - 1;
		case 'random': {
			const x = phase * table.length;
			const i0 = Math.floor(x) % table.length;
			const i1 = (i0 + 1) % table.length;
			const f = x - Math.floor(x);
			const s = f * f * (3 - 2 * f);
			return table[i0] * (1 - s) + table[i1] * s;
		}
		default:
			return Math.sin(phase * Math.PI * 2);
	}
}

/**
 * Owns the whole browser-side runtime: simulation, view, pointer, clock.
 * Svelte only constructs this in onMount and hands it plain parameter objects.
 */
export class ParticleField {
	private readonly canvas: HTMLCanvasElement;
	private readonly host: HTMLElement;
	private readonly view: ParticleView;
	private readonly onStats?: (stats: FieldStats) => void;
	private readonly onError?: (message: string) => void;
	private readonly observer: ResizeObserver;

	private params: SimParams;
	private source: Source | null = null;
	private sim: GpuSimulation | null = null;
	private raf = 0;
	private lastTime = 0;
	private time = 0;
	private frameCount = 0;
	private statsTime = 0;
	private stats: FieldStats = {
		fps: 0,
		count: 0,
		textureSize: 0,
		precision: 'float32'
	};

	private readonly audio: AudioFrame = silentAudioFrame();
	private readonly pointer: PointerState = { x: 0, y: 0, active: false };
	private readonly modulation: Modulation = neutralModulation();
	private readonly lfoRuntime: LfoRuntime[] = Array.from({ length: LFO_SLOTS }, (_, index) => {
		const rand = mulberry32(0x9e3779b9 + index * 7919);
		const table = new Float32Array(RANDOM_STEPS);
		for (let i = 0; i < RANDOM_STEPS; i++) table[i] = rand() * 2 - 1;
		return { phase: index * 0.19, env: 1, table };
	});
	private assembly = 0;
	private assemblyHold = 0;
	private autoPulseClock = 0;

	constructor(options: ParticleFieldOptions) {
		this.canvas = options.canvas;
		this.host = options.host;
		this.params = options.params;
		this.onStats = options.onStats;
		this.onError = options.onError;

		this.view = new ParticleView(this.canvas);
		this.view.setParams(this.params);

		this.observer = new ResizeObserver(() => this.resize());
		this.observer.observe(this.host);
		this.resize();

		this.canvas.addEventListener('pointermove', this.handlePointerMove);
		this.canvas.addEventListener('pointerdown', this.handlePointerMove);
		this.canvas.addEventListener('pointerup', this.handlePointerEnd);
		this.canvas.addEventListener('pointercancel', this.handlePointerEnd);
		this.canvas.addEventListener('pointerleave', this.handlePointerEnd);
		document.addEventListener('visibilitychange', this.handleVisibility);
	}

	setParams(params: SimParams): void {
		this.params = params;
		this.view.setParams(params);
		this.applyPalette();
	}

	/** Restart one LFO from phase 0 with a short ramp-in envelope. */
	triggerLfo(index: number): void {
		const runtime = this.lfoRuntime[index];
		if (!runtime) return;
		runtime.phase = 0;
		runtime.env = 0;
	}

	triggerAllLfos(): void {
		for (let i = 0; i < this.lfoRuntime.length; i++) this.triggerLfo(i);
	}

	setSource(analysis: ImageAnalysis, image: DecodedImage): void {
		this.source = { analysis, image };
		this.build();
		this.start();
	}

	/** Re-run decomposition + sampling with the current params. */
	resample(params?: SimParams): void {
		if (params) this.setParams(params);
		if (this.source) this.build();
	}

	start(): void {
		if (this.raf || !this.sim) return;
		this.lastTime = performance.now();
		this.statsTime = this.lastTime;
		this.frameCount = 0;
		this.raf = requestAnimationFrame(this.tick);
	}

	stop(): void {
		if (this.raf) cancelAnimationFrame(this.raf);
		this.raf = 0;
	}

	kick(strength = 1): void {
		this.audio.beat = Math.max(this.audio.beat, strength);
	}

	/** A temporary strong spring pulls the cloud home, then releases it. */
	reassemble(): void {
		this.assemblyHold = 2;
		if (this.assembly < 0.02) this.assembly = 0.02;
	}

	dispose(): void {
		this.stop();
		this.observer.disconnect();
		this.canvas.removeEventListener('pointermove', this.handlePointerMove);
		this.canvas.removeEventListener('pointerdown', this.handlePointerMove);
		this.canvas.removeEventListener('pointerup', this.handlePointerEnd);
		this.canvas.removeEventListener('pointercancel', this.handlePointerEnd);
		this.canvas.removeEventListener('pointerleave', this.handlePointerEnd);
		document.removeEventListener('visibilitychange', this.handleVisibility);
		this.sim?.dispose();
		this.sim = null;
		this.view.dispose();
		this.source = null;
	}

	private build(): void {
		if (!this.source) return;

		const count = Math.max(1000, Math.min(MAX_COUNT, Math.floor(this.params.particleCount)));
		const sample: SampledParticles = sampleParticles(this.source.analysis, this.source.image, {
			count,
			seed: this.params.seed,
			edgeBoost: this.params.edgeBoost
		});
		const textureSize = Math.ceil(Math.sqrt(count));

		// Construct the replacement first, so a precision error cannot leave
		// the view pointing at a disposed simulation.
		const nextSim = new GpuSimulation(this.view.renderer, sample, textureSize);
		this.sim?.dispose();

		this.view.setImageAspect(this.source.analysis.aspect);
		this.view.setSample(sample, textureSize);
		this.view.setParams(this.params);
		this.applyPalette();
		this.sim = nextSim;

		this.audio.beat = 0;
		this.assembly = 0;
		this.assemblyHold = 0;
		this.autoPulseClock = 0;

		this.stats = {
			fps: this.stats.fps,
			count,
			textureSize,
			precision: nextSim.precision.label
		};
		this.emitStats();
	}

	private resize(): void {
		const rect = this.host.getBoundingClientRect();
		if (rect.width < 2 || rect.height < 2) return;
		this.view.resize(rect.width, rect.height);
	}

	private applyPalette(): void {
		const analysis = this.source?.analysis;
		if (!analysis) return;

		const pair = resolvePalette(this.params.palette.mode, analysis);
		const dark = hexToLinearRgb(pair.dark);
		const light = hexToLinearRgb(pair.light);
		const levels = paletteLevels(analysis);
		const amount = this.params.palette.mode === 'source' ? 0 : this.params.palette.amount;

		this.view.setPalette(dark, light, amount, this.params.palette.chroma, levels.low, levels.high);
	}

	private updateModulation(dt: number): void {
		const mod = this.modulation;
		mod.curl = 1;
		mod.scale = 1;
		mod.spring = 1;
		mod.pointer = 1;
		mod.pulse = 1;
		mod.wave = 1;
		mod.fracture = 1;
		mod.depth = 1;
		mod.size = 1;
		mod.opacity = 1;

		const lfos = this.params.lfos;
		for (let i = 0; i < lfos.length && i < this.lfoRuntime.length; i++) {
			const lfo = lfos[i];
			if (!lfo.enabled || lfo.depth <= 0) continue;

			const runtime = this.lfoRuntime[i];
			runtime.phase += dt * Math.max(0, lfo.rate);
			if (runtime.phase >= 1) runtime.phase -= Math.floor(runtime.phase);
			if (runtime.env < 1) runtime.env = Math.min(1, runtime.env + dt * 2.2);

			const signal = lfoSignal(lfo.shape, runtime.phase, runtime.table) * lfo.depth * runtime.env;
			mod[lfo.target] *= Math.max(0, 1 + signal);
		}

		mod.scale = Math.min(2.5, Math.max(0.35, mod.scale));
		mod.size = Math.min(2.2, Math.max(0.3, mod.size));
		mod.opacity = Math.min(1.5, Math.max(0.25, mod.opacity));
	}

	private tick = (now: number): void => {
		this.raf = requestAnimationFrame(this.tick);

		const dt = Math.min(0.0333, Math.max(0.0001, (now - this.lastTime) / 1000));
		this.lastTime = now;
		this.time += dt;

		// Envelope decay is framerate independent.
		this.audio.beat *= Math.exp(-dt * 4.5);
		if (this.audio.beat < 0.0005) this.audio.beat = 0;

		if (this.params.autoPulse && this.params.pulseEnabled) {
			this.autoPulseClock += dt;
			if (this.autoPulseClock > 1.7) {
				this.autoPulseClock = 0;
				this.kick(1);
			}
		} else {
			this.autoPulseClock = 0;
		}

		if (this.assemblyHold > 0) {
			this.assembly = Math.min(1, this.assembly + dt * 1.8);
			this.assemblyHold -= dt;
		} else {
			this.assembly = Math.max(0, this.assembly - dt * 0.9);
		}

		this.updateModulation(dt);

		try {
			if (this.sim) {
				this.sim.step(
					dt,
					this.time,
					this.params,
					this.modulation,
					this.pointer,
					this.audio,
					this.assembly
				);
				this.view.render(this.sim.positionTexture, this.time, this.modulation);
			}
		} catch (error) {
			this.stop();
			this.onError?.(error instanceof Error ? error.message : 'The WebGL simulation stopped.');
			return;
		}

		this.frameCount++;
		if (now - this.statsTime >= 500) {
			const elapsed = (now - this.statsTime) / 1000;
			this.stats.fps = this.frameCount / elapsed;
			this.frameCount = 0;
			this.statsTime = now;
			this.emitStats();
		}
	};

	private emitStats(): void {
		this.onStats?.({ ...this.stats });
	}

	private handlePointerMove = (event: PointerEvent): void => {
		const rect = this.canvas.getBoundingClientRect();
		if (rect.width <= 0 || rect.height <= 0) return;

		const ndcX = ((event.clientX - rect.left) / rect.width) * 2 - 1;
		const ndcY = 1 - ((event.clientY - rect.top) / rect.height) * 2;

		// Undo the renderer's letterbox fit so forces live in image space.
		this.pointer.x = ndcX / this.view.fit.x;
		this.pointer.y = ndcY / this.view.fit.y;
		this.pointer.active = true;
	};

	private handlePointerEnd = (): void => {
		this.pointer.active = false;
	};

	private handleVisibility = (): void => {
		if (document.hidden) {
			this.stop();
		} else if (this.sim) {
			this.start();
		}
	};
}
