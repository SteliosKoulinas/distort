import type { SimParams } from '#lib/core/params';
import type { AudioFrame } from '#lib/audio/types';
import type { ControlSchema, VisualRenderContext } from '../types';
import { ImageEngine } from './image-engine';
import { signalFragmentShader, signalVertexShader } from '#lib/gpu/shaders/signal';

export const signalControls: ControlSchema = {
	panels: [], sliders: [
		{ key: 'intensity', label: 'Intensity', min: 0, max: 1, step: 0.01 },
		{ key: 'rows', label: 'Rows', min: 0, max: 1, step: 0.01 },
		{ key: 'channel', label: 'Channels', min: 0, max: 1, step: 0.01 },
		{ key: 'recovery', label: 'Recovery', min: 0, max: 1, step: 0.01 }
	]
};

export class SignalEngine extends ImageEngine<SimParams['signal']> {
	readonly id = 'signal-dislocation';
	readonly controls = signalControls;
	readonly silenceBehaviour = 'A low-level scan drift remains visible; transients open stronger row slips and RGB separation.';

	init(context: VisualRenderContext): void {
		this.setup(context, signalVertexShader, signalFragmentShader, {
			uIntensity: 0, uRows: 0, uChannel: 0, uRecovery: 0,
			uHigh: 0, uFlux: 0, uTransient: 0, uCentroid: 0
		});
	}

	update(dt: number, audio: AudioFrame): void {
		this.time += dt;
		const p = this.params, f = audio.features, m = this.advanceModulation(dt);
		this.uniforms({ uTime: this.time, uIntensity: p.intensity * m.modeIntensity,
			uRows: p.rows * m.modeDepth, uChannel: p.channel * m.modeDetail,
			uRecovery: Math.min(1, p.recovery * m.modeMotion), uHigh: f.high,
			uFlux: f.flux, uTransient: f.transient, uCentroid: f.centroid });
	}
}
