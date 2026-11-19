import type { SimParams } from '#lib/core/params';
import type { ControlSchema, VisualEngine, VisualEngineId } from './types';
import { particleParams } from './params';
import { ParticleEngine, particleControls } from './engines/particles';
import { StructuralEngine, structuralControls } from './engines/structural';
import { SurfaceEngine, surfaceControls } from './engines/surface';
import { TemporalEngine, temporalControls } from './engines/temporal';
import { SignalEngine, signalControls } from './engines/signal';
import { FragmentedEngine, fragmentedControls } from './engines/fragmented';

export interface EngineBinding {
	engine: VisualEngine;
	setParams(params: SimParams): void;
}

type NumericGroup = 'structural' | 'surface' | 'temporal' | 'signal' | 'fragmented';

interface EngineDefinition {
	id: VisualEngineId;
	label: string;
	description: string;
	group: NumericGroup | null;
	controls: ControlSchema;
	create(): EngineBinding;
}

function define<P>(
	id: VisualEngineId, label: string, description: string, group: NumericGroup | null,
	controls: ControlSchema, construct: () => VisualEngine<P>, select: (params: SimParams) => P
): EngineDefinition {
	return {
		id, label, description, group, controls,
		create() {
			const engine = construct();
			return { engine, setParams: (params) => engine.setParams(select(params)) };
		}
	};
}

export const ENGINES: readonly EngineDefinition[] = [
	define('particles', 'Original / particles', 'Sound refracts the photograph; the pointer pulls its grain apart.',
		null, particleControls, () => new ParticleEngine(), particleParams),
	define('structural-erosion', 'Structural erosion', 'Form under stress, following the photograph’s contours.',
		'structural', structuralControls, () => new StructuralEngine(), (p) => p.structural),
	define('surface-morphology', 'Surface morphology', 'A continuous photographic surface in motion.',
		'surface', surfaceControls, () => new SurfaceEngine(), (p) => p.surface),
	define('temporal-residue', 'Temporal residue', 'The photograph and its retained history.',
		'temporal', temporalControls, () => new TemporalEngine(), (p) => p.temporal),
	define('signal-dislocation', 'Signal dislocation', 'An image interrupted in transmission.',
		'signal', signalControls, () => new SignalEngine(), (p) => p.signal),
	define('fragmented-planes', 'Fragmented planes', 'The photograph viewed through separated planes.',
		'fragmented', fragmentedControls, () => new FragmentedEngine(), (p) => p.fragmented)
];

export function engineDefinition(id: VisualEngineId): EngineDefinition {
	const definition = ENGINES.find((entry) => entry.id === id);
	if (!definition) throw new Error(`Unknown visual engine: ${id}`);
	return definition;
}
