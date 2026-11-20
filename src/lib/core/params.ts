/**
 * A parameter object, not a framework store.
 *
 * The UI owns the reactive copy. Once the user stops moving a control, a plain
 * snapshot is handed to ParticleField. The animation loop reads that ordinary
 * object and never touches Svelte reactivity.
 */

import type { PaletteMode } from './palette';
import type { VisualEngineId } from '#lib/visual/types';

export type LfoTarget =
	| 'curl'
	| 'scale'
	| 'spring'
	| 'pointer'
	| 'pulse'
	| 'wave'
	| 'fracture'
	| 'depth'
	| 'size'
	| 'opacity'
	| 'photoParticles'
	| 'photoBreak'
	| 'photoRefraction'
	| 'photoFolds'
	| 'photoBlocks'
	| 'photoChroma'
	| 'modeIntensity'
	| 'modeDetail'
	| 'modeDepth'
	| 'modeMotion';

export type LfoShape = 'sine' | 'triangle' | 'ramp' | 'random';

/** Per-frame multipliers produced by the LFO runtime. 1 means unmodulated. */
export type Modulation = Record<LfoTarget, number>;

export function neutralModulation(): Modulation {
	return {
		curl: 1,
		scale: 1,
		spring: 1,
		pointer: 1,
		pulse: 1,
		wave: 1,
		fracture: 1,
		depth: 1,
		size: 1,
		opacity: 1,
		photoParticles: 1,
		photoBreak: 1,
		photoRefraction: 1,
		photoFolds: 1,
		photoBlocks: 1,
		photoChroma: 1,
		modeIntensity: 1,
		modeDetail: 1,
		modeDepth: 1,
		modeMotion: 1
	};
}

export interface LfoSettings {
	enabled: boolean;
	target: LfoTarget;
	shape: LfoShape;
	/** Cycles per second. */
	rate: number;
	/** 0..1. A factor of `1 + signal * depth` is applied to the target. */
	depth: number;
}

export interface PaletteSettings {
	mode: PaletteMode;
	/** How far to move from the source colours toward the grade, 0..1. */
	amount: number;
	/** Saturation of the graded colour, 0..1. */
	chroma: number;
}

/**
 * How the photograph is treated as a surface.
 *
 * These are not forces: the dots stay in their own part of the picture. Each
 * one bends, cuts or lifts the image in its own coordinates, which is what
 * keeps a face readable while it moves. All four are gated by the same Motion
 * envelope as the physics, and each answers a different band:
 *
 *   lens   ← bass      contours slide along their own gradient
 *   raster ← treble    the image splits into its own cells
 *   slice  ← beat      horizontal bands lift sideways
 *   relief ← amp       bright structure rises toward the viewer
 */
export interface FormSettings {
	enabled: boolean;
	/** 0..1. Refraction along the luminance gradient. */
	lens: number;
	/** 0..1. Cell deconstruction, anchored to source coordinates. */
	raster: number;
	/** 0..1. Horizontal band displacement. */
	slice: number;
	/** 0..1. Depth lift from luminance. */
	relief: number;
}

/** Continuous photograph underneath the particles; no dot reconstruction needed. */
export interface PhotoSettings {
	enabled: boolean;
	/** 0 = photograph alone, 1 = original particle-only rendering. */
	particles: number;
	/** Master optical destruction, 0..1. At 1 the effects can erase legibility. */
	amount: number;
	/** Contour-following refraction / fluid glass. */
	refraction: number;
	/** Displaced horizontal strips. */
	folds: number;
	/** Image block breakup and pixelation. */
	blocks: number;
	/** RGB channel separation. */
	chroma: number;
}

export interface StructuralSettings {
	intensity: number;
	sensitivity: number;
	recovery: number;
	scale: number;
}

export interface SignalSettings {
	intensity: number;
	rows: number;
	channel: number;
	recovery: number;
}

export interface FragmentedSettings {
	intensity: number;
	planes: number;
	depth: number;
	drift: number;
}

/**
 * Audio settings. `motion` is the master gate: it decides how far the image
 * opens while a track plays. With no audio the field stays close to the
 * source, so the piece reads as a quiet photograph; pressing play starts the
 * motion. `amount` only trims the spectral forces themselves.
 */
export interface AudioSettings {
	reactive: boolean;
	/** Depth of the spectral band forces, 0..2. */
	amount: number;
	/** How far the image opens while audio plays, 0..1. */
	motion: number;
	bass: boolean;
	mid: boolean;
	treble: boolean;
}

export interface SimParams {
	/** Active visual language. The default preserves the particle engine. */
	visualEngine: VisualEngineId;
	particleCount: number;
	pointSize: number;
	opacity: number;

	curlEnabled: boolean;
	curlScale: number;
	curlSpeed: number;
	curlStrength: number;

	springEnabled: boolean;
	spring: number;
	damping: number;
	maxSpeed: number;

	pointerEnabled: boolean;
	pointerStrength: number;
	pointerRadius: number;
	pointerSwirl: number;

	pulseEnabled: boolean;
	pulseStrength: number;
	pulseRadius: number;
	autoPulse: boolean;

