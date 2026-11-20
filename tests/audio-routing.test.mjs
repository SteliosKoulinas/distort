import assert from 'node:assert/strict';
import { test } from 'node:test';
import { silentAudioFrame } from '../src/lib/audio/types.ts';
import { silentAudioFeatures } from '../src/lib/audio/features.ts';
import { gateAudioFrame, RoutedAudioAnalyzer } from '../src/lib/audio/routing.ts';

test('silent audio frames remain compatible with the legacy five-number route', () => {
	const frame = silentAudioFrame();
	assert.deepEqual(
		{ bass: frame.bass, mid: frame.mid, treble: frame.treble, amp: frame.amp, beat: frame.beat },
		{ bass: 0, mid: 0, treble: 0, amp: 0, beat: 0 }
	);
	assert.deepEqual(frame.features, silentAudioFeatures());
});

const routing = { amount: 1, bass: true, mid: true, treble: true };

for (const [band, bin, descriptor] of [['bass', 4, 'low'], ['mid', 40, 'mid'], ['treble', 200, 'high']]) {
	test(`muting ${band} removes its energy and all dependent broadband descriptors`, () => {
		const analyzer = new RoutedAudioAnalyzer(48_000, 2048);
		const data = new Uint8Array(1024);
		data[bin] = 255;
		for (let i = 0; i < 30; i++) analyzer.update(data, routing);
		assert.ok(analyzer.update(data, routing).features[descriptor] > 0);
		const muted = analyzer.update(data, { ...routing, [band]: false });
		assert.deepEqual(muted, silentAudioFrame());
	});
}

test('band boundaries do not leak into adjacent routes', () => {
	const analyzer = new RoutedAudioAnalyzer(48_000, 2048);
	const bytes = new Uint8Array(1024).fill(255);
	const low = analyzer.update(bytes, { ...routing, mid: false, treble: false });
	assert.ok(low.features.low > 0);
	assert.equal(low.features.mid, 0);
	assert.equal(low.features.high, 0);
	const high = analyzer.update(bytes, { ...routing, bass: false, mid: false });
	assert.equal(high.features.low, 0);
	assert.equal(high.features.mid, 0);
	assert.ok(high.features.high > 0);
});

test('Reactive, Motion and Spectrum zero every field including descriptor history', () => {
	const analyzer = new RoutedAudioAnalyzer(48_000, 2048);
	const bytes = new Uint8Array(1024).fill(160);
	const frame = analyzer.update(bytes, routing);
	assert.deepEqual(gateAudioFrame(frame, false, 1), silentAudioFrame());
	assert.deepEqual(gateAudioFrame(frame, true, 0), silentAudioFrame());
	assert.deepEqual(analyzer.update(bytes, { ...routing, amount: 0 }), silentAudioFrame());
	assert.deepEqual(analyzer.update(bytes, { ...routing, bass: false, mid: false, treble: false }), silentAudioFrame());
	assert.equal(gateAudioFrame(frame, true, 0.5).features.rms, frame.features.rms * 0.5);
});

test('routing changes and source resets cannot create spurious onsets', () => {
	const analyzer = new RoutedAudioAnalyzer(48_000, 2048);
	const bytes = new Uint8Array(1024).fill(160);
	analyzer.update(bytes, routing);
	assert.equal(analyzer.update(bytes, { ...routing, bass: false }).features.flux, 0);
	analyzer.reset();
	assert.equal(analyzer.update(bytes, routing).features.flux, 0);
});

test('adjusting Spectrum on sustained audio scales forces without inventing a beat', () => {
	const analyzer = new RoutedAudioAnalyzer(48_000, 2048);
	const bytes = new Uint8Array(1024).fill(160);
	let previous;
	for (let i = 0; i < 600; i++) previous = analyzer.update(bytes, routing);
	assert.ok(previous.features.transient < 1e-6);
	assert.equal(previous.beat, 0);
	for (const amount of [0.9, 0.6, 0, 0, 1.2]) {
		const frame = analyzer.update(bytes, { ...routing, amount });
		assert.equal(frame.beat, 0, 'Changing gain generated a fake beat');
		assert.ok(frame.features.transient < 1e-6, 'Changing gain generated a fake transient');
		if (amount === 0) assert.deepEqual(frame, silentAudioFrame());
		else assert.equal(frame.features.centroid, previous.features.centroid);
		assert.ok(frame.features.slowEnvelope >= 0);
	}
});

test('Spectrum gain does not move a routed tone centroid, while Motion only gates response', () => {
	const analyzer = new RoutedAudioAnalyzer(48_000, 2048);
	const bytes = new Uint8Array(1024);
	bytes[30] = 255;
	const full = analyzer.update(bytes, routing);
	const half = analyzer.update(bytes, { ...routing, amount: 0.5 });
	assert.equal(half.features.centroid, full.features.centroid);
	assert.equal(gateAudioFrame(half, true, 0).features.centroid, 0);
	assert.equal(gateAudioFrame(half, false, 1).features.centroid, 0);
});
