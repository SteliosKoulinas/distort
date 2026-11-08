import type { LfoShape } from './params';
import { mulberry32 } from './rng';

export const LFO_SLOTS = 4;
export const LFO_RANDOM_STEPS = 16;

/**
 * Periodic sample-and-hold values for the `random` shape. The seed depends on
 * the route index, so each random LFO wanders through a different set of
 * values and the table survives preset changes.
 */
export function createRandomTable(index: number): Float32Array {
	const rand = mulberry32(0x9e3779b9 + index * 7919);
	const table = new Float32Array(LFO_RANDOM_STEPS);
	for (let i = 0; i < LFO_RANDOM_STEPS; i++) table[i] = rand() * 2 - 1;
	return table;
}

/**
 * LFO signal in -1..1 for a phase in 0..1. Random is a periodic
 * sample-and-hold with smoothstep interpolation, so it wanders instead of
 * stepping like white noise.
 */
export function lfoSignal(shape: LfoShape, phase: number, table: Float32Array): number {
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
