import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AudioFeatureExtractor, silentAudioFeatures } from '../src/lib/audio/features.ts';

function spectrum(size, value) {
	const data = new Uint8Array(size);
	data.fill(value);
	return data;
}

test('silent feature defaults are all zero', () => {
	assert.deepEqual(silentAudioFeatures(), {
		rms: 0,
		low: 0,
		mid: 0,
		high: 0,
		flux: 0,
		centroid: 0,
		slowEnvelope: 0,
		transient: 0
	});
});

test('feature extraction reports energy and centroid without DOM or Web Audio', () => {
	const extractor = new AudioFeatureExtractor(48_000, 2048);
	const data = spectrum(1024, 96);
	data[4] = 255;
	const features = extractor.update(data, 1 / 30);

	assert.ok(features.rms > 0);
	assert.ok(features.low > 0);
	assert.ok(features.centroid >= 0 && features.centroid <= 1);
	assert.ok(features.slowEnvelope > 0);
});

test('spectral flux responds to new energy and decays on a stable frame', () => {
	const extractor = new AudioFeatureExtractor(48_000, 2048);
	const quiet = spectrum(1024, 0);
	const loud = spectrum(1024, 180);
	assert.equal(extractor.update(quiet).flux, 0);
	assert.ok(extractor.update(loud).flux > 0);
	const stable = extractor.update(loud);
	assert.equal(stable.flux, 0);
	assert.equal(extractor.update(quiet).flux, 0);
	assert.ok(stable.transient >= 0 && stable.transient <= 1);
});

test('spectral flux detects an increase between two nonzero frames', () => {
	const extractor = new AudioFeatureExtractor(48_000, 2048);
	extractor.update(spectrum(1024, 64));
	assert.ok(extractor.update(spectrum(1024, 128)).flux > 0.5);
	assert.equal(extractor.update(spectrum(1024, 128)).flux, 0);
});

test('changing analyser bin count resets history instead of producing NaN descriptors', () => {
	const extractor = new AudioFeatureExtractor(48_000, 2048);
	extractor.update(spectrum(1024, 80));
	const changed = extractor.update(spectrum(512, 160));
	for (const value of Object.values(changed)) assert.ok(Number.isFinite(value));
	assert.equal(changed.flux, 0);
	assert.equal(extractor.update(spectrum(512, 160)).flux, 0);
});

test('reset removes history so the next frame is not treated as a transition', () => {
	const extractor = new AudioFeatureExtractor(48_000, 2048);
	const loud = spectrum(1024, 180);
	extractor.update(loud);
	extractor.reset();
	assert.equal(extractor.update(loud).flux, 0);
});
