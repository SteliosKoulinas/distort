import type { StructureInput } from './structure';

/** One worker per active structural engine. Superseded work is cancelled. */
export class StructureBuilder {
	private worker: Worker | null = null;
	private cancel: (() => void) | null = null;
	private generation = 0;

	build(input: StructureInput): Promise<Uint8Array> {
		this.dispose();
		const id = ++this.generation;
		const worker = new Worker(new URL('./structure.worker.ts', import.meta.url), { type: 'module' });
		this.worker = worker;
		const copy: StructureInput = {
			width: input.width, height: input.height,
			sobelX: input.sobelX.slice(), sobelY: input.sobelY.slice(), edge: input.edge.slice()
		};
		return new Promise((resolve, reject) => {
			this.cancel = () => reject(new DOMException('Structure analysis cancelled.', 'AbortError'));
			const finish = () => {
				worker.terminate();
				if (this.worker === worker) { this.worker = null; this.cancel = null; }
			};
			worker.onmessage = (event: MessageEvent<{ id: number; pixels?: Uint8Array; error?: string }>) => {
				if (event.data.id !== id) return;
				finish();
				if (event.data.pixels) resolve(event.data.pixels);
				else reject(new Error(event.data.error ?? 'Structure analysis failed.'));
			};
			worker.onerror = (event) => {
				finish();
				reject(new Error(event.message || 'Could not start structure analysis.'));
			};
			worker.postMessage({ id, input: copy }, [
				copy.sobelX.buffer, copy.sobelY.buffer, copy.edge.buffer
			]);
		});
	}

	dispose(): void {
		this.worker?.terminate();
		this.cancel?.();
		this.worker = null;
		this.cancel = null;
	}
}
