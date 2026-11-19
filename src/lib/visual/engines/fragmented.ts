import type { SimParams } from '#lib/core/params';
import type { AudioFrame } from '#lib/audio/types';
import type { ControlSchema, VisualRenderContext } from '../types';
import { ImageEngine } from './image-engine';
import { fragmentedFragmentShader, fragmentedVertexShader } from '#lib/gpu/shaders/fragmented';

export const fragmentedControls: ControlSchema = {
	panels: [], sliders: [
		{ key: 'intensity', label: 'Intensity', min: 0, max: 1, step: 0.01 },
		{ key: 'planes', label: 'Planes', min: 0, max: 1, step: 0.01,
			hint: 'Prototype luminance regions. Colour segmentation is planned for this path.' },
		{ key: 'depth', label: 'Depth', min: 0, max: 1, step: 0.01 },
		{ key: 'drift', label: 'Drift', min: 0, max: 1, step: 0.01 }
	]
};

export class FragmentedEngine extends ImageEngine<SimParams['fragmented']> {
	readonly id = 'fragmented-planes';
	readonly controls = fragmentedControls;
	readonly silenceBehaviour = 'Coherent source; segmented planes and pose dynamics are still planned.';

	init(context: VisualRenderContext): void {
		this.setup(context, fragmentedVertexShader, fragmentedFragmentShader, {
			uIntensity: 0, uPlanes: 0, uDepth: 0, uDrift: 0,
			uLow: 0, uMid: 0, uTransient: 0, uCentroid: 0
		});
	}

	update(dt: number, audio: AudioFrame): void {
		this.time += dt;
		const p = this.params, f = audio.features;
		this.uniforms({ uTime: this.time, uIntensity: p.intensity * Math.min(1, f.rms * 8),
			uPlanes: p.planes, uDepth: p.depth, uDrift: p.drift,
			uLow: f.low, uMid: f.mid, uTransient: f.transient, uCentroid: f.centroid });
	}
}
