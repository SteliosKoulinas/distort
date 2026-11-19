import type * as THREE from 'three';
import type { AudioFrame } from '#lib/audio/types';
import type { ImageAnalysis } from '#lib/image/analyze';
import type { DecodedImage } from '#lib/image/decode';
import type { PointerState } from '#lib/gpu/simulation';
import type { LfoView } from '#lib/gpu/field';

export type VisualEngineId = 'particles' | 'structural-erosion' | 'surface-morphology'
	| 'temporal-residue' | 'signal-dislocation' | 'fragmented-planes';

export interface VisualImage {
	image: DecodedImage;
	analysis: ImageAnalysis;
}

export interface SliderControl {
	key: string;
	label: string;
	min: number;
	max: number;
	step: number;
	hint?: string;
}

export interface ControlSchema {
	sliders: readonly SliderControl[];
	/** Custom panels for richer controls such as the Original LFO editor. */
	panels: readonly string[];
}

export interface EngineStats {
	count: number;
	textureSize: number;
	precision: 'float32' | 'float16';
}

/** Mutable stage information owned by the host; no engine owns the renderer. */
export interface VisualRenderContext {
	renderer: THREE.WebGLRenderer;
	camera: THREE.Camera;
	fit: THREE.Vector2;
	width: number;
	height: number;
	pixelRatio: number;
	pointer: PointerState;
}

export interface VisualEngine<Params = never> {
	readonly id: VisualEngineId;
	readonly controls: ControlSchema;
	/** Describes current implemented behaviour, not the later artistic target. */
	readonly silenceBehaviour: string;
	readonly stats: EngineStats;
	init(context: VisualRenderContext): void;
	setImage(image: VisualImage): void | Promise<void>;
	setParams(params: Params): void;
	update(dt: number, audio: AudioFrame): void;
	render(target: THREE.WebGLRenderTarget | null): void;
	resize(width: number, height: number): void;
	reset(): void;
	/** Rebuild sampling while retaining performance controls such as LFO phase. */
	resample?(): void;
	dispose(): void;
	kick?(strength: number): void;
	reassemble?(): void;
	getLfoView?(index: number): LfoView | null;
	triggerLfo?(index: number): void;
}
