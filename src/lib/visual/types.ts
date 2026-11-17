import type * as THREE from 'three';
import type { AudioFeatures } from '#lib/audio/features';
import type { ImageAnalysis } from '#lib/image/analyze';
import type { DecodedImage } from '#lib/image/decode';

export type VisualEngineId =
	| 'particles'
	| 'structural-erosion'
	| 'surface-morphology'
	| 'temporal-residue'
	| 'signal-dislocation'
	| 'fragmented-planes';

export interface VisualImage {
	image: DecodedImage;
	analysis: ImageAnalysis;
}

export interface VisualRenderContext {
	renderer: THREE.WebGLRenderer;
	scene: THREE.Scene;
	camera: THREE.Camera;
	canvas: HTMLCanvasElement;
	width: number;
	height: number;
}

/**
 * Minimal lifecycle contract for independent visual experiments.
 *
 * Engines own the GPU resources they create. The host owns the render loop,
 * audio feature layer and export timing; an engine must not create a second
 * audio context or a second animation loop.
 */
export interface VisualEngine<Params = Record<string, never>> {
	readonly id: VisualEngineId;
	initialize(context: VisualRenderContext): void;
	setImage(image: VisualImage | null): void;
	update(deltaTime: number, time: number, features: AudioFeatures): void;
	render(context: VisualRenderContext): void;
	resize(width: number, height: number): void;
	reset(): void;
	dispose(): void;
	setParams(params: Params): void;
}
