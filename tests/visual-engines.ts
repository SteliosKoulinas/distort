import * as THREE from 'three';
import { createDefaultParams } from '../src/lib/core/params';
import { analyzeImage } from '../src/lib/image/analyze';
import { silentAudioFrame } from '../src/lib/audio/types';
import { gateAudioFrame, RoutedAudioAnalyzer } from '../src/lib/audio/routing';
import { ENGINES } from '../src/lib/visual/registry';
import { ParticleView } from '../src/lib/gpu/view';
import { ParticleField } from '../src/lib/gpu/field';
import type { AudioFrame } from '../src/lib/audio/types';
import type { VisualRenderContext } from '../src/lib/visual/types';
import { renderTarget } from '../src/lib/visual/resources';
import { StructureBuilder } from '../src/lib/image/structure-client';
import { buildStructureField, packStructureField } from '../src/lib/image/structure';
import { structureCacheStats } from '../src/lib/image/structure-cache';

function assert(ok: boolean, message: string): asserts ok {
	if (!ok) throw new Error(message);
}

function difference(a: Uint8Array, b: Uint8Array): number {
	let max = 0;
	for (let i = 0; i < a.length; i++) max = Math.max(max, Math.abs(a[i] - b[i]));
	return max;
}

/** Real WebGL renders/readbacks. Run /tests/visual-engines.html on the Vite dev server. */
export async function runVisualEngineTests() {
	const canvas = document.createElement('canvas');
	const view = new ParticleView(canvas);
	view.resize(64, 64);
	const { renderer } = view;
	const context: VisualRenderContext = {
		...view.context, width: 64, height: 64, fit: new THREE.Vector2(1, 1), pixelRatio: 1
	};
	const target = renderTarget(64, 64);
	const sentinel = renderTarget(8, 8);
	const params = createDefaultParams();
	params.particleCount = 1024;
	params.photo.enabled = false; // Exercise actual points and float simulation.
	params.seed = 173;
	const imageData = new ImageData(64, 64);
	for (let y = 0; y < 64; y++) {
		for (let x = 0; x < 64; x++) {
			const i = (y * 64 + x) * 4;
			imageData.data.set([32 + x * 3, 40 + y * 3, (x + y) % 16 < 8 ? 180 : 70, 255], i);
		}
	}
	const image = { imageData, width: 64, height: 64, aspect: 1 };
	const source = { image, analysis: analyzeImage(image) };
	const quiet = silentAudioFrame();
	const loud: AudioFrame = {
		bass: 0.8, mid: 0.6, treble: 0.7, amp: 0.7, beat: 0.9,
		features: { rms: 0.7, low: 0.8, mid: 0.6, high: 0.7, flux: 0.9,
			centroid: 0.6, slowEnvelope: 0.7, transient: 0.9 }
	};
	const shaderErrors: string[] = [];
	renderer.debug.onShaderError = (gl, _program, vertex, fragment) => {
		shaderErrors.push(`${gl.getShaderInfoLog(vertex)} ${gl.getShaderInfoLog(fragment)}`);
	};
	const read = () => {
		const pixels = new Uint8Array(64 * 64 * 4);
		renderer.readRenderTargetPixels(target, 0, 0, 64, 64, pixels);
		return pixels;
	};
	const results: { name: string; passed: boolean }[] = [];
	const pass = (name: string) => results.push({ name, passed: true });
	const timings: Record<string, number> = {};
	try {
		const builder = new StructureBuilder();
		try {
			const expected = packStructureField(buildStructureField(source.analysis));
			const actual = await builder.build(source.analysis);
			assert(difference(expected, actual) === 0, 'Worker structure map differs from CPU reference');
			assert(source.analysis.sobelX.byteLength > 0, 'Worker detached host analysis arrays');
			pass('structure: worker matches reference and preserves host arrays');
			const width = 1200, height = 1200;
			const size = width * height;
			const input = {
				width, height, sobelX: new Float32Array(size).fill(0.2),
				sobelY: new Float32Array(size).fill(0.4), edge: new Float32Array(size).fill(0.5)
			};
			const start = performance.now();
			const job = builder.build(input);
			timings.structureWorkerSubmitMs = performance.now() - start;
			await job;
			timings.structureWorkerTotalMs = performance.now() - start;
			const cancelled = builder.build(input).then(
				() => false, (error) => error.name === 'AbortError'
			);
			builder.dispose();
			assert(await cancelled, 'Disposed worker did not cancel pending analysis');
			pass('structure: disposal cancels pending work');
		} finally { builder.dispose(); }
		const cacheBefore = structureCacheStats().completed;
		const cachedStructural = ENGINES.find((entry) => entry.id === 'structural-erosion')!.create();
		cachedStructural.engine.init(context);
		cachedStructural.setParams(params);
		await cachedStructural.engine.setImage(source);
		cachedStructural.engine.dispose();
		const afterFirstStructural = structureCacheStats().completed;
		const cachedStructuralAgain = ENGINES.find((entry) => entry.id === 'structural-erosion')!.create();
		cachedStructuralAgain.engine.init(context);
		cachedStructuralAgain.setParams(params);
		await cachedStructuralAgain.engine.setImage(source);
		cachedStructuralAgain.engine.dispose();
		assert(afterFirstStructural >= cacheBefore && structureCacheStats().completed === afterFirstStructural,
			'Structural re-entry started a second analysis for the same source');
		pass('structure: cached analysis reused on mode re-entry');
		for (const definition of ENGINES) {
			const take = async (audio: AudioFrame, frames = 20) => {
				const binding = definition.create(), engine = binding.engine;
				engine.init(context);
				binding.setParams(params);
				try {
					await engine.setImage(source);
					for (let i = 0; i < frames; i++) {
						engine.update(1 / 30, audio);
						renderer.setRenderTarget(sentinel);
						engine.render(target);
						assert(renderer.getRenderTarget() === sentinel, `${definition.id}: target not restored`);
					}
					return read();
				} finally { engine.dispose(); renderer.setRenderTarget(null); }
			};
			const silent = await take(quiet);
			assert(silent.some((value, i) => i % 4 !== 3 && value > 30), `${definition.id}: blank output`);
			pass(`${definition.id}: nonblank`);
			const active = await take(loud);
			assert(difference(active, await take(loud)) === 0, `${definition.id}: nondeterministic fixed-step take`);
			pass(`${definition.id}: deterministic fixed seed`);
			assert(difference(active, silent) > 0, `${definition.id}: audio has no pixel effect`);
			for (const [label, frame] of [
				['Reactive off', gateAudioFrame(loud, false, 1)],
				['Motion zero', gateAudioFrame(loud, true, 0)]
			] as const) {
				assert(difference(await take(frame), silent) === 0, `${definition.id}: ${label} leaks audio`);
				pass(`${definition.id}: ${label}`);
			}
			for (const [band, bin] of [['bass', 4], ['mid', 40], ['treble', 200]] as const) {
				const analyzer = new RoutedAudioAnalyzer(48_000, 2048);
				const spectrum = new Uint8Array(1024);
				spectrum[bin] = 255;
				const routing = { amount: 1, bass: true, mid: true, treble: true };
				analyzer.update(spectrum, routing);
				const muted = analyzer.update(spectrum, { ...routing, [band]: false });
				assert(difference(await take(muted), silent) === 0, `${definition.id}: muted ${band} leaks audio`);
				pass(`${definition.id}: ${band} muted`);
			}
		}

		const regressions: string[] = [];
		const original = ENGINES.find((entry) => entry.id === 'particles')!.create();
		const resetParams = createDefaultParams();
		resetParams.particleCount = 1024;
		resetParams.photo.enabled = false;
		resetParams.lfos[0] = { enabled: true, target: 'opacity', shape: 'sine', rate: 0.8, depth: 0.9 };
		original.engine.init(context);
		original.setParams(resetParams);
		try {
			await original.engine.setImage(source);
			const frames = () => {
				for (let i = 0; i < 20; i++) {
					original.engine.update(1 / 30, loud);
					original.engine.render(target);
				}
				return read();
			};
			const first = frames();
			original.engine.triggerLfo?.(0);
			frames();
			original.engine.reset();
			if (difference(first, frames()) !== 0) regressions.push('Original reset retains previous LFO phase/envelope');
			else pass('particles: reset reproduces the initial fixed-seed take');
			original.engine.triggerLfo?.(0);
			original.engine.update(1 / 30, loud);
			const beforeResample = original.engine.getLfoView?.(0);
			original.engine.resample?.();
			const afterResample = original.engine.getLfoView?.(0);
			assert(!!beforeResample && !!afterResample &&
				beforeResample.phase === afterResample.phase && beforeResample.env === afterResample.env,
				'Resampling reset the performance LFO phase/envelope');
			pass('particles: resampling preserves performance LFO state');
		} finally { original.engine.dispose(); }

		// Drive the real runtime clock explicitly while a Worker is pending.
		const requestFrame = window.requestAnimationFrame;
		const cancelFrame = window.cancelAnimationFrame;
		const callbacks = new Map<number, FrameRequestCallback>();
		let sequence = 0;
		window.requestAnimationFrame = (callback) => { callbacks.set(++sequence, callback); return sequence; };
		window.cancelAnimationFrame = (id) => { callbacks.delete(id); };
		const host = document.createElement('div');
		host.style.cssText = 'width:64px;height:64px';
		const fieldCanvas = document.createElement('canvas');
		host.append(fieldCanvas);
		document.body.append(host);
		let field: ParticleField | undefined;
		try {
			const fieldParams = createDefaultParams();
			fieldParams.visualEngine = 'temporal-residue';
			field = new ParticleField({ canvas: fieldCanvas, host, params: fieldParams });
			await field.setSource(source.analysis, source.image);
			let recorded = 0;
			field.setFrameHook(() => { recorded++; });
			const step = () => {
				const entry = callbacks.entries().next().value;
				assert(!!entry, 'Runtime clock unexpectedly stopped');
				callbacks.delete(entry[0]);
				entry[1](performance.now());
			};
			step();
			assert(recorded === 1, 'Ready engine did not deliver its frame');
			recorded = 0;
			field.setParams({ ...fieldParams, visualEngine: 'structural-erosion' });
			step();
			if (recorded !== 0) regressions.push('Recorder receives a canvas even when the active engine cannot render');
			await field.setSource(source.analysis, source.image);
			recorded = 0;
			step();
			assert(recorded === 1, 'Recording did not resume after Worker completion');
			if (!regressions.some((entry) => entry.startsWith('Recorder'))) pass('runtime: recorder skips unready frames and resumes');
		} finally {
			field?.dispose();
			host.remove();
			window.requestAnimationFrame = requestFrame;
			window.cancelAnimationFrame = cancelFrame;
		}
		assert(regressions.length === 0, regressions.join('\n'));

		// The original regression: current source must survive visibility/routing,
		// sRGB feedback must not darken it, and silence must converge after loud frames.
		const temporal = ENGINES.find((entry) => entry.id === 'temporal-residue')!.create();
		temporal.engine.init(context);
		temporal.setParams(params);
		try {
			await temporal.engine.setImage(source);
			for (let i = 0; i < 30; i++) {
				temporal.engine.update(1 / 30, loud);
				temporal.engine.render(target);
			}
			for (let i = 0; i < 30; i++) {
				temporal.engine.update(1 / 30, quiet);
				temporal.engine.render(target);
			}
			const pixels = read();
			for (let y = 0; y < 64; y++) {
				for (let x = 0; x < 64; x++) {
					for (let c = 0; c < 3; c++) {
						const actual = pixels[(y * 64 + x) * 4 + c];
						const expected = imageData.data[((63 - y) * 64 + x) * 4 + c];
						assert(Math.abs(actual - expected) <= 1, 'Temporal source pixels/orientation do not match');
					}
				}
			}
			pass('temporal: source convergence, colour and orientation');
			temporal.engine.reset();
			temporal.engine.update(1 / 30, loud);
			temporal.engine.render(target);
			const reset = read();
			await temporal.engine.setImage(source);
			temporal.engine.update(1 / 30, loud);
			temporal.engine.render(target);
			assert(difference(reset, read()) === 0, 'Temporal reset did not clear history');
			pass('temporal: reset and source replacement clear history');
			temporal.engine.resize(32, 32);
			temporal.engine.resize(64, 64);
			temporal.engine.reset();
			temporal.engine.update(1 / 30, loud);
			temporal.engine.render(target);
			assert(difference(reset, read()) === 0, 'Temporal resize retained stale history');
			pass('temporal: resize clears history');
		} finally { temporal.engine.dispose(); }

		// Exercise host switching, including first import in a continuous engine.
		params.visualEngine = 'temporal-residue';
		await view.setParams(params);
		await view.setSource(source);
		view.update(1 / 30, loud);
		view.engine!.render(target);
		const firstTemporal = read();
		const sampleCounts: number[] = [];
		for (let round = 0; round < 3; round++) {
			for (const definition of ENGINES) {
				params.visualEngine = definition.id;
				await view.setParams(params);
				view.update(1 / 30, loud);
				view.engine!.render(target);
				if (definition.id !== 'particles') {
					assert(view.engine!.stats.count === 0, 'Continuous engine allocated particle samples');
				}
				if (definition.id === 'temporal-residue') {
					assert(difference(firstTemporal, read()) === 0, 'Temporal re-entry retained history');
					sampleCounts.push(renderer.info.memory.textures);
				}
			}
		}
		assert(sampleCounts.every((n) => n === sampleCounts[0]), 'GPU texture count grows on repeated switches');
		pass('host: temporal re-entry reset, lazy particles, stable GPU allocation');
		params.visualEngine = 'structural-erosion';
		const pending = view.setParams(params);
		params.visualEngine = 'temporal-residue';
		await view.setParams(params);
		await pending;
		view.update(1 / 30, loud);
		view.engine!.render(target);
		assert(difference(firstTemporal, read()) === 0, 'Cancelled structure work corrupted the next engine');
		pass('host: switching during analysis discards stale work');
		assert(shaderErrors.length === 0, `Shader compilation failed: ${shaderErrors.join('\n')}`);
		pass('all shaders compile');
		return { passed: results.length, results, timings };
	} finally {
		target.dispose();
		sentinel.dispose();
		view.dispose();
		renderer.forceContextLoss();
	}
}