	waveEnabled: boolean;
	waveStrength: number;
	waveFrequency: number;
	waveSpeed: number;

	fractureEnabled: boolean;
	fractureStrength: number;
	fractureScale: number;
	fractureSpread: number;

	depthEnabled: boolean;
	depthStrength: number;

	/** Two-stop per-particle grade. Does not require a resample. */
	palette: PaletteSettings;

	/** Image-anchored optics. Does not require a resample. */
	form: FormSettings;

	/** Full-resolution image-space treatment, rendered before the point field. */
	photo: PhotoSettings;

	temporal: {
		memory: number;
		decay: number;
		drift: number;
	};

	structural: {
		intensity: number;
		sensitivity: number;
		recovery: number;
		scale: number;
	};

	surface: {
		intensity: number;
		viscosity: number;
		scale: number;
		folding: number;
	};
	signal: SignalSettings;
	fragmented: FragmentedSettings;

	/** Four user LFOs. Phases live in ParticleField, not in this snapshot. */
	lfos: LfoSettings[];

	/** Audio gate, spectral depth and band routing. */
	audio: AudioSettings;

	/** Sampling only. Changing it requires a resample, not a shader update. */
	edgeBoost: number;
	/** Changes noise offsets, fracture jitter and sampling jitter. */
	seed: number;
}

export type PresetId = 'drift' | 'ash' | 'undertow' | 'shatter' | 'still';

export interface Preset {
	id: PresetId;
	name: string;
	note: string;
	params: Partial<SimParams>;
}

const drift: SimParams = {
	visualEngine: 'particles',
	particleCount: 200_000,
	pointSize: 1.2,
	opacity: 0.68,

	curlEnabled: true,
	curlScale: 1.6,
	curlSpeed: 0.15,
	curlStrength: 0.7,

	springEnabled: true,
	spring: 1.45,
	damping: 0.925,
	maxSpeed: 2.4,

	pointerEnabled: true,
	pointerStrength: 2.2,
	pointerRadius: 0.32,
	pointerSwirl: 0.5,

	pulseEnabled: true,
	pulseStrength: 3.4,
	pulseRadius: 0.5,
	autoPulse: false,

	waveEnabled: false,
	waveStrength: 0.5,
	waveFrequency: 9,
	waveSpeed: 2.4,

	fractureEnabled: false,
	fractureStrength: 2,
	fractureScale: 8,
	fractureSpread: 0.4,

	depthEnabled: true,
	depthStrength: 0.45,

	palette: {
		mode: 'auto',
		amount: 0.85,
		chroma: 0.86
	},

	form: {
		enabled: true,
		lens: 0.55,
		raster: 0.16,
		slice: 0.1,
		relief: 0.4
	},
	photo: {
		enabled: true,
		particles: 0.12,
		amount: 0.32,
		refraction: 0.65,
		folds: 0.4,
		blocks: 0.28,
		chroma: 0.3
	},
	temporal: {
		memory: 0.7,
		decay: 0.4,
		drift: 0.7
	},
	structural: {
		intensity: 0.72,
		sensitivity: 0.82,
		recovery: 0.58,
		scale: 0.42
	},
	surface: {
		intensity: 0.72,
		viscosity: 0.55,
		scale: 0.4,
		folding: 0.35
	},
	signal: {
		intensity: 0.72,
		rows: 0.42,
		channel: 0.28,
		recovery: 0.62
	},
	fragmented: {
		intensity: 0.68,
		planes: 0.42,
		depth: 0.38,
		drift: 0.3
	},

	lfos: [
		{ enabled: true, target: 'curl', shape: 'sine', rate: 0.07, depth: 0.35 },
		{ enabled: true, target: 'depth', shape: 'triangle', rate: 0.11, depth: 0.45 },
		{ enabled: true, target: 'spring', shape: 'sine', rate: 0.055, depth: 0.22 },
		{ enabled: false, target: 'size', shape: 'random', rate: 0.16, depth: 0.18 }
	],

	audio: {
		reactive: true,
		amount: 1,
		motion: 0.65,
		bass: true,
		mid: true,
		treble: true
	},

	edgeBoost: 1.25,
	seed: 1337
};

export function createDefaultParams(): SimParams {
	return {
		...drift,
		palette: { ...drift.palette },
		form: { ...drift.form },
		photo: { ...drift.photo },
		temporal: { ...drift.temporal },
		structural: { ...drift.structural },
		surface: { ...drift.surface },
		signal: { ...drift.signal },
		fragmented: { ...drift.fragmented },
		lfos: drift.lfos.map((lfo) => ({ ...lfo })),
		audio: { ...drift.audio }
	};
}

