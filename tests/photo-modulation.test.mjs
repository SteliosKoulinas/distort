import assert from 'node:assert/strict';
import { test } from 'node:test';
import { modulatePhotoValue } from '../src/lib/core/photo-modulation.ts';
import { neutralModulation } from '../src/lib/core/params.ts';

test('all six image-optics routes have neutral factors', () => {
	const modulation = neutralModulation();
	for (const target of [
		'photoParticles', 'photoBreak', 'photoRefraction',
		'photoFolds', 'photoBlocks', 'photoChroma'
	]) assert.equal(modulation[target], 1);
});

test('photo modulation is silent at rest and follows the audio envelope', () => {
	assert.equal(modulatePhotoValue(0.4, 2, 0), 0.4);
	assert.ok(Math.abs(modulatePhotoValue(0.4, 2, 0.5) - 0.6) < 1e-12);
	assert.equal(modulatePhotoValue(0.4, 2, 1), 0.8);
	assert.equal(modulatePhotoValue(0.4, 0, 1), 0);
});

test('disabled zero stays zero and 0..1 controls never leave their range', () => {
	assert.equal(modulatePhotoValue(0, 2, 1), 0);
	assert.equal(modulatePhotoValue(0.8, 2, 1), 1);
	assert.equal(modulatePhotoValue(0.2, -5, 1), 0);
});
