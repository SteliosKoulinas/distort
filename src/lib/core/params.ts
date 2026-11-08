/**
 * A parameter object, not a framework store.
 *
 * The UI owns the reactive copy. Once the user stops moving a control, a plain
 * snapshot is handed to ParticleField. The animation loop reads that ordinary
 * object and never touches Svelte reactivity.
 */

import type { PaletteMode } from './palette';

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
	| 'opacity';

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
		opacity: 1
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
			edgeBoost: 1.4
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
			edgeBoost: 1.25
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
			edgeBoost: 1.5
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
			edgeBoost: 1.15
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
		edgeBoost: between(0.8, 2.4)
	};
}
