import type { SimParams } from '#lib/core/params';
import type { AudioFrame } from '#lib/audio/types';
import type { ControlSchema, VisualRenderContext } from '../types';
import { ImageEngine } from './image-engine';
import { surfaceFragmentShader, surfaceVertexShader } from '#lib/gpu/shaders/surface';

export const surfaceControls: ControlSchema = {
	panels: [], sliders: [
		{ key: 'intensity', label: 'Intensity', min: 0, max: 1, step: 0.01 },
		{ key: 'viscosity', label: 'Viscosity', min: 0, max: 1, step: 0.01 },
		{ key: 'scale', label: 'Field scale', min: 0, max: 1, step: 0.01 },
		{ key: 'folding', label: 'Creases', min: 0, max: 1, step: 0.01 }
	]
};

export class SurfaceEngine extends ImageEngine<SimParams['surface']> {
	readonly id = 'surface-morphology';
	readonly controls = surfaceControls;
	readonly silenceBehaviour = 'Returns to source; spring-mass dynamics are not yet implemented.';

	init(context: VisualRenderContext): void {
		this.setup(context, surfaceVertexShader, surfaceFragmentShader, {
			uIntensity: 0, uViscosity: 0, uScale: 0, uFolding: 0,
			uLow: 0, uMid: 0, uHigh: 0, uFlux: 0, uTransient: 0, uCentroid: 0
		});
	}

	update(dt: number, audio: AudioFrame): void {
		this.time += dt;
		const p = this.params, f = audio.features;
		this.uniforms({ uTime: this.time, uIntensity: p.intensity * Math.min(1, f.rms * 8),
			uViscosity: p.viscosity, uScale: p.scale, uFolding: p.folding,
			uLow: f.low, uMid: f.mid, uHigh: f.high, uFlux: f.flux,
			uTransient: f.transient, uCentroid: f.centroid });
	}
}
