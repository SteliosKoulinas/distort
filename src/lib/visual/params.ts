import type { SimParams } from '#lib/core/params';

/** Original receives only its own controls; routing is resolved before update. */
export type ParticleParams = Omit<SimParams,
	'visualEngine' | 'audio' | 'structural' | 'surface' | 'temporal' | 'signal' | 'fragmented'>;

export function particleParams(params: SimParams): ParticleParams {
	const { visualEngine, audio, structural, surface, temporal, signal, fragmented, ...own } = params;
	return own;
}
