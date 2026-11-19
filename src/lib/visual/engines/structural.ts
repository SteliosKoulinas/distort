import * as THREE from 'three';
import type { SimParams } from '#lib/core/params';
import type { AudioFrame } from '#lib/audio/types';
import type { ControlSchema, VisualImage, VisualRenderContext } from '../types';
import { ImageEngine } from './image-engine';
import { StructureBuilder } from '#lib/image/structure-client';
import { dataTexture } from '../resources';
import { structuralFragmentShader, structuralVertexShader } from '#lib/gpu/shaders/structural';

export const structuralControls: ControlSchema = {
	panels: [], sliders: [
		{ key: 'intensity', label: 'Intensity', min: 0, max: 1, step: 0.01 },
		{ key: 'sensitivity', label: 'Sensitivity', min: 0, max: 1, step: 0.01 },
		{ key: 'recovery', label: 'Recovery', min: 0, max: 1, step: 0.01,
			hint: 'Prototype recovery; irreversible material damage is planned for the template mode.' },
		{ key: 'scale', label: 'Field scale', min: 0, max: 1, step: 0.01 }
	]
};

export class StructuralEngine extends ImageEngine<SimParams['structural']> {
	readonly id = 'structural-erosion';
	readonly controls = structuralControls;
	readonly silenceBehaviour = 'Returns to source. Irreversible damage is not yet implemented.';
	private structure: THREE.DataTexture | null = null;
	private builder = new StructureBuilder();

	init(context: VisualRenderContext): void {
		this.setup(context, structuralVertexShader, structuralFragmentShader, {
			uStructure: null, uIntensity: 0, uSensitivity: 0, uRecovery: 0, uScale: 0,
			uLow: 0, uMid: 0, uHigh: 0, uFlux: 0, uTransient: 0
		});
	}

	async setImage(source: VisualImage): Promise<void> {
		const pixels = await this.builder.build(source.analysis);
		this.structure?.dispose();
		this.structure = dataTexture(pixels, source.analysis.width, source.analysis.height);
		this.material.uniforms.uStructure.value = this.structure;
		super.setImage(source);
	}

	update(dt: number, audio: AudioFrame): void {
		this.time += dt;
		const p = this.params, f = audio.features;
		this.uniforms({ uTime: this.time, uIntensity: p.intensity, uSensitivity: p.sensitivity,
			uRecovery: p.recovery, uScale: p.scale, uLow: f.low, uMid: f.mid, uHigh: f.high,
			uFlux: f.flux, uTransient: f.transient });
	}

	dispose(): void { this.builder.dispose(); this.structure?.dispose(); super.dispose(); }
}
