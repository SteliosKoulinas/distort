import assert from 'node:assert/strict';
import { test } from 'node:test';
import { surfaceFragmentShader } from '../src/lib/gpu/shaders/surface.ts';

test('surface morphology is a continuous texture shader, not a point shader', () => {
	assert.match(surfaceFragmentShader, /uniform sampler2D uImage/);
	assert.match(surfaceFragmentShader, /uViscosity/);
	assert.match(surfaceFragmentShader, /uFolding/);
	assert.match(surfaceFragmentShader, /vec3 folded/);
	assert.doesNotMatch(surfaceFragmentShader, /gl_PointCoord/);
});
