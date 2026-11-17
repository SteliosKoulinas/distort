import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	temporalCopyFragmentShader,
	temporalFragmentShader
} from '../src/lib/gpu/shaders/temporal.ts';

test('temporal residue is a bounded current/history compositor', () => {
	assert.match(temporalFragmentShader, /uCurrent/);
	assert.match(temporalFragmentShader, /uHistory/);
	assert.match(temporalFragmentShader, /uDecay/);
	assert.match(temporalFragmentShader, /uTransient/);
	assert.match(temporalCopyFragmentShader, /uTexture/);
});
