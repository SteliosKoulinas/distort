import assert from 'node:assert/strict';
import { test } from 'node:test';
import { signalFragmentShader } from '../src/lib/gpu/shaders/signal.ts';

test('signal dislocation uses selective rows and channel displacement', () => {
	assert.match(signalFragmentShader, /uRows/);
	assert.match(signalFragmentShader, /uChannel/);
	assert.match(signalFragmentShader, /rowIndex/);
	assert.match(signalFragmentShader, /dislocated/);
	assert.doesNotMatch(signalFragmentShader, /gl_PointCoord/);
});
