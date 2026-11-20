import type { ImageAnalysis } from './analyze';
import { StructureBuilder } from './structure-client';

interface Entry {
	analysis: ImageAnalysis;
	builder: StructureBuilder;
	promise: Promise<Uint8Array>;
	pixels: Uint8Array | null;
	lastUsed: number;
}

const MAX_ENTRIES = 4;
const entries: Entry[] = [];
let clock = 0;

function evict(): void {
	while (entries.length > MAX_ENTRIES) {
		const candidates = entries
			.filter((entry) => entry.pixels !== null)
			.sort((a, b) => a.lastUsed - b.lastUsed);
		const victim = candidates[0];
		if (!victim) return;
		victim.builder.dispose();
		entries.splice(entries.indexOf(victim), 1);
	}
}

/** Cache structure maps by the analysis object, which also encodes resolution. */
export function getStructurePixels(analysis: ImageAnalysis): Promise<Uint8Array> {
	const existing = entries.find((entry) => entry.analysis === analysis);
	if (existing) {
		existing.lastUsed = ++clock;
		return existing.promise;
	}

	const builder = new StructureBuilder();
	const entry: Entry = {
		analysis,
		builder,
		pixels: null,
		lastUsed: ++clock,
		promise: Promise.resolve(new Uint8Array())
	};
	entry.promise = builder.build(analysis).then((pixels) => {
		entry.pixels = pixels;
		entry.lastUsed = ++clock;
		builder.dispose();
		evict();
		return pixels;
	}).catch((error) => {
		builder.dispose();
		const index = entries.indexOf(entry);
		if (index >= 0) entries.splice(index, 1);
		throw error;
	});
	entries.push(entry);
	evict();
	return entry.promise;
}

export function structureCacheStats(): { entries: number; completed: number } {
	return {
		entries: entries.length,
		completed: entries.filter((entry) => entry.pixels !== null).length
	};
}
