import { buildStructureField, packStructureField, type StructureInput } from './structure';

self.onmessage = (event: MessageEvent<{ id: number; input: StructureInput }>) => {
	const { id, input } = event.data;
	try {
		const pixels = packStructureField(buildStructureField(input));
		self.postMessage({ id, pixels }, { transfer: [pixels.buffer] });
	} catch (error) {
		self.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
	}
};