export const PRESETS: Preset[] = [
	{
		id: 'drift',
		name: 'Drift',
		note: 'Fine dust, a slow incompressible drift. The image stays legible; the field only leans away from it.',
		params: {}
	},
	{
		id: 'ash',
		name: 'Ash',
		note: 'A wide, gentle haze. Soft edges breathe outward, but the face stays in place.',
		params: {
			pointSize: 1.0,
			opacity: 0.52,
			curlScale: 2.0,
			curlSpeed: 0.1,
			curlStrength: 0.5,
			spring: 1.5,
			damping: 0.93,
			pointerStrength: 1.4,
			pulseStrength: 2.2,
			depthStrength: 0.35,
			edgeBoost: 1.4,
			form: { enabled: true, lens: 1, raster: 0.1, slice: 0.05, relief: 0.3 }
		}
	},
	{
		id: 'undertow',
		name: 'Undertow',
		note: 'A slow vortex with a traveling ring. The pull is firm, so the image returns between swells.',
		params: {
			pointSize: 1.3,
			opacity: 0.66,
			curlScale: 1.1,
			curlSpeed: 0.26,
			curlStrength: 0.95,
			spring: 2.1,
			damping: 0.92,
			pointerStrength: 2.4,
			pointerRadius: 0.5,
			pointerSwirl: 0.9,
			pulseStrength: 2.2,
			waveEnabled: true,
			waveStrength: 0.4,
			waveFrequency: 6,
			waveSpeed: 2.0,
			depthStrength: 0.4,
			edgeBoost: 1.25,
			form: { enabled: true, lens: 0.5, raster: 0.22, slice: 0.14, relief: 0.5 }
		}
	},
	{
		id: 'shatter',
		name: 'Shatter',
		note: 'A few fine shards drift apart, each cell held close to its own place in the image.',
		params: {
			pointSize: 1.1,
			opacity: 0.66,
			curlStrength: 0.3,
			spring: 2.6,
			damping: 0.94,
			pointerStrength: 1.2,
			pulseStrength: 2.2,
			fractureEnabled: true,
			fractureStrength: 1.0,
			fractureScale: 9,
			fractureSpread: 0.35,
			depthStrength: 0.3,
			edgeBoost: 1.5,
			form: { enabled: true, lens: 0.25, raster: 0.72, slice: 0.5, relief: 0.28 }
		}
	},
	{
		id: 'still',
		name: 'Still',
		note: 'Closest to the source. The particles only breathe.',
		params: {
			pointSize: 1.1,
			opacity: 0.78,
			curlStrength: 0.08,
			spring: 3.5,
			damping: 0.88,
			pointerStrength: 0.9,
			pulseStrength: 1.6,
			depthEnabled: false,
			edgeBoost: 1.15,
			form: { enabled: true, lens: 0.3, raster: 0, slice: 0, relief: 0.22 }
		}
	}
];

/**
 * Reset to the preset's world, but keep the user's seed, quality choice,
 * palette and LFOs. Keeping them makes preset A/B comparisons honest and
 * avoids re-triggering modulation every time a preset changes.
 */
export function applyPreset(base: SimParams, preset: Preset): SimParams {
	const defaults = createDefaultParams();
	return {
		...defaults,
		...preset.params,
		seed: base.seed,
		particleCount: base.particleCount,
		palette: { ...base.palette },
		form: { ...(preset.params.form ?? defaults.form) },
		photo: { ...base.photo },
		temporal: { ...base.temporal },
		structural: { ...base.structural },
		surface: { ...base.surface },
		signal: { ...base.signal },
		fragmented: { ...base.fragmented },
		lfos: base.lfos.map((lfo) => ({ ...lfo })),
		audio: { ...base.audio }
	};
}

export function randomizeLook(base: SimParams, rand: () => number): SimParams {
	const between = (a: number, b: number) => a + (b - a) * rand();
	return {
		...base,
		seed: Math.floor(rand() * 1_000_000),
		pointSize: between(0.9, 1.9),
		opacity: between(0.55, 0.85),
		curlScale: between(0.8, 2.8),
		curlSpeed: between(0.05, 0.3),
		curlStrength: between(0.2, 1.0),
		spring: between(0.7, 2.8),
		damping: between(0.895, 0.955),
		pointerStrength: between(-1.2, 3.0),
		pointerRadius: between(0.22, 0.7),
		pointerSwirl: between(0, 1.2),
		pulseStrength: between(1.2, 4.4),
		pulseRadius: between(0.3, 0.8),
		waveEnabled: rand() > 0.48,
		waveStrength: between(0.2, 1.0),
		waveFrequency: between(3, 13),
		waveSpeed: between(1, 4),
		fractureEnabled: rand() > 0.75,
		fractureStrength: between(0.6, 2.2),
		fractureScale: between(5, 12),
		fractureSpread: between(0.2, 0.7),
		depthEnabled: rand() > 0.42,
		depthStrength: between(0.15, 0.9),
		palette: {
			...base.palette,
			amount: between(0.7, 1),
			chroma: between(0.62, 1)
		},
		form: {
			enabled: true,
			lens: between(0.25, 1),
			raster: rand() > 0.5 ? between(0.05, 0.6) : 0,
			slice: rand() > 0.6 ? between(0.05, 0.45) : 0,
			relief: between(0.15, 0.65)
		},
		photo: { ...base.photo },
		edgeBoost: between(0.8, 2.4)
	};
}
