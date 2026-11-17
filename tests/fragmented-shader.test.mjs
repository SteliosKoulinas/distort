import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fragmentedFragmentShader } from '../src/lib/gpu/shaders/fragmented.ts';

test('fragmented planes use source-derived luminance bands', () => {
	assert.match(fragmentedFragmentShader, /uPlanes/);
	assert.match(fragmentedFragmentShader, /luminance/);
	assert.match(fragmentedFragmentShader, /planeOffset/);
	assert.match(fragmentedFragmentShader, /for \(int i = 0; i < 8; i\+\+\)/);
	assert.doesNotMatch(fragmentedFragmentShader, /gl_PointCoord/);
});
